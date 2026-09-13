---
name: handoff
description: 把当前对话压缩成一份交接文档，供另一个 agent 接手。（Compact the current conversation into a handoff document for another agent to pick up.）
argument-hint: "下一个会话将用来做什么？"
disable-model-invocation: true
---

写一份交接文档，总结当前对话，让一个全新的 agent 能继续这项工作。保存到用户操作系统的**临时目录**——**不是**当前工作区。

文档里要包含一节 "suggested skills"（建议技能），列出 agent 应当调用的技能。

**不要**重复已经在其他产物里捕获过的内容（规格、计划、ADR、issue、commit、diff）。改用路径或 URL 引用它们。

对任何敏感信息脱敏，例如 API key、密码或可识别的个人信息。

如果用户传了参数，把它们当作"下一个会话将聚焦什么"的描述，并据此裁剪文档。
