# 撰写 Agent 简报（Agent Briefs）

**Agent 简报**是一个结构化的评论，在 issue 或 PR 移到 `ready-for-agent` 时贴上去。它是离线 agent 据以工作的**权威规格**。原始正文和讨论是上下文——**agent 简报才是契约**。

简报陈述的是**agent 应该做什么**，这覆盖两种对象：对 issue 来说，是从零构建这个变更；对 PR 来说，是在*现有 diff 之上*还剩下什么——把它做完、补上缺口、处理审查意见。两种对象原则相同；下面的 PR 示例展示了差异。

## 原则

### 耐用性优先于精确性

这个 issue 可能在 `ready-for-agent` 上躺几天或几周。这期间代码库会变。把简报写成**即使文件被改名、移动或重构后仍然有用**的样子。

- **要**描述接口、类型和行为契约
- **要**点名 agent 应该寻找或修改的具体类型、函数签名或配置形状
- **不要**引用文件路径——它们会过时
- **不要**引用行号
- **不要**假设当前的实现结构会保持不变

### 行为式，而非步骤式

描述系统**应该做什么**，而不是**怎么实现**。agent 会重新探索代码库，自己做实现决策。

- **好：** "`SkillConfig` 类型应该接受一个可选的 `schedule` 字段，类型为 `CronExpression`"
- **坏：** "打开 src/types/skill.ts，在第 42 行加一个 schedule 字段"
- **好：** "当用户不带参数运行 `/triage` 时，应该看到一个需要关注的 issue 摘要"
- **坏：** "在主处理函数里加一个 switch 语句"

### 完整的验收标准

Agent 需要知道什么时候算做完。每份 agent 简报都**必须**有具体、可测试的验收标准。每条标准都应该是可独立验证的。

- **好：** "按本仓库配置的追踪器查询 `needs-triage` 标签，会返回已经过初始分类的 issue"
  （本地 markdown 追踪器 → 扫描 `.scratch/*/issues/*.md` 里 `Status: needs-triage` 的文件；
  GitHub → `gh issue list --label needs-triage`。**验收标准要写成追踪器无关的**，否则换追踪器就失效。）
- **坏：** "分诊应该正常工作"

### 明确的范围边界

说明什么不在范围内。这能防止 agent 镀金，或者对相邻功能做假设。

## 模板

```markdown
## Agent Brief

**Category:** bug / enhancement
**Summary:** one-line description of what needs to happen

**Current behavior:**
Describe what happens now. For bugs, this is the broken behavior.
For enhancements, this is the status quo the feature builds on.

**Desired behavior:**
Describe what should happen after the agent's work is complete.
Be specific about edge cases and error conditions.

**Key interfaces:**
- `TypeName` — what needs to change and why
- `functionName()` return type — what it currently returns vs what it should return
- Config shape — any new configuration options needed

**Acceptance criteria:**
- [ ] Specific, testable criterion 1
- [ ] Specific, testable criterion 2
- [ ] Specific, testable criterion 3

**Out of scope:**
- Thing that should NOT be changed or addressed in this issue
- Adjacent feature that might seem related but is separate
```

中文字段对照（写简报时建议**保留英文字段名**，因为它们是 agent 读取的关键字）：

| 字段 | 含义 |
|---|---|
| `Category` | 分类：bug / enhancement |
| `Summary` | 一句话说明需要发生什么 |
| `Current behavior` | 当前行为。对 bug 就是坏掉的行为；对 enhancement 是功能所基于的现状 |
| `Desired behavior` | 期望行为。要具体说明边界情况和错误条件 |
| `Key interfaces` | 关键接口：要改的类型、函数签名/返回值变化、配置形状 |
| `Acceptance criteria` | 验收标准，具体、可测试、可独立验证 |
| `Out of scope` | 不在范围内：不该改的东西、看似相关但独立的功能 |

## 示例

### 好的 agent 简报（bug）

```markdown
## Agent Brief

**Category:** bug
**Summary:** Skill description truncation drops mid-word, producing broken output

**Current behavior:**
When a skill description exceeds 1024 characters, it is truncated at exactly
1024 characters regardless of word boundaries. This produces descriptions
that end mid-word (e.g. "Use when the user wants to confi").

**Desired behavior:**
Truncation should break at the last word boundary before 1024 characters
and append "..." to indicate truncation.

**Key interfaces:**
- The `SkillMetadata` type's `description` field — no type change needed,
  but the validation/processing logic that populates it needs to respect
  word boundaries
- Any function that reads SKILL.md frontmatter and extracts the description

**Acceptance criteria:**
- [ ] Descriptions under 1024 chars are unchanged
- [ ] Descriptions over 1024 chars are truncated at the last word boundary
      before 1024 chars
- [ ] Truncated descriptions end with "..."
- [ ] The total length including "..." does not exceed 1024 chars

**Out of scope:**
- Changing the 1024 char limit itself
- Multi-line description support
```

### 好的 agent 简报（enhancement）

```markdown
## Agent Brief

**Category:** enhancement
**Summary:** Add `.out-of-scope/` directory support for tracking rejected feature requests

**Current behavior:**
When a feature request is rejected, the issue is closed with a `wontfix` label
and a comment. There is no persistent record of the decision or reasoning.
Future similar requests require the maintainer to recall or search for the
prior discussion.

**Desired behavior:**
Rejected feature requests should be documented in `.out-of-scope/<concept>.md`
files that capture the decision, reasoning, and links to all issues that
requested the feature. When triaging new issues, these files should be
checked for matches.

**Key interfaces:**
- Markdown file format in `.out-of-scope/` — each file should have a
  `# Concept Name` heading, a `**Decision:**` line, a `**Reason:**` line,
  and a `**Prior requests:**` list with issue links
- The triage workflow should read all `.out-of-scope/*.md` files early
  and match incoming issues against them by concept similarity

**Acceptance criteria:**
- [ ] Closing a feature as wontfix creates/updates a file in `.out-of-scope/`
- [ ] The file includes the decision, reasoning, and link to the closed issue
- [ ] If a matching `.out-of-scope/` file already exists, the new issue is
      appended to its "Prior requests" list rather than creating a duplicate
- [ ] During triage, existing `.out-of-scope/` files are checked and surfaced
      when a new issue matches a prior rejection

**Out of scope:**
- Automated matching (human confirms the match)
- Reopening previously rejected features
- Bug reports (only enhancement rejections go to `.out-of-scope/`)
```

### 好的 agent 简报（PR）

对一个 PR，"Current behavior" 描述的是 diff 的当前状态，简报要求 agent **完成或修好它**，而不是从零构建。

```markdown
## Agent Brief

**Category:** enhancement
**Summary:** Finish the contributor's `--json` output flag for `triage list`

**Current behavior:**
The PR adds a `--json` flag that serializes the issue list to JSON. The happy
path works and the diff matches the project's command structure. Two gaps
remain: errors are still printed as human text (not JSON), and the new flag has
no test coverage.

**Desired behavior:**
With `--json`, all output — including errors — is well-formed JSON on stdout,
and the command's exit codes are unchanged. The existing human-readable output
is untouched when the flag is absent.

**Key interfaces:**
- The command's error path should emit `{ "error": string }` under `--json`
  instead of the plain-text error
- Reuse the existing serializer the PR already added; don't introduce a second

**Acceptance criteria:**
- [ ] `triage list --json` emits valid JSON for both success and error cases
- [ ] Exit codes match the non-JSON command
- [ ] A test covers the `--json` success output and one error case
- [ ] Default (non-JSON) output is byte-for-byte unchanged

**Out of scope:**
- Adding `--json` to any other command
- Changing the JSON shape of the success payload the PR already defined
```

### 坏的 agent 简报

```markdown
## Agent Brief

**Summary:** Fix the triage bug

**What to do:**
The triage thing is broken. Look at the main file and fix it.
The function around line 150 has the issue.

**Files to change:**
- src/triage/handler.ts (line 150)
- src/types.ts (line 42)
```

它差在：

- 没有 Category
- 描述含糊（"分诊那东西坏了"）
- 引用了会过时的文件路径和行号
- 没有验收标准
- 没有范围边界
- 没有描述当前行为 vs 期望行为
