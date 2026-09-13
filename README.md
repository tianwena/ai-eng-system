# AI 工程能力体系（AI Engineering Capability System）

> **版本**：v1.0 · 2026-09-12 · 维护者：本项目
> **定位**：让**一个人 + AI 编码 agent 团队**具备**从想法到商业落地**的完整能力
> **形态**：由 `SKILL.md`（YAML frontmatter + 指令正文）组成的**行为规范集**，不是代码库

> ## 👉 只想尽快开始？**读 [`从这里开始.md`](./从这里开始.md)（≈2k token）就够了。**
> 那一页纸按"你是哪种情况"给出**该跑哪条命令**。
> **本 README 是体系全貌**（≈5.4k token），按需查即可——**不要一开始就读**。
>
> 本文件与它没有重复：**它解决"我该做什么"，本文件解决"这东西是什么"。**
>
> ## 🧑💼 **不写代码的人从这里进**：[`docs/给非技术用户的使用指南.md`](./docs/给非技术用户的使用指南.md)
> 全程人话讲清"从想法到能收钱的生意"要走哪几关、每关你要做什么、怎么算过——**不用敲任何命令**。
>
> ## 🔬 **想知道它到底灵不灵**：[`docs/给外人看的验证报告.md`](./docs/给外人看的验证报告.md)
> 一页讲清：在一个真实项目上测了什么、照出哪些问题、**哪里还不确定**（含"没跑成"的检查清单）。

---

## ⚙️ 运行环境（**先看这段，否则 Mac/Linux 上会踩坑**）

| 需求 | 现状 | 说明 |
|---|---|---|
| **Node** | **必需**，跨平台 ✓ | 自动检查器（内容一致性 / 硬结构闸门 / 结构验证 / 自检 / 干净房间…）都是 `.mjs` |
| **PowerShell** | **目前以 Windows PowerShell 5.1 实测为准**；`pwsh`（7+）**未实测** | 质量闸门 / 红线 / 状态机 / 安装脚本是 `.ps1`——**Mac/Linux 上今天跑不起来** |
| git | 建议 | 提交钩子是 `#!/bin/sh`，本身跨平台；红线/闸门的 git 相关检查需要仓库 |
| 可选专业工具 | 缺了**不假装通过** | gitleaks / semgrep / ruff / pip-audit / trivy 未装 ⇒ 记 SKIP；装了但连不上源（如 pip-audit 连不上 PyPI）⇒ 记 **NOTRUN（"没跑成"，不是通过）** |

**宿主（agent 工具）**：**技能正文（36 篇方法论）与宿主无关** —— 换成别的 agent 工具，方法论照用。
但有三处是按 **DeepSeek Harness（DSH）** 适配的：

1. **一部分技能**的 frontmatter 带 DSH 专有字段（`disable-model-invocation` 等），另有少数带 `argument-hint` / `user-invocable`；
2. 安装与发现规则假设 DSH 的"技能根 + 恰好两段路径"（见 [`DSH-INTEGRATION.md`](./DSH-INTEGRATION.md)）；
3. 多 agent 编排类技能假设 DSH 的子 agent / 工作流机制。

**闸门与检查器本身不依赖宿主**：它们是命令行脚本 + git 钩子，**任何人、任何 agent 都能调**。

> **一句话**：**在 Mac/Linux 上，技能内容可以照用，但自动闸门需要先做一次移植**（清单见
> [`docs/跨平台移植清单.md`](./docs/跨平台移植清单.md)）。**在别的 agent 工具上，需要改 frontmatter 与放置结构。**
> 这条限制被刻意写在这里而不是藏在文档里 —— 本库的规矩是：**别让读者自己去发现边界。**

---

## 一、这套系统解决什么问题

真实的软件开发很难，而 agent 会**放大**你的错误。本体系用四条"失败模式 → 对策"组织全部技能：

| # | 失败模式 | 根因 | 对策（技能） |
|---|---|---|---|
| 1 | **Agent 没做我要的东西** | 软件开发最常见的失败是**错位**——你以为对方懂，看到成品才发现不是 | **逼问式访谈**：让 agent 反问到设计树每个分支都被解决 |
| 2 | **Agent 话太多、太啰嗦** | 被扔进项目里自己猜术语，于是**用 20 个词说 1 个词的事** | **统一语言**：一份 `CONTEXT.md` 帮 agent 解码项目行话 |
| 3 | **代码跑不起来** | 缺少反馈回路 = **盲飞** | **红-绿-重构** + 纪律化诊断环路 |
| 4 | **造出一团泥球** | agent 极快写代码，也**极快加速熵增** | **深模块设计** + 定期架构体检 |

在此基础上，本体系补齐了原"单 agent + 人"模型没有覆盖的**四段链路**：

| 缺口 | 后果 | 对应技能 |
|---|---|---|
| **多 agent 编排** | 一个人 + 一个上下文窗口，做不完一个完整项目 | `multi-agent-squad` |
| **商业链条** | 代码写完了才发现没人要、收不到钱 | `commercial-squad` + 验证 / 定价 / 增长 |
| **全栈与加固** | "本地能跑"就上线，第一个真实用户就崩 | `fullstack-delivery`、`production-readiness` |
| **上线与收款** | 交付不了、收不了钱、出事救不回 | `launch-and-ops`、`payment-and-billing` |

---

## 二、技能总览（36 个）

> **分工**：本节是**给人看的分组定位**（为什么需要这个技能、它守哪道闸门）；
> **机器索引是 [`SKILLS.md`](./SKILLS.md)**（名字 / 调用策略 / 一句话，且那一列会被压短）。
> 两者**不是一个抄另一个**，但**同一事实只在一处定义**：数量、策略、路径都以源文件为准，由 `check-consistency.mjs` 看着。

### 2.1 编排与商业落地（10 个 · 本项目自研）

| 技能 | 调用策略 | 一句话 | 守卫闸门 |
|---|---|---|---|
| **[multi-agent-squad](./engineering/multi-agent-squad/SKILL.md)** | 模型可调用 | 组队：三条铁律、角色表、三段式派活、通信协议、落地路线 | — |
| **[commercial-squad](./engineering/commercial-squad/SKILL.md)** | 模型可调用 | 商业流程路由与**四道闸门**（含期限与退出判据） | G1–G4 |
| [product-validation](./engineering/product-validation/SKILL.md) | 模型可调用 | 写代码**之前**验证有没有人要，含证据分级 L0–L4 | G1 有人要 |
| [pricing-and-monetization](./engineering/pricing-and-monetization/SKILL.md) | 模型可调用 | 定价、收费方式、**单位经济账** | G2 能收钱 |
| [tech-selection](./engineering/tech-selection/SKILL.md) | 模型可调用 | 一个人能维护十年的选型标准 + 成本模型 + ADR | 不可逆决策 |
| [fullstack-delivery](./engineering/fullstack-delivery/SKILL.md) | 模型可调用 | 先切最薄垂直切片，再按依赖顺序长成全栈系统 | G3 能交付 |
| [production-readiness](./engineering/production-readiness/SKILL.md) | 模型可调用 | 上线闸门：安全/数据/成本/可观测/故障/合规逐项闭环 | 上线前 |
| [payment-and-billing](./engineering/payment-and-billing/SKILL.md) | 模型可调用 | 订阅状态机、Webhook 幂等、额度计费、对账 | 收款 |
| [launch-and-ops](./engineering/launch-and-ops/SKILL.md) | 模型可调用 | 部署、回滚、监控告警、事故响应、运行手册 | G4 能重复 |
| [growth-and-analytics](./engineering/growth-and-analytics/SKILL.md) | 模型可调用 | 北极星指标、埋点、漏斗、留存、渠道评估 | 上线后 |

### 2.2 工程纪律

**路由与流程**

- [ask-matt](./engineering/ask-matt/SKILL.md) — **工程流程的路由器**：问"我现在的处境该用哪个技能"。
- [grill-with-docs](./engineering/grill-with-docs/SKILL.md) — 逼问式访谈，同时构建项目领域模型：磨炼术语，内联更新 `CONTEXT.md` 和 ADR。
- [to-spec](./engineering/to-spec/SKILL.md) — 把当前对话转成规格说明并发布到追踪器（**不访谈**，只综合已谈过的内容）。
- [to-tickets](./engineering/to-tickets/SKILL.md) — 拆成一组"曳光弹"工单，每张声明自己的**阻塞边**。
- [implement](./engineering/implement/SKILL.md) — 按规格或工单施工：在约定接缝处驱动 `tdd`，提交前跑 `code-review`。
- [wayfinder](./engineering/wayfinder/SKILL.md) — 规划超出单会话容量的大块工作，做成**决策工单共享地图**。
- [triage](./engineering/triage/SKILL.md) — 让**别人提的** issue 走一遍分诊角色状态机。

**实现与质量**

- [tdd](./engineering/tdd/SKILL.md) — 红-绿-重构，一次一个垂直切片。
- [code-review](./engineering/code-review/SKILL.md) — 以固定点为基准的**双轴**审查（标准轴 + 规格轴），两轴跑并行子 agent。
- [diagnosing-bugs](./engineering/diagnosing-bugs/SKILL.md) — 难 bug 与性能回归的纪律化诊断环路。
- [resolving-merge-conflicts](./engineering/resolving-merge-conflicts/SKILL.md) — 逐块（hunk）按两边一手来源追溯意图来裁决，**绝不 `--abort`**。

**前端**

- [frontend-delivery](./engineering/frontend-delivery/SKILL.md) — 把前端做对：**状态归属**（服务端/URL/表单/派生各放哪）、组件边界（深模块用在前端）、设计系统**令牌化且强制使用**、**四种状态**（加载/空/错误/成功）、可访问性最低线。并给**前端专属验证纪律**：`tsc` → 组件测试 → **Playwright 端到端** → **ARIA 快照** → 人工一眼。专治 AI 写前端的四种病（假后端 / 状态乱放 / 每页一套样式 / 无休止重渲染）。

**设计与领域**

- [codebase-design](./engineering/codebase-design/SKILL.md) — 设计**深模块**：小接口、干净接缝、可透过接口测试。
- [improve-codebase-architecture](./engineering/improve-codebase-architecture/SKILL.md) — 扫描"加深模块"的机会，出可视化 HTML 报告。**是体检，不是抢救。**
- [domain-modeling](./engineering/domain-modeling/SKILL.md) — 主动构建并磨炼领域模型：挑战术语、用边界场景压测。

**支撑**

- [research](./engineering/research/SKILL.md) — 针对高可信一手资料调研，结论写成带引用的 Markdown。
- [prototype](./engineering/prototype/SKILL.md) — 一次性原型回答某个设计问题。
- [wizard](./engineering/wizard/SKILL.md) — 生成交互式向导，引导人走完**只有人能做的**步骤。**PowerShell 与 bash 双模板。**
- [setup-workspace-discipline](./engineering/setup-workspace-discipline/SKILL.md) — 为仓库配置追踪器、分诊标签、领域文档布局。**每个仓库用前跑一次。**

**通用工作流**

- [grilling](./productivity/grilling/SKILL.md) — 可复用的访谈原语（`grill-me`、`grill-with-docs`、`triage`、`wayfinder` 背后都是它）。
- [grill-me](./productivity/grill-me/SKILL.md) — 无仓库场景的逼问访谈。
- [handoff](./productivity/handoff/SKILL.md) — 把当前对话压缩成交接文档。
- [teach](./productivity/teach/SKILL.md) — 跨会话教用户一项技能，把当前目录当作有状态的教学工作区。
- [to-questionnaire](./productivity/to-questionnaire/SKILL.md) — 把一个你独自答不了的决策变成问卷，交给**唯一能答的那个人**。
- [wait-what](./productivity/wait-what/SKILL.md) — 某条消息没听懂时，让 agent 用你缺失的上下文重讲一遍。
- [writing-for-agents](./productivity/writing-for-agents/SKILL.md) — 怎么写给 agent 读的文档：技能、`AGENTS.md`、以及靠指针被够到的文档。

---

## 三、三个关键机制（用之前必须懂）

### 机制 1：技能分两类

| 类型 | 谁能触发 | 职责 | DSH 里的声明 |
|---|---|---|---|
| **user-invoked** | 只有人敲 `/xxx` | **编排** | `disable-model-invocation: true` |
| **model-invoked** | 人或 agent 自动触发 | 承载**可复用的纪律** | 省略该字段（默认两边可调用） |

**铁规**：user-invoked 可以调用 model-invoked，**永远不能调用另一个 user-invoked**。

### 机制 2：主流程（想法 → 交付）

```
[想法]
   │
   ├─ 1. /grill-with-docs       逼问澄清，留下 CONTEXT.md + ADR
   │
   ├─ 2. 有跑起来才能答的问题？ → /handoff → /prototype 一次性原型 → /handoff 回来
   │
   ├─ 3. 是否多会话规模？
   │      是 → /to-spec → /to-tickets（曳光弹工单 + 阻塞边）→ 每张工单 /implement
   │      否 → 直接 /implement
   │
   └─ /implement 内部：/tdd 一个红绿切片一个切片地做 → 提交前 /code-review（双轴）
```

**上下文卫生**：第 1–3 步应在**同一个未中断的上下文窗口**里完成（`/to-tickets` 之前不要压缩），这样逼问、规格、工单都建立在同一套思考上。

**智能区**：单窗口的"智能区"是**上下文窗口的一部分**（经验值 ≈15%），超过会**无声降智**。
> ⚠️ **别写死数字**：先查当前模型的 `contextWindow`（DSH 在 `~/.dsh/settings.yaml`），再按比例估。

### 机制 3：两个路由器

| 路由器 | 管什么 | 什么时候用 |
|---|---|---|
| [ask-matt](./engineering/ask-matt/SKILL.md) | **工程流程** | "我该用哪个工程技能？" |
| [commercial-squad](./engineering/commercial-squad/SKILL.md) | **商业流程** | "我走到哪一关了？下一步该干嘛？" |

两者职责不同、**不互相调用**（技能之间不能调技能）。由人或模型根据处境选择。

---

## 四、仓库结构

```
ai-eng-system/
├── 从这里开始.md                     **唯一入口**：三种场景 → 跑哪条命令（≈2k token）
├── README.md                        本文件：体系全貌（按需查）
├── engineering/                     工程技能（29 个）
├── productivity/                    通用工作流技能（7 个）
├── SKILLS.md                        技能目录（机器可读索引）
├── DSH-INTEGRATION.md               集成到 DeepSeek Harness 的规则与排错
├── 多Agent团队协作编排指南.md          给人读的完整编排指南
├── 术语对照表.md                     统一术语（本体系的"统一语言"）
├── 速查卡.md                        各技能的压缩速查（从技能正文抽出，见下）
├── 开源技术引用.md                   引用的开源项目与技术、许可与致谢
├── install-skills.ps1               安装脚本：把技能打平安装到 DSH 技能根
├── validate-skills.mjs              技能 frontmatter 体检器
├── scripts/
│   ├── quality-gate.ps1             **质量闸门运行器**（零依赖可跑）
│   ├── quality-gate.workflow.yml    CI 模板：每次提交自动跑闸门
│   ├── self-test.mjs                **检查器自检**（变异测试：检查器抓不抓得住已知错误）
│   ├── check-consistency.mjs        内容一致性：文档里的数字/清单/链接 ⇄ 真值
│   ├── install-git-hooks.ps1        提交前自检钩子（core.hooksPath，跟代码走）
│   └── extract-cheatsheets.mjs      速查抽取 + **漂移检测**（`--check`）
├── LICENSE                          本项目许可
└── THIRD-PARTY-NOTICES.md           第三方许可与致谢
```

> **关于 `速查卡.md`**：各技能末尾原本有一节「附：一页速查」，是正文的压缩复述。
> 速查对**人**有用，但对**已读正文的 agent** 是纯重复——所以抽到文档层：
> agent 加载的 `SKILL.md` 变精简（`multi-agent-squad` 322→149 行），速查仍随手可查，**信息零损失**。
>
> ⚠️ **抽取是一次性的，所以速查卡会与正文"悄悄分叉"**（正文改了修正、速查卡留旧说法，
> 而且**没有任何工具会告诉你**）。因此加了漂移检测：
>
> ```powershell
> node scripts/extract-cheatsheets.mjs --check    # 退出码 1 = 发现漂移
> ```
> 它把带修正语气的关键短语当"热点"，检查速查卡里是否**仍把旧说法当结论用**
> （会识别 `不是…` / `别…` 这类否定语境，不误报）。**改了技能正文就顺手跑一次。**

### 安装与更新（两条命令）

```powershell
# 把 36 个技能打平安装到 DSH 技能根（含重名检测；只增不删）
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-skills.ps1

# 改完技能后必跑：体检 frontmatter（0 个致命问题才算过）
node validate-skills.mjs --quiet "$env:DSH_HOME\skills"
```

> **为什么需要"打平安装"**：DSH 的技能发现**只认恰好两段路径**（`<根>/<name>/SKILL.md`），
> 而本仓库按桶组织（`engineering/<name>/SKILL.md`）是**三段** → 扫不到。
> 不安装就只能"按绝对路径读"，会绕过三段式派活协议，形成两套调用姿势。
>
> **装完或改完要开新会话**（技能目录刷新是异步的）。
> 细节、调用策略语义与排错见 [`DSH-INTEGRATION.md`](./DSH-INTEGRATION.md)。

### 质量闸门（把"清单"变成"机制"）

本体系的核心铁规是「**能自动化的闸门，就不要靠纪律**」。`scripts/quality-gate.ps1` 是这条铁规的落地：

```powershell
# 15 项检查（默认跑 14 项；测试项 E1 需 -IncludeTests）。零依赖即可跑，只用 git / python / node
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/quality-gate.ps1 -Path . -IncludeTests -Json gate-report.json
```

覆盖：**密钥泄漏 / 硬编码凭证 / 敏感配置忽略规则 / 依赖漏洞 / 锁文件 / SAST / 危险模式 / 环境示例 / CI / 运行手册 / 测试**。

**设计要点**：
- **不撒谎**：专业工具（gitleaks / semgrep / pip-audit / ruff）未装则 **SKIP 并打印安装命令**，不假装通过；
  摘要里**始终**提示"有多少项被跳过、覆盖不完整"。
- **第四档「没跑成」**：工具装了、也跑了，但**没能得出结论**（实测：`pip-audit` 连不上 PyPI、
  `npm audit` 连不上 registry）⇒ 记 **NOTRUN** 并在摘要里单独一块列出，
  **既不算通过、也不算"你的项目有问题"**。并进 FAIL 会制造假警报、把旁边的真问题淹掉；
  并进 SKIP 又会变成"没查却说查过了"——那正是本库最反对的那种病。
- **退出码可进 CI**：`0` 通过 · `1` 有 FAIL · `2` strict 模式下有 SKIP · **`3` 有「没跑成」**。
  **`3` 不是通过**：CI 里看到它，正确反应是"补环境重跑"，不是"大概没问题"。
- **已验证**：在真实项目上跑出过真问题；并用**种入缺陷的假仓库**做过负向测试
  （硬编码密钥 / `eval()` / `shell=True` / 无锁文件 / 无 CI / 无运行手册 **全部被抓到并定位到行号**）。

接进 CI：把 `scripts/quality-gate.workflow.yml` 复制成项目里的 `.github/workflows/quality-gate.yml`。
与 `production-readiness` 技能的对应关系见该技能「**零、先跑自动闸门**」一节。

---

## 五、使用入口

**入口只有一处：[`从这里开始.md`](./从这里开始.md)**（按"你是哪种情况"给命令）。
本文件不再抄一遍——**抄一遍的那份迟早会和它分叉**（本库已经因为"同一个事实写在多处"出过 3 次不一致）。

三条最短路径（细节都在入口文档里）：

- **做商业项目** → `commercial-squad` 判在哪道闸门 → `product-validation`（**G1 没过不许写产品代码**）→ `fullstack-delivery` → 上线前 `production-readiness`
- **搭 agent 团队** → `multi-agent-squad`：从"只建 `CONTEXT.md`、单 agent 跑通"开始，**按环加人**，别一上来就并行
- **把代码写好** → `ask-matt` 路由 → 主流程（`grilling` → `to-spec` → `to-tickets` → `implement` → `code-review`）

**引入第三方依赖前**先过 [`开源技术引用.md`](./开源技术引用.md) 的「选型四问」——能省掉大量"引入然后又拆掉"的时间。

---

## 六、维护纪律

1. **技能增删或流程变化 → 必须同步更新 `ask-matt`**，否则"路由器在说谎"。
2. **每次新增或修改技能后 → 必跑体检器**（`validate-skills.mjs`）。frontmatter 错误**不报错、不崩溃，只会让技能静静消失**。
3. **正式技能必须在 `README.md` 与 `SKILLS.md` 有条目**，且 `name` 与目录名一致。
4. **不可逆决策落 ADR**，不留在对话里。
5. **改本 README 的机制描述时，必须与 `DSH-INTEGRATION.md` 的事实核对**——机制描述写错会误导所有后续工作。
6. **上面这些别靠记性**：装一次提交前钩子，`git commit` 时自动跑（.ps1 体检 / frontmatter / 内容一致性 / 速查卡漂移）：
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-git-hooks.ps1
   ```
   它用 `core.hooksPath` 指向仓库内的 `scripts/git-hooks`（钩子跟着代码走，不是 `.git/hooks` 里的黑盒）。
7. **改了 `scripts/` 或 `tests/`（检查器 / 闸门 / 钩子 / 样例）→ 必须起一个独立上下文的 reviewer 复审**。
   体系自己的铁律是「同一个 agent 不能既实现又审查自己」，而这条**对库本身最容易失效**：
   检查器是人写的、检查什么是人定的、判绿也是人判的。
   **实测依据（分开算，别夸大成口号）**：本库已出现的三次检查器 bug 里，
   **两次靠独立 agent 拿真实项目跑才暴露**（校验器拒收自己模板的加粗错误行、契约段铺垫被当成端点），
   **一次靠负向测试自己发现**（统计正则只匹配到 2/10 行）。
   所以真正可靠的结论是：**改的人看不出自己的错，需要另一双眼睛或一个会失败的测试**。
   `self-test.mjs` 只能证明"**判据仍然成立**"，证明不了"**判据选对了**"。
   复制即用的提示词模板见 [`从这里开始.md`](./从这里开始.md) 情况 D 的「纪律 6」。
   **技能正文/文档**属**轻量档**：已有机器在跑（frontmatter / 一致性 / 速查卡漂移 / 链接与覆盖率），
   不强制独立复审 —— 把每一处措辞改动都要求复审，只会让这条规矩被忽略。
   ⚠️ **不要伪造这一步**：假装的审查比没有审查更糟，它会让"没人看"看起来像"有人看过"。

---

## 七、许可

本项目采用 **MIT License**（见 [`LICENSE`](./LICENSE)）。

体系内部分技能与文档**衍生自第三方开源项目**，其许可与致谢见：
- [`开源技术引用.md`](./开源技术引用.md) — 引用了哪些开源技术、各自解决了什么问题
- [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md) — 第三方许可全文与逐项归属

**商用前请自行复核第三方许可**（尤其涉及再分发时）。
