# Issue 追踪器：GitHub

本仓库的 issue 和规格以 GitHub issue 的形式存在。所有操作都用 `gh` CLI。

> ⚠️ **前置依赖（选它之前必须先确认，否则整条链路会在使用时才失败）**
> - **`gh` CLI 已安装且已登录**：`gh auth status` 必须成功。
>   `to-tickets` / `triage` / `to-spec` / `wayfinder` 都调用它——**没装就别选这个追踪器**。
> - **`jq`**（下文用到）：未装时用下表的 PowerShell 等价写法。
> - **需要有远程仓库**：`gh` 靠 remote 确定目标 repo；本机纯本地仓库用不了。
>
> **零依赖替代**：[`issue-tracker-local.md`](./issue-tracker-local.md)（本地 markdown，**单人项目默认推荐**）。

## 跨平台写法对照（Windows / PowerShell）

| 本文的 POSIX 写法 | PowerShell 等价 |
|---|---|
| 多行正文用 **heredoc** | 用 **here-string**：<br>`$body = @'`<br>`...多行...`<br>`'@`<br>`$body \| gh issue create --title "..." --body-file -` |
| 用 **`jq`** 过滤评论 | 用内置 JSON：<br>`gh issue view <n> --json title,body,labels,comments \| ConvertFrom-Json` |

> `gh` 本身跨平台；只有**管道与多行用法**需要按上表替换。

## 约定

- **创建 issue**：`gh issue create --title "..." --body "..."`。多行正文用 heredoc（Windows 见上表）。
- **读 issue**：`gh issue view <number> --comments`，用 `jq` 过滤评论，并同时取标签。
- **列 issue**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，配合合适的 `--label` 和 `--state` 过滤。
- **评论 issue**：`gh issue comment <number> --body "..."`
- **加 / 删标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭**：`gh issue close <number> --comment "..."`

从 `git remote -v` 推断仓库——在克隆目录里运行时 `gh` 会自动这么做。

## 以 pull request 作为分诊面

**PR 作为请求面：否。** _（如果本仓库把外部 PR 当作功能请求，设为 `yes`；`/triage` 会读这个 flag。）_

设为 `yes` 时，PR 走与 issue 相同的标签和状态，使用 `gh pr` 的对应命令：

- **读 PR**：`gh pr view <number> --comments`，diff 用 `gh pr diff <number>`。
- **列外部 PR 供分诊**：`gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`，然后只保留 `authorAssociation` 为 `CONTRIBUTOR`、`FIRST_TIME_CONTRIBUTOR` 或 `NONE` 的（丢掉 `OWNER`/`MEMBER`/`COLLABORATOR`）。
- **评论 / 打标签 / 关闭**：`gh pr comment`、`gh pr edit --add-label`/`--remove-label`、`gh pr close`。

GitHub 的 issue 和 PR 共用一个编号空间，所以裸的 `#42` 可能是两者之一——先用 `gh pr view 42` 解析，不行再退到 `gh issue view 42`。

## 当某个技能说"发布到 issue 追踪器"时

创建一个 GitHub issue。

## 当某个技能说"取回相关工单"时

运行 `gh issue view <number> --comments`。

## 寻路操作（Wayfinding operations）

由 `/wayfinder` 使用。**地图**是单个 issue，**子** issue 作为工单。

- **地图**：单个打 `wayfinder:map` 标签的 issue，承载 Notes / Decisions-so-far / Fog 正文。`gh issue create --label wayfinder:map`。
- **子工单**：作为 GitHub sub-issue 链接到地图的 issue（对 sub-issues 端点用 `gh api`）。未启用 sub-issues 时，把子工单加进地图正文的任务列表，并在子工单正文顶部写 `Part of #<map>`。标签：`wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）。被认领后，工单分配给驱动地图的开发者。
- **阻塞**：GitHub 的**原生 issue dependencies**——规范、UI 可见的表达。用 `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>` 添加一条边，其中 `<blocker-db-id>` 是阻塞者的数字**数据库 id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`，**不是** `#number` 也不是 `node_id`）。GitHub 会报告 `issue_dependencies_summary.blocked_by`（只含开放的阻塞者——即当前有效的闸门）。dependencies 不可用处，回退到子工单正文顶部的 `Blocked by: #<n>, #<n>` 行。当每个阻塞者都关闭时，工单解除阻塞。
- **前沿查询**：列出地图的开放子项（`gh issue list --state open`，限定为地图的 sub-issues / 任务列表），剔除任何有开放阻塞者的（`issue_dependencies_summary.blocked_by > 0`，或 `Blocked by` 行里有一个开放 issue）或有受理人的；按地图顺序第一个赢。
- **认领**：`gh issue edit <n> --add-assignee @me` —— 本会话的第一次写入。
- **解决**：`gh issue comment <n> --body "<answer>"`，然后 `gh issue close <n>`，再把一条上下文指针（要点 + 链接）追加到地图的 Decisions-so-far。
