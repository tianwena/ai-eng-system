# Productivity（生产力）

通用工作流工具，与代码无关。

## User-invoked（用户调用）

只有你敲它们时才可达（Claude Code：`disable-model-invocation: true`；Codex：`agents/openai.yaml` 里的 `policy.allow_implicit_invocation: false`）。

- **[grill-me](./grill-me/SKILL.md)** —— 就一个计划或设计被无情访谈，直到设计树的每个分支都被解决。
- **[handoff](./handoff/SKILL.md)** —— 把当前对话压缩成交接文档，让另一个 agent 能继续工作。
- **[teach](./teach/SKILL.md)** —— 跨多次会话教用户一项技能或概念，把当前目录当作有状态的教学工作区。
- **[to-questionnaire](./to-questionnaire/SKILL.md)** —— 把一个你独自答不了的决策，变成一份 Markdown 问卷，交给唯一能答的那个人——异步填，或会上一起填。
- **[wait-what](./wait-what/SKILL.md)** —— 某条消息没听懂时立刻开火。agent 会用你缺失的上下文、平实中文、以及 `CONTEXT.md` 的词汇把它重新讲一遍。

## Model-invoked（模型调用）

模型或人都能触达（靠丰富的触发措辞让模型能自己够到）。

- **[grilling](./grilling/SKILL.md)** —— 就一个计划、决策或想法无情访谈用户，直到设计树每个分支都被解决。
- **[writing-for-agents](./writing-for-agents/SKILL.md)** —— 怎么写 agent 消费的文档：skills、`AGENTS.md`/`CLAUDE.md`，以及任何靠指针被够到的文档。
