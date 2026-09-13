#!/usr/bin/env pwsh
<#
.SYNOPSIS
    把参考库里的全部技能安装到 DSH 技能根（打平为 <根>/<name>/SKILL.md）。

.DESCRIPTION
    为什么需要这个脚本：
      - DSH 的技能发现**只认恰好两段路径**（<根>/<name>/SKILL.md），
        而参考库里技能按桶组织（engineering/<name>/SKILL.md）= 三段 → 扫不到。
      - 如果不安装，参考库里的技能只能"按绝对路径读"，而自研技能能直接加载 →
        同一个 agent 要用**两套调用姿势**，且"按路径读"会绕过三段式派活协议。

    本脚本把桶结构打平安装到技能根，**保留 frontmatter 原样**
    （调用策略由各技能自己的 disable-model-invocation 决定）。

    ⚠️ 打平后技能名**不能重名**。本脚本会检测重名并以非零码退出。

.PARAMETER Target
    DSH 技能根。默认 $env:DSH_HOME\skills，回退 ~/.dsh/skills。

.PARAMETER DryRun
    只报告将要做什么，不写文件。

.PARAMETER Prune
    删除技能根里"不属于本体系"的目录（危险：会删掉你自己装的技能）。
    默认关闭——只增不删。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File install-skills.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File install-skills.ps1 -DryRun
    powershell -NoProfile -ExecutionPolicy Bypass -File install-skills.ps1 -Target "D:\some\skills"
#>
[CmdletBinding()]
param(
  [string]$Target,
  [switch]$DryRun,
  [switch]$Prune
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = $PSScriptRoot
$Buckets  = @('engineering', 'productivity')

if (-not $Target) {
  $home_ = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
  $Target = Join-Path $home_ 'skills'
}

Write-Host "参考库   : $RepoRoot"
Write-Host "技能根   : $Target"
Write-Host "模式     : $(if ($DryRun) { 'DRY-RUN（不写入）' } else { '写入' })"
Write-Host ''

# ── 1) 采集源技能 ─────────────────────────────────────────────────────────
$sources = [System.Collections.Generic.List[object]]::new()
foreach ($b in $Buckets) {
  $bp = Join-Path $RepoRoot $b
  if (-not (Test-Path $bp)) { Write-Host "  (跳过不存在的桶: $b)"; continue }
  foreach ($d in (Get-ChildItem $bp -Directory | Sort-Object Name)) {
    $f = Join-Path $d.FullName 'SKILL.md'
    if (-not (Test-Path $f)) { continue }
    $sources.Add([PSCustomObject]@{ Name = $d.Name; File = $f; Bucket = $b })
  }
}
Write-Host "源技能数 : $($sources.Count)"

# ── 2) 重名检测（打平后必须唯一） ─────────────────────────────────────────
$dupes = $sources | Group-Object Name | Where-Object Count -gt 1
if ($dupes) {
  Write-Host ''
  Write-Host '✗ 打平后技能名冲突，必须先去重：' -ForegroundColor Red
  foreach ($g in $dupes) { Write-Host "   $($g.Name)  ← 出现在: $((($g.Group).Bucket) -join ', ')" }
  exit 2
}
Write-Host '重名检测 : 通过'
Write-Host ''

# ── 3) 安装 ───────────────────────────────────────────────────────────────
if (-not (Test-Path $Target)) {
  if ($DryRun) { Write-Host "  [dry] 将创建技能根 $Target" }
  else { New-Item -ItemType Directory -Force -Path $Target | Out-Null }
}

$installed = 0; $updated = 0; $unchanged = 0
foreach ($s in $sources) {
  $destDir = Join-Path $Target $s.Name
  $dest    = Join-Path $destDir 'SKILL.md'

  $srcText = [System.IO.File]::ReadAllText($s.File, [System.Text.Encoding]::UTF8)
  $same = (Test-Path $dest) -and ([System.IO.File]::ReadAllText($dest, [System.Text.Encoding]::UTF8) -eq $srcText)

  # 调用策略（用于报告；不修改源）
  $policy = if ($srcText -match '(?m)^disable-model-invocation:\s*true') { 'user-invoked' } else { 'model-invoked' }

  if ($same) { $unchanged++; continue }

  $state = if (Test-Path $dest) { '更新' } else { '新增' }
  if ($state -eq '更新') { $updated++ } else { $installed++ }

  Write-Host ("  [{0}] {1,-30} {2}  ({3})" -f $state, $s.Name, $s.Bucket, $policy)
  if (-not $DryRun) {
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    # 技能正文一律 UTF-8 无 BOM（只有 .ps1 需要 BOM）
    [System.IO.File]::WriteAllText($dest, $srcText, (New-Object System.Text.UTF8Encoding($false)))
  }
}

# ── 3b) 同步附属资源（scripts/ / *.md 等） ────────────────────────────────
# ⚠️ 关键实现约束：**不能**用 `Copy-Item <srcDir> -Destination <destDir> -Recurse`——
#    目标已存在时 PowerShell 会把源目录**塞进目标里面**，产生 `<name>\<name>\SKILL.md` 嵌套。
#    正确做法：拿**源目录里的每个条目**当源，复制到目标目录里（形成 `<destDir>\<child>`）。
$resInstalled = 0
foreach ($s in $sources) {
  $srcDir  = Split-Path $s.File -Parent
  $destDir = Join-Path $Target $s.Name
  $children = @(Get-ChildItem $srcDir -Force | Where-Object { $_.Name -ne 'SKILL.md' })
  foreach ($c in $children) {
    $cDest = Join-Path $destDir $c.Name
    if ($c.PSIsContainer) {
      if (-not $DryRun) {
        New-Item -ItemType Directory -Force -Path $cDest | Out-Null
        # 复制**目录内容**而非目录本身，避免嵌套
        Copy-Item (Join-Path $c.FullName '*') -Destination $cDest -Recurse -Force -ErrorAction SilentlyContinue
      }
      $resInstalled++
    } else {
      if (-not $DryRun) { Copy-Item $c.FullName $cDest -Force }
      $resInstalled++
    }
  }
}

# ── 3c) 自检：嵌套重复（<name>/<name>/SKILL.md）────────────────────────────
# 这种嵌套 DSH 发现不到，但会让"递归数 SKILL.md"的核对失准，并造成版本悄悄分叉。
$nested = @()
if (Test-Path $Target) {
  foreach ($d in (Get-ChildItem $Target -Directory -ErrorAction SilentlyContinue)) {
    if (Test-Path (Join-Path $d.FullName "$($d.Name)\SKILL.md")) {
      $nested += $d.Name
      if (-not $DryRun) { Remove-Item (Join-Path $d.FullName $d.Name) -Recurse -Force }
    }
  }
}
if ($nested.Count -gt 0) {
  Write-Host ''
  Write-Host "⚠️ 检测到嵌套重复目录（<name>\<name>\），$(if ($DryRun) { '将清理' } else { '已清理' })：" -ForegroundColor Yellow
  foreach ($n in $nested) { Write-Host "   $n" }
}

# ── 4) 报告技能根里"不属于本体系"的目录 ──────────────────────────────────
$expected = $sources.Name
$extra = @(Get-ChildItem $Target -Directory -ErrorAction SilentlyContinue |
           Where-Object { $expected -notcontains $_.Name -and $_.Name -notlike '_*' })
if ($extra.Count -gt 0) {
  Write-Host ''
  Write-Host "注意：技能根里还有 $($extra.Count) 个不属于本体系的目录：" -ForegroundColor Yellow
  foreach ($e in $extra) { Write-Host "   $($e.Name)" }
  if ($Prune -and -not $DryRun) {
    foreach ($e in $extra) { Remove-Item $e.FullName -Recurse -Force; Write-Host "   已删除 $($e.Name)" -ForegroundColor Yellow }
  } else {
    Write-Host '   （未删除。要删请加 -Prune）'
  }
}

Write-Host ''
Write-Host "完成：新增 $installed · 更新 $updated · 未变 $unchanged · 源合计 $($sources.Count) · 附属资源 $resInstalled"
Write-Host ''
Write-Host '⚠️ 装完请开【新会话】再验证——技能目录刷新是异步的。' -ForegroundColor Yellow
Write-Host '⚠️ 并跑一次体检：node validate-skills.mjs --quiet "<技能根>"' -ForegroundColor Yellow
if ($DryRun) { Write-Host '(dry-run：未写入任何文件)' }
