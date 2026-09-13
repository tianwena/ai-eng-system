---
name: to-spec
description: 把当前对话变成一份规格说明，并发布到项目的 issue 追踪器——不访谈，只综合你已经谈过的内容。（Turn the current conversation into a spec and publish it to the project issue tracker — no interview, just synthesis of what you've already discussed.）
disable-model-invocation: true
---

这个技能拿当前的对话上下文和对代码库的理解，产出一份规格说明。**不要**访谈用户——只综合你已经知道的东西。

issue 追踪器和分诊标签词汇应该已经提供给你了——如果还没有，先跑 `/setup-workspace-discipline`。

## 流程

1. 如果还没做过，先探索仓库，理解代码库的当前状态。整份规格里都要使用项目的领域术语表词汇，并尊重你所触及区域的任何 ADR。

2. 草拟出你打算在哪些**接缝（seam）**上测试这个功能。**已有接缝优先于新建接缝**。用**尽可能高**的接缝。如果需要新接缝，在你所能及的最高点上提议它们。整个代码库里的接缝越少越好——理想数量是**一个**。

   和用户确认这些接缝符合他们的预期。

3. 用下面的模板写规格，然后发布到项目的 issue 追踪器。打上 `ready-for-agent` 分诊标签——不需要再做额外的分诊。

<spec-template>

## Problem Statement（问题陈述）

用户所面临的问题，从用户的视角写。

## Solution（解决方案）

针对该问题的解决方案，从用户的视角写。

## User Stories（用户故事）

一份**很长**的、带编号的用户故事清单。每条用户故事格式为：

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending
</user-story-example>

这份用户故事清单应该极其详尽，覆盖这个功能的方方面面。

## Implementation Decisions（实现决策）

一份已做出的实现决策清单。可以包括：

- 将要新建/修改的模块
- 那些模块中将被修改的接口
- 来自开发者的技术澄清
- 架构决策
- Schema 变更
- API 契约
- 具体的交互

**不要**包含具体文件路径或代码片段。它们很快就会过时。

例外：如果某个原型产出的片段比散文更精确地编码了某个决策（状态机、reducer、schema、类型形状），就把它内联在相关决策里，并简短注明它来自原型。**只剪出决策密集的部分**——不是可运行的 demo，只是关键几段。

## Testing Decisions（测试决策）

一份已做出的测试决策清单。包括：

- 什么样的测试算好测试（只测外部行为，不测实现细节）
- 哪些模块会被测试
- 测试的先例（即代码库中类似类型的测试）

## Out of Scope（不在范围内）

描述这份规格之外的东西。

## Further Notes（补充说明）

关于该功能的任何补充说明。

</spec-template>
