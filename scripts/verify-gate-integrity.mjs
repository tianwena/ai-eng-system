// quality-gate 的"完整性"检查：**期望清单钉在闸门外面**，闸门内部的自洽不算证据。
//
// 为什么要有这个文件（独立复审原话）：
//   `$expectedIds` 是**手写的第二份真相源，且无人覆盖** —— 删掉闸门里那一行 `Add-Result 'E1'`，
//   所有检查器全绿，因为"期望清单"跟着一起"对"了。**副本自己不会漂移，是因为没人看着它。**
//   本文件就是那个"看着它的人"：
//     · 期望清单钉在这份文件顶部（PINNED_GATE_IDS）——**删检查 = 必须显式改这里**
//     · 同时核对三件事：源码里还有没有这些项、真跑出来的项是否与它完全一致、有没有多出没声明的项
//   （我第一版写成"从源码现算期望清单"，那等于把副本换成自动生成的副本 —— 一点没解决问题。）
//
// 用法:
//   node scripts/verify-gate-integrity.mjs                # 在临时项目上跑一次闸门，比对
//   node scripts/verify-gate-integrity.mjs --derive-only  # 只做静态核对（不跑 PowerShell）
//
// 退出码: 0 = 一致；1 = 不一致（少项/多项/源码里没了）；3 = **没跑成**（起不了 PowerShell / 没产出报告）
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DERIVE_ONLY = process.argv.includes("--derive-only");
const GATE = join(ROOT, "scripts", "quality-gate.ps1");

// ── 期望清单：**钉在这里**，谁想删闸门里的一项检查都必须先动这行 ─────────────
//
// 为什么不"从闸门源码现算"（我第一版就是那么写的，然后自己把坑踩明白了）：
//   闸门内部那份 `$expectedIds` 与"真跑出来的项"是**同一侧**的 —— 删掉一行
//   `Add-Result 'E1'`，两边一起变小，总闸不响、检查全绿。**现算也会跟着一起变**，
//   等于把副本换成"自动生成的副本"，一点没解决问题。
//   唯一拦得住的做法：期望清单**钉在另一侧**（这里），于是"删检查"这个动作
//   无法在自己内部闭合 —— 要么补回检查，要么改这份钉住的清单（而那是显式动作，看得见）。
//
// 改闸门时（加/删检查项）**必须同步改这里** —— 这不是重复劳动：
// 它是"少项"这件事唯一的外部见证人。（复审：手写的第二份真相源 + 无人覆盖 = 假安心。）
const PINNED_GATE_IDS = [
  "A1", "A2", "A3", "A4", "B1", "B2", "B3", "C1", "C2", "C3", "D1", "D2", "D3", "D4",
  "E1",   // ← M4：E1 **也钉进来**。以前它被排除在外，理由是"它要 -IncludeTests"，
          //   但那让"删检查无法内部闭合"对 E1 完全不成立（复审实测：6 处 Add-Result 'E1'
          //   全注释掉，本项照样打印"静态核对通过"）。现在默认就跑 -IncludeTests。
];
const INCLUDE_TESTS = !process.argv.includes("--no-tests");   // 默认带测试项；要跳过用 --no-tests
const expected = [...new Set(PINNED_GATE_IDS)].sort();

// ── M7：`verify-all` 的步骤**内容**也要有人在闸门外看着 ─────────────────────
// 复审实测：把某一步的 `cmd` 换成 `[node, "--version"]`，步数不变、`checks.verifyAll` 不变、
// 文档也一致 → **全绿**。也就是说"只数步数"挡不住"把某一步做成空转"。
// 这里钉住"每步跑的是哪个脚本"，名字或脚本一改就必须显式改这份清单。
const PINNED_VERIFY_ALL_STEPS = [
  "技能 frontmatter（写坏 = 技能静默消失） → validate-skills.mjs",
  ".ps1 的 BOM + 语法（编辑器会吃 BOM） → scripts/verify-ps1.mjs",
  "编码与行尾（.ps1 要 BOM、.bat 要 GBK+CRLF、其余 UTF-8 无 BOM） → scripts/verify-encoding.mjs",
  "内容一致性（文档里的数字/清单/链接/命令 ⇄ 真值） → scripts/check-consistency.mjs",
  "quality-gate 的完整性（不许静默少项 + 与钉住的清单一致） → scripts/verify-gate-integrity.mjs",
  "速查卡漂移（正文改了、速查卡还留旧说法） → scripts/extract-cheatsheets.mjs",
  "检查器自检（变异测试：闸门还抓不抓得住已知错误） → scripts/self-test.mjs",
];
{
  const va = readFileSync(join(ROOT, "scripts", "verify-all.mjs"), "utf8");
  const body = va.slice(va.indexOf("const steps = ["), va.indexOf("];", va.indexOf("const steps = [")));
  const got = [...body.matchAll(/name:\s*"([^"]+)"[\s\S]*?cmd:\s*\[[^\]]*?"([^"]+\.mjs)"/g)]
    .map((m) => `${m[1]} → ${m[2]}`);
  const missing = PINNED_VERIFY_ALL_STEPS.filter((s) => !got.includes(s));
  const extra = got.filter((s) => !PINNED_VERIFY_ALL_STEPS.includes(s));
  if (got.length === 0) {
    console.error("✗ 从 verify-all.mjs 里一步都解析不出来 —— 规则变了？别把空当绿");
    process.exit(1);
  }
  if (missing.length || extra.length) {
    console.error("✗ verify-all 的步骤清单与钉住的内容不一致：");
    if (missing.length) console.error(`   少了/改了: ${missing.join(" / ")}`);
    if (extra.length) console.error(`   多了/改了: ${extra.join(" / ")}`);
    console.error("   → 步数没变也可能是「某一步被换成空转」（复审 M7 实测）。要么改回来，要么显式改本文件顶部的 PINNED_VERIFY_ALL_STEPS。");
    process.exit(1);
  }
}

// ── M5：`facts.json` 的**声明清单**也要有人在闸门外看着 ─────────────────────
// 复审实测：从 facts.json 删掉 `self-test-inventory` 这条声明 → `check-consistency` **全绿**
//（它守的是入口文档脚本表里 self-test 那一行，删了之后就再没人管）。
// 理由与 PINNED_GATE_IDS 完全一样：**同一侧的判据挡不住自己变小**。
const PINNED_FACT_IDS = [
  "skill-total", "group-engineering", "group-productivity", "self-authored", "script-count-cn",
  "gate-count-total", "gate-count-default", "redline-count", "self-test-cases",
  "verify-all-count", "self-test-inventory", "hook-selftest-count",
];
{
  const facts = JSON.parse(readFileSync(join(ROOT, "scripts", "facts.json"), "utf8"));
  const ids = (facts.facts ?? []).map((f) => f.id);
  const gone = PINNED_FACT_IDS.filter((id) => !ids.includes(id));
  const added = ids.filter((id) => !PINNED_FACT_IDS.includes(id));
  if (gone.length) {
    console.error(`✗ facts.json 里这些声明**不见了**：${gone.join(", ")}`);
    console.error("  → 它们守的文档行从此没人管（复审 M5 实测：删掉 self-test-inventory 时全库仍绿）");
    process.exit(1);
  }
  if (added.length) {
    console.error(`✗ facts.json 里多了没登记的声明：${added.join(", ")}`);
    console.error("  → 新增声明是好事，但请显式更新本文件顶部的 PINNED_FACT_IDS（那是看得见的动作）");
    process.exit(1);
  }
}

// 反向自检：闸门源码里解析出来的集合必须**包含**钉住的清单。
// 不包含 = 有人删了检查（或改了 Add-Result 的写法）→ 立刻红，而不是等跑一遍才发现。
const gateSrc = readFileSync(GATE, "utf8");
const inSource = [...new Set([...gateSrc.matchAll(/Add-Result\s+'([A-Z]\d+)'/g)].map((m) => m[1]))].sort();
if (inSource.length === 0) {
  console.error("✗ 从 quality-gate.ps1 里一项 Add-Result 都解析不到 —— 推导失效了（规则变了？），别把空清单当真");
  process.exit(1);
}
const goneFromSource = expected.filter((e) => !inSource.includes(e));
if (goneFromSource.length) {
  console.error(`✗ 闸门源码里已经没有这些检查项了：${goneFromSource.join(", ")}`);
  console.error(`  钉住的清单（${expected.length} 项）: ${expected.join(", ")}`);
  console.error(`  源码里能解析到的（${inSource.length} 项）: ${inSource.join(", ")}`);
  console.error("  → 要么把检查补回来，要么显式改本文件顶部的 PINNED_GATE_IDS（那是看得见的动作，不是悄悄消失）");
  process.exit(1);
}
// **只在注释里出现 ≠ 检查还在**（M4 修法，独立复审实测的洞）：
// 旧判据是"剥注释后源码里还有 `'E1'` 这个字符串"—— 而 `if ($IncludeTests) { $expectedIds += 'E1' }`
// 本身就是**非注释代码**里的 `'E1'`，于是判据被一行**不相干的**代码满足：
// 把 6 处真实 `Add-Result 'E1'` 全注释掉，这里照样打印"静态核对通过"。
// 现在只认"真的有一条 Add-Result 声明"（字母放宽到 A-Z，将来加 F 段也管得住）。
const codeOnly = gateSrc.split(/\r?\n/).map((l) => l.replace(/(^|\s)#.*$/, "")).join("\n");
// ⚠️ 这里的正则**必须**是动态的：`${e}` 来自 `PINNED_GATE_IDS`（钉在闸门外的**白名单**），
//    不是外部输入。detect-non-literal-regexp 报的是"形态"；用白名单拼正则没有注入面。
const commentedOut = expected.filter((e) => !new RegExp(`Add-Result\\s+'${e}'`).test(codeOnly));  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
if (commentedOut.length) {
  console.error(`✗ 这些检查项**在代码里已经没有 Add-Result 了**（只剩注释/声明提到它们）：${commentedOut.join(", ")}`);
  console.error("  → 它们不会再产出结果。把检查补回来，或显式改 PINNED_GATE_IDS。");
  process.exit(1);
}
if (DERIVE_ONLY) {
  console.log(`钉住的期望清单（${expected.length} 项）: ${expected.join(", ")}`);
  console.log(`源码里能解析到的（${inSource.length} 项）: ${inSource.join(", ")}${INCLUDE_TESTS ? "（含 E1）" : "（不含 E1，它需要 -IncludeTests）"}`);
  console.log(`静态核对：**通过** —— 钉住的 ${expected.length} 项在源码里都能解析到`);
  process.exit(0);
}

// 需要跑起来才需要 PowerShell —— 找不到就**诚实报没跑成**（exit 3），不是失败。
// ⚠️ 但**静态那一半绝不放在这后面**：它是"源码里少了检查项"的判据，
//    不需要 PowerShell；实测第一版把它排在 spawn 之后，于是在起不了子进程的环境里
//    连"有人删了检查"都报不出来（本来能报的，被一个无关的环境问题挡掉了）。
const ps = [
  join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
].find((p) => existsSync(p));

const dir = mkdtempSync(join(tmpdir(), "gate-integrity-"));
const report = join(dir, "gate-report.json");
try {
  const proj = join(dir, "empty-project");
  mkdirSync(proj, { recursive: true });

  // 把工具目录"藏起来"（semgrep/ruff/gitleaks 走 SKIP），于是每条 Add-Result 都会执行 ——
  // 与 self-test 里那条用例**同一套环境**，这不是新抄一份，而是把同一判据装成可复用的检查器。
  // ⚠️ 这些"假家目录"必须是**真实存在**的目录：指向不存在的路径时，PowerShell 会退回到
  //    **当前工作目录**去写 `ModuleAnalysisCache` —— 实测在仓库根拉出一个 `Microsoft/` 目录。
  //    用临时目录同样能让工具"隐身"（它们不在那儿），而且不会污染任何仓库。
  const fakeHome = join(dir, "nohome");
  mkdirSync(fakeHome, { recursive: true });
  const env = {
    ...process.env,
    USERPROFILE: fakeHome, APPDATA: fakeHome, LOCALAPPDATA: fakeHome,
    PATH: "C:\\Windows\\System32",
  };
  const gateArgs = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", GATE, "-Path", proj, "-Json", report];
  if (INCLUDE_TESTS) gateArgs.splice(gateArgs.indexOf("-Json"), 0, "-IncludeTests");   // 默认带上，E1 才会产出
  const r = ps
    ? spawnSync(ps, gateArgs, { cwd: ROOT, encoding: "utf8", env })
    : { error: { code: "powershell.exe 不存在" } };
  if (r.error) {
    console.error(`✗ 起不了 PowerShell 子进程（${r.error.code ?? r.error.message}）—— **运行那一半没有跑成**，没有结论。`);
    console.error(`  ✅ 静态那一半**已经做完了且通过**：钉住的 ${expected.length} 项在源码里都能解析到`);
    console.error("     （这能证明「检查项没被人从源码里删掉」，**证明不了**「真跑起来每一项都产出」）");
    console.error("  ⛔ 实跑比对（期望 ⇄ 真产出）**一项都没做** —— 别把这次调用读成通过。");
    process.exit(3);
  }
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (!existsSync(report)) {
    console.error("✗ 闸门没产出 JSON 报告 —— 本项没有结论。尾部输出：");
    console.error(out.split("\n").slice(-8).map((l) => `    ${l}`).join("\n"));
    process.exit(3);
  }
  const rep = JSON.parse(readFileSync(report, "utf8"));
  const actual = [...new Set((rep.results ?? []).map((x) => x.Id))].sort();
  const missing = expected.filter((e) => !actual.includes(e));
  const extra = actual.filter((a) => !expected.includes(a));

  console.log(`期望（钉在闸门外面）    : ${expected.length} 项 → ${expected.join(", ")}${INCLUDE_TESTS ? "（含 E1：默认带 -IncludeTests）" : "（--no-tests：未带测试项）"}`);
  console.log(`实跑（闸门 JSON 报告）  : ${actual.length} 项 → ${actual.join(", ")}`);
  if (out.includes("GATE INTEGRITY BROKEN") && !missing.length) {
    console.error("✗ 闸门自己报了 GATE INTEGRITY BROKEN，但比对不出缺项 —— 两处判据打架，请人工看一眼");
    process.exit(1);
  }
  if (missing.length || extra.length) {
    if (missing.length) console.error(`✗ 静默少项：${missing.join(", ")}（源码里有，实跑没产出）`);
    if (extra.length) console.error(`✗ 多出没声明的项：${extra.join(", ")}（实跑产出了，源码里没有）`);
    process.exit(1);
  }
  console.log(`✓ 一致：${actual.length} 项全部产出，且与**钉在闸门外面**的期望完全相同`);
  process.exit(0);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
