#!/usr/bin/env pwsh
<#
.SYNOPSIS
    质量闸门运行器 —— 把"上线前检查清单"变成**可执行的检查**。

.DESCRIPTION
    设计原则（重要）：
      1. **零依赖即可跑**：基础闸门只用 git / python / node —— 本机全都有。
         缺失的专业工具（gitleaks / semgrep / pip-audit / trivy）**自动跳过并给出安装命令**，
         绝不因为"没装工具"而假装通过。
      2. **不撒谎**：跳过 = SKIP（不影响退出码，但会在摘要里明确列出），失败 = FAIL。
         摘要里始终打印"本次有多少项是跳过的"，避免虚假安全感。
      3. **纯 ASCII 输出**：避免 Windows PowerShell 5.1 的编码坑，可安全重定向到 CI 日志。

.PARAMETER Path
    项目根目录。默认当前目录。

.PARAMETER Strict
    把跳过项也当作失败（用于"必须全绿"的场景）。

.PARAMETER Json
    额外输出机器可读的 JSON 结果到指定路径。

.PARAMETER IncludeTests
    额外跑项目测试（自动探测 pytest / unittest）。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File quality-gate.ps1 -Path . -IncludeTests
    powershell -NoProfile -ExecutionPolicy Bypass -File quality-gate.ps1 -Strict -Json gate-report.json
#>
[CmdletBinding()]
param(
  [string]$Path = '.',
  [switch]$Strict,
  [string]$Json,
  [switch]$IncludeTests,
  # 只打印 C2 用的 **ruff 规则集标签**然后退出（纯 ASCII）。
  # 为什么要有这个开关（复审 M8/F7 的落地）：那个标签以前只能靠"装个 ruff、跑整个闸门、
  # 再从输出里读"来验 —— 那是碰运气，不是验证。现在它成了**可直接调用**的纯函数式入口，
  # `self-test.mjs` 就能用小目录树把六种情形自动化（原来只能手工跑）。
  [switch]$RuffLabel
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$ProjectRoot = (Resolve-Path -LiteralPath $Path).Path
$results = [System.Collections.Generic.List[object]]::new()

# ⚠️ `-RuffLabel` 的早退必须放在**这里** —— 在"补 PATH"那段之前。
#    实测踩过：放在后面时整个调用**超时 2 分钟**（那段会去 `Get-ChildItem -Recurse` 扫
#    WinGet/Python 安装目录，几百毫秒到几十秒不等，而且 `Test-Tool` 还会起进程）。
#    要验"标签对不对"却先跑一遍环境探测，那是把简单事做贵了。
if ($RuffLabel) {
  . (Join-Path $PSScriptRoot 'ruff-label.ps1')     # 标签逻辑单独一份，见那个文件顶部说明
  $r = Get-RuffRulesetLabel -Root $ProjectRoot
  Write-Output $r.Ascii
  exit 0
}

function Add-Result {
  # ⚠️ Id 是**必填**（复审 L1）：以前 Id 为空时那条结果会被下游的 `Where-Object { $_ }` 静默剔除，
  # 于是"少项/重复"两个判据都看不见它 —— 漏报比误报危险。现在空 Id 直接在这里就炸。
  param([Parameter(Mandatory = $true)][string]$Id, [string]$Name, [string]$Status, [string]$Detail)
  $results.Add([PSCustomObject]@{ Id = $Id; Name = $Name; Status = $Status; Detail = $Detail })
  $color = switch ($Status) { 'PASS' { 'Green' } 'FAIL' { 'Red' } 'NOTRUN' { 'Magenta' } 'SKIP' { 'DarkGray' } default { 'Gray' } }
  Write-Host ("  [{0,-6}] {1,-26} {2}" -f $Status, $Name, $Detail) -ForegroundColor $color
}

# ── 「没跑成」的判据（第四档，2026-09-13 补）─────────────────────────────────
# 为什么必须有这一档（实测）：在库自己身上跑闸门时，`pip-audit` 报
# `Could not connect to PyPI's vulnerability feed`、`npm audit` 报
# `registry.npmjs.org ... failed` —— 两件**都没能得出结论**的事被记成了 **FAIL**。
# 后果有两层：① 读者会把"没查到"读成"你的项目有问题"；② 旁边一条**真失败**
# （semgrep 的 22 条，含 CI 用可变 action tag）被噪音淹掉，人容易整段忽略。
# 与既有两档的区别要卡住：
#   · FAIL   = 跑了，有结论，结论是"有问题"
#   · SKIP   = 没有对象可查 / 工具没装（覆盖率不完整，但没人试图跑）
#   · NOTRUN = **有对象、工具也在、真的跑了，但没跑出结论**（网络/权限/输入缺失）
# 并进 FAIL 是假警报，并进 SKIP 又变成"没查却说查过了"（那正是 N1 那种病）。
function Test-NotRunOutput {
  param([string]$Text)
  if (-not $Text) { return $false }
  # ⚠️ 这张表只能"尽量全"：实测过同一条 pip-audit 命令**两次报的措辞不一样**
  #    （一次 `Could not connect to PyPI's vulnerability feed`，一次别的），
  #    于是同一份代码一次判 NOTRUN、一次判 FAIL。所以宁可多列几种常见形态：
  #    漏判的代价是"没跑成被当成真失败"（假警报），而假警报会把真问题淹掉。
  #
  # ⚠️⚠️ 但**另一头更危险**（第六轮复审 S6）：把**真失败**误判成 NOTRUN = **降级**，
  #    真问题会被读成"没跑成、回头再说"。所以这张表分两层：
  #      ① **工具专有措辞**（高置信，几乎不会出现在真漏洞报告里）
  #      ② **通用网络措辞**（带词边界，宁可窄一点）
  #    复审点名的三个宽匹配已收紧：`certificate` → `\bcertificate\b`；
  #    `failed to (download|fetch)` → 只认规则/配置拉取失败；`invalid requirements input` 保留
  #    （那是 pip-audit 在"没有可审对象"时的**专有**原话）。
  #    复审另外实测：真漏洞输出（`Found 114 known vulnerabilities in 4 packages`）**不会**命中这张表。
  return [bool]($Text -match '(?i)(could not connect to pypi|invalid requirements input|audit endpoint returned an error|registry\.[a-z.]+.*failed|could not resolve host|failed to (download|fetch) (config|rules|configuration)|temporary failure in name resolution|no such host|name or service not known|getaddrinfo|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|read timed out|max retries exceeded|\bssl(error)?\b|\bcertificate\b|WinError 100(51|54|60|61)|network is (unreachable|blocking))')
}

# 把"已知安装目录"补进本进程的 PATH。
# 为什么需要（实测踩过）：装完工具之后，**新起的进程仍可能继承旧 PATH**，
# 于是 semgrep / gitleaks 被判成"没装" → SKIP → 覆盖率假性下降，而工具其实就在机器上。
# 只影响本次运行的进程，**不改机器配置**。
# @() 必须包住**整条管道**：Where-Object 过滤后一个不剩时结果是 $null，
# 而 StrictMode Latest 下 $null.Count 会抛异常（同一个坑在本文件里犯了两次，第二次是刚加的用例抓到的）。
$script:ExtraDirs = @(@(
  (Join-Path $env:USERPROFILE '.local\bin'),
  (Join-Path $env:APPDATA 'Python\Python312\Scripts'),
  (Join-Path $env:APPDATA 'Python\Scripts'),
  (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\Scripts')
) + @(Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages') -Directory -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty FullName) | Where-Object { $_ -and (Test-Path $_) })
if ($script:ExtraDirs.Count -gt 0) { $env:PATH = (($script:ExtraDirs | Select-Object -Unique) -join ';') + ';' + $env:PATH }

function Test-Tool { param([string]$Name) return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

$script:GeneratedAt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')

Write-Host ''
Write-Host "=== QUALITY GATE ===" -ForegroundColor Cyan
Write-Host "project : $ProjectRoot"
Write-Host "mode    : $(if ($Strict) { 'STRICT (skip counts as fail)' } else { 'normal' })"
Write-Host "time    : $script:GeneratedAt"
Write-Host ''

# 假绿警报：项目里如果躺着一份**旧报告**，下一个看它的人（或 agent）会当成当前结论。
# 实测踩过：项目根的 gate-report.json 写着 fail=0，真实重跑是 fail=2 —— 它只是"上一次的结论"。
$staleReports = @()
foreach ($cand in @($(if ($Json) { $Json }), 'gate-report.json') | Select-Object -Unique) {
  # 绝对路径要单独处理：PS 5.1 的 Join-Path 遇到绝对子路径会拼出 `C:\proj\D:\x.json` 这种非法路径，
  # 报错还只是 "The given path's format is not supported"（看不懂）。自检用例抓出来的真 bug。
  $p = if ([System.IO.Path]::IsPathRooted($cand)) { $cand } else { Join-Path $ProjectRoot $cand }
  if (Test-Path $p) {
    $age = (Get-Date) - (Get-Item $p).LastWriteTime
    # **只警告"真的旧"的报告**（阈值 1 小时，明确写成启发式）。
    # 复审实测过原来那版：run1 写完报告、14 秒后 run2 就喊"旧报告"——
    # 而文档主推的命令处处写着 `-Json gate-report.json`，于是**每次**都喊，
    # 很快被当噪音无视，真正要防的"旧报告假绿"反而失效（狼来了）。
    if ($age.TotalHours -lt 1) { continue }
    $old = try { (Get-Content $p -Raw | ConvertFrom-Json) } catch { $null }
    # StrictMode Latest 下访问不存在的属性会**抛异常**（旧报告没有 generated_at 字段就直接炸）。
    # 所以一律先问"有没有这个属性"，绝不直接取。
    $oldDesc = '（无法解析）'
    if ($old) {
      $names = @($old.PSObject.Properties.Name)
      $ts = if ($names -contains 'generated_at') { " @ $($old.generated_at)" } else { '（旧报告无 generated_at 字段——无法判断新旧）' }
      $ck = if ($names -contains 'checked') { $old.checked } else { '?' }
      $fl = if ($names -contains 'fail') { $old.fail } else { '?' }
      $sk = if ($names -contains 'skip') { $old.skip } else { '?' }
      $oldDesc = "checked=$ck fail=$fl skip=$sk$ts"
    }
    $staleReports += [PSCustomObject]@{
      Path = $cand; Written = (Get-Item $p).LastWriteTime
      AgeHours = [math]::Round($age.TotalHours, 1); OldDesc = $oldDesc
    }
  }
}
if ($staleReports.Count -gt 0) {
  Write-Host '!! STALE REPORT PRESENT - do not read it as the current verdict !!' -ForegroundColor Yellow
  foreach ($r in $staleReports) {
    Write-Host ("   {0}  written {1} ({2}h ago)  ->  {3}" -f $r.Path, $r.Written.ToString('yyyy-MM-dd HH:mm'), $r.AgeHours, $r.OldDesc) -ForegroundColor Yellow
  }
  Write-Host '   A gate report is a SNAPSHOT of one run, not a status file. Re-run the gate to refresh it.' -ForegroundColor Yellow
  Write-Host ''
}

# ---------------------------------------------------------------- A. SECRETS
Write-Host 'A. Secrets' -ForegroundColor Cyan

# A1: 敏感文件名是否被 git 跟踪
if (Test-Path (Join-Path $ProjectRoot '.git')) {
  Push-Location $ProjectRoot
  try {
    $tracked = @(git ls-files 2>$null)
    $suspects = @($tracked | Where-Object { $_ -match '(^|/)(\.env($|\.)|.*\.pem$|.*\.key$|.*\.p12$|id_rsa|credentials(\.json)?$)' -and $_ -notmatch '\.example$|\.sample$|\.template$' })
    if ($suspects.Count -gt 0) {
      Add-Result 'A1' 'tracked secret-like files' 'FAIL' ("$($suspects.Count) file(s): " + ($suspects -join ', '))
    } else {
      Add-Result 'A1' 'tracked secret-like files' 'PASS' 'none'
    }
  } finally { Pop-Location }
} else {
  Add-Result 'A1' 'tracked secret-like files' 'SKIP' 'not a git repo'
}

# A2: 明文密钥出现在已跟踪文件里
if (Test-Path (Join-Path $ProjectRoot '.git')) {
  Push-Location $ProjectRoot
  try {
    $files = @(git ls-files 2>$null | Where-Object { $_ -match '\.(py|js|ts|tsx|jsx|json|ya?ml|toml|ini|cfg|ps1|sh|env|txt|md)$' })
    # 只匹配"看着像真密钥"的：常见前缀 + 足够长度
    $pattern = 'sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(api[_-]?key|apikey|secret|token|password)\s*[:=]\s*["'']([A-Za-z0-9_\-]{24,})["'']'
    $hits = [System.Collections.Generic.List[string]]::new()
    foreach ($f in $files) {
      if (-not (Test-Path -LiteralPath $f)) { continue }
      try {
        $m = Select-String -LiteralPath $f -Pattern $pattern -AllMatches -ErrorAction SilentlyContinue
        foreach ($x in $m) { $hits.Add("$f`:$($x.LineNumber)") }
      } catch { }
    }
    if ($hits.Count -gt 0) {
      Add-Result 'A2' 'hardcoded credentials' 'FAIL' ("$($hits.Count) hit(s), e.g. " + ($hits | Select-Object -First 3 | ForEach-Object { $_ }) -join ' ')
    } else {
      Add-Result 'A2' 'hardcoded credentials' 'PASS' "$($files.Count) tracked files scanned"
    }
  } finally { Pop-Location }
} else {
  Add-Result 'A2' 'hardcoded credentials' 'SKIP' 'not a git repo'
}

# A3: gitleaks（专业工具，可选）
if (-not (Test-Path (Join-Path $ProjectRoot '.git'))) {
  # 非 git 目录：gitleaks **会退出 0 并打印 "0 commits scanned / no leaks found"** ——
  # 那是"什么都没扫"，不是"没有泄漏"。实测过：这里曾报 PASS，而同一份报告里 A1/A2 老实写着
  # "not a git repo" —— 同一个事实两套结论。**PASS 比 SKIP 危险**：SKIP 会让人去看，
  # PASS 会让人放心。（独立复审 F1 抓到的，正是我把 SKIP 改成 PASS 的那次改动。）
  Add-Result 'A3' 'gitleaks (git history)' 'SKIP' 'not a git repo (gitleaks would exit 0 and scan 0 commits)'
} elseif (Test-Tool 'gitleaks') {
  Push-Location $ProjectRoot
  try {
    $out = & gitleaks detect --no-banner --redact 2>&1
    $text = ($out | Out-String)
    # 退出码 0 也可能是"扫了 0 个提交"，所以还要看它自己报了什么
    $scannedNothing = $text -match '0 commits scanned' -or $text -match 'scanned ~0 bytes'
    if ($LASTEXITCODE -eq 0 -and $scannedNothing) {
      Add-Result 'A3' 'gitleaks (git history)' 'SKIP' 'gitleaks scanned 0 commits - coverage is NOT there'
    } elseif ($LASTEXITCODE -eq 0) {
      Add-Result 'A3' 'gitleaks (git history)' 'PASS' 'no leaks'
    } elseif ($text -match '(?i)leaks found') {
      Add-Result 'A3' 'gitleaks (git history)' 'FAIL' "exit $LASTEXITCODE - see output above"
      Write-Host ($out | Select-Object -Last 5)
    } else {
      # 没报"leaks found"却是非 0 ⇒ 它自己没跑成（不是"发现了泄露"）
      # ⚠️ 第六轮复审 S5 指出的**如实记录**：这一支目前是**防御性**的 —— 实测 gitleaks 只有
      #    "发现泄露"一种非 0（`--no-git` + 坏配置会走上面的 SKIP 或 exit 0），
      #    所以它**从未被执行过**。留着是因为"没跑成"这一类在别的机器/版本上会出现；
      #    写在这里是为了让下一个人知道：它不是覆盖过的路径。
      Add-Result 'A3' 'gitleaks (git history)' 'NOTRUN' "exit $LASTEXITCODE - 没能得出结论（不是发现了泄露）"
      Write-Host ($out | Select-Object -Last 5)
    }
  } finally { Pop-Location }
} else {
  Add-Result 'A3' 'gitleaks (git history)' 'SKIP' 'install: scoop install gitleaks  |  https://github.com/gitleaks/gitleaks'
}

# A4: 敏感配置是否被 .gitignore 覆盖（约定无关：先从 *.example 反推真实配置名）
$giPath = Join-Path $ProjectRoot '.gitignore'
if (Test-Path $giPath) {
  $gi = Get-Content -LiteralPath $giPath -Raw
  # 从示例文件反推：settings.local.json.example -> settings.local.json
  $liveNames = [System.Collections.Generic.List[string]]::new()
  foreach ($ex in @(Get-ChildItem $ProjectRoot -File -Force -ErrorAction SilentlyContinue |
                    Where-Object { $_.Name -match '\.(example|sample|template)$' })) {
    $liveNames.Add(($ex.Name -replace '\.(example|sample|template)$', ''))
  }
  # 再补上常见约定
  foreach ($c in @('.env', 'settings.local.json', 'config.local.json', 'secrets.json')) {
    if ((Test-Path (Join-Path $ProjectRoot $c)) -and -not $liveNames.Contains($c)) { $liveNames.Add($c) }
  }
  $unguarded = [System.Collections.Generic.List[string]]::new()
  foreach ($n in $liveNames) {
    # 精确名匹配，或通配规则覆盖（如 *.local.json）
    $exact = [regex]::Escape($n)
    $esc = [regex]::Escape($n)
    $covered = ($gi -match "(?m)^\s*$esc\s*$") -or
               ($gi -match "(?m)^\s*/$esc\s*$")
    if (-not $covered) {
      # 通配：*.local.json 覆盖 settings.local.json
      $ext = [System.IO.Path]::GetExtension($n)          # .json
      $base = [System.IO.Path]::GetFileNameWithoutExtension($n)  # settings.local
      if ($base -match '\.') {
        $suffix = '*' + $base.Substring($base.IndexOf('.')) + $ext   # *.local.json
        $covered = $gi -match ('(?m)^\s*' + [regex]::Escape($suffix) + '\s*$')
      }
    }
    if (-not $covered) { $unguarded.Add($n) }
  }
  if ($liveNames.Count -eq 0) {
    Add-Result 'A4' 'sensitive configs ignored' 'SKIP' 'no example/env files to infer from'
  } elseif ($unguarded.Count -gt 0) {
    Add-Result 'A4' 'sensitive configs ignored' 'FAIL' ("NOT ignored: " + ($unguarded -join ', '))
  } else {
    Add-Result 'A4' 'sensitive configs ignored' 'PASS' ("$($liveNames.Count) checked: " + ($liveNames -join ', '))
  }
} else {
  Add-Result 'A4' 'sensitive configs ignored' 'SKIP' 'no .gitignore'
}

# ------------------------------------------------------------ B. DEPENDENCIES
Write-Host ''
Write-Host 'B. Dependencies' -ForegroundColor Cyan

# B1: Python 依赖漏洞（pip-audit 优先，缺则跳过）
if (Test-Tool 'pip-audit') {
  $req = Join-Path $ProjectRoot 'requirements.txt'
  $args = @('--progress-spinner', 'off')
  if (Test-Path $req) { $args = @('-r', $req) + $args }
  Push-Location $ProjectRoot
  try {
    $out = & pip-audit @args 2>&1
    $text = ($out | Out-String)
    if ($LASTEXITCODE -eq 0) { Add-Result 'B1' 'pip-audit' 'PASS' 'no known vulns' }
    elseif (Test-NotRunOutput $text) {
      # 实测原话：`ERROR:pip_audit._cli:Could not connect to PyPI's vulnerability feed`
      Add-Result 'B1' 'pip-audit' 'NOTRUN' '连不上 PyPI 漏洞库 / 没有可审的依赖清单 —— 不是"没有漏洞"'
      Write-Host ($out | Select-Object -Last 3)
    }
    else { Add-Result 'B1' 'pip-audit' 'FAIL' "exit $LASTEXITCODE"; Write-Host ($out | Select-Object -Last 8) }
  } finally { Pop-Location }
} else {
  Add-Result 'B1' 'Python vuln scan' 'SKIP' 'install: pip install pip-audit'
}

# B2: Node 依赖漏洞
if ((Test-Path (Join-Path $ProjectRoot 'package.json')) -and (Test-Tool 'npm')) {
  Push-Location $ProjectRoot
  try {
    $out = & npm audit --omit=dev --audit-level=high 2>&1
    $text = ($out | Out-String)
    if ($LASTEXITCODE -eq 0) { Add-Result 'B2' 'npm audit' 'PASS' 'no high/critical' }
    elseif (Test-NotRunOutput $text) {
      # 实测原话：`npm warn audit request to https://registry.npmjs.org/... failed` + `audit endpoint returned an error`
      Add-Result 'B2' 'npm audit' 'NOTRUN' '连不上 registry 的审计端点 —— 不是"没有漏洞"'
      Write-Host ($out | Select-Object -Last 3)
    }
    else { Add-Result 'B2' 'npm audit' 'FAIL' "exit $LASTEXITCODE" }
  } finally { Pop-Location }
} else {
  Add-Result 'B2' 'npm audit' 'SKIP' $(if (-not (Test-Path (Join-Path $ProjectRoot 'package.json'))) { 'no package.json' } else { 'npm missing' })
}

# B3: 依赖锁定（可复现构建）
$lockFound = @(@('requirements.txt', 'poetry.lock', 'Pipfile.lock', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'uv.lock') |
  Where-Object { Test-Path (Join-Path $ProjectRoot $_) })
if ($lockFound.Count -gt 0) { Add-Result 'B3' 'dependency lockfile' 'PASS' ($lockFound -join ', ') }
else { Add-Result 'B3' 'dependency lockfile' 'FAIL' 'no lock/requirements file found' }

# ----------------------------------------------------------------- C. SAST
Write-Host ''
Write-Host 'C. Static analysis' -ForegroundColor Cyan

if (Test-Tool 'semgrep') {
  Push-Location $ProjectRoot
  try {
    $out = & semgrep scan --config auto --error --quiet 2>&1
    $text = ($out | Out-String)
    if ($LASTEXITCODE -eq 0) { Add-Result 'C1' 'semgrep' 'PASS' 'no findings' }
    elseif ($text -match '(?i)\d+\s+(code\s+)?findings?|findings?\s*$') {
      Add-Result 'C1' 'semgrep' 'FAIL' "exit $LASTEXITCODE"; Write-Host ($out | Select-Object -Last 8)
    }
    else {
      # `--config auto` 要联网拉规则；拉不到时它退出码也非 0，但**一条都没扫**
      Add-Result 'C1' 'semgrep' 'NOTRUN' "exit $LASTEXITCODE - 没扫出结论（多半是拉不到规则/联网失败），不是发现了问题"
      Write-Host ($out | Select-Object -Last 5)
    }
  } finally { Pop-Location }
} else {
  Add-Result 'C1' 'semgrep (SAST)' 'SKIP' 'install: pip install semgrep'
}

# ── ruff 规则集标签：逻辑在 ruff-label.ps1（单独一份，两条路共用 + 可独立验证）──────
. (Join-Path $PSScriptRoot 'ruff-label.ps1')

if (Test-Tool 'ruff') {
  Push-Location $ProjectRoot
  try {
    # 规则集必须说清，否则报出来的数字没法解读：
    # 项目若**真的没有** ruff 配置，用的就是 ruff 的默认集 —— 里面混着大量**风格/纪律债**
    # （BLE001 盲 except、S110 try/except/pass …），那些是"该还的债"，不等于"上线阻断项"。
    # 实测踩过：209 errors 被直接读成"不能上线"。
    #
    # **F7（独立复审）**：旧版只看**项目根**有没有 pyproject.toml —— 而 ruff 是**向上找配置**的
    #   （项目根 → 上一级 → … → 磁盘根）。于是嵌在别人的仓库/用户主目录里的项目会被**贴错标签**：
    #   · 根下没有配置、但上级有 → 旧版报 "DEFAULT ruleset"，其实用的是上级那份配置；
    #   · 根下有配置、但上级也有 → ruff 实际以**较近的那份**为准，旧版照样说"project config"，
    #     而真正生效的可能是上级的 extend 出来的规则集。**标签错了，数字就没法解读。**
    # 现在按 ruff 的规则**向上走**（见 Get-RuffRulesetLabel），并明确标出配置在**项目外面**
    # —— 那意味着"你项目的行为被项目外的文件决定了"，这本身就该被看到。
    $ruleset = (Get-RuffRulesetLabel -Root $ProjectRoot).Label
    $out = & ruff check . --no-cache --output-format=concise 2>&1
    if ($LASTEXITCODE -eq 0) { Add-Result 'C2' 'ruff (lint)' 'PASS' "clean [$ruleset]" }
    else {
      # 必须用 --output-format=concise：ruff 默认输出是**多行**格式（一条 finding 跨 6 行），
      # 按行数根本数不出来（实测：209 个错误被数成 0，却报 FAIL —— 自相矛盾的数字比没数字更糟）。
      $n = @($out | Where-Object { $_ -match '^.+?:\d+:\d+:\s' }).Count
      $summary = @($out | Where-Object { $_ -match '^Found \d+ error' } | Select-Object -Last 1)
      $detail = if ($summary.Count -gt 0) { "$($summary[0].Trim()) [$ruleset]" } else { "$n finding line(s) [$ruleset]" }
      Add-Result 'C2' 'ruff (lint)' 'FAIL' $detail
      Write-Host "        note: 若项目没有 ruff 配置，上面这些多数是风格/纪律债。**先看有几条是真问题**，别直接当阻断项。" -ForegroundColor Yellow
    }
  } finally { Pop-Location }
} else {
  Add-Result 'C2' 'ruff (Python lint)' 'SKIP' 'install: pip install ruff'
}

# 本地危险模式扫描（零依赖）
$pyFiles = @()
if (Test-Path $ProjectRoot) {
  $pyFiles = @(Get-ChildItem $ProjectRoot -Recurse -File -Filter *.py -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\(\.venv|venv|node_modules|\.git|__pycache__|build|dist)\\' })
}
if ($pyFiles.Count -gt 0) {
  $danger = @(
    # ⚠️ 词边界必须有（2026-09-13，两个独立体检同时报的**误报**）：
    #   旧写法 `eval\s*\(` 会命中 **标识符里含 eval 的调用** —— 实测命中
    #   `RiskEval().record(...)` 与 `_tab_risk_eval()`，而全仓精确 grep `\beval\(` 是 **0 命中**。
    #   假阳性比漏报更伤：它让人以为"查过了、有问题"，然后去改本来没问题的代码。
    #   （同理给 exec/pickle 这些可能被别的名字包住的也加上边界。）
    @{ p = '\beval\s*\('; d = 'eval()' },
    @{ p = '\bexec\s*\('; d = 'exec()' },
    @{ p = 'subprocess\.[A-Za-z_]+\([^)]*shell\s*=\s*True'; d = 'shell=True' },
    @{ p = '\bpickle\.loads?\s*\('; d = 'pickle (unsafe deserialize)' },
    @{ p = 'yaml\.load\s*\((?![^)]*Loader)'; d = 'yaml.load without SafeLoader' },
    @{ p = 'verify\s*=\s*False'; d = 'TLS verify disabled' },
    @{ p = 'requests\.(get|post)\([^)]*\+'; d = 'URL string concat (SSRF/injection risk)' }
  )
  $found = [System.Collections.Generic.List[string]]::new()
  foreach ($f in $pyFiles) {
    foreach ($d in $danger) {
      $m = Select-String -LiteralPath $f.FullName -Pattern $d.p -ErrorAction SilentlyContinue
      if ($m) { $found.Add("$($f.Name):$($m[0].LineNumber) $($d.d)") }
    }
  }
  if ($found.Count -gt 0) {
    Add-Result 'C3' 'dangerous patterns (py)' 'FAIL' ("$($found.Count) hit(s): " + (($found | Select-Object -First 4) -join ' | '))
  } else {
    Add-Result 'C3' 'dangerous patterns (py)' 'PASS' "$($pyFiles.Count) files scanned"
  }
} else {
  Add-Result 'C3' 'dangerous patterns (py)' 'SKIP' 'no python files'
}

# ------------------------------------------------------- D. PROJECT HYGIENE
Write-Host ''
Write-Host 'D. Project hygiene' -ForegroundColor Cyan

# D1: 是否存在 .env.example（**部署可复现**的前提）
# ── 前提是"这个项目要部署"。但**"有没有部署物"这件事本身要先探测**，而且要小心：
#    我第一版用的是"项目根 + 精确文件名"的白名单，独立复审（第六轮）用**四个真实形态**当场证伪：
#      `docker/Dockerfile.prod`、`docker/compose.production.yaml`、`systemd/*.service` + Makefile 的 deploy 目标、
#      `scripts/release/deploy-prod.sh` —— 四个**全都该 FAIL，却全被 SKIP**。
#    而 SKIP 的文案还写着"本项目没有部署配置"：**一句它没有能力下的强断言**。
#    这与上一轮抓到的"扩展名白名单"是**同一种病**：白名单只会把下一个名字留给下一个人踩。
#    所以改成两条：① 探测**递归 + 按形态**（不限于根、不限于精确名，另加 Makefile 目标）；
#                 ② 探测不到时**不给能力之外的结论** —— 明说"找不到 ≠ 不存在"。
$deploySkipRe = '\\(\.git|node_modules|\.venv|venv|__pycache__|\.ruff_cache|\.mypy_cache|\.pytest_cache|dist|build|\.next)\\+'
$deployNameRe = '(?i)^(dockerfile(\..+)?|[^\\/]*\.dockerfile|docker-compose[^\\/]*\.ya?ml|compose[^\\/]*\.ya?ml|procfile|fly\.toml|vercel\.json|netlify\.toml|render\.yaml|app\.yaml|deploy[^\\/]*\.(sh|ps1|bash)|release[^\\/]*\.(sh|ps1|bash)|[^\\/]*\.service|[^\\/]*\.timer)$'
$deployHits = [System.Collections.Generic.List[string]]::new()
foreach ($f in @(Get-ChildItem $ProjectRoot -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch $deploySkipRe -and $_.Name -match $deployNameRe })) {
  $deployHits.Add($f.FullName.Substring($ProjectRoot.Length).TrimStart('\', '/'))
}
# Makefile 里的部署目标（`deploy:` / `release:` / `publish:`）也算部署物 —— 这是最常见的一种，
# 而它**一个文件名都匹配不上**（就叫 Makefile）。
$mk = Get-ChildItem $ProjectRoot -Recurse -File -Filter 'Makefile' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch $deploySkipRe } | Select-Object -First 3
foreach ($m in $mk) {
  if (Select-String -LiteralPath $m.FullName -Pattern '^\s*(deploy|release|publish|ship)\s*:' -ErrorAction SilentlyContinue) {
    $deployHits.Add($m.FullName.Substring($ProjectRoot.Length).TrimStart('\', '/') + ' (含 deploy/release 目标)')
  }
}
$hasExample = @(@('.env.example', '.env.sample', '.env.template', 'settings.local.json.example') |
  Where-Object { Test-Path (Join-Path $ProjectRoot $_) })
if ($hasExample.Count -gt 0) { Add-Result 'D1' 'env example present' 'PASS' ($hasExample -join ', ') }
elseif ($deployHits.Count -gt 0) {
  $shown = @($deployHits | Select-Object -First 4) -join ', '
  $more = if ($deployHits.Count -gt 4) { " (+$($deployHits.Count - 4) more)" } else { '' }
  Add-Result 'D1' 'env example present' 'FAIL' "no .env.example but deployment artifacts exist ($shown$more) -> deploy is not reproducible"
}
else {
  # ⚠️ 措辞要点名**能力边界**：这是"我没找到"，不是"它不存在"。
  #    上一版写 `no deployment config in this project`，被复审查出 4 个反例 —— 强断言就是撒谎。
  Add-Result 'D1' 'env example present' 'SKIP' 'no .env.example; 也**没找到**部署物（已按常见形态递归找过：Dockerfile*/compose*.yml/*.service/deploy|release 脚本/Makefile 目标）—— **找不到 ≠ 不存在**，这一项因此无法判定'
}

# D2: CI 配置是否存在
$ci = @(@('.github/workflows', '.gitlab-ci.yml', 'azure-pipelines.yml') |
  Where-Object { Test-Path (Join-Path $ProjectRoot $_) })
if ($ci.Count -gt 0) { Add-Result 'D2' 'CI configured' 'PASS' ($ci -join ', ') }
else { Add-Result 'D2' 'CI configured' 'FAIL' 'no CI config' }

# D3: 是否有运行手册（runbook）
$runbook = @(Get-ChildItem $ProjectRoot -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '(?i)runbook|运行手册|ops.*\.md' })
if ($runbook.Count -gt 0) { Add-Result 'D3' 'runbook present' 'PASS' ($runbook.Name -join ', ') }
else { Add-Result 'D3' 'runbook present' 'FAIL' 'no runbook (deploy/rollback/restore steps)' }

# D4: **项目里有没有像密钥的文件**（2026-09-13 三项目体检照出的缺口）
# 为什么加：那三个项目**都不是 git 仓库**，于是密钥检查全走 git 那条路 → 全 SKIP。
# 而它们根下确实躺着 `settings.local.json`（真密钥的常规住处）、一个专门存密钥的目录、`config/*.json` 之类 ——
# **一个都没被看过**。清单里的密钥检查没跑，"没发现密钥"就成了"没查过"的委婉说法。
# 判据刻意窄（避免误报）：只看**文件名/路径形态**，不看内容；命中就 FAIL 并**要求人确认**。
# （内容扫描是 gitleaks/工作区检查的事；这里只负责"别让这类文件悄悄躺在项目里没人问"。）
$secretish = @(Get-ChildItem $ProjectRoot -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object {
    $_.FullName -notmatch '\\(\.venv|venv|node_modules|\.git|__pycache__|site-packages|dist|build)\\' -and
    $_.Name -match '(?i)^(settings\.local\.json|secrets?\.(json|ya?ml|toml)|\.env(\..+)?|credentials(\.json)?|apikey.*\.txt|.*\.pem|.*\.p12|id_rsa.*)$'
  } | Select-Object -First 10)
if ($secretish.Count -gt 0) {
  Add-Result 'D4' 'secret-like files' 'FAIL' (
    "$($secretish.Count) 个像密钥的文件（**要人确认是不是真密钥、有没有被分发**）：" +
    # 路径按**相对于项目根**显示：`Resolve-Path -Relative` 是相对**当前工作目录**算的，
    # 从别处调用时会打出 `.\C:\Users\...` 这种四不像（实测踩到）——给人看的东西不该长这样。
    (($secretish | ForEach-Object { $_.FullName.Substring($ProjectRoot.Length).TrimStart('\', '/') }) -join ', '))
  Write-Host '        note: 这不是"已经泄露"，是"这类文件必须有人过一眼"——非 git 项目尤其要人工确认。' -ForegroundColor Yellow
} else {
  Add-Result 'D4' 'secret-like files' 'PASS' '没有 settings.local.json / .env / *.pem 这类文件'
}

# --------------------------------------------------------------- E. TESTS
if ($IncludeTests) {
  Write-Host ''
  Write-Host 'E. Tests' -ForegroundColor Cyan
  Push-Location $ProjectRoot
  try {
    if (Test-Path (Join-Path $ProjectRoot 'tests')) {
      $uv = Join-Path $ProjectRoot '.venv\Scripts\python.exe'
      $hasUv = Test-Path $uv
      $py = if ($hasUv) { $uv } else { 'python' }

      # 先确认解释器本身存在。**独立复审实测**：PATH 里没有 python 时，
      # `& 'python' ...` 抛 CommandNotFoundException 是 statement-terminating 错误 →
      # **整个闸门在 E 段中途死掉**，连摘要都不打，E1 永远不产出 ——
      # 新加的"不许静默少项"总闸也救不了（它只在走到摘要后才生效）。
      # 所以这里必须先判存在，把"环境不具备"变成一条**正常的结果行**。
      $pyExists = $hasUv -or [bool](Get-Command $py -ErrorAction SilentlyContinue)
      if (-not $pyExists) {
        Add-Result 'E1' 'pytest env' 'FAIL' "找不到 Python 解释器（既没有 .venv\Scripts\python.exe，PATH 里也没有 python）"
        Write-Host "        diagnosis : 这台机器/这个 shell 里没有可用的 python —— 测试无从跑起。" -ForegroundColor Red
        Write-Host "        how to fix: 建 venv（python -m venv .venv）并 pip install -r requirements.txt。" -ForegroundColor Yellow
        Write-Host "        note      : 这是【环境问题】，不是测试失败，也不是闸门坏了。" -ForegroundColor Yellow
      } else {
        # 实测踩过的误导：项目 .venv 是**空环境**（装了解释器、site-packages 一个包都没有），
        # 闸门却报 "No module named pytest" —— 读的人会以为"测试挂了"，
        # 真实原因是"依赖没装"，而同一套测试用另一个解释器跑是 20 passed。
        $probe = & $py -c "import pytest" 2>&1
        if ($LASTEXITCODE -ne 0) {
          $sp = Join-Path $ProjectRoot '.venv\Lib\site-packages'
          $emptyVenv = $hasUv -and (Test-Path $sp) -and (@(Get-ChildItem $sp -Directory -ErrorAction SilentlyContinue).Count -eq 0)
          $diag = if ($emptyVenv) {
            "该 .venv 是【空环境】：有解释器，但 site-packages 里一个包都没有（依赖从没装进去）"
          } else {
            "该解释器里没有 pytest（依赖没装）"
          }
          Add-Result 'E1' 'pytest env' 'FAIL' "环境不可用（**不是测试失败**）：$py"
          Write-Host "        diagnosis : $diag" -ForegroundColor Red
          Write-Host "        how to fix: & '$py' -m pip install -r requirements.txt   # 若 requirements 里没有 pytest，还要补上 pytest" -ForegroundColor Yellow
          Write-Host "        note      : 换一个装了依赖的解释器跑同一套测试，很可能直接通过——先修环境，再谈测试结论。" -ForegroundColor Yellow
        } else {
          # **测试目录要会找嵌套的**（2026-09-13，三项目体检实测的覆盖缺口）：
          #   旧写法把 `tests/` 写死在项目**根**，于是子目录里的 `tests\`（项目 D）与
          #   根下的 `test_*.py`（项目 C）都被判成 "no tests/ directory" → **SKIP**。
          #   SKIP 本身是诚实的，但它让"闸门这一项通过"变成一句假话的素材：
          #   那两个项目其实各有 64 与 493 个用例全绿，全靠 agent 手工补跑才发现。
          #   现在：按浅优先找 `tests/` 目录（≤3 层），找不到再找根下的 `test_*.py`；
          #   并在结果里**写明用的是哪个目录** —— 口径要可见，不然"跑过了"又是模糊的。
          $testDir = $null
          $sub = @(Get-ChildItem $ProjectRoot -Recurse -Directory -Filter 'tests' -Depth 3 -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notmatch '\\(\.venv|venv|node_modules|\.git|__pycache__|build|dist|site-packages)\\' } |
            Sort-Object { $_.FullName.Split('\').Count })
          if ($sub.Count -gt 0) { $testDir = $sub[0].FullName }
          $rootTests = @(Get-ChildItem $ProjectRoot -File -Filter 'test_*.py' -ErrorAction SilentlyContinue)
          if (-not $testDir -and $rootTests.Count -eq 0) {
            Add-Result 'E1' 'pytest' 'SKIP' 'no tests/ directory（含嵌套查找，≤3 层）也没有根下的 test_*.py'
          } else {
            $what = if ($testDir) { "tests: $($testDir.Substring($ProjectRoot.Length).TrimStart('\', '/'))" } else { "root test_*.py ×$($rootTests.Count)" }
            # ⚠️ **跑测试必须做环境隔离**（2026-09-13：N4 只修了一半被抓出来 —— ruff 禁了缓存，
            #    但 pytest 仍是裸调用，于是项目根照样会出现 `.pytest_cache/` 与 `__pycache__/`）。
            #    对**没有 git** 的项目，这些写入不可回滚 → 体检即在污染。
            #    两条措施：
            #      · `-p no:cacheprovider`  关掉 pytest 自己的缓存目录
            #      · `PYTHONPYCACHEPREFIX`   把字节码**移出项目**（指到临时目录），而不是用
            #        `PYTHONDONTWRITEBYTECODE=1` 关掉编译 —— 关掉会让测试明显变慢。
            #    两条都是**进程级**环境变量，跑完立刻还原，不影响闸门后续步骤。
            $oldAddOpts = $env:PYTEST_ADDOPTS
            $oldPycache = $env:PYTHONPYCACHEPREFIX
            $env:PYTEST_ADDOPTS = "$oldAddOpts -p no:cacheprovider".Trim()
            if (-not $env:PYTHONPYCACHEPREFIX) { $env:PYTHONPYCACHEPREFIX = Join-Path ([System.IO.Path]::GetTempPath()) 'dsh-pycache' }
            try {
              $out = if ($testDir) { & $py -m pytest $testDir -q 2>&1 } else { & $py -m pytest $ProjectRoot -q 2>&1 }
            } finally {
              if ($null -eq $oldAddOpts) { Remove-Item Env:\PYTEST_ADDOPTS -ErrorAction SilentlyContinue } else { $env:PYTEST_ADDOPTS = $oldAddOpts }
              if ($null -eq $oldPycache) { Remove-Item Env:\PYTHONPYCACHEPREFIX -ErrorAction SilentlyContinue } else { $env:PYTHONPYCACHEPREFIX = $oldPycache }
            }
            if ($LASTEXITCODE -eq 0) { Add-Result 'E1' 'pytest' 'PASS' ("$($out | Select-Object -Last 1)  [$what]") }
            else { Add-Result 'E1' 'pytest' 'FAIL' "exit $LASTEXITCODE  [$what]"; Write-Host ($out | Select-Object -Last 10) }
          }
        }
      }
    } else {
      Add-Result 'E1' 'pytest' 'SKIP' 'no tests/ directory（含嵌套查找，≤3 层）也没有根下的 test_*.py'
    }
  } catch {
    # 兜底：E 段**任何**未预料的异常都必须变成一条结果行，绝不允许"闸门自己死掉、连摘要都没有"。
    # （复审实测过：命令不存在导致 statement-terminating 错误 → 整个脚本在 E 段终止，E1 零产出。）
    Add-Result 'E1' 'pytest env' 'FAIL' ("E 段异常，测试未跑成（不是测试失败）: " + $_.Exception.Message)
    Write-Host ("        exception : " + $_.Exception.GetType().Name) -ForegroundColor Red
  } finally { Pop-Location }
}

# ------------------------------------------------------------------ SUMMARY
$pass = @($results | Where-Object Status -eq 'PASS').Count
$fail = @($results | Where-Object Status -eq 'FAIL').Count
$skip = @($results | Where-Object Status -eq 'SKIP').Count
$notrun = @($results | Where-Object Status -eq 'NOTRUN').Count
$total = $results.Count

# 「不许静默消失」总闸：每项检查都**必须**产出且只产出一条结果。
# 为什么要有它：实测踩过——一处 StrictMode 异常让 C2 整项一条结果都不产出，
# 而摘要照常打印 "checked 12"，**没有任何迹象表明少了一项**。
# 漏报比误报危险得多：一次漏掉的检查会被读成"这项没问题"。
$expectedIds = @('A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3', 'D1', 'D2', 'D3')
if ($IncludeTests) { $expectedIds += 'E1' }
# ⚠️ **这份清单是"手写的第二份真相源"**（独立复审原话），它只在本文件内部自洽：
#    把上面某一行 `Add-Result 'E1'` 删掉，$actualIds 与 $expectedIds 会**一起变小**，
#    于是总闸不响、所有检查器全绿 —— 实测过。
#    防它的办法不在这份清单里（清单自己看不见自己少了什么），而是**外部**：
#      · `node scripts/verify-gate-integrity.mjs` —— 拿**钉住的清单**比对（少一项就红）
#      · `scripts/self-test.mjs` 里 quality-gate 的变异用例 —— 证明总闸真的会响
#    也就是说：**删掉一项检查 = 必须同时改这两处，否则有东西会红。**
# 注意：**不再**用 `Where-Object { $_ }` 把空 Id 悄悄滤掉（复审 L1：那会让空 Id 的结果
# 同时躲开"少项"和"重复"两个判据 = 漏报）。空 Id 现在在 Add-Result 那一层就被 Mandatory 挡住；
# 这里若仍出现空 Id，说明有调用点绕过了函数 —— 计进 $emptyIdCount，并在总闸里报出来。
$actualIds = @($results | Select-Object -ExpandProperty Id)
$emptyIdCount = @($actualIds | Where-Object { -not $_ }).Count
$actualIds = @($actualIds | Where-Object { $_ })
$missingIds = @($expectedIds | Where-Object { $actualIds -notcontains $_ })
$dupeIds = @($actualIds | Group-Object | Where-Object Count -gt 1 | Select-Object -ExpandProperty Name)

Write-Host ''
Write-Host '=== SUMMARY ===' -ForegroundColor Cyan
Write-Host ("  checked {0}  |  " -f $total) -NoNewline
Write-Host "PASS $pass" -ForegroundColor Green -NoNewline
Write-Host '  ' -NoNewline
Write-Host "FAIL $fail" -ForegroundColor $(if ($fail -gt 0) { 'Red' } else { 'Green' }) -NoNewline
Write-Host '  ' -NoNewline
Write-Host "SKIP $skip" -ForegroundColor DarkGray -NoNewline
Write-Host '  ' -NoNewline
Write-Host "NOTRUN $notrun" -ForegroundColor $(if ($notrun -gt 0) { 'Magenta' } else { 'DarkGray' })
if ($notrun -gt 0) {
  # ⛔ 单独一块，措辞与 redline-check.ps1 对齐：**这些项没有结论**，别读成"没问题"。
  Write-Host ''
  Write-Host "  NOTRUN ($notrun) - these checks produced NO conclusion:" -ForegroundColor Magenta
  foreach ($r in ($results | Where-Object Status -eq 'NOTRUN')) { Write-Host "    - [$($r.Id)] $($r.Name): $($r.Detail)" -ForegroundColor Magenta }
  Write-Host '  These are NOT "no problems found". Fix the environment (usually network/credentials) and re-run.' -ForegroundColor Magenta
}
if ($missingIds.Count -gt 0 -or $dupeIds.Count -gt 0 -or $emptyIdCount -gt 0) {
  Write-Host ''
  Write-Host '!! GATE INTEGRITY BROKEN - some check(s) never reported !!' -ForegroundColor Red
  if ($missingIds.Count -gt 0) { Write-Host ("   missing: " + ($missingIds -join ', ')) -ForegroundColor Red }
  if ($dupeIds.Count -gt 0) { Write-Host ("   duplicated: " + ($dupeIds -join ', ')) -ForegroundColor Red }
  if ($emptyIdCount -gt 0) { Write-Host ("   empty id: $emptyIdCount 条结果没有 Id（旧版会被静默剔除，于是躲开少项与重复两个判据）") -ForegroundColor Red }
  Write-Host '   A check that silently disappears reads as "that item is fine". Fix the script before trusting any verdict.' -ForegroundColor Red
}
if ($skip -gt 0) {
  Write-Host ''
  Write-Host "  NOTE: $skip check(s) SKIPPED - coverage is INCOMPLETE." -ForegroundColor Yellow
  Write-Host '  Install the missing tools to close them (commands printed above).' -ForegroundColor Yellow
}
if ($fail -gt 0) {
  Write-Host ''
  Write-Host '  Failed:' -ForegroundColor Red
  foreach ($r in ($results | Where-Object Status -eq 'FAIL')) { Write-Host "    - [$($r.Id)] $($r.Name): $($r.Detail)" -ForegroundColor Red }
}

if ($Json) {
  $report = [PSCustomObject]@{
    # generated_at 必须有：没有它，一份旧报告和一份新报告在机器眼里完全一样，
    # 而人会把它当成"当前结论"（实测踩过：fail=0 的旧报告 vs 真实 fail=2）。
    generated_at = $script:GeneratedAt
    generated_by = 'quality-gate.ps1'
    project = $ProjectRoot
    mode    = if ($Strict) { 'strict' } else { 'normal' }
    # 本次实际用上了哪些可选工具：跳过项到底是"项目不需要"还是"工具没装"，看这里。
    tools = [PSCustomObject]@{
      gitleaks = Test-Tool 'gitleaks'; semgrep = Test-Tool 'semgrep'
      ruff = Test-Tool 'ruff'; 'pip-audit' = Test-Tool 'pip-audit'
      npm = Test-Tool 'npm'; pytest = Test-Tool 'pytest'
    }
    # verdict 必须把"闸门自己坏了"算进去：复审实测过——原来只看 fail/skip，
    # 于是缺项时 JSON 里写 FAIL、stdout 写 BROKEN、退出码都是 1，**三套口径**。
    # CI/agent 读的是这个 JSON，两套结论等于没结论。
    integrity = [PSCustomObject]@{ missing = @($missingIds); duplicated = @($dupeIds) }
    verdict = $(if ($missingIds.Count -gt 0 -or $dupeIds.Count -gt 0) { 'BROKEN' } elseif ($fail -gt 0) { 'FAIL' } elseif ($notrun -gt 0) { 'NOTRUN' } elseif ($Strict -and $skip -gt 0) { 'INCOMPLETE' } elseif ($skip -gt 0) { 'PASS (with skips)' } else { 'PASS' })
    checked = $total; pass = $pass; fail = $fail; skip = $skip; notrun = $notrun
    results = $results
  }
  $jsonPath = if ([System.IO.Path]::IsPathRooted($Json)) { $Json } else { Join-Path $ProjectRoot $Json }
  # 报告可能被要求写到"还不存在的目录"（文档就建议写到项目外）→ 先建目录，
  # 并且**只在真的写成功之后**才说成功。复审实测过原来那版：目录不存在时
  # WriteAllText 抛非终止错误、下一行照样打印 "JSON written: …" —— 工具撒谎。
  try {
    $parent = Split-Path -Parent $jsonPath
    if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    [System.IO.File]::WriteAllText($jsonPath, ($report | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
    Write-Host ''
    Write-Host "  JSON written: $jsonPath  (snapshot @ $script:GeneratedAt — re-run the gate to refresh)"
  } catch {
    $script:jsonFailed = $true
    Write-Host ''
    Write-Host "  !! JSON NOT written: $jsonPath" -ForegroundColor Red
    Write-Host ("     " + $_.Exception.Message) -ForegroundColor Red
    Write-Host '     报告没写成 —— 下游若在等这个文件，会读到旧内容或什么都没有。' -ForegroundColor Red
  }
  Write-Host "  JSON written: $jsonPath  (snapshot @ $script:GeneratedAt — re-run the gate to refresh)"
}

Write-Host ''
# 退出码语义（0/1/2 是原先就有的；**3 = 有"没跑成"** 是 2026-09-13 补的，
# 与全库其它检查器一致：verify-all / verify-clean-clone / verify-ps1 都用 3 表示"没跑成"）。
# 为什么不能让它落到 0：那正是 N1 那种病 —— **"没跑成"被读成"通过"**。
$exitCode = if ($missingIds.Count -gt 0 -or $dupeIds.Count -gt 0) { 1 }
            elseif ($fail -gt 0) { 1 }
            elseif ($notrun -gt 0) { 3 }
            elseif ($Strict -and $skip -gt 0) { 2 } else { 0 }
Write-Host ("VERDICT: " + $(if ($missingIds.Count -gt 0) { 'BROKEN (a check never reported)' } elseif ($exitCode -eq 0) { if ($skip -gt 0) { 'PASS (with skips)' } else { 'PASS' } } elseif ($exitCode -eq 2) { 'INCOMPLETE (strict mode)' } elseif ($exitCode -eq 3) { "NOTRUN ($notrun check(s) produced no conclusion - this is NOT a pass)" } else { 'FAIL' }))
exit $exitCode
