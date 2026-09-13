# Engineering（工程）

日常写代码用的技能。

## User-invoked（用户调用）

只有你敲它们时才可达（Claude Code：`disable-model-invocation: true`；Codex：`agents/openai.yaml` 里的 `policy.allow_implicit_invocation: false`；**DSH：`user-invocable: true` + `disable-model-invocation: true`**）。

- **[ask-matt](./ask-matt/SKILL.md)** —— 问哪个技能或流程适合你当前的处境。本仓库用户可调用技能的路由器。
- **[grill-with-docs](./grill-with-docs/SKILL.md)** —— 逼问式访谈，同时构建项目领域模型：磨炼术语，内联更新 `CONTEXT.md` 和 ADR。
- **[triage](./triage/SKILL.md)** —— 让 issue 走一遍分诊角色状态机。
- **[improve-codebase-architecture](./improve-codebase-architecture/SKILL.md)** —— 扫描代码库找"加深模块"的机会，以可视化 HTML 报告呈现，再就你选中的那个开始逼问。
- **[setup-workspace-discipline](./setup-workspace-discipline/SKILL.md)** —— 为这些工程技能配置仓库（issue 追踪器、分诊标签、领域文档布局）。每个仓库用前跑一次。
- **[to-spec](./to-spec/SKILL.md)** —— 把当前对话转成一份规格说明并发布到 issue 追踪器。
- **[to-tickets](./to-tickets/SKILL.md)** —— 把任何计划、规格或对话拆成一组曳光弹工单，每个声明自己的阻塞边——写成文本放进本地文件，或在真实追踪器上成为原生阻塞链接。
- **[implement](./implement/SKILL.md)** —— 按规格或一套工单施工：在预先约定的接缝处驱动 `/tdd`，提交前跑 `/code-review` 收尾。
- **[wayfinder](./wayfinder/SKILL.md)** —— 规划一大块工作（超过一个 agent 会话能承载的量），做成 issue 追踪器上的决策工单共享地图，逐个解决直到通往目的地的路清晰。

## Model-invoked（模型调用）

模型或人都能触达（靠丰富的触发措辞让模型能自己够到）。**DSH 中省略调用字段即为两边可调用。**

### ★新增★ 编排类（已设为模型可调用）

> 更保守的做法是"路由器只由人敲"；这 2 个**有意放开**为模型可调用，以便 agent 能自主组队。
> 权衡说明与回退方法见 [`DSH-INTEGRATION.md`](../DSH-INTEGRATION.md) 第四节。

- **[multi-agent-squad](./multi-agent-squad/SKILL.md)** —— 把大目标拆成多 agent 团队：三条铁律（文件是唯一共享内存 / 阶段边界换窗口 / 审查者独立）、角色表、三段式派活模板、六类消息协议、一小环一小环的落地路线。
- **[commercial-squad](./commercial-squad/SKILL.md)** —— 从想法到收钱的作战地图与路由：**四道商业闸门**（有人要 → 能收钱 → 能交付 → 能重复）、商业角色表、范围控制、商业侧人工闸门。

### 原有技能

- **[prototype](./prototype/SKILL.md)** —— 做一个一次性原型回答某个设计问题：状态/逻辑给一个可分享的 HTML 文件，UI 给几个可切换的、截然不同的方案。
- **[diagnosing-bugs](./diagnosing-bugs/SKILL.md)** —— 难 bug 与性能回归的纪律化诊断环路。
- **[research](./research/SKILL.md)** —— 针对高可信一手资料调研一个问题，把结论写成带引用的 Markdown 文件留在仓库里，以后台 agent 方式运行。
- **[tdd](./tdd/SKILL.md)** —— 红-绿-重构的测试驱动开发。一次一个垂直切片。
- **[domain-modeling](./domain-modeling/SKILL.md)** —— 主动构建并磨炼项目领域模型：挑战术语、用边界场景压测、内联更新 `CONTEXT.md` 和 ADR。
- **[codebase-design](./codebase-design/SKILL.md)** —— 设计深模块的共同纪律与词汇：小接口、干净接缝、可透过接口测试。
- **[code-review](./code-review/SKILL.md)** —— 以固定点为基准的双轴审查：**标准轴**（是否符合仓库编码规范 + Fowler 坏味道基线）与**规格轴**（是否忠实实现来源 issue/spec），两轴跑并行子 agent。
- **[resolving-merge-conflicts](./resolving-merge-conflicts/SKILL.md)** —— 逐块处理进行中的 git merge/rebase 冲突，按两边一手来源追溯意图来裁决，然后完成操作——绝不 `--abort`。
- **[wizard](./wizard/SKILL.md)** —— 生成一个交互式 bash 向导，引导人完成只有人能做的步骤：开通基础设施、配置凭据或 CI 密钥、走一遍陌生的第三方后台、跑一次性迁移或割接。

## ★新增★ 商业落地链路（8 个）

补齐"从想法到收钱"的缺口。**顺序即依赖顺序**：

- **[product-validation](./product-validation/SKILL.md)** —— 写一行产品代码**之前**验证有没有人要。证据分级 L0~L4，含"过去时提问"技巧与反证要求。守卫 **G1**。
- **[pricing-and-monetization](./pricing-and-monetization/SKILL.md)** —— 定价、收费方式（订阅/一次性/按量/额度）、**单位经济账**（ARPU/VC/毛利/回本）、免费与付费边界、必须提前定的商业条款。守卫 **G2**。
- **[tech-selection](./tech-selection/SKILL.md)** —— 一个人能维护十年的选型标准（无聊优先、托管优先、迁得走）、真实成本模型（含你自己的时间）、每项不可逆决策写 ADR。
- **[fullstack-delivery](./fullstack-delivery/SKILL.md)** —— 先切**最薄的端到端垂直切片**，再按依赖顺序长出数据模型/认证/授权/API/前端四态/后台任务/外部集成。含多 agent 并行安全规则。守卫 **G3**。
- **[frontend-delivery](./frontend-delivery/SKILL.md)** —— 把前端做对：**状态归属**（服务端/URL/表单/派生各放哪）、组件边界（深模块用在前端）、设计系统**令牌化且强制使用**、**四种状态**（加载/空/错误/成功）、可访问性最低线。并给**前端专属验证纪律**：tsc → 组件测试 → Playwright 端到端 → **ARIA 快照** → 人工一眼。专治 AI 写前端的四种病。
- **[production-readiness](./production-readiness/SKILL.md)** —— 上线闸门七节逐项闭环：安全、数据（**恢复演练**）、成本与滥用（**额度硬上限**）、可观测、故障、合规、部署。**每项必须有验证证据**。
- **[payment-and-billing](./payment-and-billing/SKILL.md)** —— 三条铁规（不自研、Webhook 是唯一事实来源、一切幂等）、订阅状态机、按量计费与对账、上线前的真实小额验证。
- **[launch-and-ops](./launch-and-ops/SKILL.md)** —— 三个"必须能"（一条命令部署 / 5 分钟回滚 / 出事知道）、数据库变更三步走、监控告警三级、事故响应、运行手册。
- **[growth-and-analytics](./growth-and-analytics/SKILL.md)** —— 北极星指标、埋点（**上线前就位**）、漏斗找瓶颈、队列留存、渠道的"有效 CAC"、每轮 ≤3 项带假设的动作。守卫 **G4**。

> **工程流程问题找 `ask-matt`；商业流程问题找 `commercial-squad`。**
> 两者**定位相同（都是路由器）但调用策略不同**：`ask-matt` 设为仅用户调用；
> `commercial-squad` 已放开为模型可调用。**技能之间不能互相调用**（本体系铁规），
> 所以由**人**或**模型**根据处境决定用哪个。
