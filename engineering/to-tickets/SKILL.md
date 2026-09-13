---
name: to-tickets
description: 把一个计划、规格或当前对话拆成一组曳光弹工单，每张工单声明自己的阻塞边，并发布到已配置的追踪器——本地场景是每张工单一个文件、阻塞边写成文本；真实追踪器上则是原生 blocking 链接。（Break a plan, spec, or the current conversation into a set of tracer-bullet tickets, each declaring its blocking edges, published to the configured tracker — edges as text in one file per ticket locally, or native blocking links on a real tracker.）
disable-model-invocation: true
---

# To Tickets

把一个计划、规格或对话拆成一组**工单（ticket）**——曳光弹式的垂直切片，每张都声明**阻塞**它的那些工单。

issue 追踪器和分诊标签词汇应该已经提供给你了——如果还没有，先跑 `/setup-workspace-discipline`。

## 流程

### 1. 收集上下文

从对话上下文里已有的东西出发。如果用户以参数传入了引用（规格路径、issue 编号或 URL），就取回它，读它的完整正文和评论。

### 2. 探索代码库（可选）

如果你还没探索过代码库，先探索，理解代码的当前状态。工单标题和描述应该使用项目的领域术语表词汇，并尊重你所触及区域的 ADR。

寻找**预重构（prefactor）**的机会，好让实现更简单。"先把改动变容易，再做那个容易的改动。"

### 3. 草拟垂直切片

把工作拆成**曳光弹**工单。

<vertical-slice-rules>

- 每个切片都穿过**每一层**（schema、API、UI、测试）切出一条**窄但完整**的路径——是垂直的，**不是**某一层的水平切片
- 一个完成的切片自身就是可演示或可验证的
- 每个切片的尺寸都以"装进一个全新的上下文窗口"为准
- 任何预重构都应该最先做

</vertical-slice-rules>

给每张工单标出它的**阻塞边**——在它开始之前必须先完成的其他工单。没有阻塞项的工单可以立刻开始。

**大范围重构（wide refactor）是垂直切片的例外。** **大范围重构**指的是"一处机械改动——重命名一列、改一个共享符号的类型——其**爆炸半径**铺满整个代码库"，于是一次编辑同时弄坏成千上万个调用点，没有任何垂直切片能绿着落地。别硬把它塞进曳光弹；把它排成**扩张-收缩（expand–contract）**：

1. 先**扩张**：把新形态加在旧形态旁边，这样什么都不会坏。
2. 再**迁移**调用点，按爆炸半径分批（按包、按目录），每批自身一张工单，被"扩张"阻塞；因为旧形态还在，CI 能一批一批保持绿。
3. 最后**收缩**：在没有调用方剩下之后删掉旧形态，这一张工单被所有迁移批次阻塞。

当连分批都无法各自保持绿时，保留这个序列，但让它们共用一个集成分支，所有这些工单一起阻塞一张最终的"集成并验证"工单——"绿"只在那张工单上被承诺。

### 4. 拷问用户

把提议的拆分以带编号的清单呈现。每张工单展示：

- **标题（Title）**：简短的描述性名字
- **被谁阻塞（Blocked by）**：哪些其他工单（如果有）必须先完成
- **它交付什么（What it delivers）**：这张工单让什么端到端行为跑通

问用户：

- 粒度感觉对吗？（太粗 / 太细）
- 阻塞边对吗——每张工单是否只依赖真正卡住它的工单？
- 有没有该合并或进一步拆分的工单？

反复迭代，直到用户批准这份拆分。

### 5. 把工单发布到已配置的追踪器

发布批准的工单。**怎么发**取决于 `/setup-workspace-discipline` 配置的追踪器——两种方式工单内容相同，只是阻塞边的形态不同：

- **本地文件** → 每张工单在 `.scratch/<feature-slug>/issues/<NN>-<slug>.md` 下写一个文件，从 `01` 按依赖顺序编号（阻塞者在前）。每个文件的 "Blocked by" 列出它依赖的编号/标题。用下面的单工单文件模板——**一张工单一个文件，永远不要合成一个文件**。
- **真实的 issue 追踪器（GitHub、Linear……）** → 按依赖顺序（阻塞者在前）每张工单发一个 issue，这样每张工单的阻塞边能引用真实的标识符。平台有原生 blocking / sub-issue 关系就用它；否则把每张工单的 "Blocked by" 设成那些阻塞 issue。除非另有指示，打上 `ready-for-agent` 分诊标签——这些工单按构造就是 agent 可抓取的。

按**前沿（frontier）**推进：凡是阻塞项都已完成的那张工单。对纯线性链来说就是从下往上。

**不要**关闭或修改任何父 issue。

<local-ticket-template>

# <NN> — <工单标题>

**What to build（要建什么）：** 这张工单让什么端到端行为跑通，从用户的视角写——不是逐层的实现清单。

**Blocked by（被谁阻塞）：** 卡住这张工单的工单编号/标题，或者 "None — can start immediately"。

**Status:** ready-for-agent

- [ ] 验收标准 1
- [ ] 验收标准 2

</local-ticket-template>

<issue-template>

## Parent

指向追踪器上父 issue 的引用（如果来源是一个已存在的 issue；否则省略这一节）。

## What to build

这张工单让什么端到端行为跑通，从用户的视角写——不是逐层的实现。

## Acceptance criteria

- [ ] 标准 1
- [ ] 标准 2

## Blocked by

- 对每张阻塞工单的引用，或者 "None — can start immediately"。

</issue-template>

两种形态里都避免具体文件路径或代码片段——它们过时很快。例外：如果某个原型产出的片段比散文更精确地编码了某个决策（状态机、reducer、schema、类型形状），就内联它，并简短注明来自原型。只剪出决策密集的部分——不是可运行的 demo，只是关键几段。
