# 领域文档（Domain Docs）

工程技能在探索代码库时，应当如何消费本仓库的领域文档。

## 探索之前，先读这些

- 仓库根目录的 **`CONTEXT.md`**，或者
- 如果存在仓库根目录的 **`CONTEXT-MAP.md`**——它指向每个上下文各自的一份 `CONTEXT.md`。读与当前话题相关的每一份。
- **`docs/adr/`** —— 读触及你即将工作区域的 ADR。在多上下文仓库里，还要检查 `src/<context>/docs/adr/` 里的上下文级决策。

如果这些文件不存在，**静默继续**。不要指出它们缺席，也不要建议事先创建它们。`/domain-modeling` 技能（经由 `/grill-with-docs` 和 `/improve-codebase-architecture` 到达）会在术语或决策真正被敲定时惰性创建它们。

## 文件结构

单上下文仓库（大多数仓库）：

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

多上下文仓库（根目录存在 `CONTEXT-MAP.md`）：

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← 系统级决策
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← 该上下文特有的决策
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## 使用术语表的词汇

当你的输出要命名一个领域概念时（issue 标题、重构提议、假设、测试名称里），用 `CONTEXT.md` 里定义的术语。不要漂移到术语表明确列在 `_Avoid_` 下的同义词。

如果你需要的概念还不在术语表里，那是个信号——要么你在发明项目不使用的语言（重新考虑），要么存在一个真实的缺口（记下来交给 `/domain-modeling`）。

## 指出 ADR 冲突

如果你的输出与一份既有 ADR 矛盾，明确摆出来，而不是悄悄覆盖：

> _与 ADR-0007（事件溯源订单）冲突——但值得重新打开，因为……_
