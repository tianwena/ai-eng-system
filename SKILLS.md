# 技能目录（SKILLS.md）

> 本文件为**机器可读索引**：技能名、调用策略、一句话说明。由 scripts/ 下的生成逻辑产出。
> 增删技能后必须同步本文件与 README.md（见 README 维护纪律）。

**合计 36 个技能**

| 技能 | 调用策略 | 说明 |
|---|---|---|
| ask-matt | user-invoked | 问哪个技能或流程适合你当前的处境。本仓库全部技能的路由器 |
| code-review | model-invoked | 以某个固定点（commit、分支、tag 或 merge-base）为基准，沿两条轴审查变更——标准轴（代码是否遵循… |
| codebase-design | model-invoked | 设计深模块的共享词汇。当用户想设计或改进一个模块的接口、寻找加深机会、决定接缝放哪、让代码更可测或更易被 AI 导航… |
| commercial-squad | model-invoked | 从"一个想法"到"一门能收钱的生意"的完整作战地图与路由：按商业闸门（有人要 → 能收钱 → 能交付 → 能重复）编… |
| diagnosing-bugs | model-invoked | 难 bug 与性能回归的诊断环路。当用户说 "diagnose"/"debug this"，或报告某东西坏了/抛错/… |
| domain-modeling | model-invoked | 构建并磨炼项目的领域模型。当用户想敲定领域术语或统一语言、记录一项架构决策，或者其他技能需要维护领域模型时使用 |
| frontend-delivery | model-invoked | 把前端做对：组件边界与状态归属、设计系统一致性、可访问性、四种状态（加载/空/错误/成功）、以及**怎么证明界面真的… |
| fullstack-delivery | model-invoked | 从零或半途把一个全栈商业系统做出来：先切最薄的一条端到端垂直切片（跑通"浏览器→服务端→数据库→再回来"），再按依赖… |
| grill-me | user-invoked | 一场无情的访谈，用来把计划或设计磨锋利 |
| grill-with-docs | user-invoked | 一场无情的访谈，用来把计划或设计磨锋利；过程中同步产出文档（ADR 和术语表） |
| grilling | model-invoked | 就一个计划、决策或想法对用户进行无情的访谈。当用户想压力测试自己的思考，或使用任何 "grill" 触发短语时使用 |
| growth-and-analytics | model-invoked | 上线后的增长与留存：定义北极星指标、埋点与事件设计、AARRR 漏斗分析、留存与流失分析、获客渠道评估、把数据变成下… |
| handoff | user-invoked | 把当前对话压缩成一份交接文档，供另一个 agent 接手 |
| implement | user-invoked | 按一份规格或一组工单实现一块工作 |
| improve-codebase-architecture | user-invoked | 扫描代码库寻找"加深模块"的机会，以一份可视化 HTML 报告呈现，然后就你选中的那个开始逼问 |
| launch-and-ops | model-invoked | 把系统真正发布出去并让它稳定运行：部署流水线、环境与密钥管理、域名与证书、发布策略与回滚、监控告警、备份恢复、事故响… |
| multi-agent-squad | model-invoked | 把一个大目标拆成多 agent 分工的团队来干：决定什么时候该开新 agent、怎么把角色实例化成子 agent、用… |
| payment-and-billing | model-invoked | 实现收款与计费链路：选支付服务商、订阅与一次性付款的状态机、Webhook 幂等处理、额度与用量扣减、退款与对账、税… |
| pricing-and-monetization | model-invoked | 设计能赚钱的商业模式：定价、收费方式（订阅/一次性/按量/额度）、单位经济账（毛利与回本）、免费与付费的边界、提价与… |
| product-validation | model-invoked | 在写一行产品代码之前验证"有没有人要"：找出真实的人、拿到可追溯的需求证据、用最便宜的方式压测需求真伪，最后给出继续… |
| production-readiness | model-invoked | 上线前的加固闸门：把"能跑"变成"敢给真人用"。逐项闭环安全（认证/授权/注入/密钥/依赖）、数据（备份/恢复演练/… |
| prototype | model-invoked | 做一个一次性原型来回答一个设计问题。当用户想验证某个状态模型或逻辑感觉对不对，或想探索一个 UI 该长什么样时使用 |
| research | model-invoked | 针对高可信的一手资料调研一个问题，并把结论作为一个 Markdown 文件捕获到仓库里。当用户想研究某个话题、收集文… |
| resolving-merge-conflicts | model-invoked | 当需要解决一个进行中的 git merge/rebase 冲突时使用 |
| setup-workspace-discipline | user-invoked | 为这些工程技能配置本仓库——设置它的 issue 追踪器、分诊标签词汇和领域文档布局。在第一次使用其他工程技能之前跑一次 |
| tdd | model-invoked | 测试驱动开发。当用户想测试先行地构建功能或修 bug、提到 "red-green-refactor"，或想要集成测试… |
| teach | user-invoked | 在这个工作区里教用户一项新技能或概念 |
| tech-selection | model-invoked | 为一个人能长期维护的商业项目选技术栈：按"能跑十年、一个人扛得住、招得到人、迁得走"四个标准评估，算清真实成本（不只… |
| to-questionnaire | user-invoked | 把一个你无法独自完全回答的决策，变成一份给别人填写的问卷 |
| to-spec | user-invoked | 把当前对话变成一份规格说明，并发布到项目的 issue 追踪器——不访谈，只综合你已经谈过的内容 |
| to-tickets | user-invoked | 把一个计划、规格或当前对话拆成一组曳光弹工单，每张工单声明自己的阻塞边，并发布到已配置的追踪器——本地场景是每张工单… |
| triage | user-invoked | 让 issue 和外部 PR 走一遍分诊角色状态机——分类、验证、必要时逼问，并写出 agent 就绪的简报 |
| wait-what | user-invoked | 停。上一条消息没落地——重讲一遍 |
| wayfinder | user-invoked | 把一大块工作（超过一个 agent 会话能承载的量）规划成 issue 追踪器上一张共享的决策工单地图，然后逐个解决… |
| wizard | model-invoked | 生成一个交互式向导脚本，引导人走完只有他们能执行的步骤。用于开通基础设施、配置凭据或 CI 密钥、走一遍陌生的第三方… |
| writing-for-agents | model-invoked | 写给 agent 读的文档。当创建或编辑 skills，或修改 AGENTS.md / CLAUDE.md 时使用 |

---

## 调用策略说明（DSH）

| 策略 | frontmatter 写法 | 行为 |
|---|---|---|
| **model-invoked** | 不写调用字段（默认） | 模型可自动够到，人也能敲 |
| **user-invoked** | disable-model-invocation: true | 只能人敲 |

> user-invocable: true 是**空操作**；user-invocable: false 才会把人敲也关掉。详见 DSH-INTEGRATION.md。
