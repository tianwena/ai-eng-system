# Issue 追踪器：GitLab

本仓库的 issue 和规格以 GitLab issue 的形式存在。所有操作都用 [`glab`](https://gitlab.com/gitlab-org/cli) CLI。

> ⚠️ **前置依赖（选它之前必须先确认，否则整条链路会在使用时才失败）**
> - **`glab` CLI 已安装且已登录**：`glab auth status` 必须成功。
>   `to-tickets` / `triage` / `to-spec` / `wayfinder` 都调用它——**没装就别选这个追踪器**。
> - **需要有远程仓库**：`glab` 靠 remote 确定目标项目。
>
> **零依赖替代**：[`issue-tracker-local.md`](./issue-tracker-local.md)（本地 markdown，**单人项目默认推荐**）。

## 跨平台写法对照（Windows / PowerShell）

| 本文的 POSIX 写法 | PowerShell 等价 |
|---|---|
| 多行描述用 **heredoc** | 用 **here-string**：<br>`$desc = @'`<br>`...多行...`<br>`'@`<br>`$desc \| glab issue create --title "..." --description -` |
| `--description -` 打开编辑器 | 非交互（CI / agent）环境**不要用**，改用 `--description` 直接传值 |

## 约定

- **创建 issue**：`glab issue create --title "..." --description "..."`。多行描述用 heredoc（Windows 见上表）。传 `--description -` 会打开编辑器。
- **读 issue**：`glab issue view <number> --comments`。要机器可读输出加 `-F json`。
- **列 issue**：`glab issue list -F json`，配合合适的 `--label` 过滤。
- **评论 issue**：`glab issue note <number> --message "..."`。GitLab 把评论叫 "notes"。
- **加 / 删标签**：`glab issue update <number> --label "..."` / `--unlabel "..."`。多个标签可逗号分隔或重复该 flag。
- **关闭**：`glab issue close <number>`。`glab issue close` 不接受关闭评论，所以先用 `glab issue note <number> --message "..."` 发出解释，再关闭。
- **合并请求（Merge requests）**：GitLab 把 PR 叫 "merge requests"。用 `glab mr create`、`glab mr view`、`glab mr note` 等——形状与 `gh pr ...` 相同，只是用 `mr` 代替 `pr`、用 `note`/`--message` 代替 `comment`/`--body`。

从 `git remote -v` 推断仓库——在克隆目录里运行时 `glab` 会自动这么做。

## 以合并请求作为分诊面

**MR 作为请求面：否。** _（如果本仓库把外部 MR 当作功能请求，设为 `yes`；`/triage` 会读这个 flag。）_

设为 `yes` 时，MR 走与 issue 相同的标签和状态，使用 `glab mr` 的对应命令：

- **读 MR**：`glab mr view <number> --comments`，diff 用 `glab mr diff <number>`。
- **列外部 MR 供分诊**：`glab mr list -F json`，然后只保留作者不是项目成员/所有者的 MR（贡献者的 MR，不是维护者正在进行的工作）。
- **评论 / 打标签 / 关闭**：`glab mr note`、`glab mr update --label`/`--unlabel`、`glab mr close`。

与 GitHub 不同，GitLab 的 issue 和 MR 分别编号，所以一旦知道维护者指的是哪个面，`#42` 就没有歧义。

## 当某个技能说"发布到 issue 追踪器"时

创建一个 GitLab issue。

## 当某个技能说"取回相关工单"时

运行 `glab issue view <number> --comments`。

## 寻路操作（Wayfinding operations）

由 `/wayfinder` 使用。**地图**是单个 issue，**子** issue 作为工单。

- **地图**：单个打了 `wayfinder:map` 标签的 issue，承载 Notes / Decisions-so-far / Fog 正文。`glab issue create --label wayfinder:map`。（在支持原生 epic 的 GitLab 付费档，也可以让一个 epic 承载地图；打标签的 issue 在所有档位都能用。）
- **子工单**：一个在最上方描述里带 `Part of #<map>`、并带 `wayfinder:<type>` 标签（`research`/`prototype`/`grilling`/`task`）的 issue。被认领后，工单分配给驱动地图的开发者。
- **阻塞**：GitLab 的**原生 blocking link**——规范、UI 可见的表达。用 `/blocked_by #<n>` quick action 添加，以一条 note 发出（`glab issue note <child> --message "/blocked_by #<blocker>"`）。原生 blocking link 是 Premium/Ultimate 功能；免费档（或不可用处）回退到描述顶部的 `Blocked by: #<n>, #<n>` 行。当每个阻塞者都关闭时，工单解除阻塞。
- **前沿查询**：`glab issue list -F json` 限定为地图的子项，剔除任何有开放阻塞者的——一条指向开放 issue 的原生 `blocked_by` 链接（`glab api projects/:id/issues/:iid/links`），或 `Blocked by` 行里的开放 issue——或有受理人的；按地图顺序第一个赢。
- **认领**：`glab issue update <n> --assignee @me` —— 本会话的第一次写入。
- **解决**：`glab issue note <n> --message "<answer>"`，然后 `glab issue close <n>`，再把一条上下文指针（要点 + 链接）追加到地图的 Decisions-so-far。
