// 硬结构校验器 —— 检查 CONTEXT.md 是否包含"三张图 + 接口契约"，并验证图的**内容**是否成立。
//
// 为什么要有它：自然语言的聊天记录无法被机器验证。把意图固化成可检查的结构之后，
// "没对齐就不许开工"才从愿望变成**闸门**。
//
// 用法:
//   node verify-structure.mjs -Project <项目根>            # 默认检查 <项目根>/CONTEXT.md
//   node verify-structure.mjs -Project . -File docs/CONTEXT.md
//   node verify-structure.mjs -Project . -Quiet            # 只出退出码
//
// 退出码: 0 = 结构齐备，可以进 Builder；1 = 不齐备，**不许开工**
//
// 检查项（按"能不能真的挡住问题"排序）：
//   1. CONTEXT.md 存在
//   2. 有 erDiagram 块                      —— 实体关系图
//   3. 有 stateDiagram-v2 块                —— 状态流转图
//   4. 有接口契约段（端点 + 请求/响应/错误） —— 接口契约
//   5. 【内容】ER 图里的实体不是孤岛（至少被一条关系连到）
//   6. 【内容】状态图里的每个状态都有出口（没有意外的死状态）
//   7. 【内容】契约段里每个端点都写了错误处理
//   8. 有"范围边界"（明确写出不做什么）
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const getArg = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const projectRoot = resolve(getArg("-Project") ?? ".");
const relFile = getArg("-File") ?? "CONTEXT.md";
const quiet = argv.includes("-Quiet");
const file = join(projectRoot, relFile);

const problems = [];
const warnings = [];
const infos = [];
const say = (s) => { if (!quiet) console.log(s); };

// ── 读文件 ────────────────────────────────────────────────────────────────
let md;
try {
  md = await readFile(file, "utf8");
} catch {
  console.log(`[FAIL] 找不到 ${relFile}`);
  console.log(`\n硬结构校验未通过：${relFile} 不存在 → **不许进入 Builder 阶段**`);
  console.log(`模板见 ai-eng-system/engineering/multi-agent-squad/CONTEXT-TEMPLATE.md`);
  process.exit(1);
}
infos.push(`${relFile} 存在（${md.length} 字符）`);

// ── 提取 mermaid 块 ───────────────────────────────────────────────────────
const mermaidBlocks = [];
{
  const re = /```mermaid\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(md)) !== null) mermaidBlocks.push(m[1]);
}
const erBlocks = mermaidBlocks.filter((b) => /^\s*erDiagram/m.test(b));
const stateBlocks = mermaidBlocks.filter((b) => /^\s*stateDiagram(-v2)?/m.test(b));

// ── 2. 实体关系图 ─────────────────────────────────────────────────────────
if (erBlocks.length === 0) {
  problems.push("缺**实体关系图**：需要一个 ```mermaid erDiagram 块");
} else {
  const er = erBlocks[0];
  const relLines = er.split("\n").filter((l) => /(--|\|\||\}\||\}\o|o\{|\|\{)/.test(l) && !/^\s*(erDiagram|class|state)/.test(l));
  // 关系里的实体名
  const inRel = new Set();
  for (const l of relLines) {
    const mm = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s+[|}o][|\-o{]*\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (mm) { inRel.add(mm[1]); inRel.add(mm[2]); }
  }
  // 块定义里的实体名（ENTITY { ... }）
  const declared = new Set();
  {
    const re = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\{/gm;
    let m;
    while ((m = re.exec(er)) !== null) declared.add(m[1]);
  }
  infos.push(`ER 图：${inRel.size} 个实体出现在关系里，${declared.size} 个有字段定义`);
  if (inRel.size === 0) {
    problems.push("ER 图里**没有任何关系边**——只有实体=还没想清它们怎么连");
  } else {
    const isolated = [...declared].filter((d) => !inRel.has(d));
    if (isolated.length > 0) {
      problems.push(`ER 图里有**孤岛实体**（没有任何关系连到）：${isolated.join(", ")}——孤岛实体通常说明它属于谁还没想清`);
    }
  }
  const plural = [...inRel].filter((e) => e.endsWith("S") && e.length > 2);
  if (plural.length > 0) warnings.push(`ER 实体名建议用单数：${plural.join(", ")}`);
}

// ── 3. 状态流转图 ─────────────────────────────────────────────────────────
if (stateBlocks.length === 0) {
  problems.push("缺**状态流转图**：需要一个 ```mermaid stateDiagram-v2 块");
} else {
  const sd = stateBlocks[0];
  const lines = sd.split("\n").map((l) => l.trim()).filter(Boolean);
  const isTerminal = (s) => s === "[*]";
  const states = new Set();
  const hasExit = new Set();
  let edgeCount = 0;

  for (const l of lines) {
    if (/^(stateDiagram|stateDiagram-v2|direction|state\s)/.test(l)) continue;
    const m = l.match(/^(\[\*\]|[^\s:]+)\s*-->\s*(\[\*\]|[^\s:]+)\s*(?::\s*(.*))?$/);
    if (!m) continue;
    const [, from, to, label] = m;
    edgeCount++;
    if (!isTerminal(from)) { states.add(from); hasExit.add(from); }
    if (!isTerminal(to)) states.add(to);
    if (!label || !label.trim()) {
      // 终止迁移（→ [*]）是"结束"，不需要触发条件；只对状态之间的迁移要求标签。
      if (!isTerminal(to)) {
        warnings.push(`状态迁移「${from} → ${to}」没写触发条件（什么事件导致这次迁移？）`);
      }
    }
  }

  if (edgeCount === 0) {
    problems.push("状态图里**没有任何迁移**——那不是一个状态机");
  } else {
    const dead = [...states].filter((s) => !isTerminal(s) && !hasExit.has(s));
    if (dead.length > 0) {
      problems.push(`状态图里有**死状态**（进了出不来，且不是终态）：${dead.join(", ")}——这会在代码里变成卡死的对象`);
    }
    infos.push(`状态图：${states.size} 个状态，${edgeCount} 条迁移`);
  }
}

// ── 4/7. 接口契约 ─────────────────────────────────────────────────────────
{
  // 取"接口契约"标题所在的段：从该标题行到**下一个同级或更高级**标题为止。
  // （早先按 ^#{1,3} 截断是错的——那会在第一个 ### 子标题处就断掉，导致幂等/权限检查全失效。）
  const lines = md.split(/\r?\n/);
  let start = -1, level = 0;
  for (let i = 0; i < lines.length; i++) {
    const h = /^(#{1,6})\s*(.*)$/.exec(lines[i]);
    if (h && /接口契约/.test(h[2])) { start = i; level = h[1].length; break; }
  }
  let sec = "";
  if (start >= 0) {
    const body = [];
    for (let i = start + 1; i < lines.length; i++) {
      const h = /^(#{1,6})\s+/.exec(lines[i]);
      if (h && h[1].length <= level) break;
      body.push(lines[i]);
    }
    sec = body.join("\n");
  }

  if (start < 0) {
    problems.push("缺**接口契约**段（标题里要有「接口契约」）");
  } else {
    // 端点：小标题里的 "端点"/"endpoint"，或裸的 HTTP 方法（不管有没有反引号）
    const endpointHeads = [...sec.matchAll(/^#{2,4}\s*[^\n]*?(端点|endpoint)[^\n]*$/gim)].length;
    const httpMentions = [...sec.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+\S+/g)].length;
    const endpointCount = Math.max(endpointHeads, httpMentions);

    if (endpointCount === 0) {
      problems.push("接口契约段里**没有任何端点**（写清每个端点的请求/响应/错误）");
    } else {
      // 按小标题切块，逐块检查是否有"错误"项
      // 注意：段首那一块（标题就是"接口契约"本身）是**铺垫文字**，不是端点块。
      // 踩过的坑：铺垫里写了"GET 11 个 + POST 10 个"这种汇总，正好命中"裸 HTTP 方法"判据，
      // 于是被当成一个"没有错误处理的端点"报出来 —— 实测报过"24 个端点都没写错误处理"，全是假警报。
      const chunks = sec.split(/\n(?=#{2,4}\s)/)
        .filter((b) => /\S/.test(b))
        .filter((b, idx) => idx > 0 || /^#{2,4}\s/.test(b))     // 段首无标题的铺垫块不是端点块
        .filter((b) => !/接口契约/.test(b.split("\n")[0]));      // 契约标题自身那一块同理
      const blocks = chunks.filter((b) => /(端点|endpoint)/i.test(b) || /\b(GET|POST|PUT|PATCH|DELETE)\s+\S+/.test(b));
      // 错误行允许加粗：`| 错误 |` 与 `| **错误** |` 都算。
      // 踩过的坑：模板里写的是加粗版，而这里只认不加粗版 —— 照模板抄的人必然卡在闸门上。
      const noErr = blocks.filter((b) => !/\|\s*\**\s*错误\s*\**\s*\|/.test(b) && !/\b(错误处理|错误码|error响应|错误响应)\b/.test(b));
      if (blocks.length > 0 && noErr.length > 0) {
        problems.push(`接口契约里有 ${noErr.length} 个端点**没写错误处理**（要有「| 错误 | … |」这一行）——Builder 只能自己猜，而它通常猜"静默返回空"`);
      }
      infos.push(`接口契约：识别到 ${blocks.length} 个端点块（标题 ${endpointHeads} / HTTP 提及 ${httpMentions}）`);
      if (blocks.length === 0) {
        warnings.push("没能识别出端点块——请把每个端点写成 '### 端点：POST /api/xxx'");
      }
    }
    if (!/幂等|idempot/i.test(sec)) {
      warnings.push("接口契约里没提**幂等**——写操作要回答「重复提交会怎样」");
    }
    if (!/谁可以调|权限|鉴权|authoriz/i.test(sec)) {
      warnings.push("接口契约里没写**谁可以调**——授权漏项是数据泄露的头号原因");
    }
  }
}

// ── 8. 范围边界 ───────────────────────────────────────────────────────────
if (!/范围边界|不做什么|不做：|non-goal/i.test(md)) {
  problems.push("缺**范围边界**（明确写出『不做什么』）——一个人做项目的生命线");
}

// ── 9. 模板占位符 / 空表格行（**"照模板抄但没填"**）─────────────────────────
// 为什么要有这一条（独立复审提出，已实测确认）：
//   `CONTEXT-TEMPLATE.md` **交付时本身就是合规的** —— 它带着示例实体（USER/ORDER）、
//   示例状态机、一个带完整错误行的示例端点，于是**一份没填过的模板也能过闸门**。
//   模板的"示例内容"变成了"看起来填好了"，而闸门本该问的是"**你**想清楚了吗"。
//
// 判据刻意收紧（避免把正常文档打死）：
//   · 只看**占位符样式的 HTML 注释**（含"例："或 TODO/XXX）——不是"凡有注释就算没填"。
//     实测依据：`tests/fixtures/tiny-CONTEXT.md` 第 3 行就有一个说明性注释，
//     宽判据会把那份**合规样例**误杀（self-test 立刻红）。
//   · 表格空单元格：一行里**两个以上单元格是空的**（**实测**：所以 `| 字段 |  |  |` 也会命中，
//     它并不是"整行空着"——旧文案说的就是"整行空着"，**判据与措辞不一致**（复审 L8），已改准）。
//     为什么连"部分填"也拦：那些格子是要你填的；真要有意留白，写一句话说明，别留空。
{
  const placeholders = [...md.matchAll(/<!--[^>]*(例：|例:|TODO|待填|xxx)/gi)];
  if (placeholders.length > 0) {
    problems.push(`有 ${placeholders.length} 处**模板占位符没填**（形如「<!-- 例：… -->」）——` +
      `闸门问的是"**你**想清楚了吗"，不是"模板里有没有示例"`);
  }
  const sparseRows = md.split(/\r?\n/)
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /^\s*\|/.test(l) && (l.match(/\|\s*(?=\|)/g) ?? []).length >= 2);
  if (sparseRows.length > 0) {
    problems.push(`有 ${sparseRows.length} 行表格**空着两个以上单元格**（第 ${sparseRows.slice(0, 3).map(([n]) => n).join("/")} 行…）——` +
      `这些格子是要你填的；真要有意留白，就写一句话说明，别留空`);
  }
  if (placeholders.length === 0 && sparseRows.length === 0) infos.push("没有未填的模板占位符 / 空着的表格单元格");
}

// ── 输出 ──────────────────────────────────────────────────────────────────
say("=== 硬结构校验（CONTEXT.md） ===");
say(`文件: ${file}`);
say("");
for (const i of infos) say(`  [信息] ${i}`);
if (warnings.length) {
  say("");
  say(`  [警告] ${warnings.length} 条（不阻塞，但建议处理）:`);
  for (const w of warnings) say(`         - ${w}`);
}
if (problems.length) {
  say("");
  for (const p of problems) say(`  [FAIL] ${p}`);
  say("");
  say("========================================");
  say(`✗ 硬结构校验未通过（${problems.length} 项）→ **不许进入 Builder 阶段**`);
  say("");
  say("补法：按 CONTEXT-TEMPLATE.md 把这四样补齐，重跑本命令直到通过。");
  process.exit(1);
} else {
  say("");
  say("========================================");
  say("✓ 硬结构校验通过 —— 三张图 + 接口契约齐备，**可以进入 Builder 阶段**");
  say("");
  say("记得同步中央状态：");
  say("  state.ps1 artifact -Name er_diagram -Value true");
  say("  state.ps1 artifact -Name state_diagram -Value true");
  say("  state.ps1 artifact -Name interface_contract -Value true");
  process.exit(0);
}
