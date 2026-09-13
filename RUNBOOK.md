# RUNBOOK —— 这套体系自己的运行手册

> **为什么有这个文件**：`quality-gate.ps1` 的 D3 检查要求"有运行手册"，
> 而本库过去**没有** —— 于是体系对自己的重型闸门永远红一条。这份文件把那条红消掉，
> 靠的是**把东西补上**，不是把判据关掉。
>
> ⚠️ 先说清楚：**本库不是服务、不部署、没有常驻进程**。所以它没有"值班/告警/回滚生产"那一套；
> 下面的"回滚"指**把这套工具回退到一个已知可用的版本**。这与一个真上线系统的 RUNBOOK 不是一回事，
> 别照抄到那种项目上（那种项目要看 `engineering/launch-and-ops`）。

## 1. 装上（一次性）

```powershell
# ① 装技能（36 个，打平到技能根）
powershell -NoProfile -ExecutionPolicy Bypass -File <库根>\install-skills.ps1

# ② 装提交前钩子（可选但建议：改动会先过自检）
powershell -NoProfile -ExecutionPolicy Bypass -File <库根>\scripts\install-git-hooks.ps1
```

装完**开新会话**（技能目录刷新是异步的）。

## 2. 怎么确认它现在是好的（每次改动后都跑）

```powershell
node <库根>\scripts\verify-all.mjs          # 6 步：技能体检/一致性/闸门完整性/速查卡/自检
node <库根>\scripts\verify-clean-clone.mjs  # 干净房间：clone 到临时目录重跑（验"已提交的版本自足"）
```

判读口径（**这是本手册最重要的一节**）：

| 退出码 | 含义 | 你该做什么 |
|---|---|---|
| `0` | 全跑完了，没发现问题 | 没事 |
| `1` | **有真失败** | 看输出的 FAIL 行，改完重跑 |
| `2` | strict 模式下有 SKIP（覆盖率不完整） | 补工具或明确接受 |
| `3` | **有"没跑成"** | **这不是通过** —— 缺环境（多数是网络/凭据）或缺少可审对象 |

> **"没跑成 ≠ 通过"** 是这套体系的核心教条。看到 `3` 时，正确的反应是"我去把环境补齐再跑"，
> 不是"大概没问题"。

## 3. 常见故障与处理

| 症状 | 原因 | 处理 |
|---|---|---|
| `pip-audit` / `npm audit` 报"连不上" | 这两个要访问 PyPI / registry.npmjs.org，网络或代理挡了 | 换有出网的网络重跑；**它不是"没有漏洞"**（闸门会记 NOTRUN 并给出非 0 退出码） |
| `semgrep` 报"没扫出结论" | `--config auto` 要联网拉规则 | 联网重跑，或 `semgrep scan --config <本地规则>` |
| `gitleaks` 报了泄露 | 历史里真有密钥形态的字符串 | **先看是不是样例/夹具**：那一行若有 `redline-allow` 会被自动放行（见 `.gitleaks.toml`）；不是样例就按泄露处理 |
| 自检里大批中文断言失败 | 控制台代码页不是 UTF-8 | 用 `chcp 65001` 再跑；自检现在会**自己临时归一并在退出时还原** |
| `.ps1` 报几十个语法错、中文乱码 | 文件被存成了无 BOM | 确认前三个字节是 `ef bb bf`；`Get-Content -Raw` 读它们要加 `-Encoding UTF8` |
| 提交被钩子拦住 | 钩子跑了自检/一致性且没过 | 按它打印的那一节修；**别 `--no-verify`**（那等于关掉闸门） |

## 4. 升级与回滚

**升级**（改了库、或拉了新版本之后）：

```powershell
node <库根>\scripts\verify-all.mjs            # 必须 0；3 或 1 都别往下走
powershell -NoProfile -ExecutionPolicy Bypass -File <库根>\install-skills.ps1   # 同步已装技能
```

**回滚**（新版本把某个检查器改坏了）：

```powershell
cd <库根>
git log --oneline -10                 # 找到上一个已知可用的提交
git revert <坏的提交>                  # 首选：留下一条可追溯的回滚提交
node scripts\verify-all.mjs           # 回滚后必须再验一次
```

> ⚠️ 也可以 `git checkout <好提交> -- scripts/`，但那**只恢复 `scripts/` 一个目录** ——
> 有些提交还改了 `.gitleaks.toml`、`tests/fixtures/`、文档。**回滚要按那次提交实际碰过的路径来**，
> 或者干脆用 `git revert`（它按提交整体回退，不会漏）。
> 这条是第六轮复审指出的：原来的写法会让人以为"回滚 = 恢复 scripts/"。

改过 `scripts/` 之后，按规矩要**起一个独立上下文的 reviewer**（同一个 agent 不能既改又判）；
结论写进 `docs/reviews/<日期>-<基点sha>.md`。

## 5. 出了事怎么查（本库的三条排查路径）

1. **先看退出码是哪一档**（0/1/2/3）—— 90% 的误判发生在把 3 当成 0。
2. **再跑 `verify-all.mjs`**：它会把每一步的名字与脚本印出来；某一步"没跑成"会单独标。
3. **要看某个检查器自己的判断依据**：直接单独跑它（`check-consistency.mjs` / `verify-ps1.mjs` /
   `verify-gate-integrity.mjs` / `self-test.mjs` / `quality-gate.ps1 -Path .`）。

> 报告类文件（`gate-report.json` 等）**是某一次运行的快照，不是状态文件** ——
> 它会一直躺在项目根，然后被下一个人当成当前结论。别把它留在项目根。

## 6. 这份手册什么时候必须改

- 退出码语义变了（比如又加了一档）
- 新增/删除一个顶层脚本（自检与一致性检查会强制你同步文档）
- 换了"怎么跑才算过"的口径

> 与本手册配套的真相来源：脚本清单看 `README.md` / `从这里开始.md`，
> 数字真值看 `scripts/facts.json`，历年复审留痕看 `docs/reviews/`。
