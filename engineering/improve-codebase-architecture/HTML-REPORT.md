# HTML 报告格式

架构评审渲染成操作系统临时目录里一个自包含的 HTML 文件。Tailwind 和 Mermaid 都来自 CDN。Mermaid 可靠地处理图状图表；手搭的 div 和内联 SVG 处理更杂志化的视觉（体量图、剖面图）。两者混用——不要什么都依赖 Mermaid，那样会开始显得千篇一律。

## 脚手架

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Architecture review — {{repo name}}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
      mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "loose" });
    </script>
    <style>
      /* small custom layer for things Tailwind doesn't cover cleanly:
         dashed seam lines, hand-drawn-feeling arrow heads, etc. */
      .seam { stroke-dasharray: 4 4; }
      .leak { stroke: #dc2626; }
      .deep { background: linear-gradient(135deg, #0f172a, #1e293b); }
    </style>
  </head>
  <body class="bg-stone-50 text-slate-900 font-sans">
    <main class="max-w-5xl mx-auto px-6 py-12 space-y-12">
      <header>...</header>
      <section id="candidates" class="space-y-10">...</section>
      <section id="top-recommendation">...</section>
    </main>
  </body>
</html>
```

## 页头

仓库名、日期，以及一个紧凑的图例：实线框 = 模块，虚线 = 接缝，红色箭头 = 泄漏，粗深色框 = 深模块。不要引言段落——直接进候选。

## 候选卡片

图表承载重量。散文稀少、平实，并且不事张扬地使用术语表词汇（来自 `/codebase-design` 技能）。

每个候选是一个 `<article>`：

- **Title（标题）** —— 简短，点名这次加深（例如 "Collapse the Order intake pipeline"）。
- **Badge row（徽章行）** —— 推荐强度（`Strong` = 祖母绿，`Worth exploring` = 琥珀，`Speculative` = 石板灰），外加一个依赖类别标签（`in-process`、`local-substitutable`、`ports & adapters`、`mock`）。
- **Files（文件）** —— 等宽字体列表，`font-mono text-sm`。
- **Before / After diagram（前后对比图）** —— 中心的重点。两栏，并排。模式见下。
- **Problem（问题）** —— 一句话。哪里疼。
- **Solution（方案）** —— 一句话。改什么。
- **Wins（收益）** —— 项目符号，每条 ≤6 个词。例如 "Tests hit one interface"、"Pricing logic stops leaking"、"Delete 4 shallow wrappers"。
- **ADR callout（ADR 提示，如适用）** —— 琥珀色底框里一行。

不要成段的解释。如果一张图需要一段文字才能被理解，**重画那张图**。

## 图表模式

挑适合该候选的模式。混着用。不要让每张图看起来都一样——多样性本身就是重点的一部分。

### Mermaid 图（依赖 / 调用流的主力）

当重点是"X 调 Y、Y 调 Z，看看这团乱"时，用 Mermaid 的 `flowchart` 或 `graph`。把它包在一张 Tailwind 风格的卡片里，让甩进来感觉不那么突兀。用 classDef 把泄漏边染红、把深模块染深。时序图很适合"之前：6 次往返；之后：1 次"。

```html
<div class="rounded-lg border border-slate-200 bg-white p-4">
  <pre class="mermaid">
    flowchart LR
      A[OrderHandler] --> B[OrderValidator]
      B --> C[OrderRepo]
      C -.leak.-> D[PricingClient]
      classDef leak stroke:#dc2626,stroke-width:2px;
      class C,D leak
  </pre>
</div>
```

### 手搭的方块和箭头（当 Mermaid 的布局跟你作对时）

模块用带边框和标签的 `<div>`。箭头用内联 SVG 的 `<line>` 或 `<path>`，绝对定位在一个 relative 容器上。当你想让"之后"的图感觉像一个粗边框的深模块、内部灰掉时用它——Mermaid 渲染不出正确的重量感。

### 剖面图（适合分层的"浅"）

把水平色带（`h-12 border-l-4`）叠起来，展示一次调用穿过的各层。之前：6 层薄薄的，每层什么都不干。之后：1 条厚带子，标着合并后的职责。

### 体量图（适合"接口和实现一样宽"）

每个模块两个矩形——一个代表接口面积，一个代表实现。之前：接口矩形几乎和实现矩形一样高（浅）。之后：接口矩形矮、实现矩形高（深）。

### 调用图坍缩

之前：一棵函数调用树，渲染成嵌套盒子。之后：同一棵树坍缩进一个盒子，现在变成内部的那些调用在盒子里淡显。

## 样式指南

- 偏**杂志化**，不要企业仪表盘。慷慨的留白。标题可选衬线体（`font-serif` 配 stone/slate 很搭）。
- 颜色用得要省：一个强调色（祖母绿或靛蓝），加上红色表示泄漏、琥珀色表示警告。
- 图高保持约 320px，让前后对比并排放着不用滚动就很舒服。
- 图内部的模块标签用 `text-xs uppercase tracking-wider`——它们应该读起来像示意图，不像 UI。
- 唯一的脚本是 Tailwind CDN 和 Mermaid ESM import。除此之外报告是静态的——没有 app 代码，除 Mermaid 自己的渲染外没有任何交互。

## Top recommendation 小节

一张更大的卡片。候选名、一句话说明为什么、指向它卡片的锚点链接。就这些。

## 语气

平实中文，简洁——但架构名词和动词**直接来自** `/codebase-design` 技能。简洁不是漂移的借口。

**精确使用：** module（模块）、interface（接口）、implementation（实现）、depth（深度）、deep（深）、shallow（浅）、seam（接缝）、adapter（适配器）、leverage（杠杆）、locality（局部性）。

**永不替换为：** component、service、unit（用来指 module）· API、signature（用来指 interface）· boundary（用来指 seam）· layer、wrapper（当你指的是 module 时）。

**符合风格的措辞：**

- "Order intake 模块是浅的——接口几乎和实现一样大。"
- "Pricing 越过接缝泄漏了。"
- "加深：一个接口，一处可测。"
- "两个适配器证明了这条接缝：生产用 HTTP，测试用内存实现。"

**收益项目符号**用术语表词汇点名收益：*"locality：bug 集中在一个模块"*、*"leverage：一个接口，N 个调用点"*、*"接口缩小；实现吸收了那些包装层"*。不要写 *"更易维护"* 或 *"代码更干净"*——那些词不在术语表里，挣不到它们的位置。

不要含糊、不要清嗓子、不要 "值得一提的是……"。如果一句话能做成项目符号，就做成项目符号。如果一个项目符号能被砍掉，就砍掉。如果一个术语不在 `/codebase-design` 术语表里，先伸手够一个在表里的，再考虑发明新的。
