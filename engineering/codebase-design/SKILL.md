---
name: codebase-design
description: 设计深模块的共享词汇。当用户想设计或改进一个模块的接口、寻找加深机会、决定接缝放哪、让代码更可测或更易被 AI 导航，或者其他技能需要这套深模块词汇时使用。（Shared vocabulary for designing deep modules. Use when the user wants to design or improve a module's interface, find deepening opportunities, decide where a seam goes, make code more testable or AI-navigable, or when another skill needs the deep-module vocabulary.）
---

# Codebase Design（代码库设计）

设计**深模块**：大量行为藏在一个**小接口**后面，落在一个**干净的接缝**上，可透过那个接口测试。凡是在设计或重构代码的地方，都使用这套语言和这些原则。目标是：给调用者的**杠杆**、给维护者的**局部性**、给所有人的**可测试性**。

## 术语表

**精确**使用这些术语——不要替换成 "component"、"service"、"API" 或 "boundary"。语言一致本身就是全部意义。

**模块（Module）** —— 任何有接口和实现的东西。**刻意与尺度无关**：可以是一个函数、一个类、一个包，或一个横跨多层的切片。_避免_：unit、component、service。

**接口（Interface）** —— 调用者正确使用该模块所必须知道的一切：类型签名，但也包括不变量、顺序约束、错误模式、必需的配置和性能特征。_避免_：API、signature（太窄——它们只指类型层面的表面）。

**实现（Implementation）** —— 模块内部的东西，它的代码主体。与**适配器**不同：一个东西可以是"小适配器 + 大实现"（一个 Postgres 仓储），也可以是"大适配器 + 小实现"（一个内存假件）。当话题是接缝时用 "adapter"；否则用 "implementation"。

**深度（Depth）** —— 接口处的**杠杆**：调用者（或测试）每学习一单位接口，就能练习多少行为。当**大量行为藏在小接口后面**时，模块是**深**的；当**接口几乎和实现一样复杂**时，它是**浅**的。

**接缝（Seam）** _（Michael Feathers）_ —— 一个你能改变行为、而不必编辑那个地方的位置；也就是模块接口**所在的位置**。接缝放哪是它自己的设计决策，与接缝后面放什么不同。_避免_：boundary（与 DDD 的限界上下文重载冲突）。

**适配器（Adapter）** —— 在某个接缝上满足某个接口的具体东西。描述的是**角色**（它填哪个槽），不是实质（里面是什么）。

**杠杆（Leverage）** —— 调用者从深度中得到的东西：每学习一单位接口就换来更多能力。一份实现，在 N 个调用点和 M 个测试上得到回报。

**局部性（Locality）** —— 维护者从深度中得到的东西：改动、bug、知识和验证集中在一个地方，而不是散布到各个调用者。修一处，处处已修。

## 深 vs 浅

**深模块** = 小接口 + 大量实现：

```
┌─────────────────────┐
│   Small Interface   │  ← Few methods, simple params
├─────────────────────┤
│                     │
│  Deep Implementation│  ← Complex logic hidden
│                     │
└─────────────────────┘
```

**浅模块** = 大接口 + 很少实现（要避免）：

```
┌─────────────────────────────────┐
│       Large Interface           │  ← Many methods, complex params
├─────────────────────────────────┤
│  Thin Implementation            │  ← Just passes through
└─────────────────────────────────┘
```

设计接口时问自己：

- 我能减少方法的数量吗？
- 我能简化参数吗？
- 我能把更多复杂度藏进去吗？

## 原则

- **深度是接口的属性，不是实现的属性。** 一个深模块内部可以由小的、可 mock 的、可替换的部件组合而成——它们只是不属于接口。一个模块可以既有**内部接缝**（对其实现私有、供它自己的测试使用），又有接口处的**外部接缝**。
- **删除测试（the deletion test）。** 想象删掉这个模块。如果复杂度消失了，它就是个直通层。如果复杂度在 N 个调用者处重新出现，它就在挣自己的位置。
- **接口就是测试面（the interface is the test surface）。** 调用者和测试跨过同一条接缝。如果你想**绕过**接口测试，这个模块大概形状不对。
- **一个适配器意味着假想接缝，两个适配器意味着真接缝。** 除非确实有东西在这条接缝上变化，否则不要引入接缝。

## 为可测试性设计

好接口让测试变得自然：

1. **接受依赖，不要创建依赖。**

   ```typescript
   // Testable
   function processOrder(order, paymentGateway) {}

   // Hard to test
   function processOrder(order) {
     const gateway = new StripeGateway();
   }
   ```

2. **返回结果，不要产生副作用。**

   ```typescript
   // Testable
   function calculateDiscount(cart): Discount {}

   // Hard to test
   function applyDiscount(cart): void {
     cart.total -= discount;
   }
   ```

3. **小的表面积。** 更少的方法 = 需要更少的测试。更少的参数 = 更简单的测试 setup。

## 关系

- 一个**模块**恰好有一个**接口**（它呈现给调用者和测试的表面）。
- **深度**是**模块**的属性，相对它的**接口**来衡量。
- **接缝**是**模块**的**接口**所在的位置。
- **适配器**坐在一条**接缝**上，满足那个**接口**。
- **深度**为调用者产生**杠杆**，为维护者产生**局部性**。

## 被否掉的框架

- **把深度当作"实现行数 / 接口行数"的比值**（Ousterhout）：这会奖励把实现灌水。我们用"深度即杠杆"。
- **把 "Interface" 理解为 TypeScript 的 `interface` 关键字或一个类的公开方法**：太窄——这里的接口包含调用者必须知道的每一条事实。
- **"Boundary"**：与 DDD 的限界上下文重载。说**接缝**或**接口**。

## 深入

- **给定依赖关系，加深一簇模块** —— 见 [DEEPENING.md](DEEPENING.md)：依赖类别、接缝纪律，以及"替换而非叠加"的测试策略。
- **探索替代接口** —— 见 [DESIGN-IT-TWICE.md](DESIGN-IT-TWICE.md)：起并行子 agent 把接口设计成几种截然不同的样子，然后按深度、局部性和接缝位置来比较。
