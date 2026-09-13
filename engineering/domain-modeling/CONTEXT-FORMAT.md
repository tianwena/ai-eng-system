# CONTEXT.md 格式

## 结构

```md
# {上下文名称}

{一到两句，描述这个上下文是什么、为什么存在。}

## Language

**Order**:
{一到两句描述这个术语}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request

**Customer**:
A person or organization that places orders.
_Avoid_: Client, buyer, account
```

## 规则

- **要有主张。** 同一个概念存在多个词时，挑出最好的那个，其余列在 `_Avoid_` 下。
- **定义要窄。** 最多一到两句。定义它**是什么**，不是它**做什么**。
- **只收本项目上下文特有的术语。** 通用编程概念（超时、错误类型、工具模式）不属于这里，哪怕项目里用得很多。加一个术语之前先问：这是本上下文独有的概念，还是通用编程概念？只有前者该进来。
- **自然成簇时用子标题分组。** 如果所有术语都属于同一个内聚领域，平铺一列就好。

## 单上下文 vs 多上下文仓库

**单上下文（大多数仓库）：** 仓库根目录一份 `CONTEXT.md`。

**多上下文：** 仓库根目录一份 `CONTEXT-MAP.md`，列出各个上下文、它们在哪、彼此如何关联：

```md
# Context Map

## Contexts

- [Ordering](./src/ordering/CONTEXT.md) — receives and tracks customer orders
- [Billing](./src/billing/CONTEXT.md) — generates invoices and processes payments
- [Fulfillment](./src/fulfillment/CONTEXT.md) — manages warehouse picking and shipping

## Relationships

- **Ordering → Fulfillment**: Ordering emits `OrderPlaced` events; Fulfillment consumes them to start picking
- **Fulfillment → Billing**: Fulfillment emits `ShipmentDispatched` events; Billing consumes them to generate invoices
- **Ordering ↔ Billing**: Shared types for `CustomerId` and `Money`
```

技能会自行推断适用哪种结构：

- 如果存在 `CONTEXT-MAP.md`，读它来找到各个上下文；
- 如果只有根目录一份 `CONTEXT.md`，就是单上下文；
- 如果两者都不存在，在第一个术语被敲定时惰性创建根目录的 `CONTEXT.md`。

存在多个上下文时，推断当前话题与哪一个相关。不清楚就问。
