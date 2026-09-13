# 复审任务书 · 第六轮（审 `c921ef9`，基线 `e13bfd9`）

> **怎么用**：在一个**全新窗口**里执行本任务（独立上下文 = 本库纪律要求的"不能既改又判"）。
> 把下面「任务正文」整段发给新窗口的 agent 即可；它看得到这个仓库，但**不应该**看改动者的推理过程。
> 跑完把报告保存为 `docs/reviews/2026-09-13-c921ef9.md`（与本文件同一目录，命名沿用 `<日期>-<基点sha>`）。
>
> **为什么不用子代理**：本会话第一次用子代理跑这轮复审时，**DSH 桌面版的本地服务在
> 2026-09-13T06:47:36Z（= 本地 14:47:36）重启了一次**，界面报 `Failed to fetch (internal)`，
> 子代理没有产出结论。日志里**没有堆栈**，所以原因无法判定（时间吻合，但不能证明因果）。
> 为不再触发它，这轮改由**新窗口**执行。

---

## 任务正文（下面整段发给新窗口）

你是**独立复审 agent**。任务：**尝试证伪**下列声明，不是确认。库根 `<库根>`。

只审**一个提交**：`c921ef9`（`git show c921ef9 --stat`、`git diff e13bfd9..c921ef9`）。基线 `e13bfd9`。

背景：上一轮判定"体系能给自己过重型闸门"这一环没闭环，缺口四件。这个提交把它们补完了。
你要做的是**证明这四件补得对不对、有没有引入新问题**。

### 要逐条证伪的声明

1. **豁免约定统一了，而且不是"把规则关掉"**
   - `.gitleaks.toml` 用 `regexTarget = "line"` + `redline-allow` 放行 ⇒ 在库根跑 `gitleaks detect`
     应当**0 泄露**。
   - 关键证伪点：**它是"按行"还是"按文件"？** 请构造一个**新的** git 仓库（`$env:TEMP` 下），
     提交两行：一行含 `redline-allow` + 一个假密钥，另一行**只有**假密钥**不带**标记。
     期望：带标记的放行、**不带的必须仍被抓到**。如果两行都被放行 ⇒ 声明不成立。
   - 反向验证：把 `.gitleaks.toml` 改名移开 ⇒ 库根应当**重新报出泄露**（证明配置是"豁免"而不是"静音"）。
   - semgrep 侧：`semgrep scan --config auto --error --quiet` 在库根应当 **0 findings**。
     请检查那 7 行 `// nosemgrep:` 的**作用域**：是不是"所在行"？随便挑一行，把标记挪到**上一行**，
     看是否失效（验证它对位置敏感 = 不是全局关规则）。
2. **`NOTRUN` 第四档与退出码 3**
   - 构造"连不上网"的情形（例如临时把 registry 指向不存在的地址，或用 `$env:HTTP_PROXY` 指向
     一个死端口）验证 `pip-audit` / `npm audit` 落进 **NOTRUN**、退出码 **3**。
   - **反向风险（最重要）**：`Test-NotRunOutput` 的正则会不会把**真失败**误判成 NOTRUN？
     例如 pip-audit **真的报出一个漏洞**时，它的输出里有没有可能命中那串正则
     （`ssl` / `certificate` / `proxy` / `read timed out` / `no packages found`…）？
     请**实际构造**一份带已知漏洞的 `requirements.txt`（或用 `-r` 指向一个含老版本包的清单），
     看它是 FAIL 还是被误判成 NOTRUN。**误判成 NOTRUN 比误判成 FAIL 更危险**（真问题被降级成"没跑成"）。
   - 退出码 3 会不会打断别的消费方：`verify-gate-integrity.mjs`、`.github/workflows`、
     `scripts/quality-gate.workflow.yml` 里读退出码的地方，逐处说明。
3. **semgrep 22 → 0 的处置是否站得住**
   - 8 处可变 action tag 被钉成 SHA。请用 `git ls-remote <repo> refs/tags/<tag>` **独立核对**
     四个 SHA 是否真的是 `actions/checkout@v4`、`actions/setup-node@v4`、`actions/setup-python@v5`、
     `actions/upload-artifact@v4` 指向的提交。**SHA 写错会让 CI 直接跑不起来**，这是硬伤。
   - 5 处 `spawn-shell-true` 从 `{ shell: true }` 改成显式 `cmd.exe /c`：有没有改坏行为？
     （`self-test.mjs` 里读控制台代码页那条路径，请在 936 与 65001 两种控制台下各跑一次自检。）
   - 2 处带理由豁免的 `detect-non-literal-regexp`：理由（正则来自钉死的白名单）**是否属实**？读代码确认。
4. **部署类取舍**
   - `RUNBOOK.md` 里的命令是否**真能跑**（逐条核；特别是回滚那几条）。
   - **D1 的新规则有个明显风险请重点查**：现在"项目里没有部署配置 ⇒ SKIP"。但部署配置的清单
     （`Dockerfile`/`compose`/`Procfile`/`deploy.ps1`…）**本身是一张白名单** —— 与上一轮抓到的
     "扩展名白名单"是同一种病。请构造一个**确实要部署、但配置文件不在清单里**的项目
     （例如 `docker/` 目录 + `systemd/` 单元 + `Makefile` 里的 deploy 目标），
     看它是否被**错误地 SKIP 掉**（本该 FAIL）。**这一条如果成立，就是新引入的漏报。**
5. `node scripts/verify-all.mjs` → 6 步全 PASS、55/55；`node scripts/verify-clean-clone.mjs` → 干净环境全过。

### 额外请你主动找
- 这一轮改动里**有没有新的恒真断言 / 说法与事实不符**（注释、输出、文档都算）。
- `quality-gate.ps1` 新增的 `NOTRUN` 有没有破坏"少项总闸"（`$expectedIds` / `verify-gate-integrity` 的
  钉住清单）——**故意让某条不产出**，看总闸还响不响。
- 库自己的重型闸门现在是 `FAIL 0 / NOTRUN 2 / SKIP 3, exit 3`：请**独立复算**这 14 项的状态，
  确认没有哪一项被错误地记成 PASS。

### 环境约束（别把环境限制当产品 bug）
- Windows **PowerShell 5.1**；`scripts/*.ps1` 是 **UTF-8 带 BOM**（改动后 BOM 掉了会让语法检查假报错）；
  `.mjs` 按 `.gitattributes` 用 **LF**。
- 退出码用 `Start-Process -Wait -PassThru -RedirectStandardOutput`；**别**用
  `cmd /c "… & echo %ERRORLEVEL%"`（那个报的是陈旧值）。
- 本机 `chcp` 可能是 936 而 `[Console]::OutputEncoding` 是 65001；自检开头会临时归一并在退出时还原。
- 样例一律放 `$env:TEMP`（**别在库内建临时目录**，那会污染 `script-inventory`），跑完删掉。
- **不要改库里任何文件**、不要 `git add`/`commit`。

### 输出格式
```
## 复审报告：c921ef9（第六轮）
### 1. 五条声明逐条判定（命令 + 原始输出片段）
### 2. 新发现的问题（按严重度，附复现构造）
### 3. 说法与事实不符之处
### 4. 总判定：可以收尾 / 必须改（必改项附证据）
```
无法判定就写"无法判定"并说明缺什么条件，**不要猜**。
