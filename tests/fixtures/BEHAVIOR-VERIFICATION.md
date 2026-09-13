# 行为验证协议：schema 校验（F6）与 ruff 配置发现（F7）

> **为什么单独一份协议**：这两项的真实判据只有跑起来才知道（`state.ps1 validate` 的**行为**、
> ruff 到底读哪份配置）。而 `self-test.mjs` 里能写的只有**静态**断言 ——
> 它靠 `spawnSync` 调 PowerShell，在禁止起子进程的环境里（如某些沙箱）整块跑不动。
> **静态用例证明不了行为**，所以行为验证单独落成这份协议：**先写判据，再跑，再记账**。

## 一、F6 · `state.ps1 validate` 必须真的按 schema 查

**跑的判据**（先写死，别看完结果再改）：

| 场景 | 期望 |
|---|---|
| `state.ps1 init` 刚写的合法状态 | **exit 0** |
| 合法状态 + 一条 `history` | **exit 0** |
| 合法状态 + `deadline: null` | **exit 0** |
| `tests/fixtures/state-bad.json`（三处违反） | **exit 1**，且三处**都**报出具体路径 |
| 单点违反 ×10（见 `state-bad.README.md` 的表） | 各自 **exit 1**，各报具体路径 |

**怎么跑**：

```powershell
# 坏样例
# ⚠️ 全都在**临时目录**里做，别在仓库根建 .scratch/（复审 L7：旧写法会往仓库根建目录）
$probe = Join-Path $env:TEMP ("ctx-" + [guid]::NewGuid().ToString('N').Substring(0,6))
New-Item -ItemType Directory -Force -Path (Join-Path $probe ".scratch") | Out-Null

# 坏样例
Copy-Item tests\fixtures\state-bad.json (Join-Path $probe ".scratch\state.json")
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\state.ps1 validate -Project $probe

# 合法样例（state.ps1 init 要求目录**已存在**，否则 Resolve-Path 直接报错 —— 复审 L7 实测）
$good = Join-Path $env:TEMP ("ctx-ok-" + [guid]::NewGuid().ToString('N').Substring(0,6))
New-Item -ItemType Directory -Force -Path $good | Out-Null
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\state.ps1 init -Project $good
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\state.ps1 validate -Project $good

Remove-Item -Recurse -Force $probe, $good
```

**实测账（2026-09-13，Windows PowerShell 5.1）**：13 个场景全部符合预期（明细见
`state-bad.README.md` 的表）。**本机未跑**：没有任何场景在本沙箱里跑过 ——
这里禁止起子进程（EPERM），所以那些结果是手工执行的。

## 二、F7 · ruff 规则集标签不能贴错

**为什么**：ruff **向上找配置**（项目根 → 上级 → … → 磁盘根）。旧版只看项目根，
于是嵌在别的仓库/用户主目录里的项目会被贴错标签 —— 而**标签错了，报出来的错误数就没法解读**
（实测踩过：209 errors 被当成"不能上线"，其实多数是默认规则集里的风格债）。

**验证方式**：抽出 `quality-gate.ps1` 里的 `Get-RuffRulesetLabel` **函数本体验证**
（不另抄一份 —— 抄一份就又制造一处会分叉的副本），在临时目录树里断言标签：

| 目录树 | 期望标签 |
|---|---|
| 根下无配置、上级也没有 | `NO config found` |
| 上级有 `ruff.toml` | `INHERITED`（旧版会谎报 `NO config found`） |
| 上级 `pyproject.toml` **无** `[tool.ruff]` | `NO config found`（不能因为有个 pyproject 就算配置） |
| 上级 `pyproject.toml` **有** `[tool.ruff]` | `INHERITED` |
| 自己与上级都有 | `project config: ruff.toml`（较近的那份生效） |
| 上级有 `.ruff.toml` | `INHERITED` |

**实测账（2026-09-13）**：6/6 通过，标签逐条核对过。
**本机未跑**：同上，本沙箱里起不了 PowerShell；那次是手工跑的。

## 三、`$expectedIds`：我第一版修错了，记在这里别重犯

复审原话：**`$expectedIds` 是手写的第二份真相源且无人覆盖** —— 删掉闸门里一行 `Add-Result 'E1'`，
所有检查器全绿，因为"期望清单"跟着一起"对"了。

❌ **第一版修法（错的）**：把期望清单改成"从闸门源码现算"。
那是把**手抄的副本**换成**自动生成的副本** —— 一点没解决问题：源码少一项，现算结果也少一项。

✅ **第二版（对的）**：期望清单**钉在闸门外面**（`scripts/verify-gate-integrity.mjs` 的
`PINNED_GATE_IDS`）。"删检查"这个动作于是**无法在闸门内部闭合** —— 要么补回检查，
要么显式改钉住的清单（那是看得见的动作）。

**实测（2026-09-13）**：

| 变异 | 结果 |
|---|---|
| 只删 `Add-Result 'E1'` 里的一行 | **不响** —— E1 有 6 个产出点（互斥分支），删一个不影响它产出。**这不是判据的洞，是变异选错了** |
| 删掉整个 E 段 + `$expectedIds += 'E1'` 那行 | ✅ 静态判据报红：`这些检查项**只剩注释里提到了**：E1` |

⚠️ **顺带抓到我自己造的假绿**：第一版静态判据用"源码里还有没有 `Add-Result 'E1'`"来判，
而我**自己写的那句解释性注释里**就有这个字样 —— 于是 E 段被整段删掉之后，正则照样"解析到" E1，
静态核对假绿。现在剥掉注释再确认一次（`commentOnly`）。

**钉住的清单要跟着改**：给闸门加检查项时，`PINNED_GATE_IDS` 必须同步加，
否则 `self-test` 里那条"钉住的清单 ⇄ 闸门源码"用例会红（这是设计好的，不是麻烦）。

## 四、真机第一次跑 `verify-all` 抓到了什么（2026-09-13，记账）

**结论：34 条自检用例里 2 条红，两条都是"自检脚本自己的期望写错了"，产品代码没问题。**
这正是"本机跑不动 ⇒ 必须在真机复跑"的价值 —— 沙箱里那 34 条一条都没跑过。

| 红的用例 | 根因 | 修法 |
|---|---|---|
| `quality-gate 必须产出源码里声明的每一项` | **用例自相矛盾**：跑闸门时**没带 `-IncludeTests`**（E1 那一段不执行、不产出），却拿"源码现算的期望"（把 E1 一起算进去了）去比对 → 注定红 | 跑闸门时加 `-IncludeTests`；期望集 = 源码声明的全部，语义才干净 |
| `入口文档标题的脚本数（中文数字）被改错` | **变异选错了**：改成**单字**中文数字，而 claim 正则是 `[一二三四五六七八九十]{2,}` → **命中 0 处**，红的是"锚点失效"（registered-claims），不是要断言的数字核对（script-count-cn） | 变异改成**两字**中文数字。**我在临时验证器里用的就是两字的，两者不等价 —— 我漏了这一层，真机才照出来** |

⚠️ **这两个修法本身还没在真机上验证过**（本沙箱连 `spawnSync` 都被禁，我根本跑不了闸门）。
按"验证才算完成"的规矩，它们在你下次跑 `verify-all` 通过之前**不算完成**。

### 真机第二次跑（同一天）：又红了 1 条 —— 这次是"变异落空"

| 红的用例 | 根因 | 修法 |
|---|---|---|
| `入口文档标题的脚本数（中文数字）被改错` | **变异字符串过期**：那片段的标题**早就不长那样了**（第三批加了新脚本、标题跟着改）→ `String.replace` 找不到目标就**静默返回原串** → 基线副本根本没被改 → 检查器当然全绿 → 用例报红，**而红的原因跟检查器毫无关系** | ① 变异改成**从文件里现取**那段标题（正则匹配当前数字），不再写死；② **给整个自测套件加一道「变异必须真的改到东西」总闸** |

**这道总闸值得单独说**：`mutate` 跑完，目录指纹（**看内容，不只看大小** —— 本库的变异常是等长替换）必须变化；
没变就直接判"用例坏了，不是闸门坏了"，并打印可能原因。
它把这一整类错误从"靠人看出来"变成"机器每次自己查" —— 真机三次红里有两次属于这一类。

## 五、干净房间验证的账（2026-09-13）

`node scripts/verify-clean-clone.mjs`：**6 步全过 / exit 0**（clone 到临时目录 + `npm ci 0.9s` +
刮干净环境跑 verify-all，34 条自检用例全过）。

### 它顺便教了我一件事：**同一句话可能有三处，我只改了两处**

日志里"闸门完整性"那行一度还显示旧文案（"从闸门源码现算"），而我已经把两处改成"钉在闸门外面"了。
**我当时的判断是"这份 clone 是更早的提交"——那个判断是错的**（我先去核了 `git show HEAD:` 和
`git show master:` 都已是新文案，却没把搜索范围扩大到"这句话一共出现在几个文件里"）。
真相：**同一句话出现在三个地方**，我改了两处，第三处（成功时打印的那一行）漏了。
**教训**：改一句"会被人读到的文案"时，要按**含义**全仓扫一遍，而不是按我记得的那两行去找；
"我以为我已经改完了"不能当证据。

（同一类问题当天还出现过一次：`verify-all.mjs` 里一句注释仍在说"从闸门源码现算"。
两处都已修正，并用"按含义全仓扫"的方式复核过：没有残留。）

## 六、⚠️ 别断言 PowerShell 输出里的**中文**（真机实测的代码页陷阱）

`self-test.mjs` 里有一条用例原本是"跑 `state.ps1 validate`，然后匹配输出里的
「缺必填字段 version」"。真机跑出来是红的，诊断信息（我让用例自己打的）是：

```
（诊断）status=1 error=无
（诊断）stdout="? ״̬�����⣺\n   - state: ȱ �����ֶ� version\n …"
（诊断）stderr=""
```

命令**确实跑了、也 exit 1**，但那句话在 Node 眼里不是中文。

**根因**：Windows PowerShell 5.1 往管道里写的是**控制台代码页**的字节
（中文系统 = GBK/936），而 `spawnSync(..., { encoding: "utf8" })` 按 **UTF-8** 解码 → 中文全成乱码。

**所以：**
- 断言子进程输出时**只用 ASCII 关键词**（`GATE INTEGRITY BROKEN`、`missing`、退出码）——
  现存那几条 gate 用例正好都是 ASCII，所以没踩到
- 要断言中文，就**别走子进程**：读文件（`state.ps1` 的源码、`facts.json`、schema）来推理，
  或者把"行为"交给本文件的手工判据表
- 真要解析中文输出，得先解决编码（例如把子进程的输出按代码页解码）——**这需要一个明确的决定，别顺手写**

**这条坑顺带解释了另一件事**：为什么本库的检查器大多选择"读文件"而不是"看子进程输出"——
读文件没有编码问题，而且判据更接近真相来源。

## 七、F7 的六个手工场景 → 已自动化（2026-09-13）

原来那六个目录树场景只能手工跑（`tmp-f7.ps1` 那种临时脚本，用完即删）。
现在 `quality-gate.ps1 -RuffLabel` 是**纯 ASCII 的独立入口**（逻辑在 `scripts/ruff-label.ps1`），
`self-test.mjs` 里那条用例用小目录树把**七种情形**跑成自动回归：

| 目录树 | 期望摘要 |
|---|---|
| 根下与上级都没有 | `none/no-user-config` |
| 自己有 `ruff.toml` | `project/no-user-config` |
| 上级有 `ruff.toml` | `inherited/no-user-config` |
| 上级 `pyproject.toml` **无** `[tool.ruff]` | `none/no-user-config`（不能误判成有配置） |
| 上级 `pyproject.toml` **有** `[tool.ruff]` | `inherited/no-user-config` |
| 自己与上级都有 | `project/...`（较近者生效） |
| **用户级配置存在**（M8 那一格） | `none/user-config-present` |

两个设计点值得记：
- **`-RuffLabel` 的早退放在"补 PATH"那段之前** —— 放后面时整次调用会去扫 WinGet/Python 目录，
  实测**超时 2 分钟**。要验标签却先跑一遍环境探测，是把简单事做贵了。
- 标签逻辑**单独一份**（`scripts/ruff-label.ps1`）：闸门和早退两条路共用，避免两份定义漂移。

## 八、⚠️ 跑闸门时别把"假家目录"指向不存在的路径（会污染仓库根）

为了在测试里"把工具藏起来"，我们惯用 `USERPROFILE/APPDATA/LOCALAPPDATA` 指向不存在的路径。
**实测**：那样 PowerShell 找不到缓存位置，会**退回当前工作目录**写 `ModuleAnalysisCache` ——
仓库根凭空出现 `Microsoft\Windows\PowerShell\ModuleAnalysisCache`（我用 `git status` 才看见）。

修法：那些"假家目录"改成**真实存在的临时目录**（工具照样隐身，因为不在那儿），
并加了一条用例断言"**跑完闸门后仓库根没有多出目录**"。

## 九、这两项怎么才能"入账"

在**能起子进程**的机器上：

```powershell
node scripts\verify-all.mjs          # 退出码 0 = 全过；1 = 有检查失败；3 = 有检查没跑成
node scripts\verify-clean-clone.mjs  # 干净房间：clone 到临时目录 + 刮干净环境跑全套
```

`verify-all` 现在把"没跑成"单独算一档（exit 3），所以它**不会**再把
"环境起不了子进程"说成"检查失败" —— 但这也意味着：**exit 3 时你没有得到任何结论**，
别把它读成通过。
