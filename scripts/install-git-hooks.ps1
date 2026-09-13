# 安装/卸载 git 钩子。
#
# 做法：不用复制文件到 .git/hooks（那是个不受版本管理、clone 后就没有的黑盒），
# 而是把 hooks 目录指向仓库内的 scripts/git-hooks —— 钩子跟着代码走，改了立刻生效。
#
# 用法:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-git-hooks.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-git-hooks.ps1 -Uninstall
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-git-hooks.ps1 -Repo D:\path\to\repo
#
# 等价的手工命令（不想跑脚本时）：
#   git config core.hooksPath scripts/git-hooks
#   git config --unset core.hooksPath
[CmdletBinding()]
param(
  [string]$Repo,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

# $PSScriptRoot 在 param 默认值里可能是空的（实测 PS 5.1 + -File 会为空），所以放到脚本体里算
if (-not $Repo) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
  $Repo = Split-Path -Parent $here
}

if (-not (Test-Path (Join-Path $Repo '.git'))) {
  Write-Host "✗ $Repo 不是 git 仓库（找不到 .git）" -ForegroundColor Red
  exit 1
}

if ($Uninstall) {
  $old = git -C $Repo config --get core.hooksPath 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $old) {
    Write-Host "当前没有配置 core.hooksPath —— 无需卸载。"
    exit 0
  }
  git -C $Repo config --unset core.hooksPath
  Write-Host "✓ 已卸载（原值：$old）。提交前自检不再运行。" -ForegroundColor Yellow
  exit 0
}

$hookDir = Join-Path $Repo 'scripts\git-hooks'
$hookFile = Join-Path $hookDir 'pre-commit'
if (-not (Test-Path $hookFile)) {
  Write-Host "✗ 找不到 $hookFile" -ForegroundColor Red
  exit 1
}

# 钩子必须是 LF：CRLF 会让 sh 报 `\r': command not found`，钩子静默失效
$bytes = [System.IO.File]::ReadAllBytes($hookFile)
$crlf = 0
for ($i = 0; $i -lt $bytes.Length - 1; $i++) { if ($bytes[$i] -eq 13 -and $bytes[$i + 1] -eq 10) { $crlf++ } }
if ($crlf -gt 0) {
  Write-Host "⚠️ pre-commit 含 $crlf 处 CRLF —— 正在转成 LF（否则钩子在 Windows 上会静默失效）" -ForegroundColor Yellow
  $text = [System.IO.File]::ReadAllText($hookFile).Replace("`r`n", "`n")
  [System.IO.File]::WriteAllText($hookFile, $text, (New-Object System.Text.UTF8Encoding $false))
}

git -C $Repo config core.hooksPath scripts/git-hooks
if ($LASTEXITCODE -ne 0) { Write-Host "✗ git config 失败" -ForegroundColor Red; exit 1 }

$now = git -C $Repo config --get core.hooksPath
Write-Host "✓ 已安装：core.hooksPath = $now" -ForegroundColor Green
Write-Host "  钩子：$hookFile"
Write-Host "  下次 git commit 会自动跑（.ps1 体检 / 技能 frontmatter / 内容一致性 / 速查卡漂移）。"
Write-Host "  本次提交想跳过：git commit --no-verify（跳过 = 这次没有任何检查）"
