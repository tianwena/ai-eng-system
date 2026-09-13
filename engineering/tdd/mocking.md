# 什么时候该 Mock

**只在系统边界** mock：

- 外部 API（支付、邮件等）
- 数据库（有时——优先用测试数据库）
- 时间/随机性
- 文件系统（有时）

**不要** mock：

- 你自己的类/模块
- 内部协作者
- 任何你能控制的东西

## 为可 mock 性做设计

在系统边界上，设计容易 mock 的接口：

**1. 用依赖注入**

把外部依赖**传进来**，而不是在内部创建：

```typescript
// Easy to mock
function processPayment(order, paymentClient) {
  return paymentClient.charge(order.total);
}

// Hard to mock
function processPayment(order) {
  const client = new StripeClient(process.env.STRIPE_KEY);
  return client.charge(order.total);
}
```

**2. 优先用 SDK 风格接口，而不是泛化的 fetcher**

为每个外部操作创建具体的函数，而不是一个带条件逻辑的泛化函数：

```typescript
// GOOD: Each function is independently mockable
const api = {
  getUser: (id) => fetch(`/users/${id}`),
  getOrders: (userId) => fetch(`/users/${userId}/orders`),
  createOrder: (data) => fetch('/orders', { method: 'POST', body: data }),
};

// BAD: Mocking requires conditional logic inside the mock
const api = {
  fetch: (endpoint, options) => fetch(endpoint, options),
};
```

SDK 式做法意味着：

- 每个 mock 只返回一种具体形状
- 测试 setup 里没有条件逻辑
- 更容易看出一个测试练到了哪些端点
- 每个端点有独立类型安全
