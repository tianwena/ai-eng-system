// 自检：**让检查器们自己被检查**。
//
// 为什么需要它（这不是洁癖，是今天实测出来的）：
//   这套体系的闸门全靠"检查器"挡问题，但检查器本身**没有任何回归测试**。
//   实战里已经连出三次检查器自身的 bug：
//     · verify-structure.mjs 只认不加粗的 `| 错误 |`，而它自己的模板印的是加粗版 → 照模板抄必卡
//     · 同一文件把契约段开头的"铺垫文字"当成一个端点块 → 报"24 个端点都没写错误处理"（全是假警报）
//     · check-consistency.mjs 里数自研技能行的正则少匹配（10 行只数到 2 行）
//   三次里**两次是独立 agent 拿真实项目跑出来的**（校验器拒收自己模板的加粗错误行、
//   契约段铺垫被当成端点），**一次是我自己写负向测试发现的**（统计正则只匹配到 2/10 行）。
//   也就是说：闸门可能一直在空转，而**要么**需要另一双眼睛，**要么**需要有人想到该测什么。
//
// 本文件的做法：**变异测试**（mutation test）
//   把库复制到临时目录 → 注入一个"已知的错误" → 断言检查器**必须**报 FAIL（且报对地方）
//   顺手断言"不改任何东西时必须 PASS"（防止检查器变成"永远报警"的狼来了）
//
// 用法:
//   node scripts/self-test.mjs            # 跑全部用例
//   node scripts/self-test.mjs -v         # 顺带打印每个用例的检查器输出
//
// 退出码: 0 = 检查器们行为正确；1 = 有检查器没抓住注入的错误（闸门形同虚设）
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync, existsSync, renameSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const VERBOSE = process.argv.includes("-v");

// ── 造一份临时副本（不带 .git：用不上，还慢）───────────────────────────────
const copyLib = () => {
  const dst = mkdtempSync(join(tmpdir(), "self-test-"));
  cpSync(ROOT, dst, {
    recursive: true,
    filter: (src) => !/[\\/]\.git([\\/]|$)/.test(src) && !/self-test-/.test(src),
  });
  return dst;
};

const read = (p) => readFileSync(p, "utf8");
const edit = (p, fn) => writeFileSync(p, fn(read(p)), "utf8");
const run = (dir, script, args = []) =>
  spawnSync(process.execPath, [join(dir, script), ...args], { cwd: dir, encoding: "utf8" });

// ── "变异必须真的改到东西"总闸 ─────────────────────────────────────────────
// **为什么要有它（真机第三次红照出来的）**：
//   一条用例的变异字符串写的是「十六个脚本」，而文件里**早就是**「十七个脚本」
//   （加了新脚本后标题跟着改了）→ `String.replace` 找不到就**静默返回原串** →
//   基线副本根本没被改 → 检查器当然全绿 → 用例报红，而红的原因跟检查器一点关系没有。
//   这类"变异落空"会伪装成两种假象：**假红**（像这次）或者**假绿**（改错了地方却刚好也红）。
//   判据很简单也很硬：**mutate 跑完，目录里的文件必须真的变了**。没变 = 用例坏了，直接报出来。
// ⚠️ 指纹必须**看内容**，不能只看文件大小：本库的变异常是"等长替换"
//   （「十六个脚本」→「十五个脚本」字节数相同），只比大小会漏掉它们。
// ⚠️ 盲区补掉（复审 L5）：
//   ① `scripts/git-hooks/pre-commit` **没有扩展名**，旧判据只按扩展名读文本 → 对它做等长变异会漏判；
//   ② 深度 >4 层的文件不进指纹 → tests/… 里更深的样例同样漏判。
//   现在：文本判据加"无扩展名也算"，深度放到 6（本库最深的文件也够）。
const fingerprint = (dir, depth = 0, acc = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (depth < 6) fingerprint(p, depth + 1, acc); continue; }
    try {
      const s = statSync(p);
      // 文本类文件读内容；其余（二进制/超大）只记大小。
      // `pre-commit` 这类**无扩展名**的文本文件也按内容读（旧判据漏了它们）。
      const textish = /\.(md|mjs|ps1|json|ya?ml|txt|gitattributes|gitignore)$/i.test(e.name) || !/\.[a-z0-9]+$/i.test(e.name);
      acc.push(textish && s.size < 400_000 ? `${p}:${readFileSync(p, "utf8")}` : `${p}:size=${s.size}`);
    } catch { /* 读不到就不计入 */ }
  }
  return acc;
};
const dirFingerprint = (dir) => fingerprint(dir).sort().join("|");

// ── 用例定义 ──────────────────────────────────────────────────────────────
// mutate(dir)：注入错误；check(dir)：返回 {code, out}
const CASES = [
  {
    name: "基线：什么都不改 → 全部 PASS",
    // 防"狼来了"：一个永远报警的检查器等于没有检查器
    check(dir) {
      const c = run(dir, "scripts/check-consistency.mjs");
      const v = run(dir, "scripts/verify-ps1.mjs", ["-Repo", dir]);
      const s = run(dir, "validate-skills.mjs", ["--quiet", "engineering", "productivity"]);
      return { code: c.status ?? 1, out: `consistency=${c.status}\nverify-ps1=${v.status}\nvalidate-skills=${s.status}\n${c.stdout}`, expectCode: 0 };
    },
  },
  {
    name: "README 技能数被改错（36→35）→ 一致性必须拦住",
    mutate: (d) => edit(join(d, "README.md"), (t) => t.replace("## 二、技能总览（36 个）", "## 二、技能总览（35 个）")),
    check: (d) => ({ r: run(d, "scripts/check-consistency.mjs"), need: "skill-total", expectCode: 1 }),
  },
  {
    name: "README 漏列一个技能 → 覆盖率必须拦住",
    mutate: (d) => edit(join(d, "README.md"), (t) => t.replace("[wizard](./engineering/wizard/SKILL.md)", "wizard")),
    check: (d) => ({ r: run(d, "scripts/check-consistency.mjs"), need: "readme-coverage", expectCode: 1 }),
  },
  {
    name: "脚本清单漏列一个脚本 → 双向清单必须拦住",
    mutate: (d) => edit(join(d, "从这里开始.md"), (t) => t.replace(/^\|\s*`verify-ps1\.mjs`.*$/m, "")),
    check: (d) => ({ r: run(d, "scripts/check-consistency.mjs"), need: "script-inventory", expectCode: 1 }),
  },
  {
    name: "文档里写回旧文件夹名 → 残留检查必须拦住",
    mutate: (d) => edit(join(d, "README.md"), (t) => t.replace("## 一、这套系统解决什么问题", "## 一、这套系统解决什么问题\n\n（旧路径：skills-1.2.3-zh）")),
    check: (d) => ({ r: run(d, "scripts/check-consistency.mjs"), need: "no-legacy-names", expectCode: 1 }),
  },
  {
    name: "文档里的命令写回 pwsh → 可执行性检查必须拦住",
    mutate: (d) => edit(join(d, "从这里开始.md"), (t) => t.replace("powershell -NoProfile -ExecutionPolicy Bypass -File <库根>\\install-skills.ps1", "pwsh -File <库根>\\install-skills.ps1")),
    check: (d) => ({ r: run(d, "scripts/check-consistency.mjs"), need: "runnable-commands", expectCode: 1 }),
  },
  {
    name: ".ps1 被吃掉 BOM → 体检器必须拦住",
    mutate: (d) => {
      const p = join(d, "scripts", "state.ps1");
      const buf = readFileSync(p);
      writeFileSync(p, buf.subarray(3));                       // 去掉 EF BB BF
    },
    check: (d) => ({ r: run(d, "scripts/verify-ps1.mjs", ["-Repo", d]), need: "缺 UTF-8 BOM", expectCode: 1 }),
  },
  {
    name: "编码/行尾体检：BOM 与行尾装反了必须被抓到（新检查器的负向测试）",
    // **为什么加**：`verify-encoding.mjs`（2026-09-14 由另一个窗口新增）本来**一条用例都没有**，
    // 而它已经被接进 `verify-all` —— 没有负向测试的检查器进总闸，等于"少项总闸"只保住了它的**存在**，
    // 保不住它的**判据**（`self-test` 的意义正是后者）。
    // 判据挑它**独有**、别的检查器管不到的规则（`.ps1` 的 BOM 已被上面那条覆盖）：
    //   · `.md` **带 BOM** ⇒ 必须报 ERROR（其它检查器只管 `.ps1`）
    //   · `.bat` 用 **裸 LF** ⇒ 必须报 ERROR（bat 必须 CRLF，否则 cmd 当一行拼）
    // ⚠️ 变异：把 `RULES` 里 `.md` 的 `bom: "forbidden"` 或 `.bat` 的 `eol: "crlf"` 删掉 ⇒ 这条必须红。
    // ⚠️ 夹具故意**不**做 `git init`：正好走它那条"非 git 目录 → 目录遍历"兜底分支 ——
    //    那条分支原本是 `require("node:fs")`（ES module 里没有 require）⇒ 一跑就抛
    //    `ReferenceError`（2026-09-14 实测），这条用例同时守住那个修复。
    check: (d) => {
      const dir = join(d, "tests", "fixtures", "encoding-bad");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "bom.md"), "\uFEFF# 带 BOM 的 md\n", "utf8");          // 不该有 BOM
      // ⚠️ `.bat` 夹具**必须是纯 ASCII**（用 latin1 写）：第一版用 "ascii" 编码写了一句中文，
      //    中文被截断成非法字节 ⇒ 触发的是**另一条**规则（"无法按 GBK 严格解码"）⇒
      //    用例**因为错误的原因而绿**：把 EOL 规则删掉它照样绿（变异 M20 实测抓到的假护栏）。
      writeFileSync(join(dir, "lf.bat"), "@echo off\nrem must be CRLF\n", "latin1"); // 不该是裸 LF
      const r = run(d, "scripts/verify-encoding.mjs", ["-Repo", dir]);
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      const problems = [];
      if ((r.status ?? 1) !== 1) problems.push(`退出码 ${r.status}（两个文件都违规，应当 1）`);
      // ⚠️ 断言必须钉**报错那一行的形态**（`[ERROR] <文件>`），不能只匹配文件名：
      //    实测（变异 M20）只写 `/lf\.bat/` 时，把 `.bat` 的 EOL 规则删掉后**这条用例照样绿** ——
      //    因为输出里"检查 N 个文本文件"之类的行也能碰到那个名字。弱断言 = 假护栏。
      if (!/\[ERROR\]\s+bom\.md/.test(out)) problems.push("`.md` 带 BOM 没被抓到（期望输出里有 `[ERROR] bom.md`）");
      if (!/\[ERROR\]\s+lf\.bat/.test(out)) problems.push("`.bat` 用裸 LF 没被抓到（期望输出里有 `[ERROR] lf.bat`）");
      if (/ReferenceError|require is not defined/.test(out)) problems.push("在非 git 目录下抛异常了（应当走目录遍历兜底，而不是崩栈）");
      return { code: problems.length ? 1 : 0, expectCode: 0, raw: out, out: problems.length ? problems.join("；") : "BOM 与行尾违规都被抓到，且非 git 目录下正常工作" };
    },
  },
  {
    name: "CONTEXT.md 合规样本 → 硬结构闸门必须放行",
    mutate: (d) => cpSync(join(d, "tests", "fixtures", "tiny-CONTEXT.md"), join(d, "CONTEXT.md")),
    check: (d) => ({ r: run(d, "scripts/verify-structure.mjs", ["-Project", d]), need: "硬结构校验通过", expectCode: 0 }),
  },
  {
    name: "把没填的 CONTEXT-TEMPLATE 原样当 CONTEXT.md → 必须拦住（占位符/空表格）",
    // **复审提出的那条**：模板交付时**本身就是合规的**（带示例实体、示例状态机、
    // 一个带完整错误行的示例端点）→ 一份**没填过的模板**也能过闸门，
    // 而闸门本该问"**你**想清楚了吗"。所以校验器现在专门拦这一类。
    // 判据刻意收紧：只认**占位符样式**的注释（例：/TODO/xxx），不认说明性注释 ——
    // 否则 `tiny-CONTEXT.md`（第 3 行有说明性注释）会被误杀，上一条用例立刻红。
    mutate: (d) => cpSync(join(d, "engineering", "multi-agent-squad", "CONTEXT-TEMPLATE.md"), join(d, "CONTEXT.md")),
    check: (d) => ({ r: run(d, "scripts/verify-structure.mjs", ["-Project", d]), need: "占位符", expectCode: 1 }),
  },
  {
    name: "CONTEXT.md 里留一行整行空着的表格 → 必须拦住（字段还没填）",
    mutate: (d) => {
      cpSync(join(d, "tests", "fixtures", "tiny-CONTEXT.md"), join(d, "CONTEXT.md"));
      edit(join(d, "CONTEXT.md"), (t) => t + "\n|  |  |  |\n");
    },
    check: (d) => ({ r: run(d, "scripts/verify-structure.mjs", ["-Project", d]), need: "空着", expectCode: 1 }),
  },
  {
    name: "表格判据的四个对照（复审 L8）：全空/部分空要拦，全填/分隔行要放行",
    // 复审要求补"**部分填写应放行**"的对照样例，因为它怀疑 `| 字段 |  |  |` 被误判成"整行空着"。
    // **实测结论**：那个怀疑一半对一半错 ——
    //   · 过滤**没错**：判据本来就是"一行里 2 个以上格子是空的"，`| 字段 |  |  |` 确实该拦
    //     （那些格子是要你填的）；
    //   · **错的是措辞**：旧报错说"整行空着"，而这一行并不是整行空 —— 会让人以为判错了。
    // 所以：改准措辞，并在这里把四种情形**钉住**（全空/部分空 → exit 1；全填/分隔行 → exit 0）。
    check: (d) => {
      const cases = [
        ["|  |  |  |", 1, "全空"],
        ["| 字段 |  |  |", 1, "部分空（2 个空）"],
        ["| 字段 | 值 |", 0, "全填"],
        ["|---|---|---|", 0, "分隔行"],
      ];
      const bad = [];
      for (const [row, want, why] of cases) {
        cpSync(join(d, "tests", "fixtures", "tiny-CONTEXT.md"), join(d, "CONTEXT.md"));
        edit(join(d, "CONTEXT.md"), (t) => t + `\n${row}\n`);
        const r = run(d, "scripts/verify-structure.mjs", ["-Project", d]);
        const got = (r.status ?? 1) === 0 ? 0 : 1;
        if (got !== want) bad.push(`${why}（${row}）期望 exit ${want}，实际 ${got}`);
      }
      return {
        code: bad.length ? 1 : 0, expectCode: 0,
        out: bad.length ? bad.join("; ") : "四种情形全部符合预期（全空/部分空拦、全填/分隔行放行）",
      };
    },
  },
  {
    name: "端点删掉错误行 → 硬结构闸门必须拦住",
    mutate: (d) => {
      cpSync(join(d, "tests", "fixtures", "tiny-CONTEXT.md"), join(d, "CONTEXT.md"));
      edit(join(d, "CONTEXT.md"), (t) => t.replace(/^\|\s*错误\s*\|.*$/m, ""));
    },
    check: (d) => ({ r: run(d, "scripts/verify-structure.mjs", ["-Project", d]), need: "没写错误处理", expectCode: 1 }),
  },
  {
    name: "状态图出现死状态 → 硬结构闸门必须拦住",
    mutate: (d) => {
      cpSync(join(d, "tests", "fixtures", "tiny-CONTEXT.md"), join(d, "CONTEXT.md"));
      edit(join(d, "CONTEXT.md"), (t) => t.replace("  cancelled --> [*]", "  cancelled --> stuck : 人工介入"));
    },
    check: (d) => ({ r: run(d, "scripts/verify-structure.mjs", ["-Project", d]), need: "死状态", expectCode: 1 }),
  },
  {
    name: "ER 图出现孤岛实体 → 硬结构闸门必须拦住",
    mutate: (d) => {
      cpSync(join(d, "tests", "fixtures", "tiny-CONTEXT.md"), join(d, "CONTEXT.md"));
      edit(join(d, "CONTEXT.md"), (t) => t.replace("  ORDER ||--|{ ORDER_ITEM : contains", "  ORDER ||--|{ ORDER_ITEM : contains\n  COUPON {\n    string code\n  }"));
    },
    check: (d) => ({ r: run(d, "scripts/verify-structure.mjs", ["-Project", d]), need: "孤岛", expectCode: 1 }),
  },

  // ── 钩子自己的用例 ────────────────────────────────────────────────────────
  // 为什么加这几条：独立复审指出「"闸门要跑才算数"这句话对钩子自己不成立」——
  // 把触发正则收窄一个字符、或删掉提醒，其余闸门**依旧全绿**，没人会发现。
  // 做法：从钩子里**抽出真正的正则**来跑（不另抄一份：抄一份就又制造一处会分叉的副本）。
  {
    name: "钩子的触发正则：改检查器 / 改名 / 移进子目录 都必须触发",
    check: (d) => {
      const hook = readFileSync(join(d, "scripts", "git-hooks", "pre-commit"), "utf8");
      const m = hook.match(/grep -qE '([^']+)'/);
      if (!m) return { code: 1, out: "钩子里找不到触发正则（grep -qE '...'）—— 规则已失效", expectCode: 0 };
      // ⚠️ 这里的正则**来自被测对象**（`scripts/git-hooks/pre-commit` 里的那行 `grep -qE '...'`），
      //    不是白名单 —— 我上一版的注释写成"来自钉死的白名单"，**那是错的**（第六轮复审指出）。
      //    安全结论不变：正则的来源是仓库内的文件，没有任何外部输入进来；而且**测的就是它本身**
      //    （换成白名单就测不到钩子了）。nosemgrep 抑制的理由按这句读。
      const re = new RegExp(m[1]);  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
      const lines = [
        ["改检查器", "M\tscripts/check-consistency.mjs", true],
        ["改名到子目录", "R100\tscripts/self-test.mjs\tscripts/lib/self-test.mjs", true],
        ["改钩子自己", "M\tscripts/git-hooks/pre-commit", true],
        ["改样例", "M\ttests/fixtures/tiny-CONTEXT.md", true],
        ["只改 README（不该触发）", "M\tREADME.md", false],
        ["只改技能正文（轻量档，不该触发）", "M\tengineering/tdd/SKILL.md", false],
      ];
      const bad = lines.filter(([, text, want]) => re.test(text) !== want);
      return {
        code: bad.length ? 1 : 0, expectCode: 0,
        out: bad.length ? bad.map(([n, t, w]) => `${n}：期望${w ? "触发" : "不触发"}，实际相反（${t}）`).join("; ") : "六种情形全部符合预期",
      };
    },
  },
  {
    name: "钩子的复审提醒：必须存在，且**先于**自检打印（自检失败也要提醒到）",
    check: (d) => {
      const hook = readFileSync(join(d, "scripts", "git-hooks", "pre-commit"), "utf8");
      const iRemind = hook.indexOf("独立上下文");
      const iSelftest = hook.indexOf("node scripts/self-test.mjs");
      const problems = [];
      if (iRemind < 0) problems.push("提醒文案不见了（独立上下文 reviewer）");
      if (iSelftest < 0) problems.push("自检调用不见了");
      if (iRemind >= 0 && iSelftest >= 0 && iRemind > iSelftest) problems.push("提醒排在自检之后 —— 自检没过时就不会提醒（复审实测过的漏洞）");
      return { code: problems.length ? 1 : 0, expectCode: 0, out: problems.join("; ") || "提醒存在且在自检之前" };
    },
  },
  {
    name: "钩子的前置检查：引用的文件不见了要说清是改名还是误删",
    check: (d) => {
      const hook = readFileSync(join(d, "scripts", "git-hooks", "pre-commit"), "utf8");
      const refs = ["validate-skills.mjs", "scripts/verify-ps1.mjs", "scripts/check-consistency.mjs", "scripts/extract-cheatsheets.mjs", "scripts/self-test.mjs"];
      const problems = [];
      if (!hook.includes("找不到") || !/改名或移动/.test(hook)) problems.push("没有前置检查（缺「找不到…改名或移动」这类说明）");
      // 钩子调用的每个脚本都必须在前置清单里
      const pre = hook.split("log \"── pre-commit")[1]?.split("]) ; do")[0] ?? "";
      for (const f of refs) {
        if (hook.includes(`node ${f}`) && !pre.includes(f)) problems.push(`调用了 ${f}，但它不在前置清单里`);
      }
      return { code: problems.length ? 1 : 0, expectCode: 0, out: problems.join("; ") || "前置检查覆盖全部被调用的脚本" };
    },
  },

  // ── quality-gate 自身的用例 ────────────────────────────────────────────────
  // 为什么加：实测踩过——我新写的一段代码让 **C2 整项一条结果都不产出**（StrictMode 下 $null.Count 抛异常），
  // 摘要照常打印 "checked 12"，**没有任何迹象表明少了一项**。漏掉的检查会被读成"这项没问题"。
  // 加之前：十四 个用例全在测别的脚本，quality-gate **零覆盖**（这句是**历史记录**，
  // 所以写的是当时的数字；它同时是 facts.json 里 self-test-cases 的行锚点——
  // 挪动/改写这句话会让 check-consistency 红，这是故意的）。
  {
    name: "quality-gate 必须产出源码里声明的每一项（不许静默少项）",
    check: (d) => {
      const gate = join(d, "scripts", "quality-gate.ps1");
      const proj = join(d, "tests", "fixtures", "empty-project");
      mkdirSync(proj, { recursive: true });
      const jsonOut = join(d, "gate-self-test.json");
      const ps = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      // 把工具目录"藏起来"（USERPROFILE/APPDATA/LOCALAPPDATA 指向不存在路径）：
      // semgrep/ruff/gitleaks 于是都走 SKIP 分支 —— 用例快、离线可跑，且每条 Add-Result 都会执行。
      const env = { ...process.env, USERPROFILE: "C:\\__no_such__", APPDATA: "C:\\__no_such__", LOCALAPPDATA: "C:\\__no_such__", PATH: "C:\\Windows\\System32" };
      // ⚠️ **必须带 -IncludeTests**：E1 那一段只有带这个开关才会执行。
      // 真机第一次跑就抓到我这条用例自相矛盾 —— 不带开关跑闸门（E1 不产出），
      // 却拿"源码里现算的期望"（含 E1）去比对 → **这条用例自己注定要红**。
      // 现在带开关，期望集就是"源码里声明的全部"，语义才是干净的。
      // （副作用：E1 会真的去试 python，结果 FAIL/SKIP 都无所谓 —— 闸门照样产出 E1 这一条结果。）
      const r = spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", gate, "-Path", proj, "-IncludeTests", "-Json", jsonOut], { cwd: d, encoding: "utf8", env });
      const out = `${r.stdout}${r.stderr}`;
      if (!existsSync(jsonOut)) return { code: 1, expectCode: 0, out: `闸门没产出 JSON 报告；尾部：\n${out.split("\n").slice(-8).join("\n")}` };
      const rep = JSON.parse(readFileSync(jsonOut, "utf8"));
      const ids = [...new Set((rep.results || []).map((x) => x.Id))];
      // **期望集 = 闸门源码里声明的全部**（现算，不手抄）。
      // 注意：现算在这里**是对的**，因为这条用例问的是"源码声明 ⇄ 真产出"是否一致；
      // "删掉一项检查"这种内部闭合的漂移由**闸门外面那份钉住的清单**管
      // （scripts/verify-gate-integrity.mjs 的 PINNED_GATE_IDS）。
      const expected = [...new Set([...readFileSync(gate, "utf8").matchAll(/Add-Result\s+'([A-E]\d+)'/g)].map((m) => m[1]))];
      const missing = expected.filter((e) => !ids.includes(e));
      const problems = [];
      if (missing.length) problems.push(`静默少项: ${missing.join(", ")}`);
      if (out.includes("GATE INTEGRITY BROKEN")) problems.push("闸门自己报了 GATE INTEGRITY BROKEN");
      if (problems.length) problems.push(`实际 ids: ${ids.join(",")}`);
      return { code: problems.length ? 1 : 0, expectCode: 0, out: problems.join(" | ") || `${ids.length} 项齐全，与源码声明一致（${ids.join(",")}）` };
    },
  },
  {
    name: "quality-gate 的完整性总闸：故意让一项不产出 → 必须报 BROKEN 且退出码非 0",
    // 只改**检查那一侧**：写成 /'D2'/g 会把期望清单里的 'D2' 一起改掉，
    // 两侧同时变 → 总闸当然不响（第一次就是这么写的，用例假绿了一轮）。
    mutate: (d) => edit(join(d, "scripts", "quality-gate.ps1"), (t) => t.replace(/Add-Result 'D2'/g, "Add-Result 'D9'")),
    check: (d) => {
      const gate = join(d, "scripts", "quality-gate.ps1");
      const proj = join(d, "tests", "fixtures", "empty-project");
      mkdirSync(proj, { recursive: true });
      const ps = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      const env = { ...process.env, USERPROFILE: "C:\\__no_such__", APPDATA: "C:\\__no_such__", LOCALAPPDATA: "C:\\__no_such__", PATH: "C:\\Windows\\System32" };
      const r = spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", gate, "-Path", proj], { cwd: d, encoding: "utf8", env });
      const out = `${r.stdout}${r.stderr}`;
      const ok = out.includes("GATE INTEGRITY BROKEN") && out.includes("missing") && (r.status ?? 1) !== 0;
      return { code: ok ? 0 : 1, expectCode: 0, out: ok ? "总闸按预期报警（missing + 非零退出码）" : `总闸没报警，退出码=${r.status}；尾部：\n${out.split("\n").slice(-6).join("\n")}` };
    },
  },
  {
    name: "没登记的体系数字 → 事实登记表（facts.json）必须拦住",
    // 这是"新增数字必须登记"的机制本身：不带护栏的新数字 = 下一处文档腐烂的种子。
    mutate: (d) => edit(join(d, "从这里开始.md"), (t) => t.replace("## 二、我该用哪个技能", "本库共有 99 个检查器。\n\n## 二、我该用哪个技能")),
    check: (d) => ({ r: run(d, "scripts/check-consistency.mjs"), need: "unregistered-facts", expectCode: 1 }),
  },
  {
    name: "没登记的体系数字（中文数字）→ 登记表必须拦住",
    // **V3**：旧版只认 `\d+`，写「九十九个检查器」**全绿**（中文数字/全角数字零防护）。
    // 断言锚定 verify-all-count 这条声明：它持有入口文档里的「六个检查器」。
    mutate: (d) => edit(join(d, "从这里开始.md"), (t) => t.replace("## 二、我该用哪个技能", "本库共有九十九个检查器。\n\n## 二、我该用哪个技能")),
    check: (d) => ({ r: run(d, "scripts/check-consistency.mjs"), needId: "registered-claims", needAlso: "unregistered-facts", expectCode: 1 }),
  },
  {
    name: "没登记的体系数字（全角数字）→ 登记表必须拦住",
    // **V3 的另一半**：`１５个脚本`（全角）在旧版同样全绿。
    mutate: (d) => edit(join(d, "从这里开始.md"), (t) => t.replace("## 二、我该用哪个技能", "本库共有１５个脚本。\n\n## 二、我该用哪个技能")),
    check: (d) => ({ r: run(d, "scripts/check-consistency.mjs"), need: "unregistered-facts", expectCode: 1 }),
  },
  {
    name: "入口文档标题的脚本数（中文数字）被改错 → 登记表必须拦住",
    // ⚠️ 两条硬要求，都是真机踩出来的：
    //   ① 变异必须是**两个字的**中文数字：claim 正则是 `[一二三四五六七八九十]{2,}`，
    //      写成单字会**命中 0 处** → 红的是"锚点失效"（registered-claims），不是要断言的数字核对。
    //   ② **别写死"十六个脚本"**：这个数字会随脚本数变（本库从 16 变过 17），写死之后
    //      `String.replace` 找不到就静默返回原串 → 变异落空 → 用例假红（真机第三次就是它）。
    //      所以改成**从文件里现取**那段文字，用正则匹配当前数字。
    mutate: (d) => edit(join(d, "从这里开始.md"), (t) => {
      const m = t.match(/## 三、([一二三四五六七八九十]{2,})个脚本/);
      if (!m) throw new Error("找不到「## 三、<中文数字>个脚本」这个标题 —— 用例的前提变了，请同步");
      return t.replace(m[0], `## 三、十五个脚本`);
    }),
    check: (d) => ({ r: run(d, "scripts/check-consistency.mjs"), needId: "script-count-cn", expectCode: 1 }),
  },
  {
    name: "正常行文复用已登记的小数字（「先装 2 个技能试试」）→ 必须放行",
    // **误报摩擦**：旧版会报 FAIL，逼人每写一句自然语言就去改登记表 —— 那种闸门很快会被无视。
    // 判据：叙述性小数字（< smallNumberThreshold）不要求登记，但**两位数以上的精确声明仍然要登记**
    // （下一条用例就是它的反面）。
    mutate: (d) => edit(join(d, "从这里开始.md"), (t) => t.replace("## 二、我该用哪个技能", "先装 2 个技能试试。\n\n## 二、我该用哪个技能")),
    check: (d) => ({ r: run(d, "scripts/check-consistency.mjs"), expectCode: 0, passId: "registered-claims" }),
  },
  {
    name: "新句子写了一个没登记的大数字（99 个技能）→ 仍必须拦住",
    mutate: (d) => edit(join(d, "从这里开始.md"), (t) => t.replace("## 二、我该用哪个技能", "本库有 99 个技能。\n\n## 二、我该用哪个技能")),
    check: (d) => ({ r: run(d, "scripts/check-consistency.mjs"), needId: "unregistered-facts", expectCode: 1 }),
  },
  // ── 登记表"行锚定"的用例（V2：独立复审抓到的**退步**）──────────────────────
  // 为什么必须有用例：旧版是"一个正则 + 命中计数"，把 README 技能总览标题的括号改成冒号，
  // 数字保持不变，**检查器全绿**；加了"整条 fact 至少命中一次 + 按文件要求命中"**仍然没抓住**，
  // 因为同一个正则还在同一文件第 192 行（安装脚本那句注释）命中。
  // 下面三条把"计数救不了声明消失"钉住：只有锚定到具体行才拦得住。
  // ⚠️ 这段注释里**刻意不写完整的声明原文**：写了的话它自己会被 claim 正则匹配到
  //    （实测会被数成 29 个"用例"），那是检查器被自己的注释骗了。
  {
    name: "README 技能数声明被改写措辞（括号改冒号）→ 登记表必须拦住",
    mutate: (d) => edit(join(d, "README.md"), (t) => t.replace("## 二、技能总览（36 个）", "## 二、技能总览：共 36 个")),
    check: (d) => ({ r: run(d, "scripts/check-consistency.mjs"), needId: "registered-claims", needAlso: "这句声明消失了", expectCode: 1 }),
  },
  {
    name: "README 技能数声明整句消失 → 登记表必须拦住",
    mutate: (d) => edit(join(d, "README.md"), (t) => t.replace("## 二、技能总览（36 个）", "## 二、技能全景")),
    check: (d) => ({ r: run(d, "scripts/check-consistency.mjs"), needId: "registered-claims", expectCode: 1 }),
  },
  {
    name: "同一文件里多出一处没登记的技能数声明 → 登记表必须拦住",
    mutate: (d) => edit(join(d, "README.md"), (t) => t.replace("### 安装与更新（两条命令）", "### 安装与更新（两条命令）\n\n技能总览（35 个）\n")),
    check: (d) => ({ r: run(d, "scripts/check-consistency.mjs"), needId: "registered-claims", expectCode: 1 }),
  },
  // ── 登记表**自己**坏了也要被发现（它现在是判据本身）────────────────────────
  {
    name: "锚点 witness 被改成解析不到的行 → 登记表必须自曝",
    mutate: (d) => edit(join(d, "scripts", "facts.json"), (t) => t.replace("**技术红线审查**（", "技术红线审查（（")),
    check: (d) => ({ r: run(d, "scripts/check-consistency.mjs"), needId: "registered-claims", expectCode: 1 }),
  },
  {
    name: "锚点 witness 不够独特（能命中多行）→ 登记表必须自曝",
    mutate: (d) => edit(join(d, "scripts", "facts.json"), (t) => t.replace('"witness": "**红线 "', '"witness": "项"')),
    check: (d) => ({ r: run(d, "scripts/check-consistency.mjs"), needId: "registered-claims", expectCode: 1 }),
  },
  {
    name: "claim 正则取不出数字了 → 登记表必须自曝",
    mutate: (d) => edit(join(d, "scripts", "facts.json"), (t) => t.replace('(\\\\d+)\\\\s*项"', '项"')),
    check: (d) => ({ r: run(d, "scripts/check-consistency.mjs"), needId: "registered-claims", expectCode: 1 }),
  },
  {
    name: "真值来源被写成不存在的 key → 登记表必须自曝",
    mutate: (d) => edit(join(d, "scripts", "facts.json"), (t) => t.replace('"truth": "checks.redline"', '"truth": "checks.nonexistent"')),
    check: (d) => ({ r: run(d, "scripts/check-consistency.mjs"), needId: "facts-registry", expectCode: 1 }),
  },
  {
    name: "自检用例表被改名（CASES 不再被迭代）→ 真值来源必须自曝",
    // V4 的另一面：**看着被管、其实没人管**。真值来源（self-test.mjs 的用例条数）
    // 变成 0 的那一刻，"自检用例数"这条声明就没有真值了 —— 检查器必须直接说"真值来源失效"，
    // 而不是拿 0 去核对、然后报一堆无关的红。
    mutate: (d) => edit(join(d, "scripts", "self-test.mjs"), (t) => t.replace("const CASES = [", "const CASES_X = [")),
    check: (d) => ({ r: run(d, "scripts/check-consistency.mjs"), needId: "registered-claims", needAlso: "真值来源已经失效", expectCode: 1 }),
  },
  {
    name: "quality-gate 的项数被改（E1 改名）→ 文档里的项数必须红",
    mutate: (d) => edit(join(d, "scripts", "quality-gate.ps1"), (t) => t.replace("Add-Result 'E1'", "Add-Result 'E9'")),
    check: (d) => ({ r: run(d, "scripts/check-consistency.mjs"), needId: "registered-claims", expectCode: 1 }),
  },

  // ── verify-all 自己的三档判定（V1/V5/V6）──────────────────────────────────
  // ⚠️ **这条是静态检查，不是运行时验证 —— 如实标注**：
  //    它要验证的行为是"起不了子进程时不许报 FAIL"，而**跑它本身就要起子进程**
  //    （本沙箱里 spawnSync = EPERM），所以这里只能查源码里的判定结构。
  //    真正的运行时验证在 `scripts/verify-clean-clone.mjs`（干净房间里跑 verify-all，
  //    并且它自己也会区分 exit 3）—— 那条要换到能起子进程的机器上跑。
  {
    name: "verify-all 的结构：三档判定 / 少项总闸 / --fast 警告（静态）",
    check: (d) => {
      const src = readFileSync(join(d, "scripts", "verify-all.mjs"), "utf8");
      const problems = [];
      const need = [
        ["起不了子进程时不许压成 FAIL（V1）", /r\.error[\s\S]{0,80}NOTRUN/],
        ["exit 3 = 没跑成，且有独立分支", /process\.exit\(3\)/],
        ["把检查器自己的 exit 3 也读成'没跑成'", /status\s*\?\?\s*1\)\s*===\s*3|=== 3\b/],
        ["少项总闸：期望步数是**一条独立常量**（V6）", /EXPECTED_STEPS/],
        ["--fast 必须明说跳过了自检（V5）", /--fast[\s\S]{0,200}跳过/],
        ["有跳过项时结论是 PASS*，不是 PASS", /PASS\*/],
      ];
      for (const [why, re] of need) if (!re.test(src)) problems.push(why);
      // 总闸必须是"用了"的，不能只声明
      const uses = [...src.matchAll(/EXPECTED_STEPS/g)].length;
      if (uses < 2) problems.push(`EXPECTED_STEPS 只出现 ${uses} 次 —— 声明了但没拿它做比较（总闸没接上）`);
      return {
        code: problems.length ? 1 : 0, expectCode: 0,
        out: problems.length ? problems.join("; ") : "六条判定结构齐全（注意：这是静态检查，运行时验证在 verify-clean-clone）",
      };
    },
  },
  {
    name: "state.ps1 真的按 schema 查（类型/深层必填/枚举）—— 静态结构 + 坏样例",
    // **F6**：旧版只查"字段名有没有被声明"+ 几个写死的枚举，于是
    // `confirmed: "true"`（字符串）被当成已确认，而 schema 里深层对象写的 required
    // （artifacts.context_md）**从没被读过** = 死代码。
    // ⚠️ 这里能查的是**结构**（本沙箱里 spawnSync 被禁，跑不了 powershell）：
    //    行为验证是手工做过的（13 个场景：3 个合法样例放行、10 个坏样例各自报出**具体路径**），
    //    要在能起子进程的机器上重放才作数。
    check: (d) => {
      const ps1 = readFileSync(join(d, "scripts", "state.ps1"), "utf8");
      const schema = readFileSync(join(d, "scripts", "state.schema.json"), "utf8");
      const fixture = readFileSync(join(d, "tests", "fixtures", "state-bad.json"), "utf8");
      const f = JSON.parse(fixture);
      const problems = [];
      if (!/function Test-SchemaNode/.test(ps1)) problems.push("没有递归校验函数 Test-SchemaNode");
      if (!/Test-SchemaNode -Value \$st -Schema \$schema/.test(ps1)) problems.push("Test-SchemaNode 没有被 validate 调用（写了没用）");
      if (!/Resolve-SchemaPointer/.test(ps1)) problems.push("没有 $ref 解析（gates.g1–g4 用的是 $ref）");
      // StrictMode 陷阱：schema 节点上没有的键必须走 PSObject.Properties[...]。
      // ⚠️ 先剥掉注释再查 —— 否则**解释这个陷阱的注释本身**会被判成违规（实测踩过，假红）。
      const codeOnly = ps1.split(/\r?\n/).map((l) => l.replace(/(^|\s)#.*$/, "")).join("\n");
      const bad = codeOnly.match(/\$Schema\.(type|required|enum|const|properties|items|additionalProperties|minLength)\b(?![\w])/g) ?? [];
      if (bad.length) problems.push(`StrictMode 下会抛异常的直接取属性写法: ${[...new Set(bad)].join(", ")}（要用 PSObject.Properties['x'].Value）`);
      // schema 里"写了类型"的节点数量 —— 太少说明类型声明被删了，校验退化成查字段名
      const typed = (schema.match(/"type":/g) ?? []).length;
      if (typed < 25) problems.push(`state.schema.json 里只声明了 ${typed} 处 type（<25）—— 类型校验退化了`);
      // 坏样例本身必须真的坏（否则这个测试是空转）
      try {
        if (typeof f.version !== "string") problems.push("坏样例的 version 不是字符串（这份样例必须违反 schema）");
        if (typeof f.redline.data_source_ok.confirmed !== "string") problems.push("坏样例的 confirmed 不是字符串");
        if (f.artifacts.context_md !== undefined) problems.push("坏样例竟然有 context_md（它必须缺这个必填字段）");
      } catch (e) { problems.push(`坏样例结构不对：${e.message}`); }
      if (!/context-md|context_md|缺必填/.test(ps1)) problems.push("实现里看不到'缺必填字段'的报错文案");
      // 行为协议必须还在：静态用例证明不了行为，所以"行为怎么验"本身要有落盘的判据
      if (!existsSync(join(d, "tests", "fixtures", "BEHAVIOR-VERIFICATION.md"))) problems.push("缺 tests/fixtures/BEHAVIOR-VERIFICATION.md（行为验证协议）");
      // 注：F7（ruff 配置发现）的静态判据**已移到单独一条用例**（逻辑现在在 ruff-label.ps1）。
      // 教训：那条旧断言写的是"在 quality-gate.ps1 里找 Get-RuffRulesetLabel"，
      // 而我把函数抽走之后它**立刻假红**（真机跑出来的）—— 断言必须跟着代码搬家。
      return {
        code: problems.length ? 1 : 0, expectCode: 0,
        out: problems.length ? problems.join("; ") : `递归校验结构齐全（schema 里 ${typed} 处 type 声明；坏样例三处违反都还在）`,
      };
    },
  },
  {
    name: "ruff 标签的静态结构 + quality-gate 真的点源了它（抽走函数后必须有人看着）",
    // **这条是补一个真缺口**：我把 `Get-RuffRulesetLabel` 从 `quality-gate.ps1` 抽到
    // `scripts/ruff-label.ps1` 之后——
    //   · 旧断言在**主文件里**找那个函数，于是**假红**（真机跑出来的）；
    //   · 更要紧的是：**没有任何检查断言"主文件真的点源了它"** —— 把 `. (Join-Path $PSScriptRoot 'ruff-label.ps1')`
    //     删掉，闸门只会在运行时报"找不到命令"，静态判据看不见（它不再是"同侧"的问题）。
    // 所以这条同时管两件事：函数在**新家**、且**主文件确实引了它**。
    check: (d) => {
      const labelPath = join(d, "scripts", "ruff-label.ps1");
      const gate = readFileSync(join(d, "scripts", "quality-gate.ps1"), "utf8");
      const problems = [];
      if (!existsSync(labelPath)) {
        problems.push("没有 scripts/ruff-label.ps1（ruff 配置发现应在它自己的文件里，两条路共用）");
      } else {
        const label = readFileSync(labelPath, "utf8");
        if (!/function Get-RuffRulesetLabel/.test(label)) problems.push("ruff-label.ps1 里没有 Get-RuffRulesetLabel");
        if (!/Split-Path -Parent \$probe/.test(label)) problems.push("ruff 配置发现没有向上走（只查项目根 = F7 那个 bug）");
        if (!/INHERITED config from OUTSIDE/.test(label)) problems.push("没有'配置在项目外'的标签（嵌套项目会被贴错标签）");
        if (!/user-config-present/.test(label)) problems.push("没有用户级配置那一档（复审 M8）");
      }
      if (!/\.\s*\(Join-Path\s+\$PSScriptRoot\s+'ruff-label\.ps1'\)/.test(gate)) {
        problems.push("quality-gate.ps1 **没有点源** ruff-label.ps1 —— 闸门会在运行时报找不到命令，而静态判据看不见");
      }
      if (!/Get-RuffRulesetLabel -Root \$ProjectRoot/.test(gate)) problems.push("Get-RuffRulesetLabel 没有被 C2 调用");
      return {
        code: problems.length ? 1 : 0, expectCode: 0,
        out: problems.length ? problems.join("; ") : "ruff-label.ps1 结构齐全，且 quality-gate.ps1 确实点源了它",
      };
    },
  },
  {
    name: "删掉 F6 的递归 → 结构检查必须红（复审 M3：以前删了照样全绿）",
    // **复审实测的洞**：上面那条 F6 用例的断言全是"函数名在不在、调没调、type 声明够不够"，
    // 所以把 `Test-SchemaNode` 里**逐属性递归**那一段删掉（于是 `artifacts.context_md`
    // 与 `redline.confirmed` 两条违例不再被报出）—— 那条用例**原样重放仍然全绿**。
    // 也就是说 F6 只有"代码还在"的证据，没有"行为还对"的证据。
    // 这条用例补的就是它：**先删递归，然后要求上面那套结构断言报警**。
    // （双向：无变异时必须绿 —— 否则就是个永远报警的狼来了。）
    mutate: (d) => edit(join(d, "scripts", "state.ps1"), (t) => {
      const from = "    foreach ($p in $Value.PSObject.Properties) {";
      if (!t.includes(from)) throw new Error("找不到递归那段 —— 用例的前提变了，请同步（复审 M3 要的正是这段）");
      return t.replace(from, "    foreach ($p in @()) {   // ← 变异：把逐属性递归去掉");
    }),
    check: (d) => {
      // 复刻上面那条用例的**结构断言**（这就是"把断言原样重放"）
      const ps1 = readFileSync(join(d, "scripts", "state.ps1"), "utf8");
      const problems = [];
      if (!/function Test-SchemaNode/.test(ps1)) problems.push("没有递归校验函数");
      if (!/Test-SchemaNode -Value \$st -Schema \$schema/.test(ps1)) problems.push("没有被 validate 调用");
      if (!/Resolve-SchemaPointer/.test(ps1)) problems.push("没有 $ref 解析");
      if (!/foreach \(\$p in \$Value\.PSObject\.Properties\)/.test(ps1)) problems.push("**逐属性递归没了**（子对象的必填/类型不再被检查）");
      if (!/缺必填字段/.test(ps1)) problems.push("看不到缺必填的报错文案");
      // ⚠️ **这两条用例的通过语义是"反"的**（真机第一次跑就抓到我写反了）：
      //    变异用例里，"护栏**抓到了**变异" = 用例**通过**（exit 0）；
      //    "护栏没抓到" = 用例**失败**（exit 1）。
      //    写成 problems.length ? 1 : 0 的话，护栏**成功了**反而报"用例失败"——
      //    实测真机输出：`[FAIL] 删掉 F6 的递归…  期望退出码 0，实际 1`，
      //    而它上面那行 `逐属性递归没了` 恰恰说明护栏干得对。
      return {
        code: problems.length ? 0 : 1, expectCode: 0,
        out: problems.length
          ? `用例通过（护栏正确报出：${problems.join("; ")}）`
          : "**用例失败**：变异之后护栏居然没报警 —— 这些断言识破不了删除",
      };
    },
  },
  {
    name: "quality-gate 的期望清单：钉在闸门外面，且「只剩注释」要被抓到",
    // **$expectedIds 的第二份真相源**（复审原话）：闸门内部那份清单和"真跑出来的项"是**同一侧**的
    // —— 删一项检查，两边一起变小、总闸不响、全绿。所以期望清单必须钉在**闸门外面**
    // （`scripts/verify-gate-integrity.mjs` 的 PINNED_GATE_IDS），并且它要能识破
    // "检查项只剩注释里提到"这种假绿（实测：我自己那句解释性注释就把第一版骗过去了）。
    check: (d) => {
      const p = join(d, "scripts", "verify-gate-integrity.mjs");
      if (!existsSync(p)) return { code: 1, expectCode: 0, out: "没有 scripts/verify-gate-integrity.mjs" };
      const src = readFileSync(p, "utf8");
      const problems = [];
      if (!/PINNED_GATE_IDS\s*=\s*\[/.test(src)) problems.push("期望清单没有钉在这个文件里（还在手抄第二份？）");
      if (!/goneFromSource/.test(src)) problems.push("没有「源码里还在不在」的核对");
      if (!/commentedOut/.test(src)) problems.push("没有识破「Add-Result 已经没了、只剩注释/声明」的假绿");
      if (!/process\.exit\(3\)/.test(src)) problems.push("没跑成时没有按「没跑成」退出（会把环境问题说成通过/失败）");
      // 钉住的清单必须与闸门源码里的检查项**对得上**（多/少都要报）
      // 字母区间用 A-Z：将来加 F 段检查时，这条静态判据也要管得住（复审 M9(b)）
      const gateIds = [...new Set([...readFileSync(join(d, "scripts", "quality-gate.ps1"), "utf8")
        .matchAll(/Add-Result\s+'([A-Z]\d+)'/g)].map((m) => m[1]))].sort();
      const pinned = (src.match(/PINNED_GATE_IDS\s*=\s*\[([^\]]*)\]/s)?.[1] ?? "")
        .match(/"[A-Z]\d+"/g)?.map((s) => s.replace(/"/g, "")).sort() ?? [];
      if (!pinned.length) problems.push("PINNED_GATE_IDS 解析不出来（格式变了？）");
      else {
        // E1 也**已经钉住**了（复审 M4：以前把它排除在外，等于给"删掉 E1"开了后门）
        const missing = gateIds.filter((g) => !pinned.includes(g));
        const extra = pinned.filter((g) => !gateIds.includes(g));
        if (missing.length) problems.push(`闸门里有但钉住的清单没有: ${missing.join(", ")}（新加的检查没进清单）`);
        if (extra.length) problems.push(`钉住的清单里有但闸门没有: ${extra.join(", ")}（检查被删了，或清单过期）`);
      }
      return {
        code: problems.length ? 1 : 0, expectCode: 0,
        out: problems.length ? problems.join("; ") : `钉住 ${pinned.length} 项，与闸门源码一致（含 E1）`,
      };
    },
  },
  {
    name: "顶层缺键（缺 version）→ 必须报「缺必填字段」，不许抛异常栈（复审 M1）",
    // **复审 M1 的洞**：`validate` 原来先跑 `if ($st.version -ne 1)` 再做 schema 校验，
    // 而 StrictMode 下取不存在的键**直接抛异常** → 用户看到的是 PowerShell 异常栈，
    // 方向完全错（该报的是"缺必填字段 version"）。
    //
    // ⚠️ **这条为什么不 spawn PowerShell**（真机实测后改的写法）：
    //    第一版是"跑 state.ps1 然后匹配输出里的中文"。真机输出：
    //      stdout="<乱码：控制台代码页不对，中文在这一段里已被替换成 U+FFFD，原文不可恢复>\n   - state: <乱码> version\n …"（乱码）
    //      stderr=""（空）
    //    —— 命令确实跑了、也 exit 1，但那句话在 Node 眼里**不是中文**：
    //    **Windows PowerShell 5.1 往管道写的是控制台代码页（中文系统 GBK/936）的字节，
    //    而 `spawnSync(encoding:"utf8")` 按 UTF-8 解码** → 中文全成乱码。
    //    （这条坑对"任何断言 PowerShell 输出里中文"的用例都成立；gate 那两条之所以没红，
    //      是因为它们断言的是 `GATE INTEGRITY BROKEN` / `missing` 这些 **ASCII**。）
    //    所以这里改成**夹具式**：拿真 schema（唯一判据）对同一份样例做同样的推理，
    //      · 若真实现**抛异常栈**（旧版行为）→ 抓不到那句人话 → 用例红；
    //      · 若真实现正常报错 → 断言必须都命中。
    //    state.ps1 自身的**行为**另有 `tests/fixtures/BEHAVIOR-VERIFICATION.md` 里
    //    手工跑过的判据表 + 本用例的结构断言共同覆盖（真机可直接照协议复跑）。
    check: (d) => {
      const schema = JSON.parse(readFileSync(join(d, "scripts", "state.schema.json"), "utf8"));
      const sample = JSON.parse(readFileSync(join(d, "tests", "fixtures", "state-missing-version.json"), "utf8"));
      const problems = [];
      // ① 样例必须真的缺 version（否则这个测试是空转）
      if ("version" in sample) problems.push("样例里竟然有 version —— 它必须缺这个必填字段");
      // ② schema 必须把 version 列为必填（判据来源只有这一份）
      const required = schema.required ?? [];
      if (!required.includes("version")) problems.push("state.schema.json 没把 version 列为必填 —— 判据没了");
      // ③ 实现必须**先做 schema 校验**（否则 StrictMode 下取 $st.version 会抛栈）：
      //    ⚠️ 必须**剥掉注释再找** —— 我自己就在 `state.ps1` 的注释里写了
      //    `$st.version -ne 1` 当"旧写法"的反例，不剥注释就会把它当成真代码而**假红**
      //    （第一次复刻判据时正是这么红的：位置 14089 < 15161）。
      const ps1 = readFileSync(join(d, "scripts", "state.ps1"), "utf8");
      const codeOnly = ps1.split(/\r?\n/).map((l) => l.replace(/(^|\s)#.*$/, "")).join("\n");
      const iSchema = codeOnly.indexOf("Test-SchemaNode -Value $st");
      const iDirectVersion = codeOnly.indexOf("$st.version");
      if (iSchema < 0) problems.push("validate 没有调用递归校验");
      if (iDirectVersion >= 0 && iSchema >= 0 && iDirectVersion < iSchema) {
        problems.push("`$st.version` 出现在 schema 校验**之前** —— StrictMode 下缺 version 会抛异常栈（M1 的老毛病）");
      }
      // ④ 报错文案必须是人话（不是异常栈）
      if (!/缺必填字段/.test(ps1)) problems.push("实现里没有「缺必填字段」这句人话");
      return {
        code: problems.length ? 1 : 0, expectCode: 0,
        out: problems.length
          ? problems.join("; ")
          : `夹具与判据都对得上（sample 缺 version / schema 必填含 version / 实现先校验后取值）`,
      };
    },
  },
  {
    name: "ruff 规则集标签的七种情形（复审 M8/F7：原来是手工判据表，现在自动化）",
    // **为什么以前是手工的**：标签只能"装个 ruff、跑整个闸门、从输出里读"才能验。
    // 现在 `quality-gate.ps1 -RuffLabel` 是**纯 ASCII 的独立入口**（见 ruff-label.ps1 顶部说明），
    // 于是这七种情形可以自动化：① 根下/上级都没有 → none ② 自己有配置 → project
    // ③ 上级 ruff.toml → inherited ④ 上级 pyproject **无** [tool.ruff] → none（不能误判）
    // ⑤ 上级 pyproject **有** [tool.ruff] → inherited ⑥ 自己与上级都有 → project（较近者生效）
    // ⑦ 用户级配置存在 → 摘要出现 user-config-present（复审 M8 点名的那一格）
    // 另：跑完**必须还原 USERPROFILE**，否则会污染后面所有用例。
    check: (d) => {
      const ps = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      if (!existsSync(ps)) return { code: 0, expectCode: 0, out: "没有 powershell.exe —— 本项跳过（不算失败）" };
      const base = mkdtempSync(join(tmpdir(), "ruff-label-"));
      const mk = (p) => mkdirSync(join(base, p), { recursive: true });
      const put = (p, text) => writeFileSync(join(base, p), text, "utf8");
      const savedHome = process.env.USERPROFILE;
      const run = (rel, home) => {
        process.env.USERPROFILE = join(base, home);
        const r = spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(d, "scripts", "quality-gate.ps1"), "-Path", join(base, rel), "-RuffLabel"], { cwd: d, encoding: "utf8" });
        return `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
      };
      const problems = [];
      try {
        for (const p of ["plain", "own", "parentA/proj", "parentB/proj", "parentC/proj", "both/proj", "nohome", "withhome"]) mk(p);
        put("own/ruff.toml", "select = ['E']\n");
        put("parentA/ruff.toml", "line-length = 100\n");
        put("parentB/pyproject.toml", "[project]\nname = 'x'\n");
        put("parentC/pyproject.toml", "[tool.ruff]\nline-length = 100\n");
        put("both/ruff.toml", "extend = 'x'\n");
        put("both/proj/ruff.toml", "select = ['E']\n");
        put("withhome/ruff.toml", "select = ['T20']\n");
        const cases = [
          ["plain", "nohome", "none/no-user-config", "根下与上级都没有"],
          ["own", "nohome", "project/no-user-config", "自己有配置"],
          ["parentA/proj", "nohome", "inherited/no-user-config", "上级 ruff.toml"],
          ["parentB/proj", "nohome", "none/no-user-config", "上级 pyproject 无 [tool.ruff]"],
          ["parentC/proj", "nohome", "inherited/no-user-config", "上级 pyproject 有 [tool.ruff]"],
          ["both/proj", "nohome", "project/no-user-config", "自己与上级都有 → 用自己那份"],
          ["plain", "withhome", "none/user-config-present", "用户级配置存在（M8 那一格）"],
        ];
        for (const [rel, home, want, why] of cases) {
          const got = run(rel, home);
          if (got !== want) problems.push(`${why}: 期望「${want}」实际「${got}」`);
        }
      } finally {
        if (savedHome === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = savedHome;
        rmSync(base, { recursive: true, force: true });
      }
      return {
        code: problems.length ? 1 : 0, expectCode: 0,
        out: problems.length ? problems.join("; ") : "七种情形全部符合预期（含 M8 的用户级配置那一格）",
      };
    },
  },
  {
    name: "跑闸门**不得污染仓库根**（复审之外的实测：PowerShell 会退回当前目录写缓存）",
    // **实测踩到的**：把 USERPROFILE / APPDATA / LOCALAPPDATA 指向**不存在的路径**（为了"藏起工具"），
    // 于是 PowerShell 找不到缓存位置，**退回到当前工作目录**去写 `ModuleAnalysisCache` ——
    // 仓库根凭空出现一个 `Microsoft/` 目录（我用 `git status` 才看见）。
    // 修法是让那些"假家目录"**真实存在**（用临时目录，工具照样隐身）。
    // 这条用例把"不污染"变成**可判**的：跑一次闸门，断言仓库根**没有多出目录**。
    check: (d) => {
      const ps = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      if (!existsSync(ps)) return { code: 0, expectCode: 0, out: "没有 powershell.exe —— 本项跳过（不算失败）" };
      const before = new Set(readdirSync(d, { withFileTypes: true }).map((e) => e.name).filter((n) => !n.startsWith(".")));
      const proj = join(d, "tests", "fixtures", "empty-project");
      mkdirSync(proj, { recursive: true });
      const fakeHome = join(d, "tests", "fixtures", "fake-home");
      mkdirSync(fakeHome, { recursive: true });
      const env = { ...process.env, USERPROFILE: fakeHome, APPDATA: fakeHome, LOCALAPPDATA: fakeHome, PATH: "C:\\Windows\\System32" };
      spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(d, "scripts", "quality-gate.ps1"), "-Path", proj], { cwd: d, encoding: "utf8", env });
      const after = readdirSync(d, { withFileTypes: true }).map((e) => e.name).filter((n) => !n.startsWith("."));
      const added = after.filter((n) => !before.has(n));
      rmSync(fakeHome, { recursive: true, force: true });
      return {
        code: added.length ? 1 : 0, expectCode: 0,
        out: added.length
          ? `仓库根多出了东西：${added.join(", ")} —— 大概率又是"假家目录指向不存在的路径"导致 PowerShell 退回 cwd`
          : "仓库根没有被污染（闸门跑完后没有多出目录）",
      };
    },
  },
  {
    name: "项目里躺着 settings.local.json / .env → 必须拦住并要人确认（D4，三项目体检照出的缺口）",
    // **为什么加**：那三个真实项目**都不是 git 仓库** → 密钥检查全走 git 那条路 → 全 SKIP，
    // 而它们根下确实有 settings.local.json 与专门存密钥的目录这类东西，**一个都没被问过**。
    // 这条把"别让这类文件悄悄躺在项目里没人问"变成可判的。
    check: (d) => {
      const ps = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      if (!existsSync(ps)) return { code: 0, expectCode: 0, out: "没有 powershell.exe —— 本项跳过（不算失败）" };
      const proj = join(d, "tests", "fixtures", "secretlike-project");
      mkdirSync(proj, { recursive: true });
      writeFileSync(join(proj, "settings.local.json"), '{"api_key":"REDACTED"}', "utf8");
      const env = { ...process.env, USERPROFILE: join(d, "tests", "fixtures", "fake-home"), APPDATA: join(d, "tests", "fixtures", "fake-home"), LOCALAPPDATA: join(d, "tests", "fixtures", "fake-home"), PATH: "C:\\Windows\\System32" };
      mkdirSync(env.USERPROFILE, { recursive: true });
      const jsonOut = join(proj, "gate.json");
      const r = spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(d, "scripts", "quality-gate.ps1"), "-Path", proj, "-Json", jsonOut], { cwd: d, encoding: "utf8", env });
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      let d4 = null;
      try { d4 = (JSON.parse(readFileSync(jsonOut, "utf8")).results ?? []).find((x) => x.Id === "D4"); } catch { /* 报告没产出 */ }
      rmSync(proj, { recursive: true, force: true });
      if (!d4) return { code: 1, expectCode: 0, out: "D4 没有产出结果行（闸门静默少项？）" };
      const ok = d4.Status === "FAIL" && /settings\.local\.json/.test(String(d4.Detail ?? ""));
      return { code: ok ? 0 : 1, expectCode: 0, out: ok ? `D4 按预期报红：${String(d4.Detail).slice(0, 80)}` : `D4 实际=${d4.Status}：${String(d4.Detail).slice(0, 80)}` };
    },
  },
  {
    name: "redline-check 在空项目上不得说「未发现密钥」（N1：没跑成 ≠ 通过）",
    // **这条守两个真机实测出来的 bug 复发**：
    //   ① 非 git 项目里 ① 硬编码密钥**整项没跑**，顶层却打
    //      `PASS（带警告）—— 无硬失败项`，读起来像"查过一遍、没问题"（N1）；
    //   ② 一个文件都没扫到时，汇总行照样敢写「未发现硬编码密钥」。
    // 判据：空目录（没有任何可扫文件）= 本项等于没查 ⇒ 必须出现「没跑成」，
    //       且**禁止**出现「未发现…密钥」这种没有依据的断言。
    // ⚠️ 删掉 redline-check.ps1 里 `if ($scanned -eq 0) { $notRun.Add(...) }` → 这条必须红。
    //       （已实测：变异成 `if ($false)` 后本条红、另一条绿，说明两条用例各管各的。）
    // 另外同一次运行顺带断言 ② 那一句（复审第 4 条：开了 0 个文件也不该打 ✓）。
    check: (d) => {
      const ps = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      if (!existsSync(ps)) return { code: 0, expectCode: 0, out: "没有 powershell.exe —— 本项跳过（不算失败）" };
      const proj = join(d, "tests", "fixtures", "redline-empty");
      mkdirSync(proj, { recursive: true });
      const fakeHome = join(d, "tests", "fixtures", "fake-home");
      mkdirSync(fakeHome, { recursive: true });
      const env = { ...process.env, USERPROFILE: fakeHome, APPDATA: fakeHome, LOCALAPPDATA: fakeHome, PATH: "C:\\Windows\\System32" };
      const r = spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(d, "scripts", "redline-check.ps1"), "-Project", proj], { cwd: d, encoding: "utf8", env });
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      const problems = [];
      if ((r.status ?? 1) !== 0) problems.push(`退出码 ${r.status}（空目录没有硬失败，应当是 0）`);
      if (!/没跑成/.test(out)) problems.push("没有报「没跑成」—— 一个文件都没扫到，却像是查过了");
      if (/未发现[^\n]*密钥/.test(out)) problems.push("**声称「未发现密钥」** —— 可是一个文件都没扫到，这句话没有依据");
      if (/✓[^\n]*wildcard CORS/.test(out)) problems.push("**② 打了 ✓「未发现 wildcard CORS…」** —— 可是 .py/.js/.ts 一个都没有，这句没有依据");
      return { code: problems.length ? 1 : 0, expectCode: 0, out: problems.length ? problems.join("；") : "空目录：报了「没跑成」，① 和 ② 都没说「未发现」" };
    },
  },
  {
    name: "-Quiet 必须打出结论行（不许 0 字节）——它是脚本自己给的机器用法",
    // **为什么加**：独立复审实测 `-Quiet` 输出 **0 字节**（旧版把结论行也一起吞了），
    // 而 `.PARAMETER Quiet` 承诺"只输出结论行与退出码"、`.EXAMPLE` 里给机器用的正是它。
    // 后果很实：`-Quiet` + 有整项没跑成 ⇒ **看不到那句话、退出码又是 0**，
    // 于是 N1 在这条通道上等于没修（退出码按用户裁定保持 0/1，所以只能靠输出）。
    // 判据：-Quiet 下必须能看到 VERDICT: 那行；有没跑成项时也必须能看到"没跑成"。
    // ⚠️ 把结论行改回 `Say`（受 -Quiet 抑制）→ 这条必须红。
    check: (d) => {
      const ps = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      if (!existsSync(ps)) return { code: 0, expectCode: 0, out: "没有 powershell.exe —— 本项跳过（不算失败）" };
      const proj = join(d, "tests", "fixtures", "redline-quiet-empty");
      mkdirSync(proj, { recursive: true });
      const fakeHome = join(d, "tests", "fixtures", "fake-home");
      mkdirSync(fakeHome, { recursive: true });
      const env = { ...process.env, USERPROFILE: fakeHome, APPDATA: fakeHome, LOCALAPPDATA: fakeHome, PATH: "C:\\Windows\\System32" };
      const r = spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(d, "scripts", "redline-check.ps1"), "-Project", proj, "-Quiet"], { cwd: d, encoding: "utf8", env });
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      const problems = [];
      if (!out.trim()) problems.push("-Quiet 输出 0 字节 —— 机器通道上只剩退出码，跟 help 承诺的不符");
      if (!/VERDICT:/.test(out)) problems.push("-Quiet 下看不到 VERDICT 行");
      if (!/没跑成/.test(out)) problems.push("-Quiet 下看不到「没跑成」（这一档正是最需要被机器读到的那一档）");
      return { code: problems.length ? 1 : 0, expectCode: 0, out: problems.length ? problems.join("；") : `-Quiet 打出了结论行与「没跑成」（${out.trim().length} 字节）` };
    },
  },
  {
    name: "密钥藏在白名单外的扩展名里（.rb/.sql）也必须被 git 路抓到",
    // **为什么加**（独立复审 G2 实测）：旧版按**正向白名单**挑要扫的被跟踪文件
    // （只认 .py/.js/.json/.md…），于是 `settings.rb` / `schema.sql` / `Gemfile` /
    // `Dockerfile` 里的明文密钥**一个都不扫**，而结论行照样打
    // `✓ 未发现硬编码密钥 / 敏感文件泄露` + 光秃秃 `PASS` —— 与 N1 是同一句话的
    // 无依据断言，只是换了条路进来。修法是改成**反向列**（只排除二进制/资源）。
    // 判据：git 仓库里 `settings.rb` 有明文密钥 ⇒ 必须 FAIL（且退出码 1）。
    // ⚠️ 把 $files 的选择改回扩展名白名单 → 这条必须红。
    check: (d) => {
      const ps = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      if (!existsSync(ps)) return { code: 0, expectCode: 0, out: "没有 powershell.exe —— 本项跳过（不算失败）" };
      const proj = join(d, "tests", "fixtures", "redline-wrongext");
      mkdirSync(proj, { recursive: true });
      writeFileSync(join(proj, "app.py"), "print(1)\n", "utf8");
      writeFileSync(join(proj, "settings.rb"), 'api_key = "abcdefghijklmnopqrstuvwxyz123456"\n', "utf8");  // nosemgrep: generic.secrets.security.detected-generic-api-key.detected-generic-api-key — redline-allow: 自检样例里的假密钥（不是真密钥；两个扫描器共用这一个标记）
      const git = (args) => spawnSync("git", args, { cwd: proj, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
      git(["init", "-q"]);
      git(["add", "-A"]);
      git(["commit", "-qm", "i"]);
      if (!existsSync(join(proj, ".git"))) return { code: 0, expectCode: 0, out: "本机没有可用的 git —— 本项跳过（不算失败）" };
      const fakeHome = join(d, "tests", "fixtures", "fake-home");
      mkdirSync(fakeHome, { recursive: true });
      const env = { ...process.env, USERPROFILE: fakeHome, APPDATA: fakeHome, LOCALAPPDATA: fakeHome, PATH: process.env.PATH };
      const r = spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(d, "scripts", "redline-check.ps1"), "-Project", proj], { cwd: d, encoding: "utf8", env });
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      const problems = [];
      if (!/明文密钥/.test(out)) problems.push("没有报出「明文密钥」—— 被跟踪文件的选择又是白名单了？");
      if (!/settings\.rb/.test(out)) problems.push("报的不是 settings.rb（没扫到白名单外的扩展名）");
      if ((r.status ?? 1) !== 1) problems.push(`退出码 ${r.status}（git 项目里被跟踪的明文密钥是硬失败，应当 1）`);
      return { code: problems.length ? 1 : 0, expectCode: 0, out: problems.length ? problems.join("；") : "白名单外的扩展名（.rb）里的密钥被抓到并报 FAIL" };
    },
  },
  {
    name: "行内 redline-allow 只豁免**那一行**，且豁免本身必须被报出来",
    // **为什么加**：反向列把扫描面放大后，**本库自己的仓库立刻被判红** —— 红在
    // `scripts/self-test.mjs` 里那两行"造个假密钥当样例"的用例上。测试夹具放假密钥
    // 是正当做法，而它跟真密钥长得一模一样；没有豁免机制 ⇒ 每个带样例的仓库每次都红
    // ⇒ 正是本脚本自己警告的"狼来了"。
    // 但豁免**必须窄**（只那一行，不是整个文件）+ **必须可见**（报出条数），
    // 否则"把真密钥标上豁免"就成了后门。这两条都在这条用例里断言。
    // ⚠️ 抽掉 `if ($m.Line -match $ALLOW_RE)` 或把豁免做成整文件级 → 这条必须红。
    check: (d) => {
      const ps = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      if (!existsSync(ps)) return { code: 0, expectCode: 0, out: "没有 powershell.exe —— 本项跳过（不算失败）" };
      const proj = join(d, "tests", "fixtures", "redline-allowmark");
      mkdirSync(proj, { recursive: true });
      const KEY = 'api_key = "abcdefghijklmnopqrstuvwxyz123456"';  // nosemgrep: generic.secrets.security.detected-generic-api-key.detected-generic-api-key — redline-allow: 自检样例里的假密钥（不是真密钥；两个扫描器共用这一个标记）
      writeFileSync(join(proj, "fixture_ok.py"), `${KEY}  # redline-allow: 样例假密钥\n`, "utf8");
      // 再放 6 个同样带豁免的文件：共 7 处豁免 > 明细上限 5 ⇒ **截断必须报出来**
      // （第三轮复审 §3.3 实测：本库 10 处豁免只打 5 条，另外 5 条无声消失——
      //  而"静默豁免 = 后门"正是这个机制的设计动机，截断不报等于留了半条后门）。
      for (let i = 2; i <= 7; i++) writeFileSync(join(proj, `fixture_ok${i}.py`), `${KEY}  # redline-allow: 样例假密钥\n`, "utf8");
      const fakeHome = join(d, "tests", "fixtures", "fake-home");
      mkdirSync(fakeHome, { recursive: true });
      const env = { ...process.env, USERPROFILE: fakeHome, APPDATA: fakeHome, LOCALAPPDATA: fakeHome, PATH: process.env.PATH };
      const init = () => {
        spawnSync("git", ["init", "-q"], { cwd: proj, encoding: "utf8", env: { ...env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
        spawnSync("git", ["add", "-A"], { cwd: proj, encoding: "utf8" });
        spawnSync("git", ["commit", "-qm", "i"], { cwd: proj, encoding: "utf8", env: { ...env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
      };
      const problems = [];
      const runRedline = () => spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(d, "scripts", "redline-check.ps1"), "-Project", proj], { cwd: d, encoding: "utf8", env });
      init();
      if (!existsSync(join(proj, ".git"))) return { code: 0, expectCode: 0, out: "本机没有可用的 git —— 本项跳过（不算失败）" };
      const r1 = runRedline();
      const out1 = `${r1.stdout ?? ""}${r1.stderr ?? ""}`;
      if (/明文密钥/.test(out1)) problems.push("带 redline-allow 的那一行**仍然被判红** —— 豁免没生效");
      // ⚠️ 这里**必须**匹配那句计数行本身，不能只匹配 `redline-allow` 这个词——
      // 独立复审实测抓到的恒真断言：脚本在**任何**输出末尾都打一句
      // `· 行内写 \`redline-allow\` 可声明豁免…`，于是 `/redline-allow/.test(out)`
      // 永远为真，"豁免必须被报出来"这条护栏**删掉也照样绿**。
      // （同一份代码里的另一条断言文本也含这个词，等于自己给自己解围。）
      // 教训：断言要钉**那句话**，不能钉一个到处都出现的词。
      if (!/\d+ 处命中带/.test(out1)) problems.push("豁免**没有被报出来**（没看到「N 处命中带 …」那句计数；静默豁免 = 给真密钥留后门）");
      // 非 -Quiet 是**人看的通道**：明细必须列全（7 个文件全都出现）。
      // ⚠️ 我第一次写的是"必须有「另有 N 处」"——**那个断言是错的**：修掉"假指路"之后，
      //    非 -Quiet 不再截断，于是它永远不会有"另有"。断言要跟着**正确行为**走，
      //    而不是跟着我第一次的实现走（这一条是提交时钩子的自检把它拦下来的，留档）。
      if (!/豁免: fixture_ok\.py:1/.test(out1) || !/豁免: fixture_ok7\.py:1/.test(out1)) {
        problems.push("非 -Quiet 下豁免明细没列全（首尾两个文件都要出现）—— 人看的通道不许截断");
      }
      if ((r1.status ?? 1) !== 0) problems.push(`第一次运行退出码 ${r1.status}（豁免后应当 0）`);
      // 同一个文件里再来一行"没标豁免"的 → 必须红
      writeFileSync(join(proj, "fixture_ok.py"), `${KEY}  # redline-allow: 样例假密钥\n${KEY}\n`, "utf8");
      const r2 = runRedline();
      const out2 = `${r2.stdout ?? ""}${r2.stderr ?? ""}`;
      if (!/明文密钥/.test(out2)) problems.push("**同一文件里没标豁免的那一行没被抓到** —— 豁免scope 太宽（整文件级？）");
      if ((r2.status ?? 1) !== 1) problems.push(`第二次运行退出码 ${r2.status}（没标豁免的行应当判红 = 1）`);
      // 复审 S9：`-Quiet` 下豁免也必须可见（旧版实测 14 字节 `VERDICT: PASS`、零痕迹——
      // 而 `-Quiet` 正是 .EXAMPLE 给机器用的那条通道，"静默豁免"在那里是成立的后门）。
      const r3 = spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(d, "scripts", "redline-check.ps1"), "-Project", proj, "-Quiet"], { cwd: d, encoding: "utf8", env });
      const out3 = `${r3.stdout ?? ""}${r3.stderr ?? ""}`;
      if (!/\d+ 处命中带/.test(out3)) problems.push("-Quiet 下看不到豁免计数（那一档在机器通道上等于不存在）");
      // -Quiet 是**机器通道**，明细截断到 5 条——那就必须把"还有几处没列"说出来
      // （静默截断 = 留了半条后门；而输出里指"完整清单见非 -Quiet"曾经是句假话，已修）。
      if (!/另有 \d+ 处豁免未列出/.test(out3)) problems.push("-Quiet 下豁免明细被静默截断（没有「另有 N 处未列出」）");
      return { code: problems.length ? 1 : 0, expectCode: 0, raw: `【第一次】\n${out1}\n【第二次（同一文件里加一行没标豁免的）】\n${out2}\n【-Quiet】\n${out3}`, out: problems.length ? problems.join("；") : "豁免只作用于标记行：标了放行、没标照红，且豁免条数在普通与 -Quiet 下都被报出" };
    },
  },
  {
    name: "非 git 项目里的明文密钥必须被回退扫描抓到（N1 的另一半：诚实还得有用）",
    // **为什么加**：只把「① 未跑」写清楚是**诚实但没用**——实测过：非 git 目录里
    // 放一行 `api_key = "..."`，工具一声不吭。这一项跟有没有 git 无关，该扫就得扫。
    // 判据：非 git 目录 + 明文密钥 ⇒ 必须报「疑似明文密钥」；
    //       且**只记警告、不改退出码**（没有 .gitignore 依据，误报不能让闸门变成狼来了）。
    // ⚠️ 抽掉 redline-check.ps1 的非 git 回退扫描 → 这条必须红。
    check: (d) => {
      const ps = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      if (!existsSync(ps)) return { code: 0, expectCode: 0, out: "没有 powershell.exe —— 本项跳过（不算失败）" };
      const proj = join(d, "tests", "fixtures", "redline-nongit-key");
      mkdirSync(proj, { recursive: true });
      writeFileSync(join(proj, "leak.py"), 'api_key = "abcdefghijklmnopqrstuvwxyz123456"\n', "utf8");  // nosemgrep: generic.secrets.security.detected-generic-api-key.detected-generic-api-key — redline-allow: 自检样例里的假密钥（不是真密钥；两个扫描器共用这一个标记）
      const fakeHome = join(d, "tests", "fixtures", "fake-home");
      mkdirSync(fakeHome, { recursive: true });
      const env = { ...process.env, USERPROFILE: fakeHome, APPDATA: fakeHome, LOCALAPPDATA: fakeHome, PATH: "C:\\Windows\\System32" };
      const r = spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(d, "scripts", "redline-check.ps1"), "-Project", proj], { cwd: d, encoding: "utf8", env });
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      const problems = [];
      if (existsSync(join(proj, ".git"))) problems.push("样例居然带了 .git —— 用例前提坏了");
      if (!/疑似明文密钥/.test(out)) problems.push("没有报出「疑似明文密钥」—— 回退扫描没跑，或者扫了但没看这个文件");
      if (!/回退扫描/.test(out)) problems.push("没提「回退扫描」—— 读者会把非 git 的结论当成 git 项目的结论");
      if ((r.status ?? 1) !== 0) problems.push(`退出码 ${r.status}（回退扫描的命中只记警告，不改退出码）`);
      // 复审 S3（顺手断言，不另开用例）：被跳过的**每一类**都要在范围注里露面。
      // 这里放一个 node_modules 里的密钥——它被跳过是对的，但不能"跳了不说"。
      mkdirSync(join(proj, "node_modules", "pkg"), { recursive: true });
      writeFileSync(join(proj, "node_modules", "pkg", "x.js"), 'api_key = "abcdefghijklmnopqrstuvwxyz123456"\n', "utf8");  // nosemgrep: generic.secrets.security.detected-generic-api-key.detected-generic-api-key — redline-allow: 自检样例里的假密钥（不是真密钥；两个扫描器共用这一个标记）
      const fakeHome2 = join(d, "tests", "fixtures", "fake-home");
      mkdirSync(fakeHome2, { recursive: true });
      const env2 = { ...process.env, USERPROFILE: fakeHome2, APPDATA: fakeHome2, LOCALAPPDATA: fakeHome2, PATH: "C:\\Windows\\System32" };
      const r2 = spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(d, "scripts", "redline-check.ps1"), "-Project", proj], { cwd: d, encoding: "utf8", env: env2 });
      const out2 = `${r2.stdout ?? ""}${r2.stderr ?? ""}`;
      if (!/依赖\/产物/.test(out2)) problems.push("范围注没提「在依赖/产物目录里未扫」—— 跳过的文件类别被静默吞了");
      return { code: problems.length ? 1 : 0, expectCode: 0, out: problems.length ? problems.join("；") : "非 git 项目：明文密钥被回退扫描抓到并记为警告；跳过的类别也报了" };
    },
  },
  {
    name: "① 不许把「被忽略的 .env 没扫」说成「未发现密钥」（复审 S1）",
    // **为什么加**：复审构造出一个 `.gitignore` 里写着 `.env`、`.env` 里是真密钥
    // （`sk-proj-…` + `AWS_SECRET_ACCESS_KEY=…`）的项目 —— 那**正是本库自己推荐的状态**
    // （把 .env 加进 .gitignore）。旧版输出 `✓ 未发现硬编码密钥 / 敏感文件泄露` +
    // 光秃秃 `VERDICT: PASS` + exit 0，**与 N1 一字不差**：一个文件都没看，却报"未发现"。
    // 更刺眼的是非 git 项目反而能抓到（回退扫描会扫到那个 .env），git 项目抓不到。
    // 判据：① 的汇总行必须**收窄到"被跟踪的"**，并且把"未跟踪/被忽略没扫"标出来。
    // ⚠️ 把汇总行改回全称的 `✓ 未发现硬编码密钥…`（去掉收窄/范围注）→ 这条必须红。
    check: (d) => {
      const ps = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      if (!existsSync(ps)) return { code: 0, expectCode: 0, out: "没有 powershell.exe —— 本项跳过（不算失败）" };
      const proj = join(d, "tests", "fixtures", "redline-gitignored-env");
      mkdirSync(proj, { recursive: true });
      writeFileSync(join(proj, ".gitignore"), ".env\n", "utf8");
      writeFileSync(join(proj, "app.py"), "print(1)\n", "utf8");
      writeFileSync(join(proj, ".env"), "OPENAI_API_KEY=sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789\n", "utf8"); // redline-allow: 自检样例里的假密钥
      const git = (args) => spawnSync("git", args, { cwd: proj, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
      git(["init", "-q"]); git(["add", "-A"]); git(["commit", "-qm", "i"]);
      if (!existsSync(join(proj, ".git"))) return { code: 0, expectCode: 0, out: "本机没有可用的 git —— 本项跳过（不算失败）" };
      const fakeHome = join(d, "tests", "fixtures", "fake-home");
      mkdirSync(fakeHome, { recursive: true });
      const env = { ...process.env, USERPROFILE: fakeHome, APPDATA: fakeHome, LOCALAPPDATA: fakeHome, PATH: process.env.PATH };
      const r = spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(d, "scripts", "redline-check.ps1"), "-Project", proj], { cwd: d, encoding: "utf8", env });
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      const problems = [];
      if (/✓ 未发现硬编码密钥/.test(out)) problems.push("**又打了全称的「✓ 未发现硬编码密钥」** —— 而 .env 从来没扫");
      if (!/被跟踪的 \d+ 个文件里未发现/.test(out)) problems.push("汇总行没收窄到「被跟踪的 N 个文件里」—— 读者会以为整个目录都查过了");
      // 用户裁定（2026-09-13）之后：未跟踪/被忽略的文件**也要扫**，命中记警告、不改退出码。
      // 所以这里断言的是"抓到了"，而不是"报了没扫"。
      // ⚠️ 注意：脚本输出里是「文件里 检出」（"文件里" 与 "检出" 之间有空格，因为消息模板
      //    是 `"$where 检出 …"`）。我第一次把正则写成 `/里检出/` → 断言假红，
      //    而用例的失败信息又写成"没抓到"，看起来像产品 bug。**断言要照抄真实输出的空格。**
      if (!/未被跟踪\/被忽略的文件里\s*检出/.test(out)) problems.push("**被忽略的 .env 没被抓到** —— 未跟踪文件没有被纳入扫描");
      if (!/疑似明文密钥/.test(out)) problems.push("没报出命中明细");
      // 第三轮复审 M5 指出的盲区：裁定（丙）的全部实现**只靠上一条断言守着**，
      // 而那一条只证明"抓到了"，不证明"确实扫了未跟踪的文件"。补一条更贴近实现的断言。
      if (!/另外扫了 \d+ 个未跟踪\/被忽略的文件/.test(out)) problems.push("没有报出「另外扫了 N 个未跟踪/被忽略的文件」—— 未跟踪扫描可能压根没跑");
      if ((r.status ?? 1) !== 0) problems.push(`退出码 ${r.status}（未跟踪文件的命中只记警告，不改退出码）`);
      return { code: problems.length ? 1 : 0, expectCode: 0, out: problems.length ? problems.join("；") : "汇总行收窄到被跟踪文件，且被忽略的 .env 里的密钥被扫到并记为警告" };
    },
  },
  {
    name: "当代密钥格式（sk-proj-/AIza/hf_/glpat-/无引号 .env 赋值）必须被抓到（复审 S8）",
    // **为什么加**：复审逐行实测旧正则，下面这些**全部不匹配**：
    //   `sk-proj-…` / `sk-svcacct-…`（2024 后 OpenAI 正式格式）· `AIza…`（Google）·
    //   `hf_…`（HuggingFace）· `glpat-…`（GitLab）· **不带引号**的 `OPENAI_API_KEY=…` ·
    //   `AWS_SECRET_ACCESS_KEY=…`（关键词与 `=` 之间隔着 `_ACCESS_KEY`）。
    // 复审原话：**「未发现硬编码密钥」最常见的说谎方式，就是密钥恰好在这些形态里。**
    // 判据：这些形态放在**被跟踪**文件里 ⇒ 必须判红（退出码 1）。
    // ⚠️ 把 $pat 改回旧的那一条正则 → 这条必须红。
    check: (d) => {
      const ps = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      if (!existsSync(ps)) return { code: 0, expectCode: 0, out: "没有 powershell.exe —— 本项跳过（不算失败）" };
      const proj = join(d, "tests", "fixtures", "redline-modernkeys");
      mkdirSync(proj, { recursive: true });
      writeFileSync(join(proj, "conf.txt"), [
        "OPENAI_API_KEY=sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", // redline-allow: 自检样例里的假密钥
        "GOOGLE_KEY=AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r", // redline-allow: 自检样例里的假密钥
        "HF_TOKEN=hf_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", // redline-allow: 自检样例里的假密钥
        "GITLAB=glpat-AbCdEfGhIjKlMnOpQrSt", // redline-allow: 自检样例里的假密钥
        "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI0K7MDENG0bPxRfiCYEXAMPLEKEY", // redline-allow: 自检样例里的假密钥
      ].join("\n") + "\n", "utf8");
      const git = (args) => spawnSync("git", args, { cwd: proj, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
      git(["init", "-q"]); git(["add", "-A"]); git(["commit", "-qm", "i"]);
      if (!existsSync(join(proj, ".git"))) return { code: 0, expectCode: 0, out: "本机没有可用的 git —— 本项跳过（不算失败）" };
      const fakeHome = join(d, "tests", "fixtures", "fake-home");
      mkdirSync(fakeHome, { recursive: true });
      const env = { ...process.env, USERPROFILE: fakeHome, APPDATA: fakeHome, LOCALAPPDATA: fakeHome, PATH: process.env.PATH };
      const r = spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(d, "scripts", "redline-check.ps1"), "-Project", proj], { cwd: d, encoding: "utf8", env });
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      const problems = [];
      const m = out.match(/明文密钥 (\d+) 处/);
      if (!m) problems.push("一处都没抓到 —— 正则又只认旧式 `sk-` 了？");
      else if (Number(m[1]) < 5) problems.push(`只抓到 ${m[1]} 处，期望 5 处（每种形态一处）`);
      if ((r.status ?? 1) !== 1) problems.push(`退出码 ${r.status}（被跟踪的明文密钥是硬失败，应当 1）`);
      return { code: problems.length ? 1 : 0, expectCode: 0, out: problems.length ? problems.join("；") : "5 种当代密钥形态全部被抓到" };
    },
  },
  {
    name: "②③ 没扫到文件时也必须进「没跑成」（N1 换了个位置，复审第三轮 3.1）",
    // **为什么加**：第二轮我把 ② 的"开了 0 个文件却打 ✓"改成了一句诚实的话，**但没登记
    // `$notRun`** —— 于是顶层照打光秃秃 `VERDICT: PASS`，`-Quiet` 下只剩那一行。
    // 那**就是 N1 本身**：判据只挂在"① 有没有扫到文件"上，②③ 的同类情况没人管。
    // 复审的构造：git 仓库里 `git ls-files` 只有 README.md（没有任何 .py/.js），
    // ③④ 用 `state.ps1 redline` 真确认过 ⇒ 旧版 `VERDICT: PASS`（无警告、无没跑成）。
    // 判据：这种项目必须打出「没跑成 N」且 N ≥ 2，**并且 `-Quiet` 下也看得到**。
    // ⚠️ 把 ② 或 ③ 里的 `$notRun.Add(...)` 删掉 → 这条必须红。
    check: (d) => {
      const ps = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      if (!existsSync(ps)) return { code: 0, expectCode: 0, out: "没有 powershell.exe —— 本项跳过（不算失败）" };
      const proj = join(d, "tests", "fixtures", "redline-nosrc");
      mkdirSync(proj, { recursive: true });
      writeFileSync(join(proj, "README.md"), "# 没有任何 .py/.js 源文件的项目\n", "utf8");
      const git = (args) => spawnSync("git", args, { cwd: proj, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
      git(["init", "-q"]); git(["add", "-A"]); git(["commit", "-qm", "i"]);
      if (!existsSync(join(proj, ".git"))) return { code: 0, expectCode: 0, out: "本机没有可用的 git —— 本项跳过（不算失败）" };
      const fakeHome = join(d, "tests", "fixtures", "fake-home");
      mkdirSync(fakeHome, { recursive: true });
      const env = { ...process.env, USERPROFILE: fakeHome, APPDATA: fakeHome, LOCALAPPDATA: fakeHome, PATH: process.env.PATH };
      const problems = [];
      const r = spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(d, "scripts", "redline-check.ps1"), "-Project", proj], { cwd: d, encoding: "utf8", env });
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      const m = out.match(/没跑成 \((\d+)\)/);
      if (!m) problems.push("没有报「没跑成」—— ②③ 都在说没有依据，顶层却像查过了");
      else if (Number(m[1]) < 2) problems.push(`只登记了 ${m[1]} 项没跑成，期望 ≥2（② 与 ③ 各一项）`);
      // ⚠️ **必须断言结论行本身**（第四轮复审 F1 的变异 m6 实测）：只断言"报了 N 项"是不够的 ——
      //    "没跑成"段的打印与结论行的**降档**是两段独立代码，把降档那一支整段删掉，
      //    当时的全套用例**全绿**（那一轮是 53 条），而真实输出退回基线的 `VERDICT: PASS（带警告）`。
    //    （复审后来指出：让降档失效的变异实际会红 **5 条**，"只有那一条红"是我写错了；
    //      但**直接**把降档那一支写成 `if ($false)` 时，裸 PASS 也满足旧断言 ⇒ 一条都不红。
    //      所以这条用例的判据必须钉在**结论行本身**上，这就是下面那句的由来。）
      //    那正是本轮主题（"整项没跑，顶层却说查过了"）在护栏上的复发。
      if (!/VERDICT: PASS（有 \d+ 项没跑成）/.test(out)) problems.push("结论行**没有降档** —— 顶层还在说「查过了」（没跑成与降档是两段代码，必须分开断言）");
      const r2 = spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(d, "scripts", "redline-check.ps1"), "-Project", proj, "-Quiet"], { cwd: d, encoding: "utf8", env });
      const out2 = `${r2.stdout ?? ""}${r2.stderr ?? ""}`;
      if (!/没跑成/.test(out2)) problems.push("-Quiet 下看不到「没跑成」—— 机器通道上又变成一句光秃秃的 VERDICT 了");
      if (!/VERDICT: PASS（有 \d+ 项没跑成）/.test(out2)) problems.push("-Quiet 下结论行没有降档（机器通道上最要命）");
      return { code: problems.length ? 1 : 0, expectCode: 0, out: problems.length ? problems.join("；") : `②③ 的空扫描都进了「没跑成」（${m ? m[1] : "?"} 项），-Quiet 下也可见` };
    },
  },
  {
    name: "被跟踪的敏感文件（.env/*.pem/id_rsa）必须被单独点出来（复审第三轮 M8 盲区）",
    // **为什么加**：复审做了个变异——**把"被跟踪的敏感文件"整块检测删掉，50/50 照样全绿**。
    // 该检查是 ① 里唯一会因"文件名叫 .env 但内容看不出密钥"而判红的东西
    // （例如 `.env` 里全是短值、或 base64 blob），之前**零护栏**。
    // 判据：被跟踪的 `.env` ⇒ 必须出现「被跟踪的敏感文件」这句 + exit 1。
    check: (d) => {
      const ps = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      if (!existsSync(ps)) return { code: 0, expectCode: 0, out: "没有 powershell.exe —— 本项跳过（不算失败）" };
      const proj = join(d, "tests", "fixtures", "redline-tracked-env");
      mkdirSync(proj, { recursive: true });
      writeFileSync(join(proj, "app.py"), "print(1)\n", "utf8");
      writeFileSync(join(proj, ".env"), "MODE=production\n", "utf8");   // 内容**看不出**密钥，靠文件名拦
      const git = (args) => spawnSync("git", args, { cwd: proj, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
      git(["init", "-q"]); git(["add", "-A"]); git(["commit", "-qm", "i"]);
      if (!existsSync(join(proj, ".git"))) return { code: 0, expectCode: 0, out: "本机没有可用的 git —— 本项跳过（不算失败）" };
      const fakeHome = join(d, "tests", "fixtures", "fake-home");
      mkdirSync(fakeHome, { recursive: true });
      const env = { ...process.env, USERPROFILE: fakeHome, APPDATA: fakeHome, LOCALAPPDATA: fakeHome, PATH: process.env.PATH };
      const r = spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(d, "scripts", "redline-check.ps1"), "-Project", proj], { cwd: d, encoding: "utf8", env });
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      const problems = [];
      if (!/被跟踪的敏感文件/.test(out)) problems.push("没有报出「被跟踪的敏感文件」—— 这块检测被删掉也不会有人发现（复审 M8）");
      if (!/\.env/.test(out)) problems.push("报的不是 .env");
      if ((r.status ?? 1) !== 1) problems.push(`退出码 ${r.status}（被跟踪的敏感文件是硬失败，应当 1）`);
      return { code: problems.length ? 1 : 0, expectCode: 0, out: problems.length ? problems.join("；") : "被跟踪的 .env 被单独点出来并判红" };
    },
  },
  {
    name: "路径大小写不一致时不许自相矛盾（复审第三轮 §3.5）",
    // **为什么加**：复审构造出 index 里是 `LeakDir/leak.py`、磁盘上是 `leakdir\leak.py`
    // （NTFS 大小写不敏感、`git status` 干净）的项目，实测旧版把**同一个文件**同时算进
    // "硬失败"和"未跟踪警告"：汇总行说"被跟踪的 1 个文件里未发现"而该文件刚被判红，
    // 还谎称"另外扫了 1 个未跟踪/被忽略的文件"（那个文件根本不存在）。
    // 根因是 `HashSet[string]` 默认序数比较 = 大小写敏感；Windows 上路径不区分大小写，
    // 判据也必须不区分。修法是 `StringComparer::OrdinalIgnoreCase`。
    // 判据：这种项目只能判红**一次**，且**不许**出现"未跟踪/被忽略"那套话。
    // （我做的变异 M15 实测：把 HashSet 改回大小写敏感 → 这条必须红。）
    check: (d) => {
      const ps = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      if (!existsSync(ps)) return { code: 0, expectCode: 0, out: "没有 powershell.exe —— 本项跳过（不算失败）" };
      const proj = join(d, "tests", "fixtures", "redline-casepath");
      mkdirSync(join(proj, "LeakDir"), { recursive: true });
      writeFileSync(join(proj, "LeakDir", "leak.py"), 'api_key = "abcdefghijklmnopqrstuvwxyz123456"\n', "utf8");  // nosemgrep: generic.secrets.security.detected-generic-api-key.detected-generic-api-key — redline-allow: 自检样例里的假密钥（不是真密钥；两个扫描器共用这一个标记）
      const git = (args) => spawnSync("git", args, { cwd: proj, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
      git(["init", "-q"]); git(["add", "-A"]); git(["commit", "-qm", "i"]);
      if (!existsSync(join(proj, ".git"))) return { code: 0, expectCode: 0, out: "本机没有可用的 git —— 本项跳过（不算失败）" };
      // 只改大小写的改名：Windows 上要分两步走
      try { renameSync(join(proj, "LeakDir"), join(proj, "tmpcase")); renameSync(join(proj, "tmpcase"), join(proj, "leakdir")); }
      catch (e) { return { code: 0, expectCode: 0, out: `本文件系统不支持只改大小写的改名 —— 本项跳过（不算失败）：${e}` }; }
      const fakeHome = join(d, "tests", "fixtures", "fake-home");
      mkdirSync(fakeHome, { recursive: true });
      const env = { ...process.env, USERPROFILE: fakeHome, APPDATA: fakeHome, LOCALAPPDATA: fakeHome, PATH: process.env.PATH };
      const r = spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(d, "scripts", "redline-check.ps1"), "-Project", proj], { cwd: d, encoding: "utf8", env });
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      const problems = [];
      if ((r.status ?? 1) !== 1) problems.push(`退出码 ${r.status}（被跟踪文件里有明文密钥，应当 1）`);
      if (/未被跟踪\/被忽略的文件里\s*检出/.test(out)) problems.push("**同一个文件被当成「未跟踪」又报了一遍** —— 路径大小写没对齐（HashSet 大小写敏感）");
      if (/另外扫了 \d+ 个未跟踪/.test(out)) problems.push("谎称扫到了不存在的未跟踪文件（同一个文件被算了两遍）");
      return { code: problems.length ? 1 : 0, expectCode: 0, raw: out, out: problems.length ? problems.join("；") : "大小写不一致时只判红一次，没有重复计数与自相矛盾" };
    },
  },
  {
    name: "速查卡漂移检查读的是**它自己所在的仓库**（不许写死本机路径）",
    // **为什么加**：CI 首次运行（2026-09-13）红在这里，报的是「速查卡.md 不存在」——
    // 而那个文件在仓库里、也被 git 跟踪。根因是 `extract-cheatsheets.mjs` 里写着
    // 一个**写死的本机绝对路径**（形如 `D:\…\ai-eng-system`，脚本压根没用自己所在的位置）：
    // 本机跑永远绿（那目录真在），CI 里 checkout 在 `D:\\a\\ai-eng-system\\…` ⇒
    // **它读的是"我的机器"，不是"仓库"**。
    // ⚠️ 它**骗过了 verify-clean-clone.mjs** —— 那个脚本专门在干净克隆里跑 verify-all，
    //    本该抓住这类"脚本偷偷读本机"的问题；但判据指向克隆之外时，克隆再干净也证明不了什么。
    // 判据：把**副本里**的速查卡删掉 ⇒ 必须 FAIL，且报错要点名"它找的是副本里那个路径"。
    // ⚠️ 把 REF 改回写死的本机路径 ⇒ 这条必须红（本机也一样红：副本删了、本机那份还在 ⇒ 假绿）。
    check: (d) => {
      const sheet = join(d, "速查卡.md");
      if (!existsSync(sheet)) return { code: 0, expectCode: 0, out: "副本里本来就没有速查卡.md —— 本项在本机没有判据，跳过" };
      const saved = readFileSync(sheet);
      rmSync(sheet);
      const r = run(d, "scripts/extract-cheatsheets.mjs", ["--check"]);
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      writeFileSync(sheet, saved);
      const problems = [];
      if ((r.status ?? 1) !== 1) problems.push(`退出码 ${r.status}（副本里的速查卡被删了，应当 1 —— 假绿说明它读的不是这个仓库）`);
      if (!out.includes(sheet)) problems.push("报错没点名它找的是哪个文件（要能看出它读的是副本里的那份）");
      return { code: problems.length ? 1 : 0, expectCode: 0, raw: out, out: problems.length ? problems.join("；") : "漂移检查读的是它自己所在的仓库（把副本里的速查卡删掉就红）" };
    },
  },
  {
    name: "路径写成 8.3 短名时也不许自相矛盾（CI 首跑红的根因）",
    // **为什么加**：GitHub Windows runner 的 `TEMP` 形如 `C:\Users\RUNNER~1\…`，
    // 而自检夹具建在 `mkdtempSync(os.tmpdir())` 下面 ⇒ 传给 redline 的 `-Project` 是**短名**。
    // `Resolve-Path` 会**原样保留**短名，`Get-Item`/`Get-ChildItem` 给的是**长名** ⇒
    // 旧代码用 `Join-Path $root …` 拼出来的 $trackedFull 与磁盘枚举**指向同一个文件却字符串不等**
    // （差的是 `RUNNER~1` vs `runneradmin`，大小写不敏感也救不了）⇒ 同一个文件被判红一次、
    // 又被当"未跟踪"扫一遍。CI 上这条一次红**两条断言**，本机 57/57 全绿 —— 典型"只在 CI 现形"。
    // ⚠️ 本机 D: 卷没开 8.3 短名，测不出来；临时目录在 C:（系统卷，默认开）时能测。
    //    两条路都走不通时**诚实跳过**，不假装通过。
    // 判据：只判红一次（退出码 1），且不许出现"未被跟踪/被忽略…检出"与"另外扫了 N 个未跟踪"。
    // ⚠️ 变异口径（变异 M18 实测，2026-09-13）：**必须两处一起撤回**才红 ——
    //    redline 的两处修复（$root 取规范路径 / 逐个登记规范路径）**互为冗余**，
    //    只撤一处时这条用例**仍然是绿的**（57+2 全绿）。我第一次只撤了一处，
    //    差点得出"这条护栏没用"的错误结论。实测记录：两处都撤回 → 58/59，
    //    唯一红的就是这条，报出的短名是 `%TEMP%\SE1504~1\tests\fixtures\REDLIN~1`
    //    —— 与 CI 上 `RUNNER~1` 那种形态同源。
    check: (d) => {
      const ps = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      if (!existsSync(ps)) return { code: 0, expectCode: 0, out: "没有 powershell.exe —— 本项跳过（不算失败）" };
      const proj = join(d, "tests", "fixtures", "redline-shortpath");
      mkdirSync(proj, { recursive: true });
      writeFileSync(join(proj, "leak.py"), 'api_key = "abcdefghijklmnopqrstuvwxyz123456"\n', "utf8");  // nosemgrep: generic.secrets.security.detected-generic-api-key.detected-generic-api-key — redline-allow: 自检样例里的假密钥（不是真密钥；两个扫描器共用这一个标记）
      const git = (args) => spawnSync("git", args, { cwd: proj, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
      git(["init", "-q"]); git(["add", "-A"]); git(["commit", "-qm", "i"]);
      if (!existsSync(join(proj, ".git"))) return { code: 0, expectCode: 0, out: "本机没有可用的 git —— 本项跳过（不算失败）" };
      // 取 8.3 短名。⚠️ **不能**用 `spawnSync("cmd.exe", ["/c", 'for %I in ("…") do …'])`：
      //    经 Node 组命令行后引号会被吃掉（实测拿到 `D:\"C:\…\"` 这种垃圾），必须借 PowerShell 转一层。
      const shortRaw = (spawnSync(ps, ["-NoProfile", "-Command", `cmd.exe /c "for %I in (""${proj}"") do @echo %~sI"`], { encoding: "utf8" }).stdout ?? "").trim();
      let probe = null; let why = "";
      if (shortRaw && shortRaw !== proj) { probe = shortRaw; why = `-Project 用 8.3 短名（${shortRaw}）`; }
      else {
        let canon = proj;
        try { canon = realpathSync.native(proj); } catch { /* 取不到就按原样比 */ }
        if (canon !== proj) { probe = proj; why = "临时目录本身就在短名路径下（CI 就是这种）"; }
      }
      if (!probe) return { code: 0, expectCode: 0, out: "本机的临时目录既拿不到 8.3 短名、本身也不是别名形态 —— 这项在本机没有判据，跳过（CI 上有）" };
      const fakeHome = join(d, "tests", "fixtures", "fake-home");
      mkdirSync(fakeHome, { recursive: true });
      const env = { ...process.env, USERPROFILE: fakeHome, APPDATA: fakeHome, LOCALAPPDATA: fakeHome, PATH: process.env.PATH };
      const r = spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(d, "scripts", "redline-check.ps1"), "-Project", probe], { cwd: d, encoding: "utf8", env });
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      const problems = [];
      if ((r.status ?? 1) !== 1) problems.push(`退出码 ${r.status}（被跟踪文件里有明文密钥，应当 1）`);
      if (/未被跟踪\/被忽略的文件里\s*检出/.test(out)) problems.push(`同一个文件既判红又被当「未跟踪」再扫一遍 —— 短名/长名（或大小写）没对齐：${why}`);
      if (/另外扫了 \d+ 个未跟踪/.test(out)) problems.push("谎称另外扫了未跟踪文件 —— 那个文件就是刚判红的被跟踪文件");
      return { code: problems.length ? 1 : 0, expectCode: 0, raw: out, out: problems.length ? problems.join("；") : `短名写法下只判红一次，没有重复计数（${why}）` };
    },
  },
  {
    name: "中文名文件与中文目录下的文件，quality-gate 的 A1/A2 都必须看得见",
    // **为什么加**（2026-09-13 实测漏网）：A1/A2 原先各写一份**裸 `git ls-files`**，
    // 而它默认 `core.quotePath=true` ⇒ 非 ASCII 路径被输出成**带引号的八进制转义**
    // （`"docs/\344\270\255\346\226\207/.env"`）⇒ A1 的文件名正则匹配不上（末尾多个引号）、
    // A2 的扩展名过滤也落空 ⇒ **中文名文件、中文目录下的文件被静默跳过**。
    // 实测（两份内容逐字节相同，只有名字一个中文一个 ASCII）：
    //   · 两个 `.env`（目录名不同，都被跟踪）⇒ A1 只报 `1 file(s): …asciidir/.env`
    //   · 两个 `.py`（文件名不同）⇒ A2 只报 1 hit；**只留中文名那个 ⇒ A2 打 `PASS`**（假绿）
    // 本库自己有一堆中文名文档 ⇒ 这在本库上是"常态漏扫"，不是边角。
    // 判据：这种仓库里 A1 必须点名**两个** `.env`（`2 file(s)`），A2 必须报 **2 hit(s)**。
    // ⚠️ 变异：把 `Get-GitTrackedFiles` 的 `-c core.quotePath=false` 去掉（或把 A1/A2 改回裸
    //    `git ls-files`）⇒ 这条必须红（变异 M19 实测）。
    check: (d) => {
      const ps = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      if (!existsSync(ps)) return { code: 0, expectCode: 0, out: "没有 powershell.exe —— 本项跳过（不算失败）" };
      const proj = join(d, "tests", "fixtures", "gate-cjkpaths");
      mkdirSync(join(proj, "asciidir"), { recursive: true });
      mkdirSync(join(proj, "中文目录"), { recursive: true });
      writeFileSync(join(proj, "asciidir", ".env"), "MODE=production\n", "utf8");
      writeFileSync(join(proj, "中文目录", ".env"), "MODE=production\n", "utf8");
      const KEY = 'api_key = "abcdefghijklmnopqrstuvwxyz123456"\n';  // nosemgrep: generic.secrets.security.detected-generic-api-key.detected-generic-api-key — redline-allow: 自检样例里的假密钥（不是真密钥；两个扫描器共用这一个标记）
      writeFileSync(join(proj, "ascii_cfg.py"), KEY, "utf8");
      writeFileSync(join(proj, "中文配置.py"), KEY, "utf8");
      const git = (args) => spawnSync("git", args, { cwd: proj, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
      // `-f`：别让任何 `.gitignore`（本机的 core.excludesFile 也算）把 `.env` 挡在跟踪之外
      git(["init", "-q"]); git(["add", "-A", "-f"]); git(["commit", "-qm", "i"]);
      if (!existsSync(join(proj, ".git"))) return { code: 0, expectCode: 0, out: "本机没有可用的 git —— 本项跳过（不算失败）" };
      const json = join(d, "tests", "fixtures", "gate-cjk-report.json");
      const fakeHome = join(d, "tests", "fixtures", "fake-home");
      mkdirSync(fakeHome, { recursive: true });
      const env = { ...process.env, USERPROFILE: fakeHome, APPDATA: fakeHome, LOCALAPPDATA: fakeHome, PATH: process.env.PATH };
      const r = spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(d, "scripts", "quality-gate.ps1"), "-Path", proj, "-Json", json], { cwd: d, encoding: "utf8", env });
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      const problems = [];
      let rep = null;
      try { rep = JSON.parse(readFileSync(json, "utf8")); }
      catch (e) { problems.push(`读不到闸门的 JSON 报告：${e.code ?? e.message}`); }
      if (rep) {
        // ⚠️ 字段名是 `results` + `Id/Status/Detail`（大写开头）—— 报告结构别凭记忆写
        const byId = (id) => (rep.results ?? []).find((x) => x.Id === id);
        const a1 = byId("A1"); const a2 = byId("A2");
        if (!a1 || !a2) problems.push("报告里没有 A1 或 A2 这两项（闸门少项了）");
        else {
          if (a1.Status !== "FAIL") problems.push(`A1 状态是 ${a1.Status}（两个敏感文件名都被跟踪，应当 FAIL）`);
          if (!/2 file\(s\)/.test(a1.Detail ?? "")) problems.push(`A1 的明细是「${a1.Detail}」—— 中文目录下那个 .env 没被看见（期望 2 file(s)）`);
          if (a2.Status !== "FAIL") problems.push(`A2 状态是 ${a2.Status}（两处明文密钥，应当 FAIL）`);
          if (!/^2 hit\(s\)/.test(a2.Detail ?? "")) problems.push(`A2 的明细是「${a2.Detail}」—— 中文名那个 .py 没被扫（期望 2 hit(s)）`);
        }
      }
      return { code: problems.length ? 1 : 0, expectCode: 0, raw: out, out: problems.length ? problems.join("；") : "A1 认出两个 .env、A2 报出两处密钥（中文名与中文目录都没漏）" };
    },
  },
  {
    name: "被跟踪文件里带中文名的密钥也要扫到（复审第四轮 F2）",
    // **为什么加**：`git ls-files` 默认 `core.quotePath=true`，非 ASCII 路径被输出成
    // **带引号的八进制转义**（`"docs/00-\351\241\271..."`），`Test-Path` 直接抛
    // 「Illegal characters in path」⇒ 那些文件被当成"工作区已删"而**跳过不扫**，
    // 范围注还打出一句假话。实测 `项目 A` 有 14 条这样的路径。
    // 修法两件一起做：`-c core.quotePath=false` + 临时把 `[Console]::OutputEncoding` 设成 UTF-8
    // （只修一个仍会误判：只修转义、不修编码 = 换个姿势乱码）。
    // 判据：`docs/中文说明.md`（被跟踪）里放明文密钥 ⇒ 必须判红，且**不许**说"定位不到"。
    // ⚠️ 把 git 调用改回 `git ls-files`（去掉 quotePath）→ 这条必须红（我做的变异 M17a 实测）。
    // ⚠️ **这条护栏只覆盖修复的一半**：另一半（当时的"临时把 `[Console]::OutputEncoding` 设成 UTF-8"）
    //    在**本机**测不出来（本机控制台已是 UTF-8；变异 M17b 本机 54/54 全绿）。
    //    但第五轮复审用 `SetConsoleOutputCP(936)` 造出真 936 控制台后**能测出来且会红** ——
    //    所以"没有护栏"是过强的说法。现在那一半已被换掉（改成 cmd 重定向 + 显式 UTF-8 解码，
    //    见下面那条 `代码页 936` 用例），并由那条用例守住。
    check: (d) => {
      const ps = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      if (!existsSync(ps)) return { code: 0, expectCode: 0, out: "没有 powershell.exe —— 本项跳过（不算失败）" };
      const proj = join(d, "tests", "fixtures", "redline-cjkpath");
      mkdirSync(join(proj, "docs"), { recursive: true });
      writeFileSync(join(proj, "docs", "中文说明.md"), 'api_key = "abcdefghijklmnopqrstuvwxyz123456"\n', "utf8");  // nosemgrep: generic.secrets.security.detected-generic-api-key.detected-generic-api-key — redline-allow: 自检样例里的假密钥（不是真密钥；两个扫描器共用这一个标记）
      const git = (args) => spawnSync("git", args, { cwd: proj, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
      git(["init", "-q"]); git(["add", "-A"]); git(["commit", "-qm", "i"]);
      if (!existsSync(join(proj, ".git"))) return { code: 0, expectCode: 0, out: "本机没有可用的 git —— 本项跳过（不算失败）" };
      const fakeHome = join(d, "tests", "fixtures", "fake-home");
      mkdirSync(fakeHome, { recursive: true });
      const env = { ...process.env, USERPROFILE: fakeHome, APPDATA: fakeHome, LOCALAPPDATA: fakeHome, PATH: process.env.PATH };
      const r = spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(d, "scripts", "redline-check.ps1"), "-Project", proj], { cwd: d, encoding: "utf8", env });
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      const problems = [];
      if (!/明文密钥/.test(out)) problems.push("**中文名的被跟踪文件没被扫到** —— `git ls-files` 的八进制转义又把它当成「找不到」了");
      // ⚠️ 原来这里断言"不许出现『定位不到』"—— 第五轮复审实测**它是恒真的**：修复态
      //    goneCount=0 不打印；破坏态又走 `$notRun` 那一支、范围注根本不打印。
      //    换成有判别力的：修复态会打印 `· 扫描 1 个被跟踪文件`，破坏态是 `扫描 0 个`。
      if (!/扫描 [1-9]\d* 个被跟踪文件/.test(out)) problems.push("被跟踪文件的扫描计数是 0 —— 那个中文名文件没进扫描集合");
      if ((r.status ?? 1) !== 1) problems.push(`退出码 ${r.status}（被跟踪文件里的明文密钥是硬失败，应当 1）`);
      return { code: problems.length ? 1 : 0, expectCode: 0, out: problems.length ? problems.join("；") : "中文名的被跟踪文件被正确扫到并判红" };
    },
  },
  {
    name: "代码页 936 的控制台下，中文名被跟踪文件同样要判红（复审第五轮 强烈建议）",
    // **为什么加**：第四轮修 F2 时我用的是"临时把 `[Console]::OutputEncoding` 设成 UTF-8"，
    // 第五轮复审指出两件事：① 这一半在**本机测不出来**（本机控制台是 UTF-8），但用
    // `SetConsoleOutputCP(936)` 造出真 936 控制台后**能测出来**；② 它还有副作用——
    // 在 936 终端下整份报告的中文变成乱码。
    // 现在改成"cmd 重定向到临时文件 + `Get-Content -Encoding UTF8` 显式解码"，不碰全局控制台状态，
    // 于是 936 / 65001 都一样对。这条用例把"936 下也认得出中文路径"钉住。
    // ⚠️ 断言只看**退出码与 ASCII 片段**（`VERDICT: FAIL`）：936 控制台下 stdout 是 GBK 字节，
    //    在 Node 里按 utf8 解码会把中文变成乱码 —— 拿中文做断言会假红。
    check: (d) => {
      const ps = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      if (!existsSync(ps)) return { code: 0, expectCode: 0, out: "没有 powershell.exe —— 本项跳过（不算失败）" };
      const proj = join(d, "tests", "fixtures", "redline-cjk936");
      mkdirSync(join(proj, "docs"), { recursive: true });
      writeFileSync(join(proj, "docs", "中文说明.md"), 'api_key = "abcdefghijklmnopqrstuvwxyz123456"\n', "utf8");  // nosemgrep: generic.secrets.security.detected-generic-api-key.detected-generic-api-key — redline-allow: 自检样例里的假密钥（不是真密钥；两个扫描器共用这一个标记）
      const git = (args) => spawnSync("git", args, { cwd: proj, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
      git(["init", "-q"]); git(["add", "-A"]); git(["commit", "-qm", "i"]);
      if (!existsSync(join(proj, ".git"))) return { code: 0, expectCode: 0, out: "本机没有可用的 git —— 本项跳过（不算失败）" };
      const fakeHome = join(d, "tests", "fixtures", "fake-home");
      mkdirSync(fakeHome, { recursive: true });
      const env = { ...process.env, USERPROFILE: fakeHome, APPDATA: fakeHome, LOCALAPPDATA: fakeHome, PATH: process.env.PATH };
      // ⚠️ 用 `shell: true` + 命令行字符串：**直接 spawn 一个 `.cmd` 在本机是 EINVAL**
      //    （`status` 为 null，实测），而 `r.status ?? 1` 会把 null 变成 1 ⇒ **退出码断言假通过**。
      //    所以下面断言用**严格等于 1**，并把 `r.error` 也算作问题（spawn 失败必须红）。
      // ⚠️ 两个我自己踩过的坑，都留档在这里：
      //   ① `chcp` 改的是**控制台**代码页，子进程用完不会自动还原 ⇒ **漏给同控制台里后面的进程**。
      //      实测后果：紧接着的下一轮自检在同一控制台里跑出 45/55（10 条红），新控制台里复跑 55/55。
      //   ② 还原**不能**写成 `cmd /c "chcp 936 & 跑工具 & chcp 原值"` —— `cmd /c` 一行里
      //      **退出码属于最后一个命令**，还原那一步把工具的信号冲成了 0（用例当场假红）。
      //   所以改用一个小 `.bat`：逐行执行、`%ERRORLEVEL%` 按行取值、最后 `exit /b` 带出工具的退出码。
      let prevCp = "";
      try {
        // 不用 `{ shell: true }`（semgrep 的 spawn-shell-true 会报它）—— 显式 `cmd /c`，参数是字面量
        const p0 = spawnSync("cmd.exe", ["/c", "chcp"]);
        prevCp = new TextDecoder("gbk").decode(p0.stdout ?? Buffer.alloc(0)).match(/(\d+)/)?.[1] ?? "";
      } catch { /* 读不到就还原成 65001 */ }
      const restoredCp = prevCp || "65001";
      const bat = join(d, "tests", "fixtures", "run-cp936.bat");
      writeFileSync(bat, [
        "@echo off",
        "chcp 936 >nul",
        `"${ps}" -NoProfile -ExecutionPolicy Bypass -File "${join(d, "scripts", "redline-check.ps1")}" -Project "${proj}"`,
        "set RC=%ERRORLEVEL%",
        `chcp ${restoredCp} >nul`,
        "exit /b %RC%",
        "",
      ].join("\r\n"), "utf8");
      // ⚠️ **按 Buffer 收，再用 TextDecoder("gbk") 解码**：936 控制台下 stdout 是 GBK 字节，
      //    若按 utf8 解码，中文固然是乱码，连**相邻的 ASCII 都可能被 GBK 双字节序列吃掉**
      //    （我第一版断言 `/VERDICT: FAIL/` 就是这样假红的 —— 产品其实是对的）。
      const r = spawnSync("cmd.exe", ["/c", bat], { env, cwd: d });
      let out;
      try { out = new TextDecoder("gbk").decode(r.stdout ?? Buffer.alloc(0)); }
      catch { out = String(r.stdout ?? ""); }   // 没有完整 ICU 时退回（下面只靠退出码断言）
      const problems = [];
      if (r.error) problems.push(`没能起进程：${r.error.message}`);
      if (r.status !== 1) problems.push(`退出码 ${r.status}（936 控制台下也应当判红 = 1；若为 0，说明中文路径又没被扫到）`);
      if (!/VERDICT: FAIL/.test(out)) problems.push("按 GBK 解码后也看不到 `VERDICT: FAIL`");
      if (!/明文密钥/.test(out)) problems.push("按 GBK 解码后看不到「明文密钥」—— 报告本身可能被写成了 UTF-8（936 终端下会乱码）");
      return { code: problems.length ? 1 : 0, expectCode: 0, out: problems.length ? problems.join("；") : "936 控制台下中文名被跟踪文件照样判红，且报告字节是 GBK（终端可读）" };
    },
  },
  {
    name: "semgrep 规则仍然活着：**没标豁免**的同款密钥必须仍被抓到",
    // ⚠️ 夹具**不能**放在 tests/ 下：semgrep 自带默认忽略列表里就有 tests/（实测踩到：
    //    放在 tests/fixtures/ 里它一条都不报，于是判定写成"规则被关掉了" —— 假红）。
    // **为什么加**（第六轮复审 S3）：这一轮把 semgrep 的 22 条降到 0，而**全部证据都是
    // "标记生效了"** —— 没有任何一条负向用例证明"规则本身还活着"。也就是说：
    // 如果谁把规则整体关掉（`--config` 换成空集、或全库加 exclude），**没有东西会变红**。
    // 这条用例补上那一半：放一个**不带 nosemgrep** 的密钥 ⇒ semgrep 必须报出来。
    // ⚠️ 依赖网络（`--config auto` 要拉规则）：拉不到时**记"没跑成"并放行**（不冒充通过），
    //    与库内其它"环境不具备就跳过"的用例同一口径。
    check: (d) => {
      // ⚠️ 夹具**不能**放在 `tests/` 下：semgrep 自带的默认忽略列表里就有 `tests/`
      //    （实测踩到：放在 `tests/fixtures/` 里它一条都不报 ⇒ 用例假红，
      //     而失败信息写成"规则可能被整体关掉了" —— 又是一次"看着像产品 bug 的断言 bug"）。
      const proj = join(d, "sgalive-fixture");
      mkdirSync(proj, { recursive: true });
      // 不带任何豁免标记 —— 它必须被抓。
      // ⚠️ 值选 `api_key = "…32 位…"`：这是被 `generic-api-key` 规则**确实命中**的形态；
      //    换用 AWS 官方文档里那个示例密钥（`wJalrXUtnFEMI…`）反而**一条都不报**（被规则白名单化了），
      //    实测过，所以别换成"看起来更像真的"的那种。
      writeFileSync(join(proj, "leak.py"), 'api_key = "abcdefghijklmnopqrstuvwxyz123456"' + "\n", "utf8");  // nosemgrep: generic.secrets.security.detected-generic-api-key.detected-generic-api-key — redline-allow: **源码里这一行**要豁免；写进夹具文件的内容**不带**标记，正是要让它被抓
      const r = spawnSync("semgrep", ["scan", "--config", "auto", "--quiet", "--json"], { cwd: proj, encoding: "utf8" });
      if (r.error || r.status === null) return { code: 0, expectCode: 0, out: "没有 semgrep —— 本项没跑成（不算失败，但也没证明规则活着）" };
      let n = null;
      try { n = (JSON.parse(`${r.stdout ?? ""}`).results ?? []).length; } catch { /* 不是 JSON：多半没拉成规则 */ }
      if (n === null) return { code: 0, expectCode: 0, out: "semgrep 没跑成（多半是拉不到规则/网络）—— 本项没跑成，不算通过" };
      if (n < 1) return { code: 1, expectCode: 0, out: "**semgrep 一条都没报** —— 规则可能被整体关掉了（豁免标记只在固定那几行上，这条不受影响）" };
      return { code: 0, expectCode: 0, out: `未标记的密钥仍被抓到（${n} 条）—— 规则活着` };
    },
  },
  {
    name: "D1 的部署物探测：子目录/带后缀/非标准名也必须认出来（复审第六轮 S1）",
    // **为什么加**：这是第六轮复审的**唯一必改项**，也是本提交**新引入的漏报**。
    // 旧逻辑用"项目根 + 精确文件名"的白名单，复审用四个真实形态当场证伪：
    // `docker/Dockerfile.prod`、`docker/compose.production.yaml`、`systemd/*.service` + Makefile 的 deploy 目标、
    // `scripts/release/deploy-prod.sh` —— **四个全都该 FAIL，却全被 SKIP**，
    // 而 SKIP 的文案还写着"本项目没有部署配置"（一句它没有能力下的强断言）。
    // 判据：放上这些形态 ⇒ D1 必须是 **FAIL**（不是 SKIP）。
    // ⚠️ 把探测改回精确文件名白名单 → 这条必须红。
    check: (d) => {
      const ps = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      if (!existsSync(ps)) return { code: 0, expectCode: 0, out: "没有 powershell.exe —— 本项跳过（不算失败）" };
      const proj = join(d, "tests", "fixtures", "deploy-shapes");
      mkdirSync(join(proj, "docker"), { recursive: true });
      mkdirSync(join(proj, "systemd"), { recursive: true });
      writeFileSync(join(proj, "docker", "Dockerfile.prod"), "FROM python:3.12\n", "utf8");
      writeFileSync(join(proj, "docker", "compose.production.yaml"), "services: {}\n", "utf8");
      writeFileSync(join(proj, "systemd", "myapp.service"), "[Unit]\nDescription=x\n", "utf8");
      // ⚠️ 夹具 A **故意不放 Makefile**：否则"按名字递归探测"这一支就算被删掉，
      //    也会被 Makefile 那一支兜住 ⇒ 变异测试照样全绿（我实测过一次：M20a 干净版没红，
      //    查出来就是这里多放了一个 Makefile）。**一个夹具只能守一条分支。**
      const fakeHome = join(d, "tests", "fixtures", "fake-home");
      mkdirSync(fakeHome, { recursive: true });
      const env = { ...process.env, USERPROFILE: fakeHome, APPDATA: fakeHome, LOCALAPPDATA: fakeHome, PATH: process.env.PATH };
      const jsonOut = join(proj, "gate.json");
      spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(d, "scripts", "quality-gate.ps1"),
        "-Path", proj, "-Json", jsonOut], { cwd: d, encoding: "utf8", env });
      const problems = [];
      const readD1 = (p) => {
        try { return (JSON.parse(readFileSync(p, "utf8")).results ?? []).find((x) => x.Id === "D1"); } catch { return null; }
      };
      const d1 = readD1(jsonOut);
      if (!d1) return { code: 1, expectCode: 0, out: "D1 没有产出结果行（闸门静默少项？）" };
      if (d1.Status !== "FAIL") problems.push(`夹具 A（docker/ + systemd/，无 Makefile）D1 实际=${d1.Status}（应当是 FAIL）`);
      if (!/Dockerfile|compose|service/i.test(String(d1.Detail ?? ""))) problems.push("D1 的明细没点名它找到了什么部署物");

      // ⚠️ **第二个夹具单独守"Makefile 目标"那条分支**：第一版把 Makefile 和目录形态放在同一个
      //    夹具里，于是"删掉目录探测"这个变异**照样全绿**（被 Makefile 那条兜住了）——
      //    我实测过（M20 落空）。一条用例要守两条实现分支，就得两个夹具。
      const proj2 = join(d, "deploy-makefile-only");
      mkdirSync(proj2, { recursive: true });
      writeFileSync(join(proj2, "Makefile"), "build:\n\techo build\ndeploy:\n\techo deploy\n", "utf8");
      const jsonOut2 = join(proj2, "gate.json");
      spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(d, "scripts", "quality-gate.ps1"),
        "-Path", proj2, "-Json", jsonOut2], { cwd: d, encoding: "utf8", env });
      const d1b = readD1(jsonOut2);
      if (!d1b) problems.push("夹具 B：D1 没有产出结果行");
      else if (d1b.Status !== "FAIL") problems.push(`夹具 B（只有 Makefile 的 deploy 目标）D1 实际=${d1b.Status}（应当是 FAIL）`);
      return { code: problems.length ? 1 : 0, expectCode: 0, out: problems.length ? problems.join("；") : "两条分支各自守住了：目录/后缀形态与 Makefile 目标都能被认出来" };
    },
  },
];

// ── 通过语义：一条**约定**，不是能自动判定的东西（写清楚，别假装有护栏）─────────
// 约定：**变异类用例在"闸门表现正确"时都 exit 0**；要断言"检查器报红"，用
//       `need` / `needId` 断言**输出**，而不是退出码。
// 踩过的实例（同一天两次）：`删掉 F6 的递归` 那条我写成 `code: problems.length ? 1 : 0`
// —— 护栏**抓到**了变异却返回 1，于是**干对了反而报"用例失败"**（真机输出 `期望退出码 0，实际 1`）。
// ⚠️ 我试过用正则扫"变异类用例里有没有 expectCode: 1"来自动判定，**那个判据是错的**
//    （正常用例大量使用 `expectCode: 1` 来表达"检查器应该红"），实测把 24 条好用例全报成 offender。
//    所以这里只留约定 + 下面 JSON 里的 `semantics` 声明，供人复核；**不假装机器管住了它**。

// ── 环境预检：把控制台代码页临时归一到 UTF-8（第五轮复审那轮的实测教训）───────
// 用例里大量断言**中文输出**，而 PowerShell 子进程的 stdout 编码跟**控制台代码页**走：
// 在纯 936 控制台（chcp 936 且 OutputEncoding=GBK）下，子进程吐的是 GBK 字节，
// Node 按 utf8 解码 ⇒ 中文全成乱码 ⇒ 断言假红。实测：同一台机器、同一个库，
// 936 控制台下自检报 **10 条失败**，切回 65001 后 **55/55 全绿**。
// ⚠️ 产品在 936 下**是对的**（我直接跑过：CJK 名文件照样判红、退出码 1），
//    那条路径由专门的用例 `代码页 936 的控制台下…` 覆盖（它自己 chcp 936 再还原）。
// 所以这里只归一**测试环境**，跑完还原成原值，不替产品做决定。
// ⚠️ 一律用 `cmd.exe /c` 显式起，**不用 `{ shell: true }`**：semgrep 的
//    `spawn-shell-true` 规则会报后者，而且这里根本没有拼接用户输入的必要 ——
//    `shell: true` 在这个用途上纯属多余的风险面（参数全是硬编码字面量）。
const chcp = (arg) => spawnSync("cmd.exe", ["/c", arg ? `chcp ${arg}` : "chcp"]);
const readConsoleCp = () => {
  try {
    const p = chcp();
    return new TextDecoder("gbk").decode(p.stdout ?? Buffer.alloc(0)).match(/(\d+)/)?.[1] ?? "";
  } catch { return ""; }
};
const ORIG_CP = readConsoleCp();
let cpNormalized = false;
if (ORIG_CP && ORIG_CP !== "65001") {
  chcp("65001");
  cpNormalized = readConsoleCp() === "65001";
  console.log(`（环境预检：控制台代码页 ${ORIG_CP} → 65001，跑完还原。` +
    `用例要对中文输出做断言，936 下会假红；产品在 936 下另有专门用例覆盖。）\n`);
}
process.on("exit", () => {
  if (cpNormalized) { try { chcp(ORIG_CP); } catch { /* 还原失败就算了 */ } }
});

// ── 跑 ────────────────────────────────────────────────────────────────────
// ⚠️ **为什么是"分片 + 父进程并发"，而不是 Promise.all**（2026-09-14）：
//    61 条用例里有 20 条要起 PowerShell，而所有用例用的都是 **`spawnSync`（阻塞主线程）** ——
//    同一个进程里 await 它们**不会**并行。串行实测 94.3 秒（占全量 verify-all 的 93%）。
//    实测结论：**用例之间彼此独立**（各自 copyLib 一份副本、各自 spawn 子进程、各写各的目录）
//    ⇒ 可以把用例切成 N 片、由**父进程并发起 N 个子进程**跑，再把输出按序合并。
//    这样 61 条用例本体**一行都不用改**（对独立复审友好）。
// ⚠️ **例外必须独占**：动**控制台代码页**的用例（`chcp` 改的是**整个控制台**的状态）不能与别人并行，
//    否则它会把同批用例的中文输出改乱 —— 症状是"随机假红"，比慢得多更糟。它单独跑，串行。
// 实测：串行 92.9s / 2 片 49.8s / 4 片 35.3s / **6 片 32.1s**（2026-09-14，本机 6 核）。
// 默认取 min(6, 核数-1)：再多也不划算（PowerShell 启动争用），再少则吃不满。
const SERIAL_RE = /代码页/;
const serialCases = CASES.filter((c) => SERIAL_RE.test(c.name));
const parallelCases = CASES.filter((c) => !SERIAL_RE.test(c.name));

const shardArg = (() => {
  const i = process.argv.indexOf("--shard");
  if (i < 0) return null;
  const v = process.argv[i + 1] ?? "";
  if (v === "serial") return { serial: true };
  const m = /^(\d+)\/(\d+)$/.exec(v);
  return m ? { k: Number(m[1]), n: Number(m[2]) } : null;
})();
const isParallelParent = process.argv.includes("--parallel");
const jobsArg = (() => {
  const i = process.argv.indexOf("--jobs");
  const n = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 16) : null;
})();

let pass = 0;
let notRun = 0;                    // "没跑成"：子进程起不来（不是"闸门没抓住"）
const notRunList = [];
const failures = [];

// 跑一批用例，返回合并后的文本（**整块返回**：并行时避免多行输出互相插队）
const runCases = (list) => {
  const buf = [];
  const say = (s) => buf.push(s);
  for (const c of list) {
    const dir = copyLib();
    try {
      // ── 变异必须真的改到东西（见上面 fingerprint 的注释）──
      // 没有 mutate 的用例（基线、纯静态检查）跳过这道闸门。
      const before = c.mutate ? dirFingerprint(dir) : null;
      c.mutate?.(dir);
      if (c.mutate && dirFingerprint(dir) === before) {
        failures.push({ name: c.name, code: 1, expectCode: 0, need: "变异生效", text: "变异没有改动任何文件" });
        say(`  [FAIL] ${c.name}`);
        say("         变异**没有改动任何文件** —— 用例坏了，不是闸门坏了。");
        say("         常见原因：变异里硬编码的常量已经过期（比如文档里的数字改过），");
        say("         `String.replace` 找不到就静默返回原串 → 检查器当然全绿。");
        say("         修法：让变异从**文件里现取**那段文字，别写死（本库真机踩过一次）。");
        continue;
      }
      const out = c.check(dir);
      // ⚠️ 硬化（2026-09-14）：`spawnSync` **起不来子进程**时 `status` 是 null、`error` 有值。
      //    旧写法 `r.status ?? 1` 会把它当成"退出码 1" ⇒ **偶发的"起不来"会被读成"闸门抓不住错误"**，
      //    那是假红，与 N1 同类（"没跑成"被说成"查过了 / 失败了"）。
      //    这里单独判成一档：**不计入失败，但必须看得见**，且整轮退出码走 3（没结论），
      //    免得提交钩子/CI 把"环境起不来"读成"检查器坏了"。
      if (out.r && out.r.error) {
        notRun++;
        notRunList.push(`${c.name} —— 子进程起不来（${out.r.error.code ?? out.r.error.message}）`);
        say(`  [没跑成] ${c.name} —— 子进程起不来（${out.r.error.code ?? out.r.error.message}）；这不是"闸门没抓住"`);
        continue;
      }
      // 两种写法：整包断言（基线）或 {r, need, expectCode}
      const code = out.r ? (out.r.status ?? 1) : out.code;
      const text = out.r ? `${out.r.stdout ?? ""}${out.r.stderr ?? ""}` : out.out;
      // raw = **子进程的原始输出**（用例可以显式给；{r,…} 写法默认就是它）。
      // ⚠️ 为什么需要它（2026-09-13 CI 首跑）：用例失败时只打印 `out`（我自己写的问题串），
      //    被检查工具的**真实输出一个字都没进日志** ⇒ 远端红灯无法诊断，只能靠猜。
      //    CI 里没有交互 shell、日志又要鉴权，所以"失败时把原始输出带出来"是唯一的排查通道。
      const raw = out.raw ?? (out.r ? text : null);
      const expectCode = out.expectCode;
      // need：输出里必须出现这段文字；needId：必须出现 `[FAIL] <id>`（用来断言"这项红了"）。
      // passId：必须出现 `[PASS] <id>`（用来断言"这项**没红**"——放行类用例需要它，
      //   否则 `needId` 的语义在 exit 0 的用例里就落空了）。
      const need = out.need ?? (out.needId ? `[FAIL] ${out.needId}` : out.passId ? `[PASS] ${out.passId}` : undefined);
      const okCode = code === expectCode;
      const okText = (!need || text.includes(need)) && (!out.needAlso || text.includes(out.needAlso));
      if (okCode && okText) {
        pass++;
        say(`  [OK  ] ${c.name}`);
      } else {
        failures.push({ name: c.name, code, expectCode, need, text, raw });
        say(`  [FAIL] ${c.name}`);
        say(`         期望退出码 ${expectCode}，实际 ${code}${need ? `；期望输出里含「${need}」，${okText ? "有" : "**没有**"}` : ""}`);
        // 失败时**总是**带出原始输出（不只 -v）：这是远端（CI）唯一的排查通道，见上面 raw 的注释。
        if (raw) {
          const lines = String(raw).split("\n");
          const tail = lines.length > 20 ? lines.slice(-20) : lines;
          say(`         子进程原始输出（共 ${lines.length} 行${lines.length > 20 ? "，以下是尾部 20 行" : ""}）：`);
          for (const l of tail) say(`         │ ${l}`);
        }
      }
      if (VERBOSE) say(text.split("\n").map((l) => `         │ ${l}`).join("\n"));
    } catch (e) {
      failures.push({ name: c.name, err: String(e) });
      say(`  [FAIL] ${c.name} —— 用例本身抛异常：${e}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return buf.join("\n");
};

// 子进程模式：只跑这一片，输出（父进程会按序拼回）
if (shardArg) {
  const list = shardArg.serial
    ? serialCases
    : parallelCases.filter((_, i) => i % shardArg.n === shardArg.k);
  console.log(runCases(list));
  console.log(`SHARD ${shardArg.serial ? "serial" : `${shardArg.k}/${shardArg.n}`} pass=${pass} fail=${failures.length} notrun=${notRun}`);
  if (failures.length) {
    console.log("失败详情（说明闸门没拦住这类错误，等于形同虚设）：");
    for (const f of failures) console.log(`  · ${f.name}`);
  }
  for (const n of notRunList) console.log(`  [没跑成] ${n}`);
  // 退出码分三档（与 verify-all 的约定一致）：0 通过 / 1 有真失败 / 3 有"没跑成"
  process.exit(failures.length ? 1 : notRun ? 3 : 0);
}

// 父进程模式：并发起 N 片 + 串行跑"动代码页"那条，输出按序合并
if (isParallelParent) {
  const { spawn } = await import("node:child_process");
  const { cpus } = await import("node:os");
  const JOBS = jobsArg ?? Math.min(6, Math.max(2, (cpus().length || 4) - 1));
  const self = fileURLToPath(import.meta.url);
  const runChild = (args) => new Promise((res) => {
    const p = spawn(process.execPath, [self, ...args], { cwd: ROOT, env: process.env });
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { out += d; });
    p.on("close", (code) => res({ code, out }));
  });
  // ① 并行：N 片普通用例
  const shardResults = await Promise.all(
    Array.from({ length: JOBS }, (_, k) => runChild(["--shard", `${k}/${JOBS}`]))
  );
  // ② 串行：动控制台代码页的那条（独占控制台，不能和上面同时跑）
  const serialResult = await runChild(["--shard", "serial"]);
  for (const r of [...shardResults, serialResult]) process.stdout.write(r.out + "\n");
  // 汇总（各片的 pass/fail/notrun 由子进程的 SHARD 行报出）
  const parsed = [...shardResults, serialResult].map((r) => /SHARD .* pass=(\d+) fail=(\d+) notrun=(\d+)/.exec(r.out)).filter(Boolean);
  const totals = parsed.reduce((a, m) => ({ pass: a.pass + Number(m[1]), fail: a.fail + Number(m[2]), notRun: a.notRun + Number(m[3]) }), { pass: 0, fail: 0, notRun: 0 });
  const bad = shardResults.some((r) => r.code === 1) || serialResult.code === 1;
  const notrun = shardResults.some((r) => r.code === 3) || serialResult.code === 3 || totals.notRun > 0;
  console.log("");
  console.log(`合计 ${CASES.length} 个用例 | 通过 ${totals.pass} | 失败 ${totals.fail} | 没跑成 ${totals.notRun}（并行 ${JOBS} 片）`);
  if (bad || totals.fail) {
    console.log("判定: 有检查器没抓住注入的错误（详情见上面对应分片的输出）");
    process.exit(1);
  }
  if (notrun) {
    console.log("判定: 有子进程没起来 —— **这一轮没有完整结论**（没跑成 ≠ 通过），别读成全绿");
    process.exit(3);
  }
  console.log("判定: 检查器行为正确（正例放行、错例拦住）");
  process.exit(0);
}

// 默认（无参数）：串行跑全部 —— 与改造前行为一致，便于对照与排查
console.log("=== 检查器自检（变异测试：注入已知错误，断言闸门必须拦住）===\n");
console.log(runCases(CASES));

console.log("");
console.log(`合计 ${CASES.length} 个用例 | 通过 ${pass} | 失败 ${failures.length} | 没跑成 ${notRun}`);
if (failures.length) {
  console.log("\n失败详情（说明闸门没拦住这类错误，等于形同虚设）：");
  for (const f of failures) {
    console.log(`  · ${f.name}`);
    if (f.text) console.log(f.text.split("\n").slice(0, 8).map((l) => `      ${l}`).join("\n"));
  }
  process.exit(1);
}
if (notRun) {
  for (const n of notRunList) console.log(`  [没跑成] ${n}`);
  console.log("判定: 有子进程没起来 —— **这一轮没有完整结论**（没跑成 ≠ 通过），别读成全绿");
  process.exit(3);
}
console.log("判定: 检查器行为正确（正例放行、错例拦住）");
process.exit(0);
