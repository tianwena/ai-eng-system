# `state-bad.json` —— 故意的坏样例（给 `state.ps1 validate` 用）

**为什么要有它**：schema 校验曾经只查"字段名有没有被声明" + 几个写死的枚举。
于是 `"confirmed": "true"`（**字符串**）被当成"已确认"，而 schema 里深层对象写的 `required`
（`artifacts.context_md`）**从来没被读过** = 死代码。这类"看着被校验"必须有个会失败的样例钉住。

⚠️ **文件里刻意不写任何说明键**（比如 `_why`）：根对象是 `additionalProperties: false`，
多一个键就会多报一条"未声明字段"，把真正的三条错误淹掉（第一版就是这样，负向样例变成了噪音）。

## 它违反了什么（必须**三条都**被报出来）

| 位置 | 违反 |
|---|---|
| `version` | 类型：`"1"`（字符串）≠ schema 要的 `integer` |
| `artifacts` | 缺必填字段 `context_md`（schema 里写了 required，旧版从不读它） |
| `redline.data_source_ok.confirmed` | 类型：`"true"`（字符串）≠ `boolean` |

## 怎么用（在能起子进程的机器上）

```powershell
# 1) 在**临时目录**里建项目结构 —— 别在仓库根建 .scratch/（复审 L7：旧写法会污染工作区）
$probe = Join-Path $env:TEMP ("state-bad-" + [guid]::NewGuid().ToString('N').Substring(0,6))
New-Item -ItemType Directory -Force -Path (Join-Path $probe ".scratch") | Out-Null
Copy-Item tests\fixtures\state-bad.json (Join-Path $probe ".scratch\state.json")

# 2) 校验：期望**退出码 1**，且上面三条都出现在输出里
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\state.ps1 validate -Project $probe

# 3) 收尾
Remove-Item -Recurse -Force $probe
```

对应地，合法样例（`state.ps1 init` 刚写出来的那份）必须 **exit 0** ——
只测"坏的要拦住"不够，还得测"好的别误报"（否则就是一个永远报警的狼来了闸门）。
**注意**：`state.ps1 init -Project <目录>` 要求该目录**已经存在**，否则 `Resolve-Path` 会直接报错
（复审 L7 实测）—— 先 `New-Item -ItemType Directory` 再 init。

## 实测记录（2026-09-13，Windows PowerShell 5.1）

| 场景 | 期望 | 实测 |
|---|---|---|
| `init` 基线 | exit 0 | ✅ `✓ 状态合法（phase=idea tier=tech）` |
| 带一条 `history` | exit 0 | ✅ |
| `deadline: null` | exit 0 | ✅ |
| 本文件（三条违反） | exit 1 + 三条都报 | ✅ 三条路径全部报出 |
| `confirmed` 是字符串 | exit 1 | ✅ `state.redline.data_source_ok.confirmed: 类型应为 boolean，实际是 string（"true"）` |
| `passed` 是字符串 | exit 1 | ✅ `state.gates.tech_redline.passed: ...` |
| 缺 `context_md` | exit 1 | ✅ `state.artifacts: 缺必填字段 context_md` |
| `version` 是字符串 | exit 1 | ✅ `state.version: 类型应为 integer，实际是 string（"1"）` |
| `blockers` 不是数组 | exit 1 | ✅ `state.blockers: 类型应为 array，实际是 object` |
| blocker 缺 `needs` | exit 1 | ✅ `state.blockers[0]: 缺必填字段 needs` |
| gate 有未声明字段 | exit 1 | ✅ `state.gates.g1: 有 schema 未声明的字段 extra` |
| `history` 缺 `to` | exit 1 | ✅ `state.history[0]: 缺必填字段 to` |
| `tier` 枚举错 | exit 1 | ✅ `state.tier: 只能是 tech / commercial` |
| `project` 长度 0 | exit 1 | ✅ `state.project: 长度不能小于 1（实际 0）` |

**本机限制（如实记）**：`self-test.mjs` 里那条 F6 用例是**静态**的 ——
本沙箱禁止 `spawnSync`，跑不了 PowerShell，所以上面这张表是**手工跑出来的**，
需要在能起子进程的机器上用 `node scripts/verify-all.mjs` 复跑才算入账。

## 🔧 改 `.ps1` 的人必读：BOM 会被工具吃掉

实测：编辑 `scripts/state.ps1` 后 UTF-8 BOM 丢了 → PowerShell 5.1 按 ANSI 读 →
中文全成乱码、脚本报一堆 `Unexpected token`。补 BOM 的两行（改完 `.ps1` 就顺手跑）：

```powershell
$p = "scripts\state.ps1"
[System.IO.File]::WriteAllText($p, [System.IO.File]::ReadAllText($p), (New-Object System.Text.UTF8Encoding($true)))
```

（`scripts/verify-ps1.mjs` 本来就在管这件事，但它在禁止起子进程的环境里会诚实报 exit 3 ——
闸门跑不动的时候，"手工补上并核验字节"比"假装过了"强。）
