// 干净房间验证：把"换台机器还能不能跑"变成一条本机命令。
//
// 为什么需要它：
//   CI 的核心收益是"在干净环境里验证"，但上云有外泄与运维代价（本库的 docs/reviews 里
//   含有其它项目的安全细节，必须私有；而且 gh/glab 都没装）。本脚本用
//   **git clone + 刮干净的环境**在本机复现那件事 —— 零外泄、零云成本。
//
// 它验证的是**已提交的版本**（clone 出来的是某个 ref，默认 HEAD），不是你眼前的工作区。
// 这一点很重要：工作区全绿、但"忘了提交某个文件"是真实存在的失败模式，只有 clone 才照得出来。
//
// 它测什么（每一条都是"CI 会替你测、而本机钩子测不了"的）：
//   ① 有没有漏提交文件（clone 必须自足）
//   ② 检查器是否依赖本机配置（无 DSH、无 git 钩子、无我装过的那堆外部工具）
//   ③ 依赖是否能只靠 package.json + package-lock.json 还原
//   ④ 在"刮干净"的环境里把整套检查再跑一遍，看是否仍然全过
//
// 用法:
//   node scripts/verify-clean-clone.mjs                 # 默认验 HEAD
//   node scripts/verify-clean-clone.mjs --ref <ref>     # 验指定 commit/branch/tag
//   node scripts/verify-clean-clone.mjs --keep          # 保留临时 clone（排查用，会打印路径）
//   node scripts/verify-clean-clone.mjs --quiet
//
// 退出码: 0 = 干净环境全过；1 = 有步骤失败（**换台机器就会出问题**）；3 = 环境不具备（clone/npm 没跑成）
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const argv = process.argv.slice(2);
const getArg = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const QUIET = argv.includes("--quiet");
const KEEP = argv.includes("--keep");
const REF = getArg("--ref") ?? "HEAD";

const say = (s) => { if (!QUIET) console.log(s); };
const fail = (code, msg) => { console.error(msg); process.exit(code); };

// ── 0. 工作区脏不脏（脏的话要说清楚：这次验的不是你眼前这份）────────────────
const dirty = spawnSync("git", ["-C", REPO, "status", "--porcelain"], { encoding: "utf8" }).stdout?.trim();
if (dirty) {
  say("⚠ 工作区有未提交改动 —— 本次验证的是【已提交的 " + REF + "】，不是当前工作区。");
  say("  （想验工作区：先提交，或用 --ref <某个分支>。这正是「忘了提交」能被照出来的原因。）");
  say("");
}

// ── 1. clone（这一步故意用**正常环境**：干净机器上也得有 git 和网络）──────────
const dir = mkdtempSync(join(tmpdir(), "clean-room-"));
say(`=== 干净房间验证 ===`);
say(`源仓库 : ${REPO}`);
say(`临时目录: ${dir}`);
const clone = spawnSync("git", ["clone", "--quiet", "--no-hardlinks", REPO, dir], { encoding: "utf8" });

// clone 出来的副本要切到指定 ref
if (clone.status === 0 && REF !== "HEAD") {
  const co = spawnSync("git", ["-C", dir, "checkout", "--quiet", REF], { encoding: "utf8" });
  if (co.status !== 0) fail(3, `✗ 切到 ${REF} 失败：${co.stderr?.trim()}`);
}
if (clone.status !== 0) {
  if (!KEEP) rmSync(dir, { recursive: true, force: true });
  fail(3, `✗ git clone 没跑成（这不是"验证失败"，是环境不具备）：\n${clone.stderr?.trim()}`);
}

// ── 2. 只按 package.json / lock 装依赖 ────────────────────────────────────
say("");
say("· 按 package.json 装依赖（npm ci）——需要网络，装不成就没跑成，不算失败");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const tNpm = Date.now();
// ⚠️ `shell: true` 在这里是**必需**的：Windows 上 npm 是 `npm.cmd`，Node 不能直接执行它。
//    参数全是硬编码字面量（没有拼接任何外部输入），所以 spawn-shell-true 那条规则
//    在这里报的是"形态"而不是"风险"。**带理由抑制**，不是关掉整条规则。
const npm = spawnSync(npmCmd, ["ci", "--no-audit", "--no-fund"], { cwd: dir, encoding: "utf8", shell: process.platform === "win32" });  // nosemgrep: javascript.lang.security.audit.spawn-shell-true.spawn-shell-true
const npmSecs = ((Date.now() - tNpm) / 1000).toFixed(1);
if (npm.status !== 0) {
  const tail = `${npm.stdout ?? ""}${npm.stderr ?? ""}`.trim().split("\n").slice(-6).join("\n");
  if (!KEEP) rmSync(dir, { recursive: true, force: true });
  fail(3, `✗ npm ci 没跑成（环境/网络问题，不是"验证失败"）：\n${tail}`);
}
// **成功也要说话**：这一步原来成功时一声不响，于是日志里根本分不清
// "装好了" 和 "这一步被跳过了" —— 实测有人贴日志来问，我只能猜。
// 顺手核一下 node_modules 真的在（npm ci 成功但不产出依赖是说不通的）。
const depDir = join(dir, "node_modules");
say(`  ✓ npm ci 完成（${npmSecs}s）：${existsSync(depDir) ? "node_modules 已生成" : "**但没有 node_modules —— 这不对，请查**"}`);

// ── 3. 刮干净环境：只留 node + 系统目录 + PowerShell ──────────────────────
// 目的：把"本机才有的东西"全部藏掉 —— 用户级工具目录、DSH 配置、我装过的那堆工具。
// 保留 PowerShell 是因为 verify-ps1 用它的解析器做语法检查（Windows 专有）。
const nodeDir = dirname(process.execPath);
const sysRoot = process.env.SystemRoot || "C:\\Windows";
const cleanPath = [
  nodeDir,
  join(sysRoot, "System32"),
  join(sysRoot, "System32", "WindowsPowerShell", "v1.0"),
].join(";");
const fakeHome = join(tmpdir(), "clean-room-nohome");
const cleanEnv = {
  ...process.env,
  PATH: cleanPath,
  // 指向不存在的路径 = 假装这台机器上没有那些用户级安装
  USERPROFILE: fakeHome, APPDATA: fakeHome, LOCALAPPDATA: fakeHome,
  DSH_HOME: fakeHome,          // 断掉任何"D SH 在哪"的线索
};

say("");
say("· 刮干净环境后跑 verify-all（PATH 只留 node + System32 + PowerShell；用户目录指向不存在处）");
say(`  PATH = ${cleanPath}`);
say("");

const r = spawnSync(process.execPath, [join(dir, "scripts", "verify-all.mjs")], { cwd: dir, encoding: "utf8", env: cleanEnv });
const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
for (const line of out.trim().split("\n")) console.log(`  ${line}`);

// ── 4. 结论 ──────────────────────────────────────────────────────────────
say("");
const code = r.status ?? 1;
if (code === 0) {
  say("判定: 干净环境全过 —— 换台机器（有 node + npm，能上网装那一个依赖）也能跑。");
} else if (code === 3) {
  say("判定: 有检查器**没跑成**（不是内容有问题）—— 上面写了原因。");
} else {
  say("判定: 干净环境里**有步骤失败** —— 这就是「换台机器会出事」的意思，上面每一条都要处理。");
}
if (KEEP) say(`临时目录保留在: ${dir}`);
else rmSync(dir, { recursive: true, force: true });
process.exit(code === 0 ? 0 : code === 3 ? 3 : 1);
