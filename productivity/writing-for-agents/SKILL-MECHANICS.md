# Skill 机制

[`writing-for-agents`](SKILL.md) 的 skill 专用分支：当文档是一个 skill 时，什么变了——frontmatter、调用方式的选择，以及路由技能。关于怎么写它的其他一切，都在 `SKILL.md` 那份通用参考里。

## 调用方式（Invocation）

两个选择，各自交易两种负载：

- 一个**模型调用（model-invoked）**的 skill 保留 `description`，于是 agent 能自主触发它——其他 skill 也能够到它。你依然可以敲它的名字：**模型调用永远包含人的触达**；description 只会增加 agent 的发现能力，**从不移除人的**。description 是这个 skill 的**顶层上下文指针**，被迫时刻保持加载——用**永久的上下文负载**换**可发现性**。一个内容全是参考的模型调用 skill 也是**共享参考的一个家**：别的 skill 能调用它，所以几个 skill 都需要的参考可以住在一个地方。机制：**省略** `disable-model-invocation`，并写一个面向模型的 description，携带触发分支（`SKILL.md` 里写指针的规则**完全适用**）。
- 一个**用户调用（user-invoked）**的 skill 从 agent 的触达范围里**剥掉 description**：只有人敲它的名字能调用它，别的 skill 都不能。**零上下文负载**，但它花掉**认知负载**——你就是那个必须记得它存在的索引。机制：设 `disable-model-invocation: true`；`description` 变成**面向人的**——一行摘要，触发清单剥掉。

**只有当 agent 必须自己够到这个 skill、或另一个 skill 必须够到时，才选模型调用。** 如果它永远只用手的触发，就做成用户调用，不付任何上下文负载。

两个用户调用的 skill 都需要的共享参考，可以**两个里都不放**——没有 description，谁也无法触发谁。把它推成 skill 体系之外的一个普通文件：任何 skill 都能指向的外部参考。

## 按调用方式拆分

拆分的**调用切口**（序列切口在 `SKILL.md` 里）：当你有一个**独特的引导词**、它应当**独立触发**这个 skill 时——一个你在提示词里真的会用的触发词——或者另一个 skill 必须够到它时，就拆出一个模型调用的 skill。你要为新的常驻 description 付上下文负载，所以那次**独立触达必须值得**。

## 路由技能（Router skills）

当用户调用的 skill 多到你记不住时，那堆起来的认知负载靠一个**路由技能**来治：一个用户调用的 skill，点名其他 skill 以及何时该够到每一个，于是**人只需要记住一个技能，而不是许多个**。它只能**提示**、**永远不能触发**它们：用户调用的 skill 没有 description，所以除了人，没有东西能触达它们。
