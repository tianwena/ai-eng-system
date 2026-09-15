// 内容一致性检查器 —— 找出"同一件事在多个文件里写了互相矛盾的说法"。
//
// 为什么要有它：
//   这个库里的同一件事实（技能数、闸门项数、脚本清单）被反复写在 README / SKILLS.md /
//   从这里开始.md / 各技能正文里。**没有任何工具会告诉你它们开始互相矛盾** ——
//   而这正是"体系"腐坏的第一步：文档说 13 项，脚本里其实有 14 项，谁都不知道。
//
// 核心原则：**唯一事实来源是文件系统**，文档里的数字是"被检查的声明"。
//   · 声明从文档里按正则抓出来
//   · 真值从源文件里算出来
//   · 两者不一致 = FAIL
//
// 反模式（本文件刻意不做的事）：
//   **不给没有机器来源的数字背书。** 如果一个数字没人自动维护，它迟早会错；
//   正确做法是把那个数字从文档里删掉，改成不依赖精确计数的写法。
//   本检查器只覆盖"真值可从文件算出来"的声明；其余数字视为噪音。
//
// 用法:
//   node scripts/check-consistency.mjs                          # 只查库内自洽
//   node scripts/check-consistency.mjs --installed <技能根>      # 顺便比对源 ↔ 已安装副本
//   node scripts/check-consistency.mjs --root <库根>
//
// 退出码: 0 = 无矛盾；1 = 有矛盾（或--installed 下发现副本漂移）
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const getArg = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
const ROOT = resolve(getArg("--root") ?? join(HERE, ".."));
const INSTALLED = getArg("--installed") ?? null;
const VERBOSE = argv.includes("--verbose");

const results = [];
const add = (status, id, title, note = "") => results.push({ status, id, title, note });
const rel = (p) => relative(ROOT, p).split(sep).join("/");
// "核了多少处声明"：由 registered-claims 计数，最后打在摘要里（**不是硬编码的数字**）
let claimChecked = 0;

// ── 读工具 ────────────────────────────────────────────────────────────────
const readUtf8 = (p) => readFile(p, "utf8");
const listDir = async (p) => {
  try { return (await readdir(p, { withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name); }
  catch { return []; }
};
// 递归收集文件（跳过 .git / node_modules；深度上限 3 足够覆盖本库）
const walkFiles = async (dir, re, depth = 0, acc = []) => {
  if (depth > 3) return acc;
  for (const d of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (d.name === ".git" || d.name === "node_modules") continue;
    const p = join(dir, d.name);
    if (d.isDirectory()) await walkFiles(p, re, depth + 1, acc);
    else if (re.test(d.name)) acc.push(p);
  }
  return acc;
};
const ALL_MD = (await walkFiles(ROOT, /\.md$/i)).sort();
const ALL_CODE = await walkFiles(ROOT, /\.(md|mjs|ps1|json|yml|yaml|sh|txt)$/i);

// ── 真值 1：技能 ──────────────────────────────────────────────────────────
const GROUPS = [
  { key: "engineering", label: "工程技能" },
  { key: "productivity", label: "通用工作流技能" },
];
const skillNames = [];               // 全部技能名
const byGroup = {};                  // 分组计数
for (const g of GROUPS) {
  const subs = await readdir(join(ROOT, g.key), { withFileTypes: true }).catch(() => []);
  const names = subs.filter((d) => d.isDirectory()).map((d) => d.name)
    .filter((n) => existsSync(join(ROOT, g.key, n, "SKILL.md")));
  byGroup[g.key] = names.sort();
  skillNames.push(...names);
}
const TOTAL_SKILLS = skillNames.length;

// 自研技能 = 目录里同时有这个技能自己的速查/脚本等附属物？不行，太隐晦。
// 唯一可靠的判据：README 的「本项目自研」小节列出的那些名字，反过来核对它们真实存在。
// 这里只取"自研 10 个"里的数量声明，真值来自 README 那一节的列表行数（见 check 4）。

// ── 真值 2：闸门检查项（从脚本源码里数，不是从文档抄） ──────────────────────
const gateSrc = await readUtf8(join(ROOT, "scripts", "quality-gate.ps1")).catch(() => "");
const gateIds = [...new Set([...gateSrc.matchAll(/Add-Result\s+'([A-E]\d+)'/g)].map((m) => m[1]))].sort();
const redlineSrc = await readUtf8(join(ROOT, "scripts", "redline-check.ps1")).catch(() => "");
const redlineSects = [...redlineSrc.matchAll(/^\s*Sect\s+'([①②③④⑤⑥⑦⑧⑨⑩][^']*)'/gm)].map((m) => m[1]);

// ── 真值 3：脚本清单 ──────────────────────────────────────────────────────
// 库级脚本 = 根目录的 .ps1/.mjs + scripts/ 下的全部文件（模板脚本在技能目录里，不算）
const rootScripts = (await listDir(ROOT)).filter((n) => /\.(ps1|mjs)$/i.test(n));
const scriptsDir = (await listDir(join(ROOT, "scripts"))).filter((n) => !n.startsWith("."));
const INVENTORY = [...rootScripts, ...scriptsDir.map((n) => `scripts/${n}`)].sort();

// ── 文档清单 ─────────────────────────────────────────────────────────────
const ROOT_DOCS = (await listDir(ROOT)).filter((n) => n.endsWith(".md")).sort();

// ── 数字规范化：阿拉伯 / 全角 / 中文数字 → number ──────────────────────────
// 为什么必须在这里做（2026-09-12，独立复审 V3）：
//   旧版只认 `\d+`，于是 **中文数字与全角数字完全不在防护范围内** ——
//   在入口文档里写「九十九个检查器」或「１５个脚本」实测**全绿**。
//   中文数字解析曾经是一张只到"十五"的对照表，写完"十六个脚本"就报"无法解析"，
//   **把检查器的能力不足说成了文档的问题**。现在统一走通用解析。
const CN_D = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 〇: 0, 零: 0 };
const canonNum = (raw) => {
  const s = String(raw).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).trim();
  if (/^\d+$/.test(s)) return Number(s);
  if (!/^[〇零一二三四五六七八九十]+$/.test(s)) return NaN;
  // 单字：一 → 1 … 九 → 9（"十"单独出现也算 10）
  if (s.length === 1) return s === "十" ? 10 : (CN_D[s] ?? NaN);
  const i = s.indexOf("十");
  if (i < 0) return Number(s.split("").map((c) => CN_D[c] ?? NaN).join(""));   // 三五 → 35（不常用但别静默算错）
  const head = i === 0 ? 1 : (CN_D[s[0]] ?? NaN);                  // 十六 → 1*10+6
  const tail = i === s.length - 1 ? 0 : (CN_D[s[i + 1]] ?? NaN);   // 二十 → 2*10
  return head * 10 + tail;
};

// ── 声明表：正则 → 真值来源 ───────────────────────────────────────────────
// 每条声明必须能指到"哪个文件、哪一行算出来的"，指不到就不该写进文档。
// 真值仍然从源文件算（见上面）；"文档里写了什么"则完全交给 scripts/facts.json 的登记表。
const GATE_N = gateIds.length;          // 机器闸门的检查项数
const REDLINE_N = redlineSects.length;  // 技术红线的检查项数
const SCAN_DOCS = ROOT_DOCS.map((n) => ({ file: n, path: join(ROOT, n) }));

// ── 事实登记表（scripts/facts.json）──────────────────────────────────────
// 这是"关于体系自身的数字"的**唯一登记处**。两件事：
//   ① 登记表自己不能烂：每条 truth 都要能算出来，且与登记的真值一致；
//   ② 文档里出现"没登记的体系数字" → 拦下（"新增数字必须登记"的机制）。
// 背景：文档腐烂已经犯过 4 次（13/14 项、44/80 项、25 个技能没装、脚本清单漏项），
// 而每次都是**人肉**发现的 —— 因为没人知道"下一个新数字该不该有护栏"。
const FACTS_PATH = join(ROOT, "scripts", "facts.json");
let FACTS = null;
try { FACTS = JSON.parse(await readUtf8(FACTS_PATH)); } catch (e) {
  add("FAIL", "facts-registry", "事实登记表可读", `读不了 ${FACTS_PATH}：${e.message}`);
}

if (FACTS) {
  const gateDefault = gateIds.filter((i) => i !== "E1").length;
  // self-test.mjs 的用例条数 = **被真正迭代的那个数组**里的对象条数。
  // **为什么不能只数字面量**：只数对象的话，"CASES 被改名（于是没人再迭代它）"这种变异
  // 照样能数出 23 —— 真值来源已经失明，却给出一个看起来正常的数字（我第一版就栽在这里，
  // 变异用例跑出了假绿）。所以真值必须**绑定到数组标识符**，并且迭代语句要引用同一个名字。
  const selfTestSrc = await readUtf8(join(ROOT, "scripts", "self-test.mjs"));
  const arrName = selfTestSrc.match(/^const\s+([A-Za-z_$][\w$]*)\s*=\s*\[/m)?.[1];
  // 迭代那个**具体数组名**的 for-of（不能抓"第一个 for-of"——文件里还有 for (const f of refs)，
  // 实测第一版就抓到了 refs，于是基线直接报"真值来源失效"）。
  const iterName = arrName
    ? new RegExp(`for\\s*\\(\\s*const\\s+\\w+\\s+of\\s+(${arrName})\\s*\\)`).exec(selfTestSrc)?.[1]
    : undefined;
  // ⚠️ 2026-09-14：自检改成"分片 + 父进程并发"之后，迭代发生在 `runCases(CASES)` 里，
  //    不再是裸的 for-of —— 于是上面那条判据报"真值来源已经失效"（**机制是对的**：它发现
  //    自己钉的写法不见了）。但**事实没有变**：那个数组仍然被真正迭代。
  //    所以判据跟着事实走，两种写法都认；**"两者都没有"才报失效**（那才是真的没人迭代）。
  const iterViaCall = arrName
    ? new RegExp(`runCases\\s*\\(\\s*(${arrName})\\s*\\)`).exec(selfTestSrc)?.[1]
    : undefined;
  const iterated = iterName ?? iterViaCall;
  const selfTestCases = [...selfTestSrc.matchAll(/^\s{2}\{\s*$/gm)].length;
  const selfTestNames = [...selfTestSrc.matchAll(/^\s{4}name:\s*"/gm)].length;
  const selfTestTruthBroken =
    !arrName ? "找不到用例数组的声明（`const <名字> = [`）"
      : !iterated ? "找不到 `for (const x of <名字>)`，也找不到 `runCases(<名字>)` —— 用例还在，但已经没人迭代它"
        : iterated !== arrName ? `迭代的是 ${iterated}，而用例数组叫 ${arrName} —— 用例不会再被执行`
          : selfTestCases === 0 ? "找不到任何用例对象"
            : selfTestCases !== selfTestNames ? `用例对象 ${selfTestCases} 个，但 name: 只有 ${selfTestNames} 个（用例结构被改了）`
              : null;
  const truthValues = {
    "skills.total": TOTAL_SKILLS,
    "skills.engineering": byGroup.engineering.length,
    "skills.productivity": byGroup.productivity.length,
    "skills.selfAuthored": (FACTS.selfAuthoredSkills ?? []).length,
    "scripts.count": INVENTORY.length,
    "checks.qualityGateTotal": GATE_N,
    "checks.qualityGateDefault": gateDefault,
    "checks.redline": REDLINE_N,
    "checks.selfTest": selfTestTruthBroken ? -1 : selfTestCases,
    // verify-all 一共跑几个检查器（= steps 数组里的条数）。**它的意义不是数字本身**：
    // 文档里写着"六个检查器"，而 verify-all.mjs 里真有几个是能从源码算出来的——
    // 这个真值来源就是让那句话"被管着"，而不是只被登记过。
    "checks.verifyAll": [...(await readUtf8(join(ROOT, "scripts", "verify-all.mjs")))
      .matchAll(/^\s{4}(name|cmd):/gm)].length / 2,
  };
  const truthOf = (key) => (key in truthValues ? truthValues[key] : undefined);

  // ① 登记表自身：每个声明的真值来源必须算得出来；自研名单必须真实存在
  {
    const bad = [];
    for (const f of FACTS.facts ?? []) {
      if (truthOf(f.truth) === undefined) bad.push(`${f.id}: 真值来源 "${f.truth}" 算不出来（登记表写错了）`);
      if (!f.claim) bad.push(`${f.id}: 没有 claim 正则`);
    }
    for (const k of Object.keys(FACTS.truthSources ?? {})) {
      if (truthOf(k) === undefined) bad.push(`truthSources 里声明了 ${k}，但代码里没有对应推导`);
    }
    // **V4 的另一半（登记表只查"登没登"）**：registeredNumbers 里的数字必须
    // **要么等于同名 fact 的真值**（于是真值一改，这里不改就红），**要么在 extraValues 里写清理由**。
    // 旧版这里是一份**手抄的真值副本**：把 36 从名单里删掉，检查器照样全绿（复审实测）。
    // 现在删掉它 = "真值 36 不在登记表里" → 立刻红。
    // 但**只对 enforced 的名词**强制 —— 见下面的注释（否则自然语言举例会被当成违规）。
    const reuseNotice = [];
    {
      const reg = FACTS.registeredNumbers ?? {};
      const extra = FACTS.extraValues ?? {};
      const truthByNoun = new Map();
      for (const f of FACTS.facts ?? []) {
        // 只跳过"纯锚定"声明（noNumber 且没有 childTruthOf）= 那种声明只证明"这一行还在"。
        // 其余声明都把真值带进登记表 —— 包括 noNumber + childTruthOf 这类（self-test 用例数）。
        if (!f.noun || (f.noNumber && !f.childTruthOf)) continue;
        const t = truthOf(f.truth);
        if (typeof t === "number" && t >= 0) {
          if (!truthByNoun.has(f.noun)) truthByNoun.set(f.noun, new Set());
          truthByNoun.get(f.noun).add(t);
        }
      }
      const nounsWithFacts = new Set(truthByNoun.keys());
      // 有 fact 的**并且要求强制登记**的名词（enforced: true）：真值必须在登记表里。
      // 为什么不是"所有名词都强制"：像「一个脚本」这种是**自然语言举例**，
      // 把它也变成"必须跟真值一致"会把闸门变成噪音源（写一句散文就要改登记表）。
      // enforced 的判据是事实本身：**这条数字是关于体系规模的声明** → 必须被管住。
      const enforcedNouns = new Set((FACTS.facts ?? []).filter((f) => f.enforced && f.noun).map((f) => f.noun));
      for (const [noun, nums] of Object.entries(reg)) {
        if (noun.startsWith("_")) continue;
        for (const n of nums) {
          const derived = truthByNoun.get(noun)?.has(n);
          const justified = (extra[noun] ?? {})[String(n)] !== undefined;
          if (!derived && !justified && enforcedNouns.has(noun)) {
            bad.push(`registeredNumbers["${noun}"] 里的 ${n} **既不是任何 fact 的真值、也没在 extraValues 里写理由**` +
              ` —— 它可能是一份过期的手抄数字（这类副本正是"文档腐烂"的源头）`);
          }
          if (!derived && !justified && !enforcedNouns.has(noun)) {
            reuseNotice.push(`registeredNumbers["${noun}"] 里的 ${n} 没有真值来源（按"举例用的数字"放行）：${noun}`);
          }
        }
        // 反向：有 fact 的名词，真值必须**在**登记表里（否则它就是"没登记却被放行"）
        if (nounsWithFacts.has(noun)) {
          for (const t of truthByNoun.get(noun)) {
            if (!nums.includes(t)) {
              bad.push(`「${t} ${noun}」是同名 fact 的真值，但**不在 registeredNumbers["${noun}"] 里** —— 真值与登记表已经分叉`);
            }
          }
        }
      }
      for (const noun of Object.keys(extra)) {
        if (noun.startsWith("_")) continue;
        if (!(noun in reg)) bad.push(`extraValues 里的「${noun}」在 registeredNumbers 里没有对应名词`);
      }
    }
    for (const n of FACTS.selfAuthoredSkills ?? []) {
      if (!existsSync(join(ROOT, "engineering", n, "SKILL.md"))) bad.push(`自研名单里的 ${n} 找不到 SKILL.md`);
    }
    if ((FACTS.selfAuthoredSkills ?? []).length === 0) bad.push("自研技能名单是空的");
    // **V4（独立复审）**：真值来源必须**真的被用**。
    // 旧版只是"算出来了"，没用过的来源是"看着被管、其实没人管"——
    // 复审实测：checks.selfTest 与 checks.qualityGateDefault 两个真值来源**从未被任何 fact 使用**，
    // 也就是说"自检用例数"和"默认项数"这两个数字当时**根本没有护栏**，写错了也没人喊。
    {
      const used = new Set((FACTS.facts ?? []).map((f) => f.truth));
      const unused = Object.keys(truthValues).filter((k) => !used.has(k));
      if (unused.length) {
        bad.push(`真值来源算出来了但**没有任何 fact 用**（= 没人管）：${unused.join(", ")} —— ` +
          `要么在 facts.json 里给它加一条带 anchors 的声明，要么从 truthSources 里删掉`);
      }
    }
    add(bad.length ? "FAIL" : "PASS", "facts-registry",
      `事实登记表自洽（${(FACTS.facts ?? []).length} 条声明 / ${Object.keys(truthValues).length} 个真值来源 / 自研名单 ${(FACTS.selfAuthoredSkills ?? []).length} 个）`,
      bad.join("\n        "));
  }

  // ② 按登记表核对文档声明（**每条声明锚定到 文件 + 行特征** —— V2 的结构性修法）
  //
  // 为什么必须锚定到行（2026-09-12 两批独立复审 + 我自己实测）：
  //   旧版是"一个正则 + 命中计数"。把 README 的「技能总览（36 个）」改成
  //   「技能总览：共 36 个」、再改成 35，检查器**全绿** —— 因为声明"从视野里消失"了。
  //   我加的补救（每条 fact 至少命中一次 + 按文件要求命中）**仍然没抓住**：
  //   同一个正则还在**同一文件第 192 行**（安装脚本注释「把 36 个技能打平安装」）命中，
  //   于是"这个文件里这条声明"看起来还在。这证明**计数救不了"某一句声明消失"**，
  //   只有把每条声明钉到具体的行上才行。
  {
    const bad = [];
    const extraNotice = [];   // 复用已登记数字的命中：**提示**，不算违规（见 ③ 的注释）
    let checked = 0;
    let anchorsResolved = 0;
    const registeredNouns = Object.keys(FACTS.registeredNumbers ?? {}).filter((k) => !k.startsWith("_"));
    for (const f of FACTS.facts ?? []) {
      // 正则：默认要求一个捕获组（数字）；noNumber 的声明只锚定"这一行还在不在"
      let re;
      try { re = new RegExp(f.claim, "g"); }
      catch (e) { bad.push(`[${f.id}] claim 不是合法正则：${e.message}`); continue; }
      if (!f.noNumber && !f.claim.includes("(")) {
        bad.push(`[${f.id}] claim 没有捕获组 —— 无法取出文档里写的数字（真的只想锚定行就显式写 noNumber: true）`);
        continue;
      }
      const truth = truthOf(f.truth);
      // 按文件分组：登记表说"这个文件的这些行上有这条声明"
      const byFile = new Map();
      for (const a of f.anchors ?? []) {
        if (!byFile.has(a.file)) byFile.set(a.file, []);
        byFile.get(a.file).push(a);
      }
      for (const [file, anchors] of byFile) {
        // 文件可以是**具体路径**（相对库根），也可以是 `:root:x.json` = 库根下某个文件。
        // 为什么要有这个扩展点（独立复审 B1）：`scripts/git-hooks/pre-commit` **没有扩展名**，
        // 于是它既不进 ALL_MD 也不进 ALL_CODE —— 钩子里的数字**一个检查器都看不见**。
        // 这轮我就往里写了个错的条数（34，真值 36），而且它每次提交都会打印给用户看。
        // 现在把它当成"普通文件"锚定：能锚就能核对，且锚点文件**自动获得扫描资格**。
        const fp = file.startsWith(":root:") ? join(ROOT, file.slice(6)) : join(ROOT, file);
        if (!existsSync(fp)) { bad.push(`[${f.id}] 登记表里的锚点文件不存在：${file}`); continue; }
        const lines = (await readUtf8(fp)).split(/\r?\n/);
        // 排除行（可选）：**测试输入**里会原样写着一条"文档声明"（比如变异用例要注入
        // 「技能总览（35 个）」）。那不是"文档里的声明"，而是"被检查的输入" ——
        // 不排除的话，检查器会被自己的测试用例骗到（实测：self-test.mjs 里那行 mutate 被当成
        // 第二处声明，于是正确文档被判 FAIL；**这是检查器在撒谎**，不是文档有问题）。
        // 排除项必须写清理由，并且**用变异后仍然稳定的子串**（不能用被那条变异改掉的那段文字）。
        const excluded = (f.excludeLines ?? []).filter((w) => lines.some((l) => l.includes(w)));
        for (const w of f.excludeLines ?? []) {
          if (!lines.some((l) => l.includes(w))) {
            bad.push(`[${f.id}] ${file} 的排除项「${w}」已经找不到任何行了 —— 排除清单过期了（测试改了？），请同步`);
          }
        }
        // 该文件里 claim 一共命中几次（与登记表逐项比对；排除行不算）
        const hitLines = [];
        for (const [i, line] of lines.entries()) {
          if (excluded.some((w) => line.includes(w))) continue;
          const hits = [...line.matchAll(re)];
          if (hits.length) hitLines.push({ i, line, hits });
        }
        // ① 每个锚点必须**恰好**解析到一行（0 行 = 句子被删/被改写；≥2 行 = witness 不够独特）
        const resolved = new Set();
        for (const a of anchors) {
          const found = [];
          for (const [i, line] of lines.entries()) if (line.includes(a.witness)) found.push(i);
          if (found.length !== 1) {
            bad.push(`[${f.id}] ${file} 的锚点「${a.witness}」解析到 ${found.length} 行` +
              (found.length === 0
                ? " —— **这句声明消失了**（被删了？被改写了？）要么补回声明，要么同步改 facts.json 的 anchors"
                : `（行 ${found.map((x) => x + 1).join("/")}）—— witness 不够独特，换一个更长的子串`));
            continue;
          }
          const i = found[0];
          resolved.add(i);
          anchorsResolved++;
          // ② 锚点这一行必须**自己**能被 claim 匹配到（否则句子还在、数字说法被换掉了）
          const ms = [...lines[i].matchAll(re)];
          if (ms.length === 0) {
            bad.push(`[${f.id}] ${file}:${i + 1} 锚点命中了这一行，但这行**匹配不上 claim 正则**` +
              `（措辞被改写成别的说法了）→ ${lines[i].trim().slice(0, 80)}`);
          }
        }
        // ③ 该文件里 claim 的命中数必须**恰好等于登记的锚点数**：
        //    多出来的命中 = **出现了一处没登记的声明**（旧版就是这么静默变绿的）。
        if (hitLines.length !== anchors.length) {
          const extra = hitLines.filter((h) => !resolved.has(h.i));
          // **误报摩擦的修法（M9(a) 的措辞与代码已对齐）**：一条新句子**复用已登记的数值**
          // （例如"先装 2 个技能试试"、或在别处再写一句「技能总览（36 个）」）**不算违规** ——
          // 那是正常行文/合法重复。一律报 FAIL 会逼人每写一句自然语言就去改登记表，
          // 那种闸门很快会被无视（独立复审实测的"误报摩擦"）。
          // 这里只拦**用的是没登记的数值**那种命中：那才是"一处没登记的声明"。
          // 注意边界：本项只保证"数字没有说谎"，不保证"这句话不该重复"。
          const unregistered = extra.filter((h) => h.hits.some((m) => {
            const n = canonNum(m[1]);
            return !Number.isNaN(n) && !(FACTS.registeredNumbers?.[f.noun] ?? []).includes(n);
          }));
          if (unregistered.length) {
            bad.push(`[${f.id}] ${file} 里 claim 命中 ${hitLines.length} 处，登记表只登记了 ${anchors.length} 行` +
              `；其中**用的是没登记的数值**：${unregistered.map((h) => `${h.i + 1} 行 → ${h.line.trim().slice(0, 60)}`).join(" / ")}` +
              " —— 要么登记这个数字，要么改成已登记的写法");
          } else if (extra.length) {
            extraNotice.push(`[${f.id}] ${file}:${extra.map((h) => h.i + 1).join("/")} 行复用了已登记的数字（不算违规）：${extra[0].line.trim().slice(0, 60)}`);
          }
        }
        // ④ 逐处核对数字
        for (const { i, line, hits } of hitLines) {
          // childTruthOf：这条声明的**真值来源就是它所在的文件**（self-test.mjs 的用例条数）。
          // 只核对"真值来源还在不在"，不去比行内数字——那一行的数字是**历史记录**（"加之前"）。
          if (f.childTruthOf && file === f.childTruthOf) {
            if (typeof truth !== "number" || truth <= 0) {
              bad.push(`[${f.id}] ${file} 的真值算出来是 ${truth} —— 真值来源已经失效（找不到用例条数），请同步 check-consistency 的推导`);
            } else if (selfTestTruthBroken) {
              bad.push(`[${f.id}] 真值来源已经失效：${selfTestTruthBroken}`);
            }
            continue;
          }
          for (const m of hits) {
            if (f.noNumber) continue;
            const raw = m[1];
            const n = canonNum(raw);
            claimChecked++;
            if (Number.isNaN(n)) {
              bad.push(`${file}:${i + 1} [${f.id}] 解析不出数字：「${raw}」（检查器的能力不足，不是文档的问题 —— 请补 canonNum）`);
            } else if (n !== truth) {
              bad.push(`${file}:${i + 1} [${f.id}] 写的是 ${raw}(${n})，登记真值 ${truth} → ${line.trim().slice(0, 80)}`);
            }
            if (f.noun && registeredNouns.length && !registeredNouns.includes(f.noun)) {
              bad.push(`[${f.id}] noun「${f.noun}」不在 registeredNumbers 里 —— 未登记数字的扫描会漏掉这个名词`);
            }
          }
        }
      }
      // ⑤ 反向：登记表压根没给这条声明登记锚点 → 它**没人管**
      if (byFile.size === 0) bad.push(`[${f.id}] 登记表没有为它登记任何 anchors —— 这条声明**没人管**`);
    }
    add(bad.length ? "FAIL" : "PASS", "registered-claims",
      `按登记表核对文档声明（核了 ${claimChecked} 处 / ${anchorsResolved} 个行锚点` +
      (extraNotice.length ? ` / ${extraNotice.length} 处复用已登记数字，不算违规` : "") + `）`,
      bad.join("\n        ") || (VERBOSE ? extraNotice.join("\n        ") : ""));
  }

  // ③ 没登记的体系数字 → 拦下（"新增数字必须登记"的机制）
  //
  // **V3（独立复审）**：旧版只认 `\d+`，于是对**中文数字 / 全角数字零防护**——
  // 在入口文档里写「九十九个检查器」「１５个脚本」实测**全绿**。
  // 现在三种写法都先规范化再按同一张表核对。
  {
    const registered = FACTS.registeredNumbers ?? {};
    const nouns = Object.keys(registered).filter((k) => !k.startsWith("_"));
    // **叙述性小数字（M6 修法，独立复审抓到我引入的新漏报）**：
    // 上一版我写的是"小于阈值的数字一律放行"，复审实测：`本库有 8 个技能。` 从 **红变绿** ——
    // 我为了消摩擦，把 4~9 这类误写也放行了，那是**新引入的漏报**（旧代码会红）。
    // 现在改成**显式的叙述性集合**（0/1/2/3：'先装 2 个技能试试'、'0 个致命问题'、'三条铁律'），
    // 4 以上一律要求登记 —— 摩擦消掉，漏报不回来。
    const NARRATIVE = new Set([0, 1, 2, 3]);
    const smallSkippedList = [];
    const bad = [];
    let scanned = 0;
    let skippedHistory = 0;
    const NUM = "\\d+|[〇零一二三四五六七八九十]+";
    const words = nouns.join("|");
    // 全角数字归一化后再匹配：`１５个脚本` 的"１５"要先变成"15"
    const fold = (line) => line.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    const re = new RegExp(`(${NUM})\\s*(${words})`, "g");
    for (const p of ALL_MD) {
      // **记录类文档不查**：docs/reviews/ 是"当时发生了什么"的快照，
      // 里面写"13 个脚本"是正确的历史记录，不是需要修正的当前事实。
      // 拿当前真值去核对历史记录，只会逼人改写历史。
      if (rel(p).startsWith("docs/reviews/")) { skippedHistory++; continue; }
      for (const [i, line] of fold(await readUtf8(p)).split(/\r?\n/).entries()) {
        for (const m of line.matchAll(re)) {
          scanned++;
          const noun = m[2];
          const n = canonNum(m[1]);
          if (Number.isNaN(n)) {
            bad.push(`${rel(p)}:${i + 1} 「${m[1]} ${noun}」解析不出数字 —— 检查器能力不足，请补 canonNum`);
            continue;
          }
          if (!(registered[noun] ?? []).includes(n)) {
            // 叙述性集合里的数字放行，但**逐条记账**（复审 M6：别只给一个计数，
            // 那样复查的人看不到"到底放行了哪几处"）。4 以上一律要求登记。
            if (NARRATIVE.has(n)) { smallSkippedList.push(`${rel(p)}:${i + 1} 「${m[1]} ${noun}」`); continue; }
            bad.push(`${rel(p)}:${i + 1} 「${m[1]} ${noun}」= ${n}，没在 facts.json 登记 → ${line.trim().slice(0, 76)}`);
          }
        }
      }
    }
    // 反向：登记的名词必须**真的被某条声明用**，否则"登记了但没人扫"也是假的安心
    {
      const usedNouns = new Set((FACTS.facts ?? []).map((f) => f.noun).filter(Boolean));
      const orphan = nouns.filter((k) => !usedNouns.has(k));
      if (orphan.length) bad.push(`registeredNumbers 里有名词没有任何 fact 使用：${orphan.join(", ")}`);
    }
    add(bad.length ? "FAIL" : "PASS", "unregistered-facts",
      `体系数字都已登记（扫了 ${scanned} 处「数字+名词」，跳过 ${skippedHistory} 份记录类文档` +
      (smallSkippedList.length ? `；${smallSkippedList.length} 处叙述性数字 0–3 放行：${smallSkippedList.join(" / ")}` : "") + `）`,
      bad.join("\n        "));
  }

  // ④ 检查器**自己**的完整性（V4 的另一半：登记表不只是"登没登"，还要"对不对"）
  //    判据来自同一份真值来源，所以模块改坏了这里立刻红 —— 不需要另抄一份期望值。
  {
    const bad = [];
    if (truthValues["checks.qualityGateDefault"] >= truthValues["checks.qualityGateTotal"]) {
      bad.push(`默认项数 ${truthValues["checks.qualityGateDefault"]} 不小于总项数 ${truthValues["checks.qualityGateTotal"]} —— quality-gate 的 Add-Result id 重复了？`);
    }
    if ((FACTS.facts ?? []).length === 0) bad.push("登记表里一条声明都没有");
    if ((FACTS.facts ?? []).some((f) => !(f.anchors ?? []).length)) {
      bad.push(`有声明没有 anchors：${(FACTS.facts ?? []).filter((f) => !(f.anchors ?? []).length).map((f) => f.id).join(", ")}`);
    }
    add(bad.length ? "FAIL" : "PASS", "facts-integrity",
      `登记表本身就是一份完整的判据（${(FACTS.facts ?? []).length} 条声明全部有行锚点；默认 ${truthValues["checks.qualityGateDefault"]} < 总 ${truthValues["checks.qualityGateTotal"]}）`,
      bad.join("\n        "));
  }
}

// ── README 是否覆盖了全部技能（集合相等，不是数数）────────────────────────
// 为什么用集合而不是计数：README 按"自研 / 其余"分组列技能，**新增或删掉一个技能时
// 最容易漏改这里**——那时 README 会静默少列一个技能，而计数恰好还能对上。
// 判据：README 里出现的 SKILL.md 链接目标集合，必须等于真实技能目录集合。
{
  const readme = await readUtf8(join(ROOT, "README.md"));
  const linked = new Set();
  for (const m of readme.matchAll(/\]\(\.?\/*((?:engineering|productivity)\/([^/)\s]+)\/SKILL\.md)\)/g)) linked.add(`${m[1].split("/")[0]}/${m[2]}`);
  const real = new Set(skillNames.map((n) => `${byGroup.engineering.includes(n) ? "engineering" : "productivity"}/${n}`));
  const notInReadme = [...real].filter((s) => !linked.has(s)).sort();
  const ghost = [...linked].filter((s) => !real.has(s)).sort();
  const bad = [
    ...notInReadme.map((s) => `技能存在但 README 没列：${s}`),
    ...ghost.map((s) => `README 列了但技能不存在：${s}`),
  ];
  add(bad.length ? "FAIL" : "PASS", "readme-coverage",
    `README 覆盖全部 ${real.size} 个技能（列出 ${linked.size} 个）`, bad.join("\n        "));
}

// ── 脚本清单：文档表格 ⇄ 真实文件（双向） ──────────────────────────────────
{
  const here = await readUtf8(join(ROOT, "从这里开始.md"));
  // 表格行形如：| `install-skills.ps1` | ... |   —— 只认"纯文件名"，避免把说明性代码当清单项
  const listed = [...here.matchAll(/^\|\s*`([\w.\-]+\.(?:ps1|mjs|json|yml|yaml))`\s*\|/gm)].map((m) => m[1]);
  const missingFromDoc = INVENTORY.filter((f) => !listed.some((l) => f === l || f.endsWith(`/${l}`)));
  const ghostInDoc = listed.filter((l) => !INVENTORY.some((f) => f === l || f.endsWith(`/${l}`)));
  const bad = [
    ...missingFromDoc.map((f) => `脚本存在但入口文档没列：${f}`),
    ...ghostInDoc.map((l) => `入口文档列了但文件不存在：${l}`),
  ];
  add(bad.length ? "FAIL" : "PASS", "script-inventory",
    `脚本清单双向一致（${INVENTORY.length} 个：${INVENTORY.join(", ")}）`, bad.join("\n        "));
}

// ── 入口文档里"十X个脚本"的中文数字 ───────────────────────────────────────
{
  const here = await readUtf8(join(ROOT, "从这里开始.md"));
  const bad = [];
  let found = 0;
  // 中文数字解析：原来只到"十五"，写完"十六个脚本"就解析不出来，报"无法解析"——
  // **把检查器能力不足说成了文档的问题**。改成通用解析（十/十六/二十六/二十）。
  const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const cn2num = (s) => {
    if (s === "十") return 10;
    const i = s.indexOf("十");
    if (i === 0) return 10 + (CN[s[1]] ?? 0);
    if (i === s.length - 1) return CN[s[0]] * 10;
    if (i > 0) return CN[s[0]] * 10 + (CN[s[i + 1]] ?? 0);
    return CN[s] ?? NaN;
  };
  for (const m of here.matchAll(/^#{2,3}\s*[一二三四五六七八九十]+、\s*([一二三四五六七八九十]+)个脚本/gm)) {
    found++;
    const n = cn2num(m[1]);
    if (n !== INVENTORY.length) bad.push(`标题写「${m[1]}个脚本」(${n ?? "无法解析"})，真值 ${INVENTORY.length}`);
  }
  if (found === 0) bad.push("没找到「N 个脚本」标题 —— 标题被改写了，检查器已失效，请同步规则");
  add(bad.length ? "FAIL" : "PASS", "script-count-cn", `入口文档的脚本总数 = ${INVENTORY.length}`, bad.join("; "));
}

// ── 给 agent 读的文件里**不许写死本机绝对路径** ─────────────────────────────
// 为什么（2026-09-13，独立复审第 ③ 条）：技能正文里写着形如 `D:\<某工作区>\<库名>\…` 的绝对路径 ——
// **换台机器直接失效**，而这跟本库"别写死数字"的纪律是同一回事（写死 = 假定环境 = 迟早腐烂）。
// 体系自己在别处一直用 `<库根>` 占位，所以这里破的是自家惯例。
//
// 为什么要有这道判据（而不是"我改一次就好了"）：**实测就是会长回来** ——
// 我修完一轮后复扫，又冒出 3 处小写 `d:/` 版（第一次替换大小写敏感，漏了）。
//
// 白名单（有正当理由写绝对路径的地方）：
//   · `DSH-INTEGRATION.md`：它的职责就是**描述本机现状**（"你现在的技能装在这里"），
//     写真实路径是对的 —— 改 <库根> 反而看不懂。
//   · `docs/reviews/`：历史快照，**不许改写历史**（同 unregistered-facts 的处理）。
{
  const ALLOW = new Set(["DSH-INTEGRATION.md"]);
  const ABS = /[A-Za-z]:[\\/](?:AIworkspace|Users\\A|Users\/A)(?:[\\/]|$)/;
  const hits = [];
  let scanned = 0;
  for (const p of ALL_CODE) {
    const r = rel(p);
    if (r.startsWith("docs/reviews/") || ALLOW.has(r)) continue;
    scanned++;
    // ⚠️ **先剥注释再扫**：本文件的注释里就写着那个示例路径（"技能正文里写着
    // `D:\<某工作区>\…`"）—— 不剥的话**判据会咬自己的说明**（实测：基线直接红）。
    // 这个坑今天已经在别处踩过（`state.ps1` 注释里的 `$st.version`），所以这里直接写明。
    const codeOnly = (await readUtf8(p)).split(/\r?\n/).map((l) => {
      const hash = l.replace(/(^|\s)#.*$/, "");
      return hash.replace(/(^|\s)\/\/.*$/, "");
    });
    for (const [i, line] of codeOnly.entries()) {
      if (ABS.test(line)) hits.push(`${r}:${i + 1} → ${line.trim().slice(0, 76)}`);
    }
  }
  add(hits.length ? "FAIL" : "PASS", "no-hardcoded-paths",
    `给 agent 读的文件里没有写死的本机路径（扫了 ${scanned} 个文件；DSH-INTEGRATION.md 与 docs/reviews 按理由豁免）`,
    hits.join("\n        "));
}

// ── markdown 链接可解析 ───────────────────────────────────────────────────
{
  const mdFiles = ALL_MD;
  // 代码块里的链接是**示例**（模板、目录树、示例 CONTEXT-MAP），不是这个仓库里的文件。
  // 不剥掉围栏就会把示例当断链报——那是检查器在撒谎，不是文档有问题。
  const stripFences = (text) => {
    let inFence = false;
    return text.split(/\r?\n/).map((line) => {
      if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return ""; }
      if (inFence) return "";
      return line.replace(/`[^`]*`/g, "``");   // 行内代码里的路径同理，是示例
    });
  };

  const broken = [];
  let links = 0;
  const SKIP_TARGET = /^(https?:|mailto:|#|tel:)/i;
  for (const f of mdFiles) {
    const text = await readUtf8(f);
    for (const [i, line] of stripFences(text).entries()) {
      for (const m of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
        let target = m[1].replace(/^<|>$/g, "").split("#")[0];
        if (!target || SKIP_TARGET.test(target)) continue;
        links++;
        const abs = resolve(dirname(f), decodeURIComponent(target));
        if (!existsSync(abs)) broken.push(`${rel(f)}:${i + 1} → ${target}`);
      }
    }
  }
  add(broken.length ? "FAIL" : "PASS", "md-links", `markdown 链接可解析（${links} 条）`, broken.join("\n        "));
}

// ── 旧名 / 已废弃写法残留 ─────────────────────────────────────────────────
{
  // allow：**有正当理由要写出旧名的文件**（比如致谢文档要说明"由原名 X 改名而来"）。
  // 加白名单必须写清理由——白名单不是"让它过"，是"这里写旧名是对的"。
  const FORBIDDEN = [
    { re: /skills-1\.2\.3-zh/g, why: "旧文件夹名（已改名为 ai-eng-system）", allow: [] },
    { re: /setup-matt-pocock-skills/g, why: "旧技能名（已改名为 setup-workspace-discipline）",
      allow: ["THIRD-PARTY-NOTICES.md"] },   // 理由：该文件必须写明"由原名改名而来"，属正当引用
    { re: /安装到DSH\.md/g, why: "旧文档名（已改名为 DSH-INTEGRATION.md）", allow: [] },
  ];
  const hits = [];
  // 元文件白名单：这些文件的**职责就是写出这些禁止字符串**（一个是规则本身，一个是把旧名当测试输入）。
  // 白名单只有这两个，且理由写在注释里 —— 不是"让它过"，是"这里写旧名是对的"。
  const META = new Set(["scripts/check-consistency.mjs", "scripts/self-test.mjs"]);
  for (const p of ALL_CODE) {
    const text = await readUtf8(p).catch(() => "");
    for (const f of FORBIDDEN) {
      if (f.allow.includes(rel(p)) || META.has(rel(p))) continue;
      const n = [...text.matchAll(f.re)].length;
      if (n > 0) hits.push(`${rel(p)}：${f.why} × ${n}`);
    }
  }
  add(hits.length ? "FAIL" : "PASS", "no-legacy-names", "无旧名残留", hits.join("\n        "));
}

// ── 命令可执行性（文档里的命令必须真的能跑） ────────────────────────────────
// 实测抓到过两处"整库命令全跑不起来"的问题（2026-09-12）：
//   · 本机没装 PowerShell 7，但所有文档都写 `pwsh -File ...` → 命令不存在
//   · 执行策略是 Restricted，`powershell -File x.ps1` 被直接拒绝 → 必须带 -ExecutionPolicy Bypass
// CI 的 .yml 不算在内（GitHub runner 上装了 pwsh）。
{
  const bad = [];
  const SELF = "scripts/check-consistency.mjs";
  let scanned = 0;
  let filesScanned = 0;
  // 受检范围 = **会被照抄的命令行**：
  //   · ```powershell / ```ps1 代码块里的行
  //   · 行首或缩进处的 `powershell …` / `pwsh …`（.ps1 的 .EXAMPLE 注释块就是这种）
  // 刻意**不查** markdown 表格行——README/入口文档里那些 `pwsh -File x.ps1` ❌ 是**反例对照**，
  // 是正确内容。（曾经误报过，所以这里写清楚为什么不管。）
  const FENCE = /^\s*(```|~~~)\s*(powershell|ps1|pwsh)?/i;
  for (const p of [...ALL_MD, ...ALL_CODE.filter((f) => /\.ps1$/i.test(f))]) {
    if (rel(p) === SELF) continue;
    const text = await readUtf8(p).catch(() => "");
    let inFence = false;
    filesScanned++;
    for (const [i, line] of text.split(/\r?\n/).entries()) {
      const fm = line.match(FENCE);
      if (fm) {
        if (fm[2]) inFence = !inFence;                       // 带语言名的围栏
        else inFence = false;                                 // 无语言名的围栏（示例文本）不作为命令来源
        continue;
      }
      const isCmdLine = inFence || /^\s*(powershell|pwsh)\b/.test(line);
      if (!isCmdLine) continue;
      if (/^\s*#!/.test(line)) continue;                      // shebang 是给 Linux/macOS 的
      scanned++;
      if (/(^|[\s`(])pwsh\s+(-File\b|\.\/)/.test(line)) {
        bad.push(`${rel(p)}:${i + 1} 用了 pwsh（本机未安装）→ 改写为 powershell -NoProfile -ExecutionPolicy Bypass -File …`);
      }
      if (/\bpowershell(\.exe)?\b[^\n]*\s-File\b/.test(line) && !/-ExecutionPolicy\s+Bypass/i.test(line)) {
        bad.push(`${rel(p)}:${i + 1} 少了 -ExecutionPolicy Bypass（Restricted 策略下会被拒）`);
      }
    }
  }
  if (scanned === 0) bad.push("一行都没扫到 —— 规则失效了，请同步检查器");
  add(bad.length ? "FAIL" : "PASS", "runnable-commands",
    `文档里的 PowerShell 命令在本机可跑（扫了 ${filesScanned} 个文件 / ${scanned} 行命令）`, bad.join("\n        "));
}

// ── 时间戳式"没有机器来源的数字"（策略检查） ───────────────────────────────
{
  const suspicious = [];
  const PATTERNS = [
    { re: /共\s*(\d+)\s*项/g, why: "「共 N 项」没有机器来源" },
    { re: /共\s*(\d+)\s*条/g, why: "「共 N 条」没有机器来源" },
  ];
  // 覆盖到技能正文：技能正文里的计数同样会腐烂（实测抓到 production-readiness 的「A–G 共 44 项」，
  // 而那份清单实际有 80 个勾选框）。
  const allMd = ALL_MD;
  for (const p of allMd) {
    if (rel(p) === "速查卡.md") continue;   // 速查卡由 extract-cheatsheets.mjs 从正文抽取，正文改了就同步
    const text = await readUtf8(p);
    for (const [i, line] of text.split(/\r?\n/).entries()) {
      for (const pat of PATTERNS) {
        if (pat.re.test(line)) suspicious.push(`${rel(p)}:${i + 1} ${pat.why} → ${line.trim().slice(0, 80)}`);
        pat.re.lastIndex = 0;
      }
    }
  }
  add(suspicious.length ? "FAIL" : "PASS", "no-unmaintained-numbers",
    "没有「没人维护的精确计数」", suspicious.join("\n        "));
}

// ── 源 ↔ 已安装副本（需要 --installed，否则诚实报 SKIP） ────────────────────
if (!INSTALLED) {
  add("SKIP", "installed-drift", "源 ↔ 已安装副本一致性",
    "未提供 --installed <技能根>；此项未检查（覆盖不完整）");
} else {
  const drift = [];
  for (const g of GROUPS) {
    for (const name of byGroup[g.key]) {
      const src = join(ROOT, g.key, name, "SKILL.md");
      const dst = join(INSTALLED, name, "SKILL.md");
      if (!existsSync(dst)) { drift.push(`技能根缺 ${name}/SKILL.md`); continue; }
      const [a, b] = [await readUtf8(src), await readUtf8(dst)];
      if (a !== b) drift.push(`${name}/SKILL.md 与源不一致（源 ${a.length} 字符 / 装后 ${b.length} 字符）→ 跑 install-skills.ps1`);
    }
    // 反向：技能根里多出来的目录不算错（别的来源），但库里的技能必须在
  }
  add(drift.length ? "FAIL" : "PASS", "installed-drift",
    `源 ↔ 已安装副本一致（${TOTAL_SKILLS} 个技能）`, drift.join("\n        "));
}

// ── 输出 ─────────────────────────────────────────────────────────────────
const icon = { PASS: "[PASS]", FAIL: "[FAIL]", SKIP: "[SKIP]" };
console.log(`=== 内容一致性检查（库根：${ROOT}）===`);
for (const r of results) {
  console.log(`  ${icon[r.status]} ${r.id}  ${r.title}`);
  if (r.note && (r.status !== "PASS" || VERBOSE)) console.log(`        ${r.note}`);
}
const fail = results.filter((r) => r.status === "FAIL").length;
const skip = results.filter((r) => r.status === "SKIP").length;
console.log("");
console.log(`合计 ${results.length} 项 | FAIL ${fail} | SKIP ${skip} | 文档声明核对 ${claimChecked} 处`);
if (fail > 0) console.log("判定: 有矛盾 —— 上面的每一行都要处理（改文档或改真值来源）");
else if (skip > 0) console.log("判定: 通过（有 SKIP，覆盖不完整）");
else console.log("判定: 通过");
process.exit(fail > 0 ? 1 : 0);
