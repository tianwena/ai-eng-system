---
name: to-questionnaire
description: 把一个你无法独自完全回答的决策，变成一份给别人填写的问卷。（Turn a decision you can't fully answer into a questionnaire for someone else to fill in.）
disable-model-invocation: true
---

把用户独自答不了的东西变成一份**问卷**——一份 Markdown 文档，他交给**一个人**异步填写，或者会上一起填。收件人握着用户所缺的知识；问卷把它**掏出来**。

**逼问"投递"，不要逼问主题。** 只就那次**投递**访谈用户，因为那是他永远答得出来的：发给谁、需要拿回什么。文档里的问题则瞄向"**收件人知道什么**"与"**用户需要什么**"之间的**缺口**。

1. **它要发给谁？** 在一次交换里问清收件人的角色、专长，以及与用户的关系。这决定了问卷的语气，以及它必须携带多少上下文。完成条件：你知道收件人是谁，以及他知道什么用户不知道的东西。

2. **你需要拿回什么？** 在一次交换里问清用户独自解决不了、需要从这个人那里得到的**具体决策或事实**。完成条件：你有一份具体清单，列出用户**读完/答完后必须能做到或决定**什么。

3. **写问卷。** 按下面的文档结构，起草瞄向第 1~2 步那个缺口的问题。写到当前目录的 `to-questionnaire-<slug>.md`（slug 取自主题），并报告路径。完成条件：文件存在，且用户在第 2 步点名的每一项都被某个问题覆盖。

## 文档结构

把文档框成一份**探索式问卷**：用户缺上下文，收件人有。问题按**最重要优先**排序——异步意味着你可能只有一次机会——一旦超过几个问题，就用 `##` 标题按主题分组。用下面的模板写。

<questionnaire-template>

# <问卷标题>

**Purpose（目的）：** 这份问卷为什么存在、它承载着什么决策。

**From:** <用户> — **To:** <收件人> — **How your answers will be used（你的回答会被用在哪）：** <它们去哪>

## Context（背景）

一段话，给一个不在用户脑子里的收件人建立方位。足够答得好，不要写成一页。

## How to answer（怎么作答）

截止时间和大致的投入量。**部分回答**和"我不知道"都有用——不确定的地方请标出来，不要跳过。

## <主题标题>

每个主题一个 `##` 小节。每个小节下是它的问题，最重要优先。**每个问题只承载一个想法**——绝不要复合问题——下面直接跟一个作答空位，并且只在问题可能被误读、或可能招来敷衍回答时，才加一行 _为什么这重要_。

<question-example>
### What load is the system expected to handle at launch?

_Why this matters: it decides whether we provision for burst traffic now or defer it._

>
</question-example>

## Anything else?（还有别的吗？）

收尾的兜底问：有什么我们没问、但我们该知道的？

</questionnaire-template>
