# Issue 追踪器：本地 Markdown

本仓库的 issue 和规格以 markdown 文件的形式住在 `.scratch/` 里。

## 约定

- 一个功能一个目录：`.scratch/<feature-slug>/`
- 规格是 `.scratch/<feature-slug>/spec.md`
- 实现用的 issue 是**一张工单一个文件**：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 开始编号——**永远不要**写成单个合并的 tickets 文件
- 分诊状态记录在每个 issue 文件靠近顶部的 `Status:` 行（角色字符串见 `triage-labels.md`）
- 评论和对话历史追加到文件底部 `## Comments` 标题下

## 当某个技能说"发布到 issue 追踪器"时

在 `.scratch/<feature-slug>/` 下创建新文件（需要时先创建目录）。

## 当某个技能说"取回相关工单"时

读引用路径下的文件。用户通常会把路径或 issue 编号直接传给你。

## 寻路操作（Wayfinding operations）

由 `/wayfinder` 使用。**地图**是一个文件，每张工单对应一个**子文件**。

- **地图**：`.scratch/<effort>/map.md` —— 承载 Notes / Decisions-so-far / Fog 的正文。
- **子工单**：`.scratch/<effort>/issues/NN-<slug>.md`，从 `01` 编号，正文里写问题。`Type:` 行记录工单类型（`research`/`prototype`/`grilling`/`task`）；`Status:` 行记录 `claimed`/`resolved`。
- **阻塞**：靠近顶部一行 `Blocked by: NN, NN`。当它列出的每个文件都是 `resolved` 时，这张工单就解除了阻塞。
- **前沿（Frontier）**：扫描 `.scratch/<effort>/issues/`，找出 open、未阻塞、未被认领的文件；编号最小的赢。
- **认领（Claim）**：先设 `Status: claimed` 并保存，再开始任何工作。
- **解决（Resolve）**：把答案追加到 `## Answer` 标题下，设 `Status: resolved`，然后把一条上下文指针（要点 + 链接）追加到 `map.md` 的 Decisions-so-far 里。
