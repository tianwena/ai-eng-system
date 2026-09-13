// 一条命令跑完"库自身的全部检查"。
//
// 为什么需要它：这些检查器此前只有两个入口 ——
//   ① git 提交钩子（**只在本机、可被 `--no-verify` 绕过**）
//   ② "你记得手动跑"
// 换台机器、clone 一份、或者要在 CI 里跑时，两者都不成立。
// 本脚本把库自己那几个检查器收敛成一个不依赖任何本地状态的入口。
//
// 用法:
//   node scripts/verify-all.mjs                          # 全部跑（含检查器自检）
//   node scripts/verify-all.mjs --installed <技能根>      # 顺便比对源 ↔ 已安装副本
//   node scripts/verify-all.mjs --fast                   # 跳过自检（快；**结论会标 PASS* 并明确警告**）
//   node scripts/verify-all.mjs --quiet                  # 只打结论与失败项
//
// 退出码（三档，不许压成一档）:
//   0 = 全部通过
//   1 = 有检查**真的失败**（内容/行为有问题）
//   3 = 有检查**压根没跑成**（环境不具备：子进程起不来、脚本不见了…）——
//       这不是"通过"，也不是"内容有问题"，是"没结论"。**不许当成 0，也不许当成 1 混过去。**
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const argv = process.argv.slice(2);
const getArg = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const QUIET = argv.includes("--quiet");
const FAST = argv.includes("--fast");
const INSTALLED = getArg("--installed") ?? (process.env.DSH_HOME ? join(process.env.DSH_HOME, "skills") : null);

const node = process.execPath;
const steps = [
  {
    name: "技能 frontmatter（写坏 = 技能静默消失）",
    cmd: [node, "validate-skills.mjs", "--quiet", "engineering", "productivity"],
  },
  {
    name: ".ps1 的 BOM + 语法（编辑器会吃 BOM）",
    cmd: [node, "scripts/verify-ps1.mjs"],
  },
  {
    name: "内容一致性（文档里的数字/清单/链接/命令 ⇄ 真值）",
    cmd: [node, "scripts/check-consistency.mjs", ...(INSTALLED && existsSync(INSTALLED) ? ["--installed", INSTALLED] : [])],
  },
  {
    // 顺带用闸门自己的 `-Json` 报告核对"期望的检查项 ⇄ 真跑出来的检查项"。
    // 期望清单**钉在闸门外面**（见 scripts/verify-gate-integrity.mjs），且**含 E1**
    // （该检查器默认带 `-IncludeTests`；以前 E1 被排除在外，复审实测：把 6 处
    //  `Add-Result 'E1'` 全注释掉也没人红 —— 现在钉住了）。
    name: "quality-gate 的完整性（不许静默少项 + 与钉住的清单一致）",
    cmd: [node, "scripts/verify-gate-integrity.mjs"],
    // 注：它报 exit 3 = "起不了 PowerShell / 闸门没产出报告"（没结论），
    // 由下面的三档判定统一处理 —— **不需要**每步再声明一次（以前这里有个 exit3Means 字段，
    // 全仓只有它自己，属于"看着能配、其实没人读"的死字段，已删）。
  },
  {
    name: "速查卡漂移（正文改了、速查卡还留旧说法）",
    cmd: [node, "scripts/extract-cheatsheets.mjs", "--check"],
  },
  {
    name: "检查器自检（变异测试：闸门还抓不抓得住已知错误）",
    cmd: [node, "scripts/self-test.mjs"],
    skip: FAST,
    skipReason: "--fast",
  },
];
// "少项"总闸：上面的清单**必须**是这几步。少一步 = 有人把闸门悄悄摘了。
// （为什么要有：quality-gate 早就有这条总闸，而**库自己的入口反而没有** —— 复审 V6。）
const EXPECTED_STEPS = 6;   // 加/删步骤时必须同步改这里 —— 这条总闸抓过我一次（加了闸门完整性那步忘了改计数）

// **$expectedIds 的教训（复审原话：手写的第二份真相源，删掉 E1 那行所有检查器全绿）**：
// 期望的检查项**不再手抄，也不从源码现算** —— 它**钉在闸门外面**
// （scripts/verify-gate-integrity.mjs 的 PINNED_GATE_IDS）。
// 为什么不是"从源码现算"：那等于把**手抄的副本**换成**自动生成的副本** ——
// 删掉闸门里一项检查，源码和现算结果会一起变小，照样全绿（我第一版就修错了，记在案）。
// 它只能证明"闸门自洽"，证明不了"判据选对了"，所以少项仍由 self-test 的变异用例盯着。
const GATE_UNDER_TEST = "scripts/quality-gate.ps1";
let expectedGateIds = null;
try {
  const gateSrc = readFileSync(join(ROOT, GATE_UNDER_TEST), "utf8");
  const ids = [...new Set([...gateSrc.matchAll(/Add-Result\s+'([A-E]\d+)'/g)].map((m) => m[1]))].sort();
  if (ids.length > 0) expectedGateIds = ids;    // 解析不到 = 推导失效，宁可 null 也别拿空清单当真
} catch { expectedGateIds = null; }

console.log("=== verify-all：库自身完整性 ===");
console.log(`库根: ${ROOT}`);
if (INSTALLED && existsSync(INSTALLED)) console.log(`技能根: ${INSTALLED}（会比对源 ↔ 已安装副本）`);
else if (INSTALLED) console.log(`技能根: ${INSTALLED}（不存在 → 副本比对会 SKIP，这是诚实的跳过）`);
if (FAST) {
  console.log("");
  console.log("⚠️  --fast：**跳过了检查器自检**。自检才是「证明其他闸门还活着」的那一步，");
  console.log("    所以这次的结论只能算 PASS*，不能当成「库没问题」的证据。");
}
console.log("");

const results = [];
for (const s of steps) {
  if (s.skip) {
    results.push({ ...s, status: "SKIP", secs: 0, out: s.skipReason });
    if (!QUIET) console.log(`  [SKIP] ${s.name}  （${s.skipReason}）`);
    continue;
  }
  const t0 = Date.now();
  const r = spawnSync(s.cmd[0], s.cmd.slice(1), { cwd: ROOT, encoding: "utf8" });
  const secs = (Date.now() - t0) / 1000;
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  // ── 三档判定（不许把"没跑成"说成"有问题"）────────────────────────────────
  // 实测踩过：本沙箱里 Node 的 spawnSync 被禁（EPERM），于是**五项全报 FAIL**
  // —— 明明是"压根没跑起来"，报告却说"内容有问题"。那是工具在撒谎。
  let status, reason = "";
  if (r.error) {
    status = "NOTRUN";
    reason = `起不了子进程：${r.error.code ?? r.error.message}`;
  } else if ((r.status ?? 1) === 3) {
    status = "NOTRUN";
    reason = "检查器自己报的退出码 3（环境不具备 → 它拒绝给结论）";
  } else {
    status = (r.status ?? 1) === 0 ? "PASS" : "FAIL";
  }
  results.push({ ...s, status, secs, out, reason });
  const tag = { PASS: "PASS", FAIL: "FAIL", NOTRUN: "没跑成" }[status];
  console.log(`  [${tag}] ${s.name}  (${secs.toFixed(1)}s)`);
  if (status === "NOTRUN") console.log(`         ${reason}${out.trim() ? "" : "（检查器没有任何输出）"}`);
  if (status === "FAIL" || (!QUIET && out.trim())) {
    const tail = out.trim().split("\n").slice(status === "FAIL" ? -14 : -3);
    for (const line of tail) console.log(`         ${line}`);
  }
}

const failed = results.filter((r) => r.status === "FAIL");
const notRun = results.filter((r) => r.status === "NOTRUN");
const skipped = results.filter((r) => r.status === "SKIP");
const passed = results.filter((r) => r.status === "PASS");

// "少项"总闸：步骤数与 EXPECTED_STEPS 不一致 → 直接红（不是打一行提示就算）
// ⚠️ 措辞必须**中立**（复审 L3）：这里两种原因都常见 —— 摘掉一步，**或者**加了新步却忘了改计数
//（后者我自己就犯过：加"闸门完整性"那步时忘了改 EXPECTED_STEPS）。
// 以前只写"有人摘掉了闸门"，是**方向错误的话**，会把人带去查错方向。
const missingSteps = [];
if (steps.length !== EXPECTED_STEPS) {
  missingSteps.push(
    `步骤清单有 ${steps.length} 步，而 EXPECTED_STEPS 写的是 ${EXPECTED_STEPS} —— ` +
    `两种可能：① 有人摘掉了闸门；② 加了/删了步骤却没同步这条总闸（更常见）。` +
    `对一遍 ${"scripts/verify-all.mjs"} 里的 steps 与 EXPECTED_STEPS 再决定改哪边`);
}
console.log("");
console.log(`合计 ${results.length} 步 | PASS ${passed.length} | FAIL ${failed.length} | 没跑成 ${notRun.length} | SKIP ${skipped.length}`);

if (missingSteps.length) {
  console.log("");
  console.log("⚠️  闸门清单不完整（**这不是通过**）：");
  for (const m of missingSteps) console.log(`  · ${m}`);
}
if (failed.length) {
  console.log("");
  console.log("失败项（**不许当成通过**）：");
  for (const f of failed) console.log(`  · ${f.name}`);
}
if (notRun.length) {
  console.log("");
  console.log("**没跑成**的项（环境不具备 → 没结论，不许读成通过、也不许读成有问题）：");
  for (const f of notRun) console.log(`  · ${f.name} —— ${f.reason}`);
}
if (failed.length || missingSteps.length) {
  console.log("");
  console.log("判定: FAIL —— 上面每一项都要处理");
  process.exit(1);
}
if (notRun.length) {
  console.log("");
  console.log("判定: 没跑成（exit 3）—— 上面这些检查**一项结论都没有**；换到能跑它们的机器上重跑，或如实说明。");
  process.exit(3);
}
// **--fast 不能 exit 0**（复审 L4）：它跳过了"证明其他闸门还活着"的自检，
// 而 PASS* 只是**人读的 stdout** —— CI 和 agent 只看退出码，会把"没跑自检"读成通过。
// 本库对"没跑成"的全局约定就是 exit 3（validate-skills / verify-ps1 / verify-gate-integrity
// 都用它），所以 --fast 也走 3：**语义是"这次没得到完整结论"**，不是失败。
if (FAST) {
  console.log("");
  console.log("判定: 没跑成（exit 3）—— `--fast` **跳过了检查器自检**，所以这不是完整结论。");
  console.log("      要一个能写进结论的绿，请跑不带 --fast 的完整版。");
  process.exit(3);
}
console.log(skipped.length ? "判定: PASS*（有跳过项：覆盖不完整，别当成「库没问题」的证据）" : "判定: PASS");
process.exit(0);
