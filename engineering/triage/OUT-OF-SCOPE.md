# 范围外知识库（Out-of-Scope Knowledge Base）

仓库里的 `.out-of-scope/` 目录存放**被否决的功能请求**的持久记录。它有两个用途：

1. **组织记忆** —— 记录某个功能为什么被否决，这样 issue 关闭后推理不会丢失
2. **去重** —— 当一个新 issue 与之前的否决匹配时，技能可以把先前的决定摆出来，而不是重新吵一遍

## 目录结构

```
.out-of-scope/
├── dark-mode.md
├── plugin-system.md
└── graphql-api.md
```

**一个概念一个文件**，不是一个 issue 一个文件。多个请求同一件事的 issue 归到同一个文件下。

## 文件格式

文件应该写得**轻松、可读**——更像一篇简短的设计文档，而不是一条数据库记录。用段落、代码示例和例子把推理讲清楚，让第一次看到它的人也能用上。

```markdown
# Dark Mode

This project does not support dark mode or user-facing theming.

## Why this is out of scope

The rendering pipeline assumes a single color palette defined in
`ThemeConfig`. Supporting multiple themes would require:

- A theme context provider wrapping the entire component tree
- Per-component theme-aware style resolution
- A persistence layer for user theme preferences

This is a significant architectural change that doesn't align with the
project's focus on content authoring. Theming is a concern for downstream
consumers who embed or redistribute the output.

```ts
// The current ThemeConfig interface is not designed for runtime switching:
interface ThemeConfig {
  colors: ColorPalette; // single palette, resolved at build time
  fonts: FontStack;
}
```

## Prior requests

- #42 — "Add dark mode support"
- #87 — "Night theme for accessibility"
- #134 — "Dark theme option"
```

### 给文件命名

给这个概念起一个简短、可描述的 kebab-case 名字：`dark-mode.md`、`plugin-system.md`、`graphql-api.md`。名字应该足够可辨认，让人翻目录时不用打开文件就知道什么被否决了。

### 怎么写理由

理由应该**有实质内容**——不是"我们不想要这个"，而是为什么。好的理由会引用：

- 项目范围或理念（"本项目专注于 X；主题化是下游的关注点"）
- 技术约束（"支持这个需要 Y，而 Y 与我们 Z 架构冲突"）
- 战略决策（"我们选择用 A 而不是 B，因为……"）

理由应该**耐用**。避免引用临时情况（"我们现在太忙了"）——那不是真正的否决，只是推迟。

## 什么时候查 `.out-of-scope/`

分诊期间（第 1 步：收集上下文），读 `.out-of-scope/` 里的所有文件。评估一个新 issue 时：

- 检查该请求是否匹配某个既有的范围外概念
- 匹配是按**概念相似度**，不是关键词——"night theme" 匹配 `dark-mode.md`
- 如果有匹配，把它摆给维护者："这和 `.out-of-scope/dark-mode.md` 很像——我们之前否决过，理由是[理由]。你还这么觉得吗？"

维护者可以：

- **确认** —— 新 issue 追加到既有文件的 "Prior requests" 列表，然后关闭
- **重新考虑** —— 删除或更新那个范围外文件，issue 走正常分诊流程
- **不同意** —— 两个 issue 相关但不同，走正常分诊

## 什么时候写 `.out-of-scope/`

只有当**一个 enhancement（不是 bug）被以 `wontfix` 否决**时。这对 enhancement 类型的 PR 同样适用——被否决的 PR 也记在这里，免得同一个请求又以新代码的形式回来。

当某件事因为**已经实现**而被 `wontfix` 关闭时，**不要**写这里。那是已建成的功能，不是被否决的；记录它会让去重检查被假的"否决"污染。取而代之，关闭评论应指出该功能已经在哪里。

流程：

1. 维护者判定某个功能请求超出范围
2. 检查是否已有匹配的 `.out-of-scope/` 文件
3. 有：把新 issue 追加到 "Prior requests" 列表
4. 没有：新建文件，写入概念名、决定、理由，以及第一个前置请求
5. 在 issue 上发一条评论解释这个决定，并提及该 `.out-of-scope/` 文件
6. 用 `wontfix` 标签关闭 issue

## 更新或删除范围外文件

如果维护者对先前否决的概念改了主意：

- 删除那个 `.out-of-scope/` 文件
- 技能**不需要**重新打开旧 issue——它们是历史记录
- 触发这次重新考虑的新 issue 走正常分诊流程
