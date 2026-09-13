// PowerShell 脚本体检器 —— 抓两类"会静默失败"的问题：
//
//  ① 缺 UTF-8 BOM：Windows PowerShell 5.1 对无 BOM 的 .ps1 按系统 ANSI 码页（中文机器=GBK）
//     解码 → 中文字节吞掉字符串结束引号 → 报 "The string is missing the terminator"。
//     **实测对照：无 BOM ❌ / 带 BOM ✅ / GBK ✅**
//     这个坑会反复发生：任何按"现代做法"（无 BOM UTF-8）写回文件的编辑器/工具都会破坏它。
//
//  ② 语法错误：等价于 bash -n。改了脚本不跑一遍，等于没验证。
//
// 用法:
//   node verify-ps1.mjs -Repo <库根>              # 检查库内所有 .ps1
//   node verify-ps1.mjs -Repo . -Fix              # 自动补 BOM（不修语法错误）
// 退出码: 0 = 全部通过；1 = 有问题
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, extname, relative } from "node:path";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const getArg = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const repo = getArg("-Repo") ?? ".";
const fix = argv.includes("-Fix");
// 跳过的目录：`.git` 与第三方依赖。
// 踩过的坑：原来写的是 `/\\\.git\\|\\node_modules\\/` —— **要求路径带前导分隔符**，
// 而默认 `-Repo .` 时 join 出来的是相对的 `node_modules\.bin\yaml.ps1`（无前导反斜杠），
// 于是 npm 生成的 shim 被当成"本库的脚本"体检，CI 会无故变红。
// 现在按"路径段"匹配，绝对/相对都能挡住。
const SKIP = /(^|[\\/])(\.git|node_modules|dist|build|__pycache__)([\\/]|$)/;

async function walk(p) {
  const out = [];
  let st;
  try { st = await stat(p); } catch { return out; }
  if (st.isFile()) return extname(p) === ".ps1" ? [p] : out;
  for (const e of await readdir(p, { withFileTypes: true })) {
    const full = join(p, e.name);
    if (SKIP.test(full)) continue;
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (extname(e.name) === ".ps1") out.push(full);
  }
  return out;
}

// 用 PowerShell 自己的解析器做语法检查（等价 bash -n）
function syntaxErrors(file) {
  const script = `
    $e=$null
    $null=[System.Management.Automation.Language.Parser]::ParseFile('${file.replace(/'/g, "''")}',[ref]$null,[ref]$e)
    if($e -and $e.Count){ $e | ForEach-Object { $_.Extent.StartLineNumber.ToString() + '|' + $_.Message } } else { 'OK' }
  `;
  try {
    return execFileSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" })
      .trim().split("\n").map((s) => s.trim()).filter(Boolean);
  } catch (e) { return ["(解析器调用失败) " + (e.message || "")]; }
}

const files = (await walk(repo)).sort();

// 前置：解析器在不在？
// 为什么要单独判：**调用失败**和**脚本有问题**是两回事。
// 实测踩过（干净 clone + 刮掉 PATH 里 System32\WindowsPowerShell 的那种环境）：
// 找不到 powershell.exe 时，每个 .ps1 都被标成"有问题"，整体退 1 ——
// 读的人会去翻脚本，而真实原因是"这台机器上没有解析器"。
// 约定：没跑成 = exit 3（像 validate-skills 找不到 YAML 解析器那样），**不是通过、也不是内容有问题**。
try {
  execFileSync("powershell", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], { encoding: "utf8" });
} catch (e) {
  console.error("✗ 找不到 powershell.exe —— 本项**没有跑成**（这既不是通过，也不是 .ps1 有问题）。");
  console.error(`  原因: ${(e.message || "").split("\n")[0]}`);
  console.error("  说明: 本检查器用 PowerShell 自己的解析器做语法检查（等价 bash -n），所以**只能在 Windows 上跑**。");
  console.error("  影响: Linux/macOS 上这一项必然跑不了 —— CI 因此固定用 windows-latest。");
  process.exit(3);
}

let bad = 0, fixed = 0;
console.log(`=== PowerShell 脚本体检（${files.length} 个） ===`);

for (const f of files) {
  const rel = relative(repo, f) || f;
  const problems = [];

  // ① BOM
  let buf = await readFile(f);
  const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const hasNonAscii = /[^\x00-\x7F]/.test(buf.toString("utf8"));
  if (!hasBom) {
    if (hasNonAscii) {
      problems.push("缺 UTF-8 BOM（含中文，PS 5.1 下会解析失败）");
      if (fix) {
        const text = buf.toString("utf8").replace(/^\uFEFF/, "");
        await writeFile(f, "\uFEFF" + text, "utf8");
        fixed++;
        problems.push("→ 已自动补 BOM");
      }
    } else {
      // 纯 ASCII 脚本在 PS 5.1 下没有编码问题——只提示
      problems.push("缺 BOM（纯 ASCII，PS 5.1 下无害；建议统一加 BOM 以免后续加中文时踩坑）");
    }
  }

  // ② 语法
  const errs = syntaxErrors(f);
  if (errs[0] !== "OK") {
    for (const e of errs.slice(0, 5)) problems.push("语法: " + e);
  }

  const fatal = problems.filter((p) => !p.startsWith("→"));
  if (fatal.length > 0) {
    bad++;
    console.log(`  [问题] ${rel}`);
    for (const p of problems) console.log(`         - ${p}`);
  } else if (problems.some((p) => p.startsWith("→"))) {
    console.log(`  [已修] ${rel}`);
    for (const p of problems) console.log(`         - ${p}`);
  } else {
    const note = problems.length > 0 ? `  (${problems.join("; ")})` : "";
    console.log(`  [OK  ] ${rel}${note}`);
  }
}

console.log("");
console.log(bad === 0
  ? `✓ 全部通过${fixed > 0 ? `（自动补了 ${fixed} 个 BOM）` : ""}`
  : `✗ ${bad} 个有问题`);
process.exit(bad === 0 ? 0 : 1);
