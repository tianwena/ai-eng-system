---
name: domain-modeling
description: 构建并磨炼项目的领域模型。当用户想敲定领域术语或统一语言、记录一项架构决策，或者其他技能需要维护领域模型时使用。（Build and sharpen a project's domain model. Use when the user wants to pin down domain terminology or a ubiquitous language, record an architectural decision, or when another skill needs to maintain the domain model.）
---

# 领域建模（Domain Modeling）

在设计的过程中**主动**构建并磨炼项目的领域模型。这是一门*主动*的纪律——质疑术语、发明边界场景，并在术语和决策**结晶的那一刻**就写下来。（仅仅为了查词汇**读一下** `CONTEXT.md` 不算这个技能——那是任何技能都能顺手做的一行习惯。这个技能用于你**在改变模型**的时候，而不只是消费它。）

## 文件结构

大多数仓库只有一个上下文：

```
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

如果根目录存在 `CONTEXT-MAP.md`，说明仓库有多个上下文。这张地图指向每一个所在的位置：

```
/
├── CONTEXT-MAP.md
├── docs/
│   └── adr/                          ← 系统级决策
├── src/
│   ├── ordering/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/                 ← 该上下文特有的决策
│   └── billing/
│       ├── CONTEXT.md
│       └── docs/adr/
```

**惰性创建文件**——只有真的有东西要写时才创建。如果 `CONTEXT.md` 不存在，在第一个术语被敲定时创建它。如果 `docs/adr/` 不存在，在第一份 ADR 需要时创建它。

## 会话期间

### 拿术语表来质疑

当用户使用的术语与 `CONTEXT.md` 里的既有语言冲突时，立刻指出来。"你的术语表把 'cancellation' 定义成 X，但你似乎指的是 Y——到底是哪个？"

### 磨锋利模糊的表达

当用户用了含糊或过载的词时，提议一个精确的规范术语。"你说的是 'account'——你指的是 Customer 还是 User？这是两回事。"

### 讨论具体场景

当讨论领域关系时，用具体的场景去压测它们。发明一些探边界情况的场景，逼用户说清楚概念之间的边界。

### 与代码交叉比对

当用户陈述"某件事是怎么运作的"时，检查代码是否同意。如果发现矛盾，把它摆到台面上："你的代码取消的是整张 Order，但你刚说部分取消是可能的——哪个才是对的？"

### 内联更新 CONTEXT.md

一个术语被敲定时，**当场**更新 `CONTEXT.md`。不要攒起来批量做——发生一个就捕获一个。用 [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md) 里的格式。

**术语那一节**应该完全不包含实现细节。不要把术语表当成规格、草稿纸，或者实现决策的存放处。

> ⚠️ **同一个文件名在本工作区里有两个用途，别搞混**（冷启动实测真冲突过一次）：
>
> - **本技能**负责的是 `CONTEXT.md` 里的**统一语言**那一节（术语表）。
> - **`multi-agent-squad` 的硬结构闸门**要求**同一个** `CONTEXT.md` **还**承载
>   实体关系图 / 状态流转图 / 接口契约 / 范围边界——模板见
>   [`../multi-agent-squad/CONTEXT-TEMPLATE.md`](../multi-agent-squad/CONTEXT-TEMPLATE.md)，
>   而 `verify-structure.mjs` 认的就是这一份（它不认术语表，也不看别的文件）。
>
> **两个要求不矛盾，但边界要守住**：术语那一节里**不要**写实现细节；
> 该写规格/契约时写进该文件的对应小节，**别把术语表扩写成规格**。
> 一个只读入口文档、没看到这条说明的 agent，会以为两者打架——它只能二选一。

### 谨慎地提议 ADR

只有当以下三条**全部**成立时，才提议创建 ADR：

1. **难以逆转** —— 以后改主意的成本是有分量的
2. **脱离上下文会令人意外** —— 未来的读者会想"他们当初为什么这么做？"
3. **是真实取舍的结果** —— 确实存在别的选项，而你出于具体理由选了这一个

三条里缺任何一条，就跳过 ADR。用 [ADR-FORMAT.md](./ADR-FORMAT.md) 里的格式。
