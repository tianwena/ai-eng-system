# 第三方许可与致谢（Third-Party Notices）

本体系包含**衍生自第三方开源作品**的部分。按各作品的许可要求，此处保留其版权声明与许可全文。

> 引用清单与"用在哪、解决什么问题"见 [`开源技术引用.md`](./开源技术引用.md)。

---

## 1. Matt Pocock — `mattpocock/skills`

**影响范围**：`engineering/` 与 `productivity/` 下的**工程纪律类技能**（逼问澄清、规格与工单、TDD、双轴审查、诊断环路、深模块设计、领域建模、分诊、向导等）**衍生自该项目 v1.2.3**。

**本体系所做的改动**：重写为中文；补齐 DSH 兼容的调用策略字段；修正 frontmatter 的 YAML 引号问题；修正描述长度超限；`setup-workspace-discipline` 由原名 `setup-matt-pocock-skills` 改名；新增 PowerShell 向导模板；并新增 10 个编排与商业落地技能、多份文档与体检工具。

**许可证**：MIT

```
MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 2. 方法论与著作（非代码，引用其思想）

以下为**公开方法论与出版物**，本体系借鉴其概念并重写为可执行技能，**未复制其文本**：

| 来源 | 借鉴内容 |
|---|---|
| Eric Evans，《领域驱动设计》（Domain-Driven Design） | 统一语言（ubiquitous language）、术语表、限界上下文 |
| Andrew Hunt & David Thomas，《程序员修炼之道》 | 曳光弹（tracer bullet）、小而审慎的步骤、反馈速率 |
| Martin Fowler，《重构》（Refactoring） | 代码坏味道清单（12 条基线） |
| John Ousterhout，《软件设计哲学》 | 深模块 / 浅模块、接口与实现复杂度 |
| Kent Beck | "每天都投资于系统设计"、红-绿-重构 |

> 这些为**思想引用**，其著作权归原作者与出版方。本体系不含其原文。

---

## 3. 工具与标准（作为依赖或参照，未内嵌代码）

| 名称 | 用途 | 许可备注 |
|---|---|---|
| **DeepSeek Harness（DSH）** | 运行载体（子 agent、工作流、技能加载） | 专有软件，本体系仅为其技能输入，不分发其代码 |
| **`yaml`（eemeli/yaml）** | frontmatter 解析；体检器**引用 DSH 自带的该包** | ISC |
| **Chokidar** | 技能目录监视（DSH 内部使用） | MIT |
| **PowerShell 5.1 / 7+** | `template.ps1` 的运行环境 | MIT（PowerShell 本身） |

**仅作为"建议接入的外部工具"列出、未内嵌任何代码的**（见 `开源技术引用.md` 第四节）：
Semgrep、Trivy、gitleaks、trufflehog、Playwright、k6、Sentry、LiteLLM、pip-audit 等。
这些各自适用其上游许可；**采用前请自行核对其许可条款**。

---

## 4. 商用前必读

1. **再分发本体系**时，必须一并保留本文与 [`LICENSE`](./LICENSE)。
2. **`engineering/` 与 `productivity/` 的工程纪律类技能**含第 1 节所述的第三方衍生内容，
   其 MIT 许可**允许商用**，但**要求保留版权声明**——即本文不得删除。
3. **第四节所列外部工具**若被接入你的产品，其许可与合规责任**由你自行确认**。
4. 涉及支付、隐私、数据的合规章节（`production-readiness` F 节、`payment-and-billing`）**仅为检查项清单，不构成法律意见**；
   具体法域要求请咨询专业人士。
