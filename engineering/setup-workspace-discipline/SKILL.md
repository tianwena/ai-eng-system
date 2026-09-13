---
name: setup-workspace-discipline
description: 为这些工程技能配置本仓库——设置它的 issue 追踪器、分诊标签词汇和领域文档布局。在第一次使用其他工程技能之前跑一次。（Configure this repo for the engineering skills — set up its issue tracker, triage label vocabulary, and domain doc layout. Run once before first use of the other engineering skills.）
disable-model-invocation: true
---

# Setup Workspace Discipline

搭好工程技能们所假设的**每仓库配置**：

- **Issue 追踪器** —— issue 住在哪里（默认 GitHub；本地 markdown 开箱即支持）
- **分诊标签** —— 五个规范分诊角色所用的字符串
- **领域文档** —— `CONTEXT.md` 和 ADR 放在哪，以及读取它们的消费规则

这是一个**提示词驱动**的技能，不是确定性脚本。探索，呈现你发现的东西，和用户确认，然后再写。

## 流程

### 1. 探索

看看当前仓库，理解它的起始状态。读存在的东西；**不要假设**：

- **`git remote -v` —— 先看有没有远程、指向哪个平台**。
  - **输出为空 = 没有远程** → 远程追踪器**直接排除**（`gh`/`glab` 都需要 remote 才能定位目标）。
    **这是个人项目的常见情况，不是异常。**
  - 指向 `github.com` → 候选 GitHub（**还需 `gh auth status` 成功**）
  - 指向 `gitlab.com` 或自建 GitLab → 候选 GitLab（**还需 `glab auth status` 成功**）
- **平台 CLI 是否可用**：`gh --version` / `gh auth status`、`glab --version` / `glab auth status`。
  **只把"已安装且已登录"的平台列为可选**——否则配出来的追踪器到用的时候才发现是死的。
- 仓库根目录的 `AGENTS.md` 和 `CLAUDE.md` —— 哪个存在？其中一个里是否已有 `## Agent skills` 小节？
- 仓库根目录的 `CONTEXT.md` 和 `CONTEXT-MAP.md`
- `docs/adr/` 以及任何 `src/*/docs/adr/` 目录
- `docs/agents/` —— 本技能之前的产出是否已存在？
- `.scratch/` —— 本地 markdown issue 追踪器约定已在使用的迹象
- `triage` 技能装了吗？（本技能旁边有一个 `triage` 技能文件夹，或你的可用技能里有 `triage`。）这决定 B 节到底跑不跑。
- monorepo 信号 —— `pnpm-workspace.yaml`、`package.json` 里的 `workspaces` 字段，或者一个装了东西、自带 `src/` 的 `packages/*`。只在真正的大型多包仓库里出现；它们不出现就意味着单上下文，而几乎所有仓库都是这样。

### 2. 呈现发现并提问

概括什么已经存在、什么还缺。然后**按节**进行——一节一个问题一个答案，再进下一节。

每节都**先给推荐答案**，这样用户一个词就能接受。只有当选择真的分叉时才给一行解释；如果探索已经定下了这一节，就整节跳过（没装 `triage` 时跳过 B 节；没有 monorepo 时跳过 C 节）。

**A 节 —— Issue 追踪器。**

> 解释：所谓 "issue 追踪器" 就是这个仓库的 issue 住在哪里。`to-tickets`、`triage`、`to-spec` 这些技能都要读写它——它们需要知道是该调 `gh issue create`、是在 `.scratch/` 下写 markdown 文件、还是走你描述的其他工作流。挑你**实际**为本仓库追踪工作的地方。

**先探测可用性，再提议**（不要凭默认猜——提议一个没装 CLI 的方案会让整条链路卡死）：

```powershell
# 1) 有没有远程、指向哪
git remote -v
# 2) 平台 CLI 是否可用且已登录
gh auth status      # GitHub：装了且登录才可用
glab auth status    # GitLab：同上
```

按**探测结果**排序提议：

| 探测结果 | 提议 | 理由 |
|---|---|---|
| 有 GitHub 远程 **且** `gh` 可用已登录 | **GitHub** | 原生 blocking/sub-issue 关系最好用 |
| 有 GitLab 远程 **且** `glab` 可用已登录 | **GitLab** | 同上 |
| 有远程但**缺对应 CLI** | **本地 markdown**（并告知：想要原生 issue 就先装 `gh`/`glab`） | 缺 CLI 时提议远程 = 每条命令都失败 |
| **没有远程**（个人项目常见） | **本地 markdown** | 零依赖、零配置，**这是默认推荐** |

四个选项：

- **本地 markdown**（**零依赖，多数单人项目的正确答案**）—— issue 作为文件住在仓库的 `.scratch/<feature>/issues/` 下
- **GitHub** —— issue 住在仓库的 GitHub Issues 里（**需要 `gh` CLI 且已登录**）
- **GitLab** —— issue 住在仓库的 GitLab Issues 里（**需要 [`glab`](https://gitlab.com/gitlab-org/cli) CLI 且已登录**）
- **其他**（Jira、Linear 等）—— 请用户用一段话描述工作流；技能会把它记成自由文本

> ⚠️ **别把远程追踪器当默认**：本体系大量技能都要读写追踪器（`to-tickets` 发工单、`triage` 改标签、`to-spec` 发布规格）。
> 如果选了 GitHub 但环境里没有 `gh`，**这些技能会全部失效**——而且失败发生在使用时刻，不在配置时刻，排查成本很高。

把选择记进 `docs/agents/issue-tracker.md`（三个模板都在本目录下：`issue-tracker-local.md` / `issue-tracker-github.md` / `issue-tracker-gitlab.md`）。GitHub 和 GitLab 模板带一个 "PRs as a request surface" 开关，默认**关闭**——保持关闭、不要主动提；想把外部 PR 纳入分诊队列的用户以后可以自己在文件里打开。

**B 节 —— 分诊标签词汇。** 如果 `triage` 技能没装（探索已经告诉你），**整节跳过**——没装的技能不需要标签。

如果装了，只问**一个**问题：

> 要保留默认的分诊标签吗？（推荐：**要**）

默认值是五个规范角色，每个标签字符串等于它的名字：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。答**要**就原样写入。只有当用户说不要时——通常因为他家追踪器已经在用别的名字（例如用 `bug:triage` 表示 `needs-triage`）——才收集这些覆盖值，好让 `triage` 去应用**已有的**标签而不是创建重复的。

**C 节 —— 领域文档。** 默认**单上下文**——仓库根目录一份 `CONTEXT.md` + `docs/adr/`。这适合几乎所有仓库；**不用问，直接写**。

只有当探索发现了 monorepo 信号时，才提供**多上下文**——根目录一份 `CONTEXT-MAP.md`，指向各上下文的 `CONTEXT.md`。那时再和用户确认要哪种布局。

### 3. 确认并编辑

给用户看以下内容的草案：

- 要加进 `CLAUDE.md` / `AGENTS.md` 中被编辑那一个的 `## Agent skills` 块（选择规则见第 4 步）
- `docs/agents/issue-tracker.md`、`docs/agents/domain.md`、`docs/agents/triage-labels.md` 的内容（最后一个只在 `triage` 已安装时）

让他们在写之前先改。

### 4. 写

**挑要编辑的文件：**

- 如果 `CLAUDE.md` 存在，编辑它。
- 否则如果 `AGENTS.md` 存在，编辑它。
- 如果都不存在，问用户要创建哪一个——**不要替他挑**。

**永远不要**在 `CLAUDE.md` 已存在时创建 `AGENTS.md`（反之亦然）——永远编辑已经存在的那个。

如果所选文件里已经有 `## Agent skills` 块，**就地更新**它的内容，而不是再追加一个重复的。不要覆盖用户对周边小节的编辑。

块长这样：

```markdown
## Agent skills

### Issue tracker

[一行说明 issue 追踪在哪里]。见 `docs/agents/issue-tracker.md`。

### Triage labels

[一行说明标签词汇]。见 `docs/agents/triage-labels.md`。

### Domain docs

[一行说明布局——"single-context" 或 "multi-context"]。见 `docs/agents/domain.md`。
```

只有当 `triage` 已安装且 B 节跑过时，才包含 `### Triage labels` 子块并写 `docs/agents/triage-labels.md`。没装时，两者都省略。

然后用本技能文件夹里的种子模板作为起点写这些文档文件：

- [issue-tracker-github.md](./issue-tracker-github.md) —— GitHub issue 追踪器
- [issue-tracker-gitlab.md](./issue-tracker-gitlab.md) —— GitLab issue 追踪器
- [issue-tracker-local.md](./issue-tracker-local.md) —— 本地 markdown issue 追踪器
- [triage-labels.md](./triage-labels.md) —— 标签映射（只在 `triage` 已安装时）
- [domain.md](./domain.md) —— 领域文档消费规则 + 布局

对于"其他"issue 追踪器，用用户的描述从零写 `docs/agents/issue-tracker.md`。

### 5. 完成

告诉用户配置已完成，以及哪些工程技能现在会读这些文件。提一句他们以后可以直接编辑 `docs/agents/*.md`——只有在想切换 issue 追踪器或从头重来时，才需要重跑本技能。
