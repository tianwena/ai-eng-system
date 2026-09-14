#!/usr/bin/env node
/**
 * 文件编码 / 行尾体检 —— 把「🔴 编码铁律」那张表变成可执行检查。
 *
 * 为什么需要它（2026-09-14 实测）：
 *   编码类错误**一天能犯十几次**，而每次的症状都不像编码问题 ——
 *   报语法错、报"找不到命令"、中文变乱码、二进制被写坏。人（和 agent）会先去查逻辑，
 *   方向从一开始就错了。规则写在 AGENTS.md 里仍会犯，是因为**没人会每次动手前重读一遍表**。
 *
 * 判据（扩展名决定编码，"文本文件都该存 UTF-8"是错的）：
 *   .ps1            UTF-8 **带 BOM**（PS 5.1 对无 BOM 的 UTF-8 按 GBK 解码 → 语法报错）
 *   .bat / .cmd     **GBK**、**必须 CRLF**、**不能有 UTF-8 BOM**、不能含 GBK 编不出的字符
 *   .py/.md/.json/.txt  UTF-8 **不带 BOM**
 *   二进制/其它    跳过（只统计）
 *
 * 用法：
 *   node verify-encoding.mjs -Repo .                 # 扫当前仓库（git ls-files + 未跟踪）
 *   node verify-encoding.mjs -Repo . -All            # 连被忽略的文件一起扫
 *   node verify-encoding.mjs -Repo . -Strict         # 警告也算失败（默认只拦 ERROR）
 *   node verify-encoding.mjs -Files a.bat b.ps1      # 只查指定文件
 *
 * 退出码：0 通过 / 1 有 ERROR（或 -Strict 下有警告）
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, extname, basename, relative } from "node:path";

const args = process.argv.slice(2);
const getArg = (name, dflt = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("-") ? args[i + 1] : dflt;
};
const has = (name) => args.includes(name);

const repo = getArg("-Repo", ".");
const strict = has("-Strict");
const onlyFiles = (() => {
  const i = args.indexOf("-Files");
  if (i < 0) return null;
  const out = [];
  for (let k = i + 1; k < args.length && !args[k].startsWith("-"); k++) out.push(args[k]);
  return out;
})();

// ---------- 规则表（与 AGENTS.md「🔴 编码铁律」保持一致） ----------
const RULES = {
  ".ps1": { encoding: "utf-8", bom: "required", eol: "any" },
  ".bat": { encoding: "gbk", bom: "forbidden", eol: "crlf" },
  ".cmd": { encoding: "gbk", bom: "forbidden", eol: "crlf" },
  ".py": { encoding: "utf-8", bom: "forbidden", eol: "any" },
  ".md": { encoding: "utf-8", bom: "forbidden", eol: "any" },
  ".json": { encoding: "utf-8", bom: "forbidden", eol: "any" },
  ".txt": { encoding: "utf-8", bom: "forbidden", eol: "any" },
  ".yml": { encoding: "utf-8", bom: "forbidden", eol: "any" },
  ".yaml": { encoding: "utf-8", bom: "forbidden", eol: "any" },
  ".mjs": { encoding: "utf-8", bom: "forbidden", eol: "any" },
  ".js": { encoding: "utf-8", bom: "forbidden", eol: "any" },
  ".css": { encoding: "utf-8", bom: "forbidden", eol: "any" },
  ".html": { encoding: "utf-8", bom: "forbidden", eol: "any" },
};

const SKIP_DIRS = /(^|[\\/])(node_modules|\.git|\.venv|venv|__pycache__|\.pytest_cache|\.ruff_cache|dist|build|\.scratch[\\/]tmp)([\\/]|$)/;

function listFiles() {
  if (onlyFiles) return onlyFiles;
  const out = [];
  try {
    const tracked = execFileSync("git", ["-C", repo, "ls-files"], { encoding: "utf8" })
      .split(/\r?\n/).filter(Boolean);
    out.push(...tracked);
    // 未跟踪但非忽略的文件（新写的文件最容易出错，必须查）
    const untracked = execFileSync("git", ["-C", repo, "ls-files", "--others", "--exclude-standard"],
      { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
    out.push(...untracked);
  } catch {
    // 非 git 仓库：退回目录遍历
    // ⚠️ 这里原本写的是 `readFileSync ? require("node:fs").readdirSync(d, …) : []` ——
    //    本文件是 **ES module**，`require` 不存在 ⇒ 这条兜底分支一执行就抛
    //    `ReferenceError: require is not defined`（2026-09-14 实测：在非 git 目录上直接崩，
    //    抛的是栈，不是"没跑成"这种诚实降级）。库本身是 git 仓库，所以这条路径**从来没被跑到过**。
    //    已改成用顶部 import 进来的 `readdirSync`。
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (SKIP_DIRS.test(p)) continue;
        if (e.isDirectory()) walk(p); else out.push(relative(repo, p));
      }
    };
    walk(repo);
  }
  return [...new Set(out)];
}

let errs = 0, warns = 0, checked = 0, skipped = 0;
const problems = [];

function report(level, file, msg) {
  problems.push({ level, file, msg });
  if (level === "ERROR") errs++; else warns++;
}

for (const rel of listFiles()) {
  const abs = join(repo, rel);
  if (SKIP_DIRS.test(abs)) continue;
  if (!existsSync(abs) || !statSync(abs).isFile()) continue;      // 已删除的跟踪文件

  const ext = extname(rel).toLowerCase();
  const rule = RULES[ext];
  if (!rule) { skipped++; continue; }
  checked++;

  const buf = readFileSync(abs);
  const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const crlf = (buf.toString("latin1").match(/\r\n/g) || []).length;
  const lf = (buf.toString("latin1").match(/\n/g) || []).length;
  const bareLf = lf - crlf;

  // ① BOM
  if (rule.bom === "required" && !bom) {
    report("ERROR", rel, "缺 UTF-8 BOM —— PS 5.1 会按 GBK 解码 → `The string is missing the terminator`");
  }
  if (rule.bom === "forbidden" && bom) {
    report("ERROR", rel, "不该有 BOM（Python/JSON/前端对 BOM 敏感）");
  }

  // ② 编码：严格解码（对 .bat 还得再查 ③，因为 GBK 字节序列常也是合法 UTF-8）
  let text = null;
  // BOM 剥离必须新建 Buffer，不能 subarray 后直接 toString：
  // Node 的 toString(encoding) 内部用**有状态**的 TextDecoder，流式续解会把
  // 上一个 Buffer 的状态带过来 → 合法 GBK 也可能解码失败（实测踩过，误报 ERROR）。
  const body = bom ? Buffer.from(buf.subarray(3)) : buf;
  try {
    text = new TextDecoder(rule.encoding, { fatal: true }).decode(body);
  } catch {
    report("ERROR", rel, `无法按 ${rule.encoding.toUpperCase()} 严格解码`);
  }
  if (text !== null && text.includes("\uFFFD")) {
    report("ERROR", rel, "解码后含替换字符 U+FFFD —— 文件已被写坏（常见于把 GBK 当 UTF-8 读了再写回）");
  }

  // ③ .bat 专项：中文 + LF
  if (ext === ".bat" || ext === ".cmd") {
    if (rule.eol === "crlf" && bareLf > 0) {
      report("ERROR", rel, `行尾有 ${bareLf} 处裸 LF —— cmd 只认 CRLF，会把文件当一行拼接（症状：'xx' 不是内部或外部命令）`);
    }
    const nonAscii = [...body.toString("latin1")].some((c) => c.charCodeAt(0) > 127);
    if (nonAscii) {
      // 判别"是 UTF-8 还是 GBK"：**必须用 UTF-8 往返比对**，不能只看"能不能解成 UTF-8"。
      // 实测教训（2026-09-14）：GBK 的中文字节序列**经常也是合法 UTF-8**，
      // 于是只看 `toString('utf8')` 不抛错 → 把 GBK 文件误判成 UTF-8（假警报）。
      let isUtf8 = false;
      try {
        const s = body.toString("utf-8", { fatal: true });
        isUtf8 = Buffer.from(s, "utf8").equals(body);
      } catch { isUtf8 = false; }
      if (isUtf8) {
        report("ERROR", rel, "含非 ASCII 且是**真正的 UTF-8** —— .bat 会被 cmd 按 GBK 读成乱码命令（应存 GBK）");
      } else {
        // 是 GBK。提醒一句：非 ASCII 内容在 bat 里越少越安全（换机器/换码页都不会翻车）
        report("WARN", rel, "含非 ASCII 内容（GBK）—— 能跑，但 bat 里中文越少越稳（换机器/换码页都不会翻车）");
      }
      // 切码页检查：GBK 文件里出现 chcp 65001 会让控制台中文乱码
      if (/chcp\s+65001/i.test(body.toString("latin1"))) {
        report("WARN", rel, "文件是 GBK 却写了 `chcp 65001` —— 控制台中文会变乱码（中文 Windows 默认 936，与 GBK 一致，不该切）");
      }
    }
  }

  // ④ 混行尾（排除 .bat，它已单独判过）
  if (ext !== ".bat" && ext !== ".cmd" && crlf > 0 && bareLf > 0) {
    report("WARN", rel, `行尾混用（CRLF ${crlf} / 裸 LF ${bareLf}）`);
  }
}

// ---------- 输出 ----------
console.log("=== 编码 / 行尾体检 ===");
console.log(`仓库: ${repo}`);
console.log(`检查 ${checked} 个文本文件，跳过 ${skipped} 个非文本/无规则文件\n`);

if (problems.length === 0) {
  console.log("✓ 全部通过（BOM / 编码 / 行尾 均符合规则表）");
} else {
  const byFile = new Map();
  for (const p of problems) {
    if (!byFile.has(p.file)) byFile.set(p.file, []);
    byFile.get(p.file).push(p);
  }
  for (const [file, list] of byFile) {
    console.log(`  ${list.some((x) => x.level === "ERROR") ? "[ERROR]" : "[警告 ]"} ${file}`);
    for (const p of list) console.log(`         - ${p.msg}`);
  }
  console.log(`\n合计 ERROR ${errs} · 警告 ${warns}`);
  console.log("规则表见 D:\\AIworkspace\\AGENTS.md「🔴 编码铁律」");
}

const fail = errs > 0 || (strict && warns > 0);
console.log(fail ? "\n✗ 不通过" : "\n✓ 通过");
process.exit(fail ? 1 : 0);
