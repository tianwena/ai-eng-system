// 把 10 个自研技能末尾的「附：一页速查」抽出来，汇总成单独的速查卡文档；
// 原始 SKILL.md 里删除该段（正文已含同样信息）。
//
// 用法:
//   node extract-cheatsheets.mjs            # 预演（列出将要抽取的内容）
//   node extract-cheatsheets.mjs --write    # 执行抽取
//   node extract-cheatsheets.mjs --check    # 漂移检测：速查卡是否落后于技能正文（CI 可用）
//
// 关于 --check（为什么需要它）：
//   速查卡是**手工/一次性抽取**的产物，与技能正文之间没有自动同步。
//   一旦正文改了修正，速查卡里的旧说法就会留下——**并且没有任何工具会告诉你**。
//   本检查把技能里带警告/修正语气的行（"别把…""不是…""⚠️"）当作"热点"，
//   再确认这些关键短语在速查卡里仍然对得上；对不上就报漂移。
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── 路径**一律相对本脚本**，不许写死机器路径 ────────────────────────────────
// **为什么必须这样（2026-09-13 CI 首次运行实测红）**：
//   原来这里是 `const REF = "…"` —— 写死的是**我本机上库的绝对路径**（`D:\…\ai-eng-system`）。
//   本机跑 `verify-all` 永远是绿的（那个目录真的存在），**而 CI 里 checkout 在
//   `D:\\a\\ai-eng-system\\ai-eng-system`** ⇒ `--check` 读不到速查卡 ⇒
//   打 `[FAIL] 速查卡.md 不存在` —— 而仓库里 `速查卡.md` 明明在、也被 git 跟踪。
//   ⚠️ 更坏的是它**骗过了 `verify-clean-clone.mjs`**：那个脚本专门在"干净克隆"里跑
//   verify-all，本该抓住这类"脚本偷偷读本机"的问题，但脚本读的是写死的本机路径 ⇒
//   克隆在临时目录里也一样"通过"。**判据指向了克隆之外的地方，克隆再干净也证明不了什么。**
//   教训（写给以后）：只要一个脚本要跨机器跑，它的输入就只能是"它自己的位置 + 参数 + 环境"。
const HERE = dirname(fileURLToPath(import.meta.url));
// 覆盖方式沿用库内既有约定：`--ref`（同 verify-clean-clone.mjs）/ `--installed`（同 verify-all.mjs）。
// ⚠️ **不要**自造 `DSH_*` 名字：那是宿主（DSH）自己的命名空间（`DSH_HOME`/`DSH_SESSION_ID`… 都是它管的），
//    撞上去就是"某天宿主定义了一个同名变量、脚本行为悄悄变了"这类看不见的耦合。
const getArg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const REF = resolve(getArg("--ref") ?? join(HERE, ".."));
const ENG = join(REF, "engineering");
// 已安装技能根：**只有 `--write` 的"同步回技能根"用到它**，没给就跳过（不再猜机器路径）。
const ROOT = getArg("--installed") ?? (process.env.DSH_HOME ? join(process.env.DSH_HOME, "skills") : null);
const MODE = process.argv.includes("--write") ? "write"
  : process.argv.includes("--check") ? "check"
  : "dry";

// ── --check：漂移检测 ─────────────────────────────────────────────────────
if (MODE === "check") {
  const cheatsheetPath = join(REF, "速查卡.md");
  let sheet;
  try { sheet = await readFile(cheatsheetPath, "utf8"); }
  catch (e) {
    // ⚠️ 报错必须**点名它在找哪个文件**：CI 首跑时这里只打"速查卡.md 不存在"，
    //    而仓库里那个文件明明在、也被跟踪 —— 一句话把排查带到了错方向（差点去查
    //    .gitattributes/checkout）。带上路径，这类"脚本读错了地方"当场就能看出来。
    console.log(`[FAIL] 速查卡.md 不存在（找的是：${cheatsheetPath}） ${e.code ?? e.message}`);
    process.exit(1);
  }

  // 技能正文里"带修正/警告语气"的关键短语 —— 这些最可能在速查卡里留下旧版本
  const HOT = [
    { file: "tech-selection", phrase: "稳定性证据", stale: ["≥5年", "至少 5 年持续维护"] },
    { file: "growth-and-analytics", phrase: "退化的起点", stale: ["最后动作"] },
    { file: "growth-and-analytics", phrase: "验证性指标", stale: [] },
    { file: "payment-and-billing", phrase: "last-writer-wins", stale: [] },
    { file: "payment-and-billing", phrase: "纯百分比", stale: [] },
    { file: "pricing-and-monetization", phrase: "主力档", stale: ["把 80% 的人引到"] },
    { file: "launch-and-ops", phrase: "只对**代码**成立", stale: [] },
    { file: "fullstack-delivery", phrase: "不是\"串行\"", stale: [] },
  ];

  let drift = 0;
  console.log("=== 速查卡漂移检测 ===");
  for (const h of HOT) {
    // 正文是否还有这个（已修正的）短语
    const body = await readFile(join(ENG, h.file, "SKILL.md"), "utf8");
    const bodyHas = body.includes(h.phrase.replaceAll("**", ""));
    // 速查卡里的旧说法是否**真的还在被当结论用**
    // （修正后的正文常写成 "…（不是最后动作）" 这种否定用法——那不是漂移，别误报。
    //   工具误报会让人不再信它，所以这里做否定语境识别。）
    const NEGATIONS = ["不是", "别", "不要", "非", "避免", "禁止", "❌"];
    const usedAsClaim = (text, phrase) => {
      let idx = text.indexOf(phrase);
      while (idx >= 0) {
        const win = text.slice(Math.max(0, idx - 12), idx + phrase.length + 6);
        if (!NEGATIONS.some((n) => win.includes(n))) return true;
        idx = text.indexOf(phrase, idx + phrase.length);
      }
      return false;
    };
    const staleHits = h.stale.filter((s) => usedAsClaim(sheet, s));
    if (staleHits.length > 0) {
      console.log(`  [漂移] ${h.file}: 速查卡仍把旧说法当结论用 → ${staleHits.map((s) => `"${s}"`).join(", ")}`);
      drift++;
    } else if (bodyHas) {
      console.log(`  [OK]   ${h.file}: "${h.phrase}" 已同步`);
    }
  }
  console.log(drift === 0 ? "\n判定: 速查卡与正文一致" : `\n判定: 发现 ${drift} 处漂移 —— 请手工同步速查卡.md`);
  process.exit(drift === 0 ? 0 : 1);
}


const skills = (await readdir(ENG, { withFileTypes: true }))
  .filter((d) => d.isDirectory()).map((d) => d.name).sort();

const sections = [];
const report = [];
const syncFailed = [];
let syncSkipped = false;

for (const name of skills) {
  const p = join(ENG, name, "SKILL.md");
  let raw;
  try { raw = await readFile(p, "utf8"); } catch { continue; }
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.split(/\r?\n/);

  // 找末尾的「附：一页速查」标题（可能是 ## 或 #）
  let idx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^#{1,3}\s*附[：:]\s*一页速查/.test(lines[i])) { idx = i; break; }
  }
  if (idx < 0) continue;

  const body = lines.slice(idx + 1);
  // 去掉纯空行收尾
  while (body.length && body[body.length - 1].trim() === "") body.pop();
  sections.push({ name, body });
  const removed = lines.length - idx;

  if (MODE === "write") {
    // 去掉尾随空行后写回
    const kept = lines.slice(0, idx);
    while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
    const out = kept.join(eol) + eol;
    await writeFile(p, out, "utf8");
    // 同步到已安装技能根：**只有设了 DSH_SKILLS_ROOT 才做**。
    // 没设时**明说跳过**（旧版是 `catch { }` —— 写失败也一声不吭，"静默跳过"正是本库
    // 反复在修的毛病：没发生的事必须说出来）。
    if (ROOT) {
      try { await writeFile(join(ROOT, name, "SKILL.md"), out, "utf8"); }
      catch (e) { syncFailed.push(`${name}: ${e.code ?? e.message}`); }
    } else { syncSkipped = true; }
  }
  report.push(`  ${MODE === "write" ? "[已抽取]" : "[待抽取]"} ${name.padEnd(24)} 移除 ${removed} 行，保留速查 ${body.length} 行`);
}

// 组装速查卡文档
const out = [];
out.push("# 速查卡");
out.push("");
out.push("> 本文件是各技能的**压缩速查**，由 `scripts/extract-cheatsheets.mjs` 从技能正文末尾抽出。");
out.push("> ");
out.push("> **为什么单独放这里**：速查对**人**有用，但对**已读正文的 agent** 是重复内容。");
out.push("> 放在文档层可以同时满足两边——agent 加载的 `SKILL.md` 变精简，速查仍然随手可查。");
out.push("> ");
out.push("> 收录速查的技能：" + sections.map((s) => "`" + s.name + "`").join("、"));
out.push("");
out.push("---");
out.push("");
for (const s of sections) {
  out.push(`## ${s.name}`);
  out.push("");
  out.push(...s.body);
  out.push("");
  out.push("---");
  out.push("");
}
// 去掉最后一个多余分隔线
while (out.length && (out[out.length - 1] === "---" || out[out.length - 1] === "")) out.pop();
out.push("");

const doc = out.join("\n");
if (MODE === "write") await writeFile(join(REF, "速查卡.md"), doc, "utf8");

console.log(report.join("\n"));
console.log("");
console.log(`合计 ${sections.length} 个技能，速查卡文档 ${doc.split("\n").length} 行`);
if (MODE === "write") {
  // 同步结果**必须报出来**（成功/跳过/失败三档，不一锅端成"已写入"）
  if (syncFailed.length > 0) console.log(`⚠️  已写入本库，但同步到技能根失败 ${syncFailed.length} 个：${syncFailed.join("；")}`);
  else if (syncSkipped) console.log("（未设置 DSH_SKILLS_ROOT —— **跳过**同步到已安装技能根，本库内的文件已更新）");
  else console.log(">>> 已写入（SKILL.md 已精简 + 速查卡.md 已生成 + 已同步到技能根）");
} else {
  console.log(">>> 预演模式（加 --write 才写入）");
}
