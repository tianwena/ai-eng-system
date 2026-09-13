// 技能 frontmatter 体检器 —— 找出会让 DSH 静默丢弃整个技能的问题
//
// 用法: node validate-skills.mjs <技能根1> [技能根2] ...
//       node validate-skills.mjs --report <输出文件> <技能根...>
//       node validate-skills.mjs --quiet <技能根...>
//
// 设计原则：**不维护"我认为对"的规则，直接复刻 DSH 的实现**。
// 所有判定逻辑都与 @deepseek-ai/dsh-skill-filesystem 的源码逐字对齐（见各函数注释）。
import { readFile, readdir, writeFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// ── DSH 侧的常量与实现（复刻，勿凭记忆改） ────────────────────────────────
const DSH_ROOT = "C:\\Users\\A\\AppData\\Local\\Programs\\dsh-codex-desktop\\resources\\dsh\\node_modules";
const DSH_YAML = join(DSH_ROOT, "yaml", "dist", "index.js");
// dsh-tool-skill/lib/index.js:18 —— 目录里 description 的长度上限（超出则静默截断）
const CATALOG_DESC_MAX = 500;

// YAML 解析器的来源，按优先级：
//   ① 本仓库自己的 node_modules（= CI / 别人 clone 后唯一可靠的一条）
//   ② DSH 安装目录里那份（本机开发时用）
//   ③ 都没有 → **大声失败**，绝不退化成"用正则凑合着解析"
// 为什么要写这段：以前只认 ②，于是**换台机器（或 CI）这个检查器根本起不来**——
// 而它是唯一能发现"技能会被静默丢弃"的检查。一个跑不起来的闸门等于没有闸门。
const yamlCandidates = [
  join(dirname(fileURLToPath(import.meta.url)), "node_modules", "yaml", "dist", "index.js"),
  DSH_YAML,
];
let yaml = null;
const yamlTried = [];
for (const p of yamlCandidates) {
  try { yaml = await import(pathToFileURL(p).href); break; } catch (e) { yamlTried.push(`${p} (${e.code || e.message.split("\n")[0]})`); }
}
if (!yaml || typeof yaml.parse !== "function") {
  console.error("✗ 找不到可用的 YAML 解析器 —— 本检查**没有跑成**（这不是通过）。");
  console.error("  试过：");
  for (const t of yamlTried) console.error(`    · ${t}`);
  console.error("  修法：在本仓库根目录跑 `npm install`（只装一个 yaml 依赖）。");
  console.error("  为什么不自己写一个解析器：本检查器的全部价值就在于**用 DSH 真正用的那个解析器**，" +
                "手写的宽松解析会把 DSH 会拒绝的文件判成合格 —— 那就是闸门撒谎。");
  process.exit(3);
}

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// dsh-skill-filesystem/lib/index.js:842-844 —— 这三个驼峰键会抛错 → 整个技能被丢弃
const LEGACY_KEYS = ["disableModelInvocation", "modelInvocable", "userInvocable"];
const INVOCATION_KEYS = ["disable-model-invocation", "user-invocable"];

/**
 * 逐字复刻 dsh-skill-filesystem/lib/index.js:855-870 的 frontmatterBoolean。
 * 接受: boolean | 1 | 0 | "1" | "0" | true/false/yes/no/on/off（大小写不敏感）
 * 其余一律抛 TypeError → DSH 丢弃整个技能。
 */
function frontmatterBoolean(data, key) {
  if (!Object.hasOwn(data, key)) return undefined;
  const value = data[key];
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  if (typeof value === "string") switch (value.toLowerCase()) {
    case "true": case "yes": case "on": return true;
    case "false": case "no": case "off": return false;
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`);
}

// ── 参数解析 ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let reportPath = null;
let quiet = false;
const roots = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--report") { reportPath = argv[++i]; continue; }
  if (argv[i] === "--quiet") { quiet = true; continue; }
  roots.push(argv[i]);
}
if (roots.length === 0) {
  console.error("用法: node validate-skills.mjs [--report <文件>] [--quiet] <技能根1> [技能根2] ...");
  process.exit(2);
}

const out = [];
const say = (s) => { out.push(s); if (!quiet) console.log(s); };

let total = 0, bad = 0, warned = 0;
const unreachableRoots = [];
const nestedDirs = [];

for (const root of roots) {
  say("=".repeat(74));
  say(`技能根: ${root}`);
  let dirs;
  try {
    dirs = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch (e) {
    say(`  (无法读取: ${e.code} —— 根不存在或不可读，跳过)`);
    continue;
  }
  // 该根是否真的有"直接的"技能？（DSH 只认 <根>/<name>/SKILL.md）
  let nested = 0;
  for (const d of dirs) {
    try { await readdir(join(root, d)); } catch { continue; }
    // 嵌套重复：<name>/<name>/SKILL.md
    try {
      const [outerStat, innerStat] = await Promise.all([
        stat(join(root, d, "SKILL.md")).catch(() => null),
        stat(join(root, d, d, "SKILL.md")).catch(() => null),
      ]);
      if (innerStat) {
        nestedDirs.push({ name: d, outer: outerStat ? outerStat.size : 0, inner: innerStat.size });
      }
    } catch { }
    try { await readFile(join(root, d, "SKILL.md"), "utf8"); } catch {
      // 子目录没有 SKILL.md，但里面可能有更深的技能
      try {
        const sub = (await readdir(join(root, d), { withFileTypes: true })).filter(x => x.isDirectory());
        for (const s of sub) { try { await readFile(join(root, d, s.name, "SKILL.md"), "utf8"); nested++; } catch { } }
      } catch { }
    }
  }
  const directCount = (await Promise.all(dirs.map(async (d) => { try { await readFile(join(root, d, "SKILL.md"), "utf8"); return 1; } catch { return 0; } }))).reduce((a, b) => a + b, 0);
  if (directCount === 0 && dirs.length > 0) {
    unreachableRoots.push({ root, children: dirs.slice(0, 6), nested });
  }

  for (const dir of dirs) {
    const p = join(root, dir, "SKILL.md");
    let raw;
    try { raw = await readFile(p, "utf8"); } catch { say(`  [跳过] ${dir}: 无 SKILL.md`); continue; }
    total++;

    const problems = [];   // 会被 DSH 丢弃 / 违背契约
    const warnings = [];   // 不会丢弃，但会静默降级

    const ls = raw.split(/\r?\n/);
    if (ls[0] !== "---") problems.push('第 1 行必须是 "---"（DSH 认不出 frontmatter）');
    const end = ls.indexOf("---", 1);
    if (end < 0) problems.push("frontmatter 未闭合（缺第二个 ---）");

    let data = null;
    if (end > 0) {
      const fm = ls.slice(1, end).join("\n");
      try { data = yaml.parse(fm); }
      catch (e) {
        // 最常见的原因：值是未加引号的 YAML 纯量，内含 ": " 或 "*"
        problems.push("YAML 解析失败 → 整个技能被丢弃: " + e.message.split("\n")[0]);
        problems.push('  提示：给 description / whenToUse 的值加双引号可解决（见 DSH-INTEGRATION.md 第八节）');
      }
    }

    if (data) {
      // name
      if (typeof data.name !== "string" || !data.name) problems.push("缺 name");
      else if (!KEBAB.test(data.name)) problems.push(`name 非 kebab-case: ${data.name}`);
      else if (data.name !== dir) problems.push(`name(${data.name}) != 目录名(${dir})`);

      // description
      if (typeof data.description !== "string" || !data.description) {
        problems.push("缺 description");
      } else if (data.description.length > CATALOG_DESC_MAX) {
        warnings.push(`description ${data.description.length} 字符 > ${CATALOG_DESC_MAX} → 目录里被静默截断（触发词若在尾部会丢失）`);
      } else if (data.description.length > 450) {
        warnings.push(`description ${data.description.length} 字符，接近 ${CATALOG_DESC_MAX} 上限，建议留余量`);
      }

      // whenToUse —— 合法但对模型不可见
      if (Object.hasOwn(data, "whenToUse")) {
        const w = data.whenToUse;
        if (typeof w !== "string" || !w) warnings.push("whenToUse 存在但不是有效字符串（会被忽略）");
        else warnings.push(`whenToUse 有 ${w.length} 字符，但**模型看不到它**（DSH 不渲染）→ 触发词应放进 description`);
      }

      // 调用策略：驼峰键会抛错丢弃，值必须通过 DSH 的 frontmatterBoolean
      for (const k of LEGACY_KEYS) {
        if (Object.hasOwn(data, k)) problems.push(`驼峰字段 ${k} → 整个技能被丢弃（须写成连字符形式）`);
      }
      for (const k of INVOCATION_KEYS) {
        try { frontmatterBoolean(data, k); }
        catch (e) { problems.push(`${k} 的值无法被 DSH 解析 → 整个技能被丢弃: ${e.message}`); }
      }
      if (!Object.hasOwn(data, "disable-model-invocation") && !Object.hasOwn(data, "user-invocable")) {
        warnings.push("未写调用字段 → 默认两边都可调用（模型可自动触发）。若只想让人敲，需加 disable-model-invocation: true");
      }
    }

    if (problems.length) {
      bad++;
      say(`  [问题] ${dir}`);
      for (const x of problems) say(`         - ${x}`);
      for (const x of warnings) say(`         · ${x}`);
    } else if (warnings.length) {
      warned++;
      say(`  [OK·注意] ${dir}`);
      for (const x of warnings) say(`         · ${x}`);
    } else {
      say(`  [OK  ] ${dir}`);
    }
  }
}

say("=".repeat(74));
say(`合计: ${total} 个技能 | ${bad} 个有致命问题 | ${warned} 个有注意项`);
say(bad === 0 ? "判定: 通过（无技能会被静默丢弃）" : "判定: 不通过 —— 有技能会被 DSH 静默丢弃，必须修复");

// —— 嵌套重复检测 ——
// `<name>/<name>/SKILL.md` DSH **发现不到**（只认两层），所以不会报错，
// 但它会让"递归数 SKILL.md"的核对失准，并让外层与内层悄悄版本分叉。
// 常见成因：用 `Copy-Item <srcDir> -Destination <root>\<name> -Recurse` 同步——
// 目标已存在时 PowerShell 会把源目录**塞进目标里面**。
if (nestedDirs.length > 0) {
  say("");
  say("⚠️ 嵌套重复目录（<name>/<name>/SKILL.md）—— 同步用错命令的典型后果:");
  for (const n of nestedDirs) {
    say(`   · ${n.name}/${n.name}/`);
    say(`     外层 ${n.outer}B vs 内层 ${n.inner}B${n.outer !== n.inner ? "  ← !! 版本已分叉，外层可能是旧版" : ""}`);
    say(`     修法：删掉内层目录，并确认外层是当前版（必要时重装）`);
  }
}

// —— DSH 可达性提醒 ——
// 本脚本比 DSH 宽松：它直接遍历 <根>/<name>/SKILL.md。
// 而 DSH 要求**恰好两段**路径，且**根本身不算技能**。
// 所以：如果某个根下面没有直接的 SKILL.md，DSH 从该根扫到的技能数是 0。
if (unreachableRoots.length > 0) {
  say("");
  say("⚠️ DSH 可达性提醒（本脚本比 DSH 宽松，别被总数误导）:");
  for (const r of unreachableRoots) {
    say(`   · ${r.root}`);
    say(`     该根下没有直接的 SKILL.md（只有子目录：${r.children.join(", ")}）`);
    say(`     → DSH 从这里扫描会得到 0 个技能。`);
    if (r.nested > 0) say(`     它下面嵌套着 ${r.nested} 个技能，但 DSH 只认 <根>/<name>/SKILL.md 两段路径。`);
    say(`     若想用它们：把根改成 ${join(r.root, r.children[0])} 这类子目录，或把技能打平到技能根。`);
  }
}

if (reportPath) {
  await writeFile(reportPath, out.join("\n") + "\n", "utf8");
  if (!quiet) console.log(`\n报告已写入: ${reportPath}`);
}
// 只在有致命问题时以非零码退出（便于 CI 使用）；注意项不影响退出码
process.exit(bad === 0 ? 0 : 1);
