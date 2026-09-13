# ruff 规则集标签（**单独一份**，因为 quality-gate.ps1 现在两条路都要用它）
#
# 为什么单独放（复审 F7/M8 的落地）：
#   1. `quality-gate.ps1 -RuffLabel` 需要**在跑任何环境探测之前**就拿到标签（否则整次调用会
#      去扫 WinGet/Python 目录，实测超时），而那时主文件还没走到函数定义 —— 点源这个文件最省事；
#   2. 这份逻辑要能被**行为验证**：`self-test.mjs` 用小目录树把六种情形自动化
#      （以前只能"装个 ruff、跑整个闸门、从输出里读"，那是碰运气）。
#
# 返回 @{ Label = 给人读的标签（含中文）; Ascii = 给机器断言的纯 ASCII 摘要 }
#   Ascii 形如 `project/user-config-present`、`none/no-user-config`、`inherited/...`
#   —— 为什么另出一份 ASCII：本体系自己的规矩是"纯 ASCII 输出，避开 PowerShell 5.1 的编码坑"
#     （实测：中文经管道会被 `spawnSync(encoding:"utf8")` 读成乱码）。
function Get-RuffRulesetLabel {
  param([Parameter(Mandatory = $true)][string]$Root)
  $found = $null
  $probe = $Root
  for ($depth = 0; $depth -lt 12 -and $probe; $depth++) {
    foreach ($name in @('ruff.toml', '.ruff.toml')) {
      $cand = Join-Path $probe $name
      if (Test-Path $cand) { $found = $cand; break }
    }
    if ($found) { break }
    # pyproject.toml 只有**带 [tool.ruff]** 才算 ruff 配置（否则任何 Python 项目都会被误判）
    $pp = Join-Path $probe 'pyproject.toml'
    if (Test-Path $pp) {
      $ppText = Get-Content $pp -Raw -ErrorAction SilentlyContinue
      if ($ppText -and $ppText -match '(?m)^\s*\[tool\.ruff') { $found = $pp; break }
    }
    $parent = Split-Path -Parent $probe
    if (-not $parent -or $parent -eq $probe) { break }
    $probe = $parent
  }

  # **用户级配置（复审 M8，官方文档与 issue #19238 都确认 ruff 会读它）**：
  #   `%USERPROFILE%\ruff.toml`（Unix 是 `~/.config/ruff/ruff.toml`）。
  #   旧版只沿目录树向上找，找不到就断言 "ruff DEFAULT ruleset" —— 而用户的严格规则集
  #   （例如 select=['T20']）其实**正在生效**，标签却说"默认集/风格债"，方向刚好说反。
  #   这里只断言"存在这个文件"（可观测），**不猜** ruff 到底读没读它 —— 两者都可能，
  #   所以措辞是"可能仍在读"。
  $userCfg = @()
  foreach ($cand in @(
      (Join-Path $env:USERPROFILE 'ruff.toml'),
      (Join-Path $env:USERPROFILE '.ruff.toml'),
      (Join-Path $env:USERPROFILE '.config\ruff\ruff.toml')
    )) {
    if ($cand -and (Test-Path $cand)) { $userCfg += $cand }
  }
  $userNote = if ($userCfg.Count -gt 0) {
    "  ⚠ 还检测到**用户级配置**（ruff 可能仍在读它）：$($userCfg -join ', ')"
  } else { '' }
  $perFileNote = '　（注：ruff 按**文件就近**解析配置，嵌套子目录可能另有配置 —— 本标签只描述"项目根这一侧"看到的那份。）'

  $label = if (-not $found) {
    "NO config found (project or any parent) -> ruff DEFAULT ruleset (style debt included)$userNote$perFileNote"
  } elseif ($found.StartsWith((Resolve-Path -LiteralPath $Root).Path, [StringComparison]::OrdinalIgnoreCase)) {
    "project config: $(Split-Path -Leaf $found)$userNote$perFileNote"
  } else {
    "INHERITED config from OUTSIDE the project: $found  <-- 项目外的文件在决定你项目的规则集，先确认这是你要的$userNote$perFileNote"
  }

  $ascii = @()
  $ascii += if (-not $found) { 'none' }
    elseif ($found.StartsWith((Resolve-Path -LiteralPath $Root).Path, [StringComparison]::OrdinalIgnoreCase)) { 'project' }
    else { 'inherited' }
  $ascii += if ($userCfg.Count -gt 0) { 'user-config-present' } else { 'no-user-config' }
  return @{ Label = $label; Ascii = ($ascii -join '/') }
}
