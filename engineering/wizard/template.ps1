#!/usr/bin/env pwsh
#
# 向导（wizard）—— 一步一步引导人走完一套**只有人能做的**手工流程。
# 由 /wizard 技能生成。
#
# "STAGES" 标记以上的部分是向导库：**不要手改**。你在标记以下编写各阶段。
#
# 与原版 template.sh 的关系：本文件是同一套 UX 的 PowerShell 移植版。
# Windows 原生可用（不依赖 bash / WSL）；Linux/macOS 上需 pwsh 7+。
#
# 生成向导时：把本文件复制到目标路径，替换 STAGES 以下的示例，并设好 $TOTAL_STAGES。

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---
# 向导库 —— 一致的、好用的 UX。每个向导都相同。
# ---

# 作者在 stages 段顶部设置这个值。
$TOTAL_STAGES = 0

$script:StageIndex    = 0
$script:EnvFile       = if ($env:ENV_FILE) { $env:ENV_FILE } else { '.env' }
$script:WrittenEnv    = [System.Collections.Generic.List[string]]::new()
$script:WrittenSecret = [System.Collections.Generic.List[string]]::new()
$script:Skipped       = [System.Collections.Generic.List[string]]::new()

# 是否交互式终端（非交互时不刷屏、不阻塞）
# 注意：不能用 Test-* 命名（PowerShell 保留 Test- 前缀给参数语法），故用 TestWizardInteractive
function TestWizardInteractive { -not [Console]::IsOutputRedirected }

function Clear-Screen {
  if (TestWizardInteractive) { Clear-Host }
}

function Write-Banner {
  param([string]$Title)
  Clear-Screen
  Write-Host ''
  Write-Host "  $Title" -ForegroundColor Cyan
  Write-Host "  $TOTAL_STAGES 个阶段" -ForegroundColor DarkGray
  Write-Host ''
  Write-Host '  你操作浏览器；这个向导会明确告诉你每一步做什么，' -ForegroundColor DarkGray
  Write-Host '  并把你复制回来的值采集下来。随时 Ctrl-C 退出，重跑时会' -ForegroundColor DarkGray
  Write-Host '  沿用已经保存过的值。' -ForegroundColor DarkGray
  Wait-Pause -Message '准备好了就开始？'
}

function Start-Stage {
  param([Parameter(Mandatory)][string]$Name)
  Clear-Screen
  $script:StageIndex++
  Write-Host ''
  Write-Host "  ▸ 阶段 $script:StageIndex/$TOTAL_STAGES · $Name" -ForegroundColor Cyan
}

function Write-Say  { param([string]$Text) Write-Host "  $Text" }
function Write-Step { param([string]$Text) Write-Host "  • " -ForegroundColor Cyan -NoNewline; Write-Host $Text }
function Write-Note { param([string]$Text) Write-Host "  $Text" -ForegroundColor DarkGray }
function Write-Warn { param([string]$Text) Write-Host "  ⚠ $Text" -ForegroundColor Yellow }
function Write-Ok   { param([string]$Text) Write-Host "  ✓ $Text" -ForegroundColor Green }

# 在人的浏览器里打开 URL（Windows 原生；其他平台按可用命令回退）
function Open-Url {
  param([Parameter(Mandatory)][string]$Url)
  Write-Host "  ↗ 正在打开 " -ForegroundColor Green -NoNewline
  Write-Host $Url
  try {
    if ($IsWindows -or $env:OS -eq 'Windows_NT') {
      Start-Process $Url | Out-Null
    } elseif ($IsMacOS) {
      & open $Url
    } else {
      & xdg-open $Url
    }
  } catch {
    Write-Warn "打不开浏览器 —— 请手动访问：$Url"
  }
}

# 等人确认手工步骤做完了
function Wait-Pause {
  param([string]$Message = '按 Enter 继续')
  if (-not (TestWizardInteractive)) { return }
  Write-Host "  $Message " -ForegroundColor DarkGray -NoNewline
  [void](Read-Host)
}

# y/N 闸门；返回 $true 表示确认
function Confirm-Action {
  param([Parameter(Mandatory)][string]$Question)
  if (-not (TestWizardInteractive)) { return $true }
  Write-Host "  ? $Question [y/N] " -ForegroundColor Yellow -NoNewline
  $reply = Read-Host
  return ($reply -match '^[Yy]')
}

# 读 .env 里某个 KEY 的当前值（用于重跑时给默认值）
function Get-EnvValue {
  param([Parameter(Mandatory)][string]$Key)
  if (-not (Test-Path $script:EnvFile)) { return $null }
  $line = Get-Content -LiteralPath $script:EnvFile -Encoding UTF8 |
          Where-Object { $_ -match "^$([regex]::Escape($Key))=" } |
          Select-Object -Last 1
  if (-not $line) { return $null }
  return $line.Substring($line.IndexOf('=') + 1)
}

# 问一个值，写进变量（可见输入）。重跑时 Enter 沿用已有值。
function Read-Value {
  param(
    [Parameter(Mandatory)][string]$Key,
    [Parameter(Mandatory)][string]$Prompt
  )
  $current = Get-EnvValue -Key $Key
  if ($current) {
    Write-Host "  $Prompt " -NoNewline
    Write-Host '[Enter 沿用当前值]' -ForegroundColor DarkGray -NoNewline
    Write-Host ' ' -NoNewline
  } else {
    Write-Host "  $Prompt " -NoNewline
  }
  $input_ = Read-Host
  if ([string]::IsNullOrEmpty($input_) -and $current) { $input_ = $current }
  Set-Variable -Name $Key -Value $input_ -Scope Script
}

# 问一个密钥值，输入隐藏。
function Read-Secret {
  param(
    [Parameter(Mandatory)][string]$Key,
    [Parameter(Mandatory)][string]$Prompt
  )
  $current = Get-EnvValue -Key $Key
  if ($current) {
    Write-Host "  $Prompt " -NoNewline
    Write-Host '[Enter 沿用当前值]' -ForegroundColor DarkGray -NoNewline
    Write-Host ' ' -NoNewline
  } else {
    Write-Host "  $Prompt " -NoNewline
  }
  $sec = Read-Host -AsSecureString
  $plain = [System.Net.NetworkCredential]::new('', $sec).Password
  if ([string]::IsNullOrEmpty($plain) -and $current) { $plain = $current }
  Set-Variable -Name $Key -Value $plain -Scope Script
}

# 把 KEY=VALUE 写进 .env（不存在则创建；已存在则替换）。幂等。
function Set-EnvValue {
  param(
    [Parameter(Mandatory)][string]$Key,
    [Parameter(Mandatory)][AllowEmptyString()][string]$Value
  )
  if (-not (Test-Path $script:EnvFile)) { New-Item -ItemType File -Path $script:EnvFile -Force | Out-Null }
  $existing = @(Get-Content -LiteralPath $script:EnvFile -Encoding UTF8 -ErrorAction SilentlyContinue |
                Where-Object { $_ -notmatch "^$([regex]::Escape($Key))=" })
  $existing += "$Key=$Value"
  Set-Content -LiteralPath $script:EnvFile -Value $existing -Encoding UTF8
  $script:WrittenEnv.Add($Key)
  Write-Ok "已写入 $Key → $script:EnvFile"
}

# 确认 gh 可用并已登录
function TestGhReady {
  $gh = Get-Command gh -ErrorAction SilentlyContinue
  if (-not $gh) { return $false }
  try { & gh auth status *> $null; return ($LASTEXITCODE -eq 0) } catch { return $false }
}

# 设置 GitHub Actions 仓库 secret（需要 gh）。不可用时记录并警告，不中断。
function Set-RepoSecret {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][AllowEmptyString()][string]$Value
  )
  if (TestGhReady) {
    try {
      $Value | & gh secret set $Name *> $null
      if ($LASTEXITCODE -eq 0) {
        $script:WrittenSecret.Add($Name)
        Write-Ok "已设置 GitHub secret $Name"
        return
      }
    } catch { }
  }
  $script:Skipped.Add("GitHub secret $Name（手动设置：gh secret set $Name）")
  Write-Warn "跳过 GitHub secret $Name —— gh 不可用或未登录，稍后手动设置"
}

# 设置 GitHub Actions 仓库变量（非密钥）
function Set-RepoVariable {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][AllowEmptyString()][string]$Value
  )
  if (TestGhReady) {
    try {
      & gh variable set $Name --body $Value *> $null
      if ($LASTEXITCODE -eq 0) { Write-Ok "已设置 GitHub variable $Name"; return }
    } catch { }
  }
  $script:Skipped.Add("GitHub variable $Name")
  Write-Warn "跳过 GitHub variable $Name —— gh 不可用或未登录"
}

# 收尾摘要
function Complete-Wizard {
  Clear-Screen
  Write-Host ''
  Write-Host '  ✓ 配置完成' -ForegroundColor Green
  if ($script:WrittenEnv.Count -gt 0) {
    Write-Note "写入 $($script:WrittenEnv.Count) 个值到 $script:EnvFile：$($script:WrittenEnv -join ', ')"
  }
  if ($script:WrittenSecret.Count -gt 0) {
    Write-Note "设置 $($script:WrittenSecret.Count) 个 GitHub secret：$($script:WrittenSecret -join ', ')"
  }
  if ($script:Skipped.Count -gt 0) {
    Write-Host ''
    Write-Warn '仍需手工完成：'
    foreach ($s in $script:Skipped) { Write-Note "  - $s" }
  }
  Write-Host ''
}

# ---
# STAGES —— 作者写这一段。人走的每一步一个 Start-Stage。
# 把下面的示例替换掉，并把 $TOTAL_STAGES 设为你写的阶段数。
# ---

$TOTAL_STAGES = 1

Write-Banner -Title '示例：Stripe 配置'

# --- 示例阶段：替换成你的真实步骤 ---
Start-Stage -Name 'Stripe —— API 密钥'
Write-Say '我们来取 Stripe 测试密钥，存到本地开发与 CI 用。'
Open-Url -Url 'https://dashboard.stripe.com/test/apikeys'
Write-Step '在 API keys 页面复制 Publishable key（以 pk_test_ 开头）。'
Read-Value -Key 'STRIPE_PUBLISHABLE_KEY' -Prompt '粘贴 publishable key：'
Write-Step "点 Secret key 那行的 'Reveal test key'，然后复制。"
Read-Secret -Key 'STRIPE_SECRET_KEY' -Prompt '粘贴 secret key：'
Set-EnvValue -Key 'STRIPE_PUBLISHABLE_KEY' -Value $STRIPE_PUBLISHABLE_KEY
Set-EnvValue -Key 'STRIPE_SECRET_KEY' -Value $STRIPE_SECRET_KEY
Set-RepoSecret -Name 'STRIPE_SECRET_KEY' -Value $STRIPE_SECRET_KEY   # CI 需要这个
# ---

Complete-Wizard
