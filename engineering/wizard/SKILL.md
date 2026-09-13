---
name: wizard
description: "生成一个交互式向导脚本，引导人走完只有他们能执行的步骤。用于开通基础设施、配置凭据或 CI 密钥、走一遍陌生的第三方后台，或跑一次性的迁移或割接。**不要**用它处理 agent 自己就能做的步骤。（Generate an interactive wizard script that walks a human through steps only they can perform. Use when provisioning infrastructure, setting up credentials or CI secrets, walking an unfamiliar third-party dashboard, or running a one-off migration or cutover. Don't invoke this for steps the agent can perform itself.）"
---

# Wizard（向导）

一个 **wizard（向导）** 是一个脚本，一步一步引导人走完一套手工流程——这套流程手工做很烦，每次跟 AI 重新解释一遍也很烦。它逐个打开 URL，明确说明该点哪里、复制什么，采集各值，把它们写到该去的地方（`.env`、CI secrets），每个阶段都确认，并显示还剩几个阶段。它可能配置第三方服务、跑一次性迁移，或者把项目从一个状态搬到另一个状态。

向导默认是**一次性的**——为一次运行而建，存到 scratch 或 `scripts/` 路径下，事情做完就删。只有当用户想要一条**可重复**的、应该活在仓库里的安装路径时，才提交它。

## 0. 先选平台（**别默认写 bash**）

| 平台 | 模板 | 语法验证 |
|---|---|---|
| **Windows / PowerShell**（本工作区默认） | [`template.ps1`](template.ps1) | 见下面第 4 步 |
| Linux / macOS / WSL / Git Bash | [`template.sh`](template.sh) | `bash -n <script>` |

**两个模板提供同一套 UX**，辅助函数一一对应：

| 用途 | PowerShell | bash |
|---|---|---|
| 开场 | `Write-Banner` | `banner` |
| 阶段 | `Start-Stage` | `stage` |
| 说明 / 动作 / 提示 | `Write-Say` / `Write-Step` / `Write-Note` | `say` / `step` / `note` |
| 警告 / 成功 | `Write-Warn` / `Write-Ok` | `warn` / — |
| 打开 URL | `Open-Url` | `open_url` |
| 暂停 / 确认 | `Wait-Pause` / `Confirm-Action` | `pause` / `confirm` |
| 取值（明文/隐藏） | `Read-Value` / `Read-Secret` | `ask` / `ask_secret` |
| 写 .env | `Set-EnvValue` | `write_env` |
| 写 CI secret / var | `Set-RepoSecret` / `Set-RepoVariable` | `set_secret` / `set_var` |
| 收尾摘要 | `Complete-Wizard` | `finish` |

### ⚠️ PowerShell 模板的硬性要求（已实测踩过）

**`.ps1` 文件必须存成 UTF-8 __带 BOM__（或 GBK），否则中文会解析失败。**

Windows PowerShell 5.1 对**无 BOM 的 UTF-8 脚本**按系统 ANSI 码页（中文机器是 GBK）解码，
中文字节会吞掉字符串的结束引号 → 报 `The string is missing the terminator`。

```
UTF-8 无 BOM  → ❌ 报错（PS 5.1，中文 Windows）
UTF-8 带 BOM  → ✅ 正常
GBK           → ✅ 正常
```

**写文件时显式指定编码**：

```powershell
[System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($true)))
```

> 另外两条本模板已避开的坑（你写自己的脚本时同样注意）：
> - **函数名不能用 `Test-*`**：PowerShell 保留 `Test-` 前缀给参数语法（如 `-IsInteractive`）。本模板用 `TestWizardInteractive`。
> - **注释分隔线用 ASCII `---`**，别用 box-drawing 字符 `─`（会被解析器当成运算符）。

## 流程

### 1. 界定流程范围

搞清楚人必须走的每一个手工步骤，以及沿途采集的每一个值。**先读仓库**——不要冷着问：

- 对安装配置：`.env`、`.env.example`、`.env.*`、`README`、`docker-compose*`、框架配置，以及 `.github/workflows/*`（每一个 `secrets.*` / `vars.*` 引用都是向导必须产出的值）。
- 对迁移或状态转换：当前状态、目标状态，以及两者之间不可逆的动作。

然后把有序的阶段清单和每个阶段产出的值给用户看并确认——他们可能会增、删或调整顺序。

**完成条件：** 每个阶段都按顺序命名了；对每个采集的值你都知道 (a) 人从哪里拿到它，(b) 它写到哪里（`.env`、一个 CI secret、两者都要，还是哪里都不写——有些阶段是纯动作），(c) 它是密钥（隐藏输入）还是公开的。

### 2. 画出每个阶段的路径

对每个阶段，写出人要走的确切路径：打开哪个 URL、在那里做什么、值显示在哪、填哪个变量——例如 "Dashboard → Developers → API keys → Reveal test key → copy"。凡是你不确定当前 UI 或确切命令的地方，就说出来并问用户或查文档——**绝不要编造可能不存在的步骤**。

**完成条件：** 每个阶段都能追溯到一段陌生人也能照做的具体指令。

### 3. 撰写向导

把**对应平台**的模板复制到目标路径（`.ps1` 或 `.sh`）。把示例阶段替换成每个步骤一个阶段，按依赖顺序排列。使用库里已有的辅助函数，并把阶段总数设对（PowerShell 用 `$TOTAL_STAGES`，bash 用 `TOTAL_STAGES`）。**不要手改标记之上的库**——那部分在每个向导里都完全相同，一致性正是重点。

守住模板设定的标准：**先打开 URL 再索要它的值**；任何密钥都用隐藏输入（`Read-Secret` / `ask_secret`）；每个要持久化的值都写进 `.env`；只对 CI 真正需要的值写 secret；**任何不可逆动作前都确认**。每个阶段都会清屏，所以只有当前步骤可见——**一个阶段只做一件聚焦的事**，免得人需要看的内容被滚走。

### 4. 验证并交接

**PowerShell**：

```powershell
# ① 语法检查（等价于 bash -n），输出应为空
$e=$null; $null=[System.Management.Automation.Language.Parser]::ParseFile($p,[ref]$null,[ref]$e); $e

# ② 确认带 BOM（前 3 字节应为 EF BB BF）
$b=[System.IO.File]::ReadAllBytes($p); '{0:X2} {1:X2} {2:X2}' -f $b[0],$b[1],$b[2]
```

**bash**：`bash -n <script>`；有 `shellcheck` 就跑一下；`chmod +x <script>`。

**端到端不要自己跑**——它会打开浏览器并阻塞在人的输入上。改为：

- **静态追踪**：第 1 步列出的每个值都被采集、并落到第 1 步说的地方；每个 secret 的名字都精确匹配 CI 里的某个 `secrets.*` 引用。
- **库可以单独测**：把标记（`# STAGES` / `# STAGES —`）以上的部分抽出来 dot-source，然后对 `Set-EnvValue` / `Get-EnvValue` / `Confirm-Action` 等做断言。
  非交互环境下 `Wait-Pause` 与 `Confirm-Action` **会自动跳过、不阻塞**，所以能安全地跑自动化测试。

最后告诉用户怎么运行它。如果它是一条可重复的安装路径，就提交它并从 README 链接过去，让下一个人跑这个脚本，而不是去问 AI。
