#!/usr/bin/env pwsh
<#
.SYNOPSIS
    技术红线审查（轻量版闸门）—— 日常自用项目跑这一遍就够了。

.DESCRIPTION
    为什么分两级：把 G1–G4（商业验证/期限/证据分级）强加在每个项目上，结果是**没人跑**——
    而**一个没人跑的闸门等于没有闸门**。日常自用项目只需要回答"这件事有没有踩线"。

    四项红线（前两项机器查，后两项必须人确认一句）：
      ① 硬编码密钥        [机器]
      ② 无保护的 API 端点  [机器·启发式]  —— 还顺带查 wildcard CORS 与调试模式
      ③ 违法数据源        [人确认]  —— 无授权的爬取 / 数据买卖 / 违反 ToS
      ④ 分发他人内容      [人确认]  —— 打包别人的付费内容/数据

    设计纪律：
      - **轻**：不做全量 SAST、不跑测试、不装依赖。秒级返回。
      - **准**：启发式结果标成"需人过一眼"，不谎报为确定结论；明说局限。
      - **不假装**：机器查不了的两项，要么人答一句，要么就报"未确认"——**不许默认通过**。

.PARAMETER Project
    项目根目录。默认当前目录。

.PARAMETER Quiet
    只输出结论行与退出码（"没跑成"那几行也照输出——它们是结论的一部分）。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File redline-check.ps1 -Project .
    powershell -NoProfile -ExecutionPolicy Bypass -File redline-check.ps1 -Quiet; if ($LASTEXITCODE -ne 0) { "有红线问题" }
#>
[CmdletBinding()]
param(
  [string]$Project = '.',
  [switch]$Quiet
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

# ⚠️ **必须用 `Get-Item` 的 `.FullName`，不能用 `Resolve-Path` 的 `.Path`**（2026-09-13 CI 首跑红的根因）：
#    `Resolve-Path` 会**原样保留**传进来的 **8.3 短名**（本机实测：`-Project C:\Users\<你>\A-VERY~1`
#    → `$root` 就是 `…\A-VERY~1`），而 `Get-Item` / `Get-ChildItem` 给的是**长名**。
#    下游 `Join-Path $root …`（用于 $trackedFull）与 `$f.FullName`（工作区枚举）于是指向
#    **同一个文件却字符串不相等** —— 差的是 `RUNNER~1` vs `runneradmin` 这种，大小写不敏感也救不了。
#    后果：同一个文件被判红一次（"已跟踪"那轮），又被当"未跟踪"再扫一遍 ⇒ 自相矛盾 + 重复计数。
#    这正是 CI 的现象：GitHub Windows runner 的 `TEMP` 形如 `C:\Users\RUNNER~1\…`，
#    自检夹具建在它下面 ⇒ **本机全绿、CI 红**（本机临时目录在长名下，永远碰不到）。
#    ⇒ 判据：路径一律从**同一个 API 家族**取（provider：Get-Item / Get-ChildItem），不靠字符串拼接。
try { $root = (Get-Item -LiteralPath $Project -ErrorAction Stop).FullName }
catch { Write-Host "[FAIL] 项目目录不存在或读不到：$Project" -ForegroundColor Red; exit 1 }
$fail = [System.Collections.Generic.List[string]]::new()
$warn = [System.Collections.Generic.List[string]]::new()
$info = [System.Collections.Generic.List[string]]::new()
# **"没跑成"单独一类**（不是 fail、也不是 warn）：检查项确实没能执行，
# 所以"没发现硬伤"这句话对那一项**不成立**。见下面 ① 的非 git 分支与结论行。
$notRun = [System.Collections.Generic.List[string]]::new()

function Say  { param([string]$t) if (-not $Quiet) { Write-Host $t } }
function Sect { param([string]$t) if (-not $Quiet) { Write-Host ''; Write-Host $t -ForegroundColor Cyan } }
# **结论行不受 -Quiet 抑制**（2026-09-13 独立复审实测：-Quiet 下输出 0 字节，
# 而 `.PARAMETER Quiet` 承诺的是"只输出结论行与退出码"，`.EXAMPLE` 里给机器用的
# 也正是 -Quiet）。后果很实：`-Quiet` + "有整项没跑成" 时，机器通道上**既看不到
# 那句话、退出码又是 0**（用户已裁定退出码保持 0/1）—— 那 N1 在这条通道上等于没修。
# 修法取复审建议的"替代 A"：让结论行（与"没跑成"那几行，它们是结论的一部分）
# 照常输出，退出码一个字不动。
function SayVerdict { param([string]$t, [string]$Color = 'Gray') Write-Host $t -ForegroundColor $Color }

Say ''
Say '=== 技术红线审查（轻量版闸门）==='
Say "项目: $root"

# ══════════════════════════════════════════════════════════════════════════
Sect '① 硬编码密钥'

$scanned = 0
# 非 git 回退扫描的命中（在 else 分支里填）。**在外面先声明**：
# 下面汇总时要读它，而在 `Set-StrictMode -Version Latest` 下引用未定义变量会直接抛异常。
$fbHits = [System.Collections.Generic.List[string]]::new()

# ── ① 的密钥正则：**只此一份**（两条路共用，避免"两条路判据不一样"这种只有人肉对照才看得出的偏差）
# 2026-09-13 独立复审 S8 实测出的漏网（旧正则只认 `sk-` 一种形态，于是下面这些**全都不匹配**）：
#   · `sk-proj-…` / `sk-svcacct-…`（2024 之后 OpenAI 的正式格式；`sk-` 后面紧跟 `-`，旧正则直接断掉）
#   · `AIza…`（Google）· `hf_…`（HuggingFace）· `glpat-…`（GitLab）
#   · **不带引号**的 `.env` 赋值 `OPENAI_API_KEY=…`（旧正则强制要求引号）
#   · `AWS_SECRET_ACCESS_KEY=…`（`secret` 与 `=` 之间隔着 `_ACCESS_KEY`，关键词要单独列）
# 复审的原话值得抄下来：**"未发现硬编码密钥"这句话最常见的说谎方式，就是密钥恰好在这些形态里。**
# 第四轮复审 F5 又抓到一处：键值分支要求 `[:=]` 后**立刻**是值首字符，而 `["'']?` 只吞得下
# 一个引号 —— 于是 JSON 里最常见的写法 `"api_key": "abcdef…"`（键名带引号）**全都不匹配**。
# 现在键名后允许一个可选引号：`(key)["'']?\s*[:=]`。
$pat = 'sk-(proj|svcacct|admin)-[A-Za-z0-9_\-]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_\-]{35}|hf_[A-Za-z0-9]{30,}|glpat-[A-Za-z0-9_\-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?i)(api[_-]?key|apikey|secret|token|password|passwd|access[_-]?key|client[_-]?secret)["'']?\s*[:=]\s*["'']?([A-Za-z0-9_\-/+=]{24,})'

# ── ① 扫文件的两条共用判据（git 与非 git 两条路**共用同一份**）──────────────
# 为什么改成"**反向列**（只排除确知是二进制/资源的）"而不是原来的**正向白名单扩展名**
# （2026-09-13 独立复审 G2 实测抓到）：白名单之外的文件**一个都不扫**，而结论行照样打
# `✓ 未发现硬编码密钥 / 敏感文件泄露` + 光秃秃 `PASS`。复审的构造：`git ls-files` =
# `app.py, schema.sql, settings.rb`，后两个文件里**各有**明文 `api_key`，`$scanned=1`
# ⇒ 工具一路绿。`Gemfile` / `Dockerfile` / `*.go` / `*.php` / `*.java` 也都在白名单外。
# 这与 N1 是**同一句话的无依据断言**，只是换了条路进来 —— 白名单永远列不全，
# 而"二进制/资源"这张清单短得多、也好维护。
$BINARY_RE = '\.(png|jpe?g|gif|webp|ico|bmp|svg|pdf|zip|gz|tgz|bz2|xz|7z|rar|jar|war|exe|dll|so|dylib|bin|pyc|pyo|class|o|a|lib|obj|woff2?|ttf|otf|eot|mp[34]|wav|avi|mov|mkv|db|sqlite3?|parquet|feather|pkl|joblib|npy|npz|onnx|pt|h5|wasm)$'
# 超大文件跳过（多半是数据/资源）。**跳过就要报出来**——静默跳过正是本项要防的事。
$MAX_SCAN_BYTES = 2MB
$skippedLarge = 0
# **行内豁免**：命中那一行里写了 `redline-allow` 就跳过（gitleaks 的 `gitleaks:allow` 同款）。
# 为什么必须有（2026-09-13 实测）：反向列把扫描面放大之后，**本库自己的仓库立刻红了** ——
# 红在 `scripts/self-test.mjs` 里那两行"造一个假密钥当样例"的用例上。
# 测试夹具里放假密钥是**正当做法**，而它长得和真密钥一模一样；没有豁免机制的话，
# 每个带样例密钥的仓库都会**每次都红**，那正是本脚本 .DESCRIPTION 里警告的"狼来了"。
# 设计取舍：豁免必须**写在那一行里**（不是全局开关、不是整文件通配），于是它在 diff 里
# 看得见、能被人评审；而且**豁免本身会被报出来**（$allowed 计数），不静默 ——
# 静默豁免等于给"把真密钥标成豁免"留了个后门。
$ALLOW_RE = '(?i)redline-allow'
$allowed = 0
# 被豁免的命中（文件名:行号）。只报一个数字等于"有痕迹但极弱"——复审 §3 的原话。
$allowedList = [System.Collections.Generic.List[string]]::new()
# 四类"没扫"的计数器：两条路各自只会填其中一部分，所以**都要在这里先定义**
# （`Set-StrictMode -Version Latest` 下引用未定义变量会直接抛异常）。
$skippedDir = 0
$skippedBin = 0
$scannedExtra = 0
# index 里有、工作区已删的被跟踪文件数（第三轮复审 §3.5 的第二个边界）
$goneCount = 0

# ── 工作区枚举（两条路都要用，所以放在分支之前 **只做一次**）─────────────────
# 为什么要有这一步（2026-09-13 用户裁定，接复审 S1）：**git 项目里被 `.gitignore`
# 忽略的文件从来没被扫过**。复审构造：`.gitignore` 写着 `.env`（正是本库推荐的做法），
# `.env` 里是真密钥，`git ls-files` 只有两个文件 ⇒ 旧版打
# `✓ 未发现硬编码密钥` + 光秃秃 `PASS` + exit 0，与 N1 一字不差。
# 密钥在盘上就是密钥：非 git 项目已经这么扫了，git 项目没理由例外。
# 命中的处理分两档（这是刻意的）：
#   · **被跟踪**的文件 → 硬失败（它已经/将要进仓库，没得商量）
#   · **未跟踪/被忽略**的文件 → **警告**（`.env` 本来就该放密钥，是不是问题取决于
#     "这目录会不会被打包/同步/上传"——那是人的判断，机器不该替人定）
$skipRe = '\\(\.git|node_modules|\.venv|venv|__pycache__|\.ruff_cache|\.mypy_cache|\.pytest_cache|dist|build|\.next|\.idea|\.vscode)\\+'
# ⚠️ `\.git\` 在这里**显式**排掉（不再只靠"不带 -Force 就不会枚举隐藏目录"这个实现细节）：
#    `.git/index`、`.git/logs/…` 这些既不是"被跟踪的源文件"也不是"未跟踪的源文件"，
#    落在任何一轮扫描的语义之外；而"谁的枚举更宽"是 PS 版本相关的，不该变成判据的一部分。
$wsAll = @(Get-ChildItem $root -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\\.git\\' })
# ⚠️ 排除 `\.git\` 只是**防御性**的：实测 `Get-ChildItem -Recurse`（不带 -Force）
#    根本不会枚举隐藏目录，所以 `.git` 里的文件从来就没进过这个计数。
#    （我一度以为本库自报的那 241 个"依赖/产物目录"全是 `.git` 里的东西，**那是瞎猜**——
#      实测为 `node_modules` 237 + `.ruff_cache` 4，标签本来就是准确的。把猜的当实测写进
#      注释，正是本项要防的那类不诚实，故留档更正。）
$skippedDir = @($wsAll | Where-Object { $_.FullName -match $skipRe -and $_.FullName -notmatch '\\\.git\\' }).Count
$wsInScope = @($wsAll | Where-Object { $_.FullName -notmatch $skipRe })
$skippedBin = @($wsInScope | Where-Object { $_.Name -match $BINARY_RE }).Count
$wsScannable = @($wsInScope | Where-Object { $_.Name -notmatch $BINARY_RE })
$skippedLarge = @($wsScannable | Where-Object { $_.Length -gt $MAX_SCAN_BYTES }).Count
$wsScan = @($wsScannable | Where-Object { $_.Length -le $MAX_SCAN_BYTES })

if (Test-Path (Join-Path $root '.git')) {
  Push-Location $root
  try {
    # ── `git ls-files` 的两个坑（第四轮复审 F2 在真实项目上照出来的）──────────
    # ① **`core.quotePath` 默认 true**：非 ASCII 路径会被输出成八进制转义
    #    （`"docs/00-\351\241\271..."`）。`项目 A` 有 14 条这样的路径，
    #    于是 `Test-Path -LiteralPath` 抛「Illegal characters in path」→ 全被当成"工作区已删"，
    #    范围注打出一句**假话**（那些文件一个都没删），同一批文件又被工作区扫描当"未跟踪"再扫一遍 ⇒ 双计。
    #    `-c core.quotePath=false` 后路径**全部**能定位（was: 假报 14 个缺失 → now: 0）。
    # ② 输出**编码**：git 吐的是 UTF-8 字节，而 PowerShell 5.1 用控制台代码页解码。
    #    ⚠️ 前一版用"临时把 `[Console]::OutputEncoding` 设成 UTF-8"绕开它 —— 那有副作用，
    #    第五轮复审实测：在**代码页 936 的交互控制台**下，改完之后整份报告的中文变成乱码
    #    （字节流是 UTF-8、终端按 936 解码）。
    #    现在改成：cmd 把 git 的原始字节**重定向进临时文件**，再用 `Get-Content -Encoding UTF8`
    #    显式解码 —— **不碰全局控制台状态**，也不依赖当前代码页（936 / 65001 都一样对）。
    #    （`core.quotePath=false` 仍必需：它管 git 自己的转义，与解码无关；两个坑都要治。）
    $giTmp = [System.IO.Path]::GetTempFileName()
    try {
      $null = & cmd.exe /c "git -c core.quotePath=false ls-files > `"$giTmp`" 2>nul"
      $tracked = @(Get-Content -LiteralPath $giTmp -Encoding UTF8 | Where-Object { $_ -ne '' })
    } finally { Remove-Item -LiteralPath $giTmp -Force -ErrorAction SilentlyContinue }
    $suspect = @($tracked | Where-Object { $_ -match '(^|/)(\.env($|\.)|.*\.pem$|.*\.key$|id_rsa|credentials(\.json)?$)' -and $_ -notmatch '\.example$|\.sample$|\.template$' })
    if ($suspect.Count -gt 0) { $fail.Add("被跟踪的敏感文件: $($suspect -join ', ')") }

    # ── "已经扫过的文件"这张表：**必须在下面那轮扫描之前建好** ────────────────
    # 两道判据都要（2026-09-13 独立复审第三轮 + CI 首跑各照出一次）：
    #    ① `OrdinalIgnoreCase`：`git ls-files` 的路径与磁盘上的路径**只差大小写**时
    #       （`leakdir/leak.py` vs `LeakDir\leak.py`，NTFS 大小写不敏感、`git status` 干净），
    #       默认的序数比较会认不出是同一个文件。
    #    ② **不能只靠 `Join-Path` 拼字符串**：同一个目录的**短名/长名**写法不是"大小写差异"，
    #       序数不敏感也判不出来。所以下面扫每个被跟踪文件时会顺手登记它的
    #       **provider 规范路径**（`.FullName`）；这里的 `Join-Path` 形态是兜底。
    #       CI 首跑红的根因就是缺 ②（详见文件开头 $root 那段）。
    # ⚠️ 声明位置很关键：它**先**被"已跟踪"那轮写、再被"未跟踪"那轮读。
    #    放在读的那一轮旁边（原来的写法）在 `Set-StrictMode -Version Latest` 下会直接抛异常。
    $trackedFull = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($t in $tracked) { [void]$trackedFull.Add((Join-Path $root ($t -replace '/', '\'))) }

    # 明文密钥模式：**反向列**（只排除二进制/资源，见上面的 $BINARY_RE）
    $files = @($tracked | Where-Object { $_ -notmatch $BINARY_RE })
    $hits = [System.Collections.Generic.List[string]]::new()
    $trackedLarge = 0
    foreach ($f in $files) {
      if (-not (Test-Path -LiteralPath $f)) { $goneCount++; continue }
      # ⚠️ 顺手把**规范路径**（provider 给的 `.FullName`）登记进 $trackedFull —— 见 $root 那段。
      #    只登记 `Join-Path $root …` 拼出来的字符串是不够的：短名/长名这种差异拼不出来。
      #    这里本来就要 `Get-Item` 取文件大小，所以**零额外开销**。
      $fi = Get-Item -LiteralPath $f -ErrorAction SilentlyContinue
      if ($null -ne $fi) { [void]$trackedFull.Add($fi.FullName) }
      $len = if ($null -ne $fi) { $fi.Length } else { $null }
      # 超 2MB 的被跟踪文件在这里跳过。⚠️ **不要**把这个计数再加进 $skippedLarge：
      # `$skippedLarge` 来自工作区枚举（`Get-ChildItem`，它不认识 git），**本来就包含**
      # 被跟踪的大文件。第四轮复审提的 F4 说"$trackedLarge 是死变量、那个文件不在任何计数里"
      # —— **那个前提是错的**，我照它改成了 `$skippedLarge += $trackedLarge`，结果**双计**
      # （实测：只有一个被跟踪大文件的项目，数字从正确的 1 变成 2）。第五轮复审抓出来，已撤。
      # 教训：**先验证缺陷的前提，再动手改** —— 别人报的 bug 也可能是想当然。
      if ($null -ne $len -and $len -gt $MAX_SCAN_BYTES) { $trackedLarge++; continue }
      $scanned++
      foreach ($m in (Select-String -LiteralPath $f -Pattern $pat -ErrorAction SilentlyContinue)) {
        if ($m.Line -match $ALLOW_RE) { $allowed++; $allowedList.Add("$f`:$($m.LineNumber)"); continue }
        $hits.Add("$f`:$($m.LineNumber)")
      }
    }
    if ($hits.Count -gt 0) { $fail.Add("明文密钥 $($hits.Count) 处，如 $($hits[0])") }
    # ⚠️ **这里曾经有一行 `$skippedLarge += $trackedLarge`，是错的，已撤**（第五轮复审 3.1 实测）：
    #    `$skippedLarge` 来自**工作区枚举**（`Get-ChildItem`，它不认识 git），**本来就包含**
    #    被跟踪的大文件；再加一遍 = 双计。实测：只有一个被跟踪大文件的项目，数字从正确的
    #    `1` 变成 `2`；`项目 A` 从真值 1 变成 2。
    #    起因是第四轮复审的 F4 说"`$trackedLarge` 是死变量、那个大文件不在任何计数里"——
    #    **那个前提本身是错的**，而我没有验证就照做了。
    #    ⇒ **教训：别人报的缺陷，先验证它的前提，再动手改。**（$trackedLarge 现在只用于下面
    #    那句"其中 N 个是被跟踪的"补充说明，不再参与计数。）

    # ── 未跟踪 / 被忽略的文件：**也扫**（用户裁定；命中记警告，见上面的分档说明）──
    # ⚠️ 这里**不要**重建 `$trackedFull`：它在上面（"已跟踪"那轮之前）建好，并在扫每个被跟踪
    #    文件时登记了 provider 规范路径。在这里重建 = 把那些规范路径**抹掉**，CI 那个
    #    "同一个文件被判红两次"就是这么来的（短名/长名对不上）。判据见上面的注释。
    foreach ($f in $wsScan) {
      if ($trackedFull.Contains($f.FullName)) { continue }   # 已跟踪的上面那轮已经硬失败扫过
      $scannedExtra++
      foreach ($m in (Select-String -LiteralPath $f.FullName -Pattern $pat -ErrorAction SilentlyContinue)) {
        $rel = $f.FullName.Substring($root.Length).TrimStart('\', '/')
        if ($m.Line -match $ALLOW_RE) { $allowed++; $allowedList.Add("$rel`:$($m.LineNumber)"); continue }
        $fbHits.Add("$rel`:$($m.LineNumber)")
      }
    }
    if ($scannedExtra -gt 0) { $info.Add("另外扫了 $scannedExtra 个未跟踪/被忽略的文件（`.gitignore` 里的 `.env` 属于这类）") }

    # 忽略规则是否覆盖真实配置文件
    $giPath = Join-Path $root '.gitignore'
    if (Test-Path $giPath) {
      $gi = Get-Content -LiteralPath $giPath -Raw
      $live = [System.Collections.Generic.List[string]]::new()
      foreach ($ex in @(Get-ChildItem $root -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '\.(example|sample|template)$' })) {
        $live.Add(($ex.Name -replace '\.(example|sample|template)$', ''))
      }
      foreach ($c in @('.env', 'settings.local.json', 'secrets.json')) {
        if ((Test-Path (Join-Path $root $c)) -and -not $live.Contains($c)) { $live.Add($c) }
      }
      $unguarded = [System.Collections.Generic.List[string]]::new()
      foreach ($n in $live) {
        $esc = [regex]::Escape($n)
        $ok = ($gi -match "(?m)^\s*/?$esc\s*$")
        if (-not $ok) {
          $base = [System.IO.Path]::GetFileNameWithoutExtension($n)
          if ($base -match '\.') { $ok = $gi -match ('(?m)^\s*' + [regex]::Escape('*' + $base.Substring($base.IndexOf('.')) + [System.IO.Path]::GetExtension($n)) + '\s*$') }
        }
        if (-not $ok) { $unguarded.Add($n) }
      }
      if ($unguarded.Count -gt 0) { $fail.Add("敏感配置未被 .gitignore 覆盖: $($unguarded -join ', ')") }
    }
    $info.Add("扫描 $scanned 个被跟踪文件")
  } finally { Pop-Location }
} else {
  # ── 非 git 分支：**回退扫描**（2026-09-13 用户裁定）────────────────────
  # 演进过程（留档，因为这里换过三次写法，每次都是被实测推翻的）：
  #   ① 初版：整项跳过，只往 $warn 记一笔 ⇒ 顶层照样 `PASS（带警告）—— 无硬失败项`，
  #      读起来像"查过一遍、没问题"，而实情是一个文件都没扫（N1）。
  #   ② 只改措辞：非 git 时改打"① 未跑"——诚实了，但**一个明文密钥摆在目录里
  #      也照样不报**（实测：非 git 目录放 `api_key = "..."`，工具一声不吭）。
  #      诚实但没用，等于把缺口说清楚之后留着。
  #   ③ 现在：**照扫**。理由：`git ls-files` 只是"该扫哪些文件"的一种取法，
  #      密钥是不是明文写在工作区里，**跟有没有 git 无关**。没有 git 就扫工作区。
  #
  # 为什么命中记**警告**而不是硬失败：非 git 项目没有 `.gitignore`、没有"跟踪"，
  # 命中的可能是测试夹具、文档示例、本地模板（本库自己的 tests/fixtures 就有这种
  # 样例）。一律硬失败会制造误报，而**误报会让整个闸门失去可信度**——
  # 这个脚本自己的 .DESCRIPTION 里写着"启发式结果标成需人过一眼，不谎报为确定结论"。
  #
  # ⚠️ 文件枚举与判据**都已在分支之前算好**（$wsScan / $BINARY_RE / $skipRe）：
  #    第一版这里又各写了一遍，结果 `$pat` 在这里被**重新赋值成了旧正则**
  #    （S8 的修复只作用于 git 路），两条路的判据悄悄分了叉——正是本轮要消灭的那类偏差。
  foreach ($f in $wsScan) {
    $scanned++
    foreach ($m in (Select-String -LiteralPath $f.FullName -Pattern $pat -ErrorAction SilentlyContinue)) {
      $rel = $f.FullName.Substring($root.Length).TrimStart('\', '/')
      if ($m.Line -match $ALLOW_RE) { $allowed++; $allowedList.Add("$rel`:$($m.LineNumber)"); continue }
      $fbHits.Add("$rel`:$($m.LineNumber)")
    }
  }
  # 没有版本控制这件事本身要人知道：写错了也追不回来，而且"密钥有没有在旧版本里
  # 出现过"这类问题**本工具从来答不了**（它只读当前文件，不读历史——有没有 git 都一样）。
  $warn.Add('项目不是 git 仓库：没有版本控制 ⇒ 出了事追不回来（建议 git init）')
  # ⚠️ 这里**不**再往 $notRun 记一笔：回退扫描真的跑了、① 有结论了。
  #    诚实不是"多标几个没跑成"，是**只在真没跑时**才说没跑。
  $info.Add("非 git 回退扫描 $scanned 个工作区文件")
}
# ── $fbHits 的报出：**两条路共用一段**（git 路扫的是未跟踪/被忽略的文件，
#    非 git 路扫的是整个工作区，但"命中要报出来、记警告"这件事没有区别）────────
foreach ($h in @($fbHits | Select-Object -First 8)) {
  $warn.Add("疑似明文密钥（未被跟踪/回退扫描）**需人过一眼**: $h")
}
if ($fbHits.Count -gt 8) { $warn.Add("疑似明文密钥另有 $($fbHits.Count - 8) 处（同上）") }
if ($fbHits.Count -gt 0) {
  # 未跟踪文件里的命中**不改退出码**（被跟踪的才硬失败）——但要在①这一节里点名，
  # 不能只躺在警告列表里。
  # 措辞按项目是不是 git 分岔（第三轮复审 §3.6 实测）：非 git 项目里既没有 `.gitignore`
  # 也没有"跟踪"这回事，把那 10/10 处命中叫成"未被跟踪/被忽略"是给不存在的区分贴标签。
  $where = if (Test-Path (Join-Path $root '.git')) { '未被跟踪/被忽略的文件里' } else { '非 git 项目的工作区里' }
  $why = if (Test-Path (Join-Path $root '.git')) { '（`.env` 这类文件本来就该放密钥，问题在于这目录会不会被打包/同步出去）' } else { '（没有版本控制，这些文件既没有历史也没有 ignore 规则兜着）' }
  Say "  · $where 检出 $($fbHits.Count) 处疑似明文密钥 —— **需人过一眼**$why" -ForegroundColor Yellow
}
if ($scannedExtra -gt 0 -and $fbHits.Count -eq 0) {
  Say "  · 另外扫了 $scannedExtra 个未跟踪/被忽略的文件（`.gitignore` 里的 `.env` 属于这类），未发现明文密钥" -ForegroundColor DarkGray
}
if ($scanned -eq 0) {
  # **① 的"没跑成"**：一个文件都没扫到（空目录 / 只有无可扫扩展名的文件）。
  # 删掉它，"一个文件都没扫、却敢打 ✓ 未发现硬编码密钥"就会复发——
  # 而那正是负向测试 D 抓到的 bug 类型（判据在 git 与非 git 两条路上都成立）。
  # ⚠️ 配套：self-test 里必须有用例在**空目录**上跑本脚本、断言这句出现。
  # ⚠️ 它**不再是**"唯一一处"：②③ 的同类分支现在也登记（见下面，第三轮复审 3.1）。
  $notRun.Add('① 一个文件都没扫到（没有可扫的源文件/配置）—— 本项等于没查，"未发现"没有依据')
}
# ── "未发现"这句话的**范围**：例外一个都不能少（复审 S1/S3/S7/§3）──────────
# 范围注的由来：`✓ 未发现…` 是全称否定，而 ① 有几类文件**没看**（在依赖/产物目录里、
# 按扩展名判为二进制、超过 2MB、**index 里有但工作区已删**）+ **一类命中被豁免**。
# 只要其中任何一类不写出来，汇总行就在说大话——复审 AE/U/W/X/S7 五个用例逐个证明了这一点。
# ⚠️ 用户裁定后，"未跟踪/被忽略"这一类**已从"没看"里移走**（现在会扫、命中记警告），
#    所以它不再出现在这里，改成在 ① 那一节点名"另外扫了 N 个"。
$scope = [System.Collections.Generic.List[string]]::new()
if ($skippedLarge -gt 0) {
  # 超 2MB 的总数来自工作区枚举（含被跟踪的）。被跟踪的大文件**更值得看一眼**（它进了仓库），
  # 所以在总数后面点名有几个是——这是**补充说明**，不是第二次计数（见上面撤掉双计那段的注释）。
  $largeNote = if ($trackedLarge -gt 0) { "（其中 $trackedLarge 个是被跟踪的）" } else { '' }
  $scope.Add("$skippedLarge 个超 $([math]::Round($MAX_SCAN_BYTES / 1MB, 0))MB 未扫$largeNote")
}
if ($skippedDir -gt 0) { $scope.Add("$skippedDir 个在依赖/产物目录里未扫（node_modules/.venv/dist/build…）") }
if ($skippedBin -gt 0) { $scope.Add("$skippedBin 个按扩展名判为二进制未扫（含 .db/.sqlite）") }
# index 里有、工作区定位不到的被跟踪文件（第四轮复审 F2：措辞不能写死成"已删"——
# 定位不到有两种原因：真的删了/改名了，或者**路径名编码对不上**（git 的八进制转义 + 控制台
# 代码页）。上面的 `-c core.quotePath=false` + UTF-8 已经把后者降到 0，但断言仍不该比事实更硬）。
if ($goneCount -gt 0) { $scope.Add("$goneCount 个被跟踪文件在工作区定位不到（已删/改名，或路径名编码对不上）") }
if ($allowed -gt 0) { $scope.Add("$allowed 处命中被 ``redline-allow`` 豁免") }
$scopeNote = if ($scope.Count -gt 0) { '（另有 ' + ($scope -join '；另有 ') + '）' } else { '' }
# 豁免要**报出来**，而且**在 -Quiet 下也要报**（复审 §3 实测：`t.py` 里明文写一行
# `aws_secret_access_key = "HHH…"  # redline-allow`，`-Quiet` 只输出 14 字节
# `VERDICT: PASS` + exit 0 —— 豁免零痕迹。`-Quiet` 恰恰是 .EXAMPLE 给机器用的那条通道，
# 所以"静默豁免 = 后门"这句话在那里是**成立**的，不是修辞）。
# 用 SayVerdict：它与结论行同级，不受 -Quiet 抑制。
# ⚠️ 明细也要走同一个通道，并且**截断必须报出来**（第三轮复审 §3.3/§3.4 实测：本库 10 处
#    豁免只打了 5 条，另外 5 条**无声消失**，而 `$fbHits` 那边早就有"另有 N 处"的正确写法；
#    `-Quiet` 下更是只剩一个数字）。既然设计动机是"静默豁免 = 给真密钥留后门"，
#    "看得到 5 条、看不到另外 5 条"就仍然是一条后门通道。
if ($allowed -gt 0) {
  Say ''
  SayVerdict "  · $allowed 处命中带 ``redline-allow`` 行内豁免（**请确认那些豁免确实合理**：样例/夹具可以，真密钥不行）" 'Yellow'
  # ⚠️ 我第一次写的是"明细最多 5 条 + 另有 N 处（**完整清单见非 -Quiet 输出**）"——
  #    **那是一句假话**：非 -Quiet 也走同一个 `-First 5`，根本不存在什么"完整清单"。
  #    （这正是本轮反复在修的毛病：输出里指了一个不存在的地方。）
  #    现在：人看的通道（非 -Quiet）列**全部**；机器通道（-Quiet）列 5 条 + 明说"另有 N 处未列出"。
  $allowShown = if ($Quiet) { 5 } else { $allowedList.Count }
  foreach ($a in @($allowedList | Select-Object -First $allowShown)) { SayVerdict "      豁免: $a" 'DarkGray' }
  if ($allowedList.Count -gt $allowShown) { SayVerdict "      另有 $($allowedList.Count - $allowShown) 处豁免未列出（-Quiet 模式只显示前 5 条）" 'DarkGray' }
}
if ($skippedLarge -gt 0) {
  $warn.Add("$skippedLarge 个文件超过 $([math]::Round($MAX_SCAN_BYTES / 1MB, 0))MB **没扫**（多半是数据/资源）——「未发现密钥」这句话不覆盖它们")
}
if ($fail.Count -eq 0) {
  if ($notRun.Count -gt 0) {
    # **绝不能写"未发现……"**：没扫到东西时，"未发现"就是个没有依据的断言。
    # 实测（2026-09-13 负向测试 D）：非 git 目录里放明文 `api_key = "..."`，
    # 只改措辞的那一版照样输出"未发现硬编码密钥"。
    # **没查过就说没查过** —— 这句话本身就是本体系的核心纪律。
    Say '  · ① **没查到东西**：见结论里的"没跑成"一段' -ForegroundColor Yellow
  } elseif (Test-Path (Join-Path $root '.git')) {
    # 措辞收窄到"被跟踪的"：这才是本项真正查过的范围（复审 S1）。
    # 旧措辞 `✓ 未发现硬编码密钥 / 敏感文件泄露` 是全称否定，而黑名单里的 `.env`
    # 永远不被扫描 —— 复审构造出一个"`.gitignore` 里有 `.env`、`.env` 里是真密钥"
    # 的项目，它就靠这句话拿到了光秃秃的 `VERDICT: PASS`。
    Say "  ✓ 被跟踪的 $scanned 个文件里未发现硬编码密钥 / 敏感文件泄露$scopeNote"
  } elseif ($fbHits.Count -gt 0) {
    # ⚠️ 这一支是实测补上的：第一版漏了它，于是在非 git 项目上同时打印
    #    "工作区 1 个文件里**未发现**明文密钥" 和 "疑似明文密钥: leak.py:1"——
    #    同一节里两句话互相打脸。**汇总行必须跟着命中走**，否则它就是在说谎。
    Say "  · 非 git 回退扫描：工作区 $scanned 个文件里检出 $($fbHits.Count) 处疑似明文密钥$scopeNote —— **需人过一眼**（明细见结论的警告）" -ForegroundColor Yellow
  } else {
    # 扫了，但要明说扫的是哪一套：非 git 时没有"被跟踪"这个概念，
    # 覆盖范围是"工作区里所有非二进制文件"，读数会让人以为和 git 项目一样全。
    Say "  · 非 git 回退扫描：工作区 $scanned 个文件里未发现明文密钥$scopeNote（无 .gitignore、无历史可查）" -ForegroundColor DarkGray
  }
}

# ══════════════════════════════════════════════════════════════════════════
Sect '② 无保护的 API 端点'

# `.mjs` / `.cjs` / `.jsx` / `.vue` 也算 JS 家族（2026-09-13 第三轮复审 §3.1 的副产品：
# **本库自己**是 PowerShell + `.mjs`，旧清单下 ② 会报"没扫任何文件"——那是白名单太窄，
# 与复审 G2 抓到的 ① 是同一类毛病，只是换到了 ②）。
$srcFiles = @(Get-ChildItem $root -Recurse -File -Include *.py, *.js, *.mjs, *.cjs, *.ts, *.tsx, *.jsx, *.vue -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch '\\(\.venv|venv|node_modules|\.git|__pycache__|dist|build|\.next)\\' })
$routeHits = [System.Collections.Generic.List[object]]::new()

foreach ($f in $srcFiles) {
  $lines = [System.IO.File]::ReadAllLines($f.FullName)
  for ($i = 0; $i -lt $lines.Count; $i++) {
    # Python: @app.get/post/... · @router.get(...)      JS/TS: app.get('/x') router.post('/x')
    # websocket 必须算进去：WS 端点是玩家真正连上来的那条路，漏了它等于漏了主入口。
    if ($lines[$i] -match '@\s*(app|router|bp|api)\s*\.\s*(get|post|put|patch|delete|websocket)\s*\(' -or
        $lines[$i] -match '\b(app|router)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*[''"]') {
      # 看前后 12 行有没有鉴权标记
      $lo = [Math]::Max(0, $i - 12); $hi = [Math]::Min($lines.Count - 1, $i + 12)
      $ctx = ($lines[$lo..$hi] -join "`n")
      $hasAuth = $ctx -match '(?i)Depends\s*\(|require_auth|@login_required|current_user|get_current_user|verify_token|authenticate|authoriz|@PreAuthorize|authMiddleware|requireAuth|isAuthenticated|passport\.'
      # "公开端点"只看**这条路由自己**（装饰器行 + 下一行的函数名），不看 ±12 行上下文。
      # 踩过的坑：/api/ips 因为挨着 /healthz 被上层判成"公开"，于是从"无鉴权"里被豁免掉了——
      # 邻近是巧合，不是证据。
      $own = ($lines[$i..([Math]::Min($lines.Count - 1, $i + 1))] -join "`n")
      $isPublic = $own -match '(?i)(healthz|/health|/ping|/metrics|/login|/register|/signup|/webhook|/public)'
      $routeHits.Add([PSCustomObject]@{ File = $f.Name; Line = $i + 1; Auth = $hasAuth; Public = $isPublic; Text = $lines[$i].Trim() })
    }
  }
}

if ($routeHits.Count -eq 0) {
  $info.Add('未识别到路由定义（可能是前端项目、CLI 或用了别的框架）')
  Say '  · 未识别到 API 路由——**若你确实有对外接口，请人工确认它们有鉴权**'
} else {
  $noAuth = @($routeHits | Where-Object { -not $_.Auth -and -not $_.Public })
  $info.Add("识别到 $($routeHits.Count) 个路由；其中 $($noAuth.Count) 个在上下文里看不到鉴权标记")
  if ($noAuth.Count -gt 0) {
    # 判定用启发式，所以**降级为警告**而不是硬失败：
    # "看不到显式鉴权标记" ≠ "确定没有鉴权"（中间件/网关可能生效）。
    # 谎报"确定有洞"比漏报更伤信任——那正是要避免的"闸门撒谎"。
    $filesWithAuth = @($routeHits | Where-Object Auth | Select-Object -ExpandProperty File -Unique)
    if ($filesWithAuth.Count -eq 0) {
      $warn.Add("**$($noAuth.Count) 个端点的所在文件里完全没有鉴权痕迹**——若这个服务对外开放，任何同网段的人都能调它")
    } else {
      $warn.Add("$($noAuth.Count) 个端点在本文件上下文里看不到鉴权标记——**需人过一眼**（该文件别处有鉴权，可能是中间件/装饰器间接生效）")
    }
    foreach ($r in $noAuth | Select-Object -First 6) { $warn.Add("    $($r.File):$($r.Line)  $($r.Text)") }
  } else {
    Say "  ✓ $($routeHits.Count) 个路由都能看到鉴权标记（或属于公开端点）"
  }
}

# 附加：**外部花钱调用**但没有额度上限——只有和无鉴权叠加时才是真风险
$spendFiles = [System.Collections.Generic.List[string]]::new()
foreach ($f in $srcFiles) {
  if (Select-String -LiteralPath $f.FullName -Pattern '(?i)(openai|anthropic|deepseek|siliconflow|dashscope|zhipu|chat\.completions|/v1/chat)' -ErrorAction SilentlyContinue) { $spendFiles.Add($f.Name) }
}
if ($spendFiles.Count -gt 0) {
  $hasBudget = $false
  foreach ($f in $srcFiles) {
    if (Select-String -LiteralPath $f.FullName -Pattern '(?i)(daily_?(limit|budget|quota)|max_?(spend|cost)|budget_usd|额度上限|每日限额|本月上限)' -ErrorAction SilentlyContinue) { $hasBudget = $true; break }
  }
  if (-not $hasBudget) {
    $warn.Add("检出外部付费 API 调用（$($spendFiles.Count) 个文件）但**没找到额度硬上限**——若叠加无鉴权，同网段的人可刷爆你的额度")
  } else {
    Say '  ✓ 外部付费调用看起来有额度上限'
  }
}

# 附加：wildcard CORS 与调试模式（都是"无保护"的常见形态）
$danger = @(
  @{ p = 'allow_origins\s*=\s*\[\s*["'']\*["'']'; d = 'CORS 允许任意来源（allow_origins=["*"]）' },
  @{ p = "cors\s*\(\s*\{\s*origin\s*:\s*['""]\*['""]"; d = 'CORS 允许任意来源（origin: "*"）' },
  @{ p = 'DEBUG\s*=\s*True'; d = 'DEBUG=True（生产会暴露堆栈与调试接口）' },
  @{ p = 'app\.run\s*\([^)]*debug\s*=\s*True'; d = 'debug=True 启动' },
  @{ p = 'verify\s*=\s*False'; d = 'TLS 校验被关闭（verify=False）' }
)
$dHits = [System.Collections.Generic.List[string]]::new()
foreach ($f in $srcFiles) {
  foreach ($d in $danger) {
    $m = Select-String -LiteralPath $f.FullName -Pattern $d.p -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($m) { $dHits.Add("$($f.Name):$($m.LineNumber) $($d.d)") }
  }
}
if ($dHits.Count -gt 0) {
  foreach ($h in $dHits) { $warn.Add($h) }
} elseif ($srcFiles.Count -eq 0) {
  # 同一把尺子（2026-09-13 独立复审第 4 条）：**开了 0 个文件之后不该打 ✓**。
  # ② 扫的是 $srcFiles，一个都没有时"未发现 wildcard CORS / 调试模式 / 关闭 TLS 校验"
  # 是句没有依据的断言——跟 ① 的 N1 是同一个毛病，只是它藏在 ② 里。
  #
  # ⚠️ 第三轮复审 §3.1：光改措辞**不够** —— 这处（与 ③ 那处）当时只 `Say`、**从不登记
  #    `$notRun`**，于是顶层照样打光秃秃 `VERDICT: PASS`，`-Quiet` 下更是只剩那一行。
  #    那**就是 N1 本身换了个位置**：判据只挂在"① 有没有扫到文件"上。
  #    现在 ②③ 与 ① 完全对称：真没查 ⇒ 登记进 `$notRun` ⇒ 顶层降档 + `-Quiet` 可见。
  $notRun.Add('② 无保护的 API 端点：一个可扫的源文件都没有（.py/.js/.mjs/.cjs/.ts/.tsx/.jsx/.vue），这一项没查')
  Say '  · ② **没扫任何文件**（没有 .py/.js/.mjs/.cjs/.ts/.tsx/.jsx/.vue）—— 这一项没有依据，已记入"没跑成"' -ForegroundColor Yellow
} else {
  Say "  ✓ 在 $($srcFiles.Count) 个源文件里未发现 wildcard CORS / 调试模式 / 关闭 TLS 校验"
}

# ══════════════════════════════════════════════════════════════════════════
Sect '③ 违法数据源  [需人确认]'
Say '  机器只能找出"像在采集别人的数据"的痕迹，**是否合法要你自己答**：'
Say '    · 有没有抓取没有授权的站点？（你的 robots.txt / ToS 合规吗）'
Say '    · 有没有买卖数据 / 用来源不明的数据集？'
Say '    · 有没有调用第三方的非公开接口（逆向出来的 API）？'
Say '    · 用户数据是从哪来的？有告知同意吗？（见 production-readiness 的 F 节）'

$dataPat = '(?i)selenium|playwright|puppeteer|scrapy|requests\.get\(|httpx\.get\(|爬虫|爬取|采集|数据买卖|proxy_pool|代理池'
$dataHits = [System.Collections.Generic.List[string]]::new()
foreach ($f in $srcFiles) {
  $m = Select-String -LiteralPath $f.FullName -Pattern $dataPat -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($m) { $dataHits.Add("$($f.Name):$($m.LineNumber)") }
}
if ($dataHits.Count -gt 0) {
  Say ''
  Say "  · 检出 $($dataHits.Count) 个文件含采集/抓取类调用——**请确认这些来源有授权**：" -ForegroundColor Yellow
  foreach ($h in $dataHits | Select-Object -First 6) { Say "      $h" }
} else {
  Say ''
  # **"未检出"也是全称否定，必须带范围**（2026-09-13 独立复审 S6 实测）：
  # 逐字节相同的内容（`import scrapy` + 中文注释），放 `crawl.py` → "检出 1 个文件"，
  # 放 `crawl.go` → "未检出"；`.rb` / `.java` 同样漏（它们不在 $srcFiles 的 5 种扩展名里）。
  # ② 那里已经学会"0 个文件不许打 ✓"，③ 当时还没学——**同一句话在 ② 修了、在 ③ 没修**。
  if ($srcFiles.Count -eq 0) {
    # 与 ② 同款：**登记进 `$notRun`**（第三轮复审 §3.1 —— 只改措辞会让顶层继续打裸 `PASS`）
    $notRun.Add('③ 违法数据源：一个可扫的源文件都没有（.py/.js/.mjs/.cjs/.ts/.tsx/.jsx/.vue），机器侧没查（人确认那两句仍然要答）')
    Say '  · ③ **没扫任何文件**（没有 .py/.js/.mjs/.cjs/.ts/.tsx/.jsx/.vue）—— 「未检出」这句话没有依据，已记入"没跑成"' -ForegroundColor Yellow
  } else {
    Say "  · 在 $($srcFiles.Count) 个 .py/.js/.mjs/.cjs/.ts/.tsx/.jsx/.vue 里未检出采集/抓取类调用（**没覆盖 .go/.rb/.java/.php 等**；没检出 ≠ 合法，仍要人确认）"
  }
}

# ══════════════════════════════════════════════════════════════════════════
Sect '④ 分发他人内容  [需人确认]'
Say '    · 你的产物里有没有打包别人的付费内容、题库、数据集、字体/图片素材？'
Say '    · 有没有把人家的 API 结果缓存下来当成自己的数据卖？'
Say '    · 依赖的许可证允许商用/再分发吗？（见 THIRD-PARTY-NOTICES.md）'

# ══════════════════════════════════════════════════════════════════════════
# 人工确认状态（从中央状态读；没有状态文件就明说"未确认"）
Sect '人工确认状态'
$statePath = Join-Path $root '.scratch\state.json'
$conf1 = $false; $conf2 = $false; $note1 = ''; $note2 = ''
if (Test-Path $statePath) {
  try {
    $st = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $conf1 = [bool]$st.redline.data_source_ok.confirmed
    $conf2 = [bool]$st.redline.no_redistribute.confirmed
    # 把**依据原文**读出来（复审 S5）：`state.ps1 redline -Note "x"` 也是一个有效的"确认"，
    # 于是任何项目都能在 10 秒内换到一条光秃秃的 `VERDICT: PASS`，而输出里看不出
    # "依据只是一句 x"。把 note 打在确认行上，读的人立刻能判断这个确认值多少。
    $note1 = [string]$st.redline.data_source_ok.note
    $note2 = [string]$st.redline.no_redistribute.note
  } catch { }
}
$n1 = if ($note1) { "（依据：$note1）" } else { '（**没写依据**）' }
$n2 = if ($note2) { "（依据：$note2）" } else { '（**没写依据**）' }
if ($conf1) { Say "  ✓ ③ 数据来源合法：已确认$n1" } else { $warn.Add('③ 数据来源合法：**未确认**——用 state.ps1 redline -Name data_source_ok -Note "为什么合法" 确认'); Say '  ✗ ③ 数据来源合法：未确认' }
if ($conf2) { Say "  ✓ ④ 不分发他人内容：已确认$n2" } else { $warn.Add('④ 不分发他人内容：**未确认**——用 state.ps1 redline -Name no_redistribute -Note "依据" 确认'); Say '  ✗ ④ 不分发他人内容：未确认' }

# ══════════════════════════════════════════════════════════════════════════
Say ''
Say '=== 结论 ==='
if ($info.Count -gt 0 -and -not $Quiet) { foreach ($i in $info) { Say "  · $i" } }
if ($warn.Count -gt 0 -and -not $Quiet) {
  Say ''
  Say "  警告/需人过一眼 ($($warn.Count)):" -ForegroundColor Yellow
  foreach ($w in $warn) { Say "    - $w" -ForegroundColor Yellow }
}
# "没跑成"用 SayVerdict：它是**结论的一部分**，`-Quiet` 也照输出（见 SayVerdict 的注释）
if ($notRun.Count -gt 0) {
  Say ''
  SayVerdict "  ⛔ 没跑成 ($($notRun.Count))——这些项**没有结论**，别读成'没问题':" 'Magenta'
  foreach ($n in $notRun) { SayVerdict "    - $n" 'Magenta' }
}
if ($fail.Count -gt 0) {
  Say ''
  Say "  ✗ 红线问题 ($($fail.Count)):" -ForegroundColor Red
  foreach ($f in $fail) { Say "    - $f" -ForegroundColor Red }
  Say ''
  # FAIL 那行也点名没跑成项（复审"顺手可做"那条）：verdict 行是被复制、被 grep 的那一行，
  # 而"有硬失败"与"还有整项没查"是两件事，可以同时为真。
  # 失败**条数**也带上（第三轮复审 §3.7 实测：`-Quiet` 下 FAIL 只剩 49 字节一句
  # `VERDICT: FAIL`，看不到有一处还是十处）——明细仍只在完整输出里，那是刻意的。
  $fSuffix = if ($notRun.Count -gt 0) { "（另有 $($notRun.Count) 项没跑成，见上）" } else { '' }
  SayVerdict "VERDICT: FAIL（$($fail.Count) 处）$fSuffix —— 先修这些，再谈别的" 'Red'
  Say ''
  Say '本检查的局限（别把它当安全审计）：' -ForegroundColor DarkGray
  Say '  · ② 是**启发式**：看不到显式鉴权标记不等于没鉴权（中间件/网关可能生效）' -ForegroundColor DarkGray
  Say '  · 不做全量 SAST、不查依赖漏洞、不查 git 历史（那是 quality-gate.ps1 与专业工具的事）' -ForegroundColor DarkGray
  Say '  · 行内写 `redline-allow` 可声明豁免（会报出来，不静默）；**真密钥不许标豁免**' -ForegroundColor DarkGray
  exit 1
} else {
  Say ''
  # ── 结论行分三档（N1）───────────────────────────────────────────────
  # 旧写法只有两档：`PASS（带警告）` / `PASS`；而"① 整项没跑"被塞进警告列表，
  # 于是顶层读起来像"机器查了一遍、没发现硬伤"。
  # 现在把"**没跑成**"独立成最高优先的一档，三档各对应一件不同的事：
  #   PASS                   → 每一项都跑了，且没发现硬伤
  #   PASS（带警告）         → 每一项都跑了，但有需人过一眼的点
  #   PASS（有 N 项没跑成）  → 有整项**没有结论**；"无硬失败项"对它不成立
  # ⚠️ 判据写成 `$notRun.Count` 而不是"$warn 非空"：**这两件事本来就没有关系**
  #    （真没跑时只记 $notRun、不一定记 $warn）。若改成看 $warn，那么
  #    "$warn 为空 + 有整项没跑"这个真实组合就会输出光秃秃的 `PASS` —— 那正是 N1 复发。
  #    已实测：空目录用例在 $warn 里只有"不是 git 仓库"一条时仍打出"没跑成"。
  if ($notRun.Count -gt 0) {
    SayVerdict "VERDICT: PASS（有 $($notRun.Count) 项没跑成）—— 已跑的项无硬失败；**没跑的那几项没有结论**" 'Magenta'
  } elseif ($warn.Count -gt 0) {
    SayVerdict 'VERDICT: PASS（带警告）—— 无硬失败项；警告请人过一眼' 'Yellow'
  } else {
    SayVerdict 'VERDICT: PASS' 'Green'
  }
  exit 0
}
