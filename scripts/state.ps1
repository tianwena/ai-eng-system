#!/usr/bin/env pwsh
<#
.SYNOPSIS
    项目中央状态读写器（.scratch/state.json）。本体系多 agent 协作的**单一事实源**。

.DESCRIPTION
    为什么需要它：状态原本散在 .scratch/*/issues/*.md 的 Status 行里，靠人扫一遍才能拼出
    "现在在哪一关"——又慢又费 token，且容易看错。

    **权限纪律（重要）**：本脚本是**唯一**允许写 state.json 的入口，且**只有 Lead 能调用**。
    其它 agent（Builder / Reviewer / Researcher…）**一律只读**——否则又多一个并发踩踏点。
    脚本不校验调用者身份（做不到），靠 skill 正文与工单纪律约束；但所有写入都会记
    updated_by=lead 与 history，**可事后审计**。

.PARAMETER Command
    init      创建 .scratch/state.json（已存在则报错，除非 -Force）
    show      打印当前状态（默认命令，供 agent 快速读）
    validate  按 schema **递归**校验 state.json（类型 / 必填含深层 / 枚举 / const / 未声明字段 / $ref）
    phase     切阶段（记录 history）
    node      设当前节点
    gate      记一道闸门的通过/未通过
    artifact  记硬结构产物（er/state/contract/context）
    block     加一个阻塞项
    unblock   移除阻塞项（按关键词匹配 what）
    tier      切换闸门档位（tech / commercial）

.PARAMETER Project
    项目根目录。默认当前目录。状态写在 <项目根>/.scratch/state.json

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File state.ps1 init -Project D:\myapp
    powershell -NoProfile -ExecutionPolicy Bypass -File state.ps1 show -Project D:\myapp
    powershell -NoProfile -ExecutionPolicy Bypass -File state.ps1 artifact -Project D:\myapp -Name er_diagram -Value true
    powershell -NoProfile -ExecutionPolicy Bypass -File state.ps1 gate -Project D:\myapp -Name tech_redline -Passed -Evidence "quality-gate 通过"
    powershell -NoProfile -ExecutionPolicy Bypass -File state.ps1 phase -Project D:\myapp -Value g3-build -Note "G2 已过：3 人预付"
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('init', 'show', 'validate', 'phase', 'node', 'gate', 'artifact', 'block', 'unblock', 'tier', 'redline')]
  [string]$Command = 'show',

  [string]$Project = '.',
  [string]$Value,
  [string]$Name,
  [string]$Evidence,
  [string]$Note,
  [string]$What,
  [string]$Tried,
  [string]$Needs,
  [switch]$Passed,
  [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── 常量（与 scripts/state.schema.json 保持一致） ─────────────────────────
$PHASES = @('idea', 'tech-review', 'g1-validate', 'g2-price', 'g3-build', 'g4-repeat', 'hardening', 'shipped', 'paused')
$TIERS = @('tech', 'commercial')
$GATE_NAMES = @('tech_redline', 'g1', 'g2', 'g3', 'g4')
$ARTIFACT_NAMES = @('context_md', 'er_diagram', 'state_diagram', 'interface_contract', 'api_contract_path')

$root = (Resolve-Path -LiteralPath $Project).Path
$scratch = Join-Path $root '.scratch'
$statePath = Join-Path $scratch 'state.json'

function Read-State {
  if (-not (Test-Path $statePath)) {
    throw "state.json 不存在：$statePath`n先用 'state.ps1 init' 创建。"
  }
  return (Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Write-State {
  param($State)
  $State.updated_at = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
  $State.updated_by = 'lead'
  $json = $State | ConvertTo-Json -Depth 10
  # PS 5.1 的 ConvertTo-Json 会把非 ASCII 转成 \uXXXX——那让人读不了 git diff。
  # 用 .NET 正则把转义还原回真字符。
  $json = [regex]::Replace($json, '\\u([0-9a-fA-F]{4})', { param($m) [char][Convert]::ToInt32($m.Groups[1].Value, 16) })
  [System.IO.File]::WriteAllText($statePath, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function New-State {
  param([string]$ProjectName)
  return [ordered]@{
    version    = 1
    project    = $ProjectName
    tier       = 'tech'
    phase      = 'idea'
    node       = 'initial'
    artifacts  = [ordered]@{ context_md = 'CONTEXT.md'; er_diagram = $false; state_diagram = $false; interface_contract = $false }
    # 技术红线的两项人工确认（机器查不了的部分，必须人答一句）
    redline    = [ordered]@{
      data_source_ok  = [ordered]@{ confirmed = $false; at = $null; note = '' }
      no_redistribute = [ordered]@{ confirmed = $false; at = $null; note = '' }
    }
    gates      = [ordered]@{
      tech_redline = [ordered]@{ passed = $false; at = $null; evidence = '' }
      g1           = [ordered]@{ passed = $false; at = $null; evidence = ''; deadline = $null }
      g2           = [ordered]@{ passed = $false; at = $null; evidence = ''; deadline = $null }
      g3           = [ordered]@{ passed = $false; at = $null; evidence = ''; deadline = $null }
      g4           = [ordered]@{ passed = $false; at = $null; evidence = ''; deadline = $null }
    }
    blockers   = @()
    deadline   = $null
    updated_at = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    updated_by = 'lead'
    history    = @()
    notes      = ''
  }
}

# ── 通用 schema 校验（**递归**：类型 / 必填 / 枚举 / const / 未声明字段 / $ref）──
# 为什么必须递归（2026-09-12，独立复审 F6）：
#   旧版只做三件事 —— 顶层有没有未声明字段、顶层 required 里有没有**键**、外加几个写死的枚举。
#   于是 `"confirmed": "true"`（**字符串**）被当成"已确认"，validate 照常打 ✓；
#   而 schema 里深层对象写的 `required`（如 artifacts 的 context_md）**从来没被读过** = 死代码。
#   "看着被校验"和"真被校验"的差别，正是这个库反复在修的那一类问题。
# 判据只有一份：scripts/state.schema.json。这里不另抄一份规则（抄一份就又制造一处会分叉的副本）。
# 解析本文件内的 JSON Pointer（#/$defs/xxx）。
# 必须用 PSObject.Properties[...]：StrictMode 下 `$node.$seg` 对不存在的键**直接抛异常**
# （实测：`The property '$defs' cannot be found`）—— schema 的根和子节点都可能没有该键。
function Resolve-SchemaPointer {
  param([AllowNull()]$Root, [string]$Pointer)
  $cur = $Root
  foreach ($seg in ($Pointer -split '/')) {
    if ($null -eq $cur) { return $null }
    $prop = $cur.PSObject.Properties[$seg]
    if ($null -eq $prop) { return $null }
    $cur = $prop.Value
  }
  return $cur
}

function Test-SchemaNode {
  param(
    [AllowNull()]$Value,
    [AllowNull()]$Schema,
    [string]$Path,
    [string]$FileHint,
    [AllowNull()]$RootSchema,
    [string[]]$VisitedRefs = @()
  )
  $out = @()
  if ($null -eq $Schema) { return $out }
  if ($null -eq $RootSchema) { $RootSchema = $Schema }

  # $ref（本文件内的 #/...）；带环保护，防止 schema 写错时无限递归
  if ($Schema.PSObject.Properties['$ref']) {
    $r = [string]$Schema.'$ref'
    if ($r -notmatch '^#/(.+)$') { return @("schema 用了不支持的 `$ref（只支持本文件内的 #/...）: $r ($Path)") }
    if ($VisitedRefs -contains $r) { return @("schema 的 `$ref 成环了: $r ($Path)") }
    $node = Resolve-SchemaPointer -Root $RootSchema -Pointer $Matches[1]
    if ($null -eq $node) { return @("schema 的 `$ref 指不到东西: $r ($Path)") }
    return (Test-SchemaNode -Value $Value -Schema $node -Path $Path -FileHint $FileHint -RootSchema $RootSchema -VisitedRefs ($VisitedRefs + $r))
  }

  # 类型（**F6 的核心**：以前完全不查）
  # ⚠️ 全部用 PSObject.Properties['x'] 取值：本脚本开了 Set-StrictMode -Version Latest，
  #    直接写 `$Schema.type` 在"这个 schema 节点没有 type"时会**直接抛异常**（不是返回 $null）——
  #    实测第一版就踩了：validate 整个崩掉，报 "The property 'required' cannot be found"。
  if ($Schema.PSObject.Properties['type']) {
    $types = @($Schema.PSObject.Properties['type'].Value)
    $actual = if ($null -eq $Value) { 'null' }
      elseif ($Value -is [bool]) { 'boolean' }
      elseif ($Value -is [string]) { 'string' }
      elseif ($Value -is [int] -or $Value -is [long] -or $Value -is [double] -or $Value -is [decimal]) { 'number' }
      elseif ($Value -is [array]) { 'array' }
      else { 'object' }
    $ok = $false
    foreach ($t in $types) {
      switch ([string]$t) {
        'object'  { if ($actual -eq 'object') { $ok = $true } }
        'array'   { if ($actual -eq 'array') { $ok = $true } }
        'string'  { if ($actual -eq 'string') { $ok = $true } }
        'integer' { if ($actual -eq 'number' -and -not ($Value -is [double]) -and -not ($Value -is [decimal])) { $ok = $true } }
        'number'  { if ($actual -eq 'number') { $ok = $true } }
        'boolean' { if ($actual -eq 'boolean') { $ok = $true } }
        'null'    { if ($actual -eq 'null') { $ok = $true } }
      }
    }
    if (-not $ok) {
      $shown = if ($Value -is [string]) { '"' + $Value + '"' } elseif ($Value -is [array]) { "（$($Value.Count) 项）" } else { [string]$Value }
      $out += "$Path`: 类型应为 $($types -join '/')，实际是 $actual（$shown）$FileHint"
    }
  }

  # 枚举 / const
  if ($Schema.PSObject.Properties['enum']) {
    $en = @($Schema.PSObject.Properties['enum'].Value)
    if ($en -notcontains $Value) { $out += "$Path`: 只能是 $($en -join ' / ')，实际是 $Value" }
  }
  if ($Schema.PSObject.Properties['const']) {
    $c = $Schema.PSObject.Properties['const'].Value
    if ($Value -ne $c) { $out += "$Path`: 必须是 $c，实际是 $Value" }
  }

  # 字符串长度下限（schema 里写了就得管）
  if ($Schema.PSObject.Properties['minLength'] -and $Value -is [string]) {
    $min = [int]$Schema.PSObject.Properties['minLength'].Value
    if ($Value.Length -lt $min) { $out += "$Path`: 长度不能小于 $min（实际 $($Value.Length)）" }
  }

  # 对象：必填 + 未声明字段 + 递归
  if ($Schema.PSObject.Properties['properties'] -and $null -ne $Value -and $Value -isnot [array]) {
    $props = $Schema.PSObject.Properties['properties'].Value
    $declared = @($props.PSObject.Properties.Name)
    $required = if ($Schema.PSObject.Properties['required']) { @($Schema.PSObject.Properties['required'].Value) } else { @() }
    foreach ($req in $required) {
      if (-not $req) { continue }
      if ($null -eq $Value.PSObject.Properties[$req]) { $out += "$Path`: 缺必填字段 $req$FileHint" }
    }
    $addl = $Schema.PSObject.Properties['additionalProperties']
    if ($addl -and $addl.Value -eq $false) {
      $unknown = @($Value.PSObject.Properties.Name | Where-Object { $declared -notcontains $_ })
      if ($unknown.Count -gt 0) { $out += "$Path`: 有 schema 未声明的字段 $($unknown -join ', ')（要么补进 schema，要么别写它）" }
    }
    foreach ($p in $Value.PSObject.Properties) {
      if ($declared -contains $p.Name) {
        $out += Test-SchemaNode -Value $p.Value -Schema $props.PSObject.Properties[$p.Name].Value -Path "$Path.$($p.Name)" -FileHint $FileHint -RootSchema $RootSchema -VisitedRefs $VisitedRefs
      }
    }
  }

  # 数组：逐项递归
  if ($Schema.PSObject.Properties['items'] -and $Value -is [array]) {
    $itemSchema = $Schema.PSObject.Properties['items'].Value
    for ($i = 0; $i -lt $Value.Count; $i++) {
      $out += Test-SchemaNode -Value $Value[$i] -Schema $itemSchema -Path "$Path[$i]" -FileHint $FileHint -RootSchema $RootSchema -VisitedRefs $VisitedRefs
    }
  }
  return $out
}

# schema 关键字白名单：只列**本校验器真的实现**的那些（见 Test-SchemaNode）。
# 为什么要有它（独立复审 M2，实测）：给 schema 加 `"pattern"` / `"oneOf"` / `"minimum"` 之后，
# 把 project 写成违规值，`validate` 照样打 ✓ 状态合法 —— 也就是说
# **以后往 schema 里加约束 = 静默不生效**，而文案却写着"schema 是唯一判据"。
# 那正是这轮在修的"看着被管、其实没人管"。现在遇到不认识的关键字直接 FAIL。
$SCHEMA_KEYWORDS = @(
  '$schema', 'title', 'description',          # 元信息：不参与校验，允许
  'type', 'required', 'enum', 'const', 'minLength',
  'properties', 'additionalProperties', 'items', '$ref', '$defs', 'default'
)
function Find-UnsupportedSchemaKeyword {
  param([AllowNull()]$Node, [string]$Path, [int]$Depth = 0)
  $out = @()
  if ($null -eq $Node -or $Depth -gt 12) { return $out }
  if ($Node -is [array]) {
    for ($i = 0; $i -lt $Node.Count; $i++) {
      $out += Find-UnsupportedSchemaKeyword -Node $Node[$i] -Path "$Path[$i]" -Depth ($Depth + 1)
    }
    return $out
  }
  # ⚠️ 遍历属性要用 `foreach ($p in $Node.PSObject.Properties)`，**不要**读 `.Name`：
  #    StrictMode 下 `$Node.PSObject.Properties.Name` 在空集合/标量上会抛
  #    "The property 'Name' cannot be found on this object" —— 实测踩过（同一个坑当天第二次）。
  if ($Node -isnot [System.Management.Automation.PSCustomObject]) { return $out }
  foreach ($p in $Node.PSObject.Properties) {
    if ($SCHEMA_KEYWORDS -notcontains $p.Name) {
      $out += "$Path.$($p.Name)"
    } elseif ($p.Name -eq 'properties' -or $p.Name -eq '$defs') {
      foreach ($sub in $p.Value.PSObject.Properties) {
        $out += Find-UnsupportedSchemaKeyword -Node $sub.Value -Path "$Path.$($p.Name).$($sub.Name)" -Depth ($Depth + 1)
      }
    } elseif ($p.Name -in @('items', 'additionalProperties')) {
      $out += Find-UnsupportedSchemaKeyword -Node $p.Value -Path "$Path.$($p.Name)" -Depth ($Depth + 1)
    }
  }
  return $out
}

# ── 各命令 ────────────────────────────────────────────────────────────────
switch ($Command) {

  'init' {
    if ((Test-Path $statePath) -and -not $Force) {
      throw "state.json 已存在：$statePath`n要覆盖请加 -Force（会丢失当前状态！）"
    }
    if (-not (Test-Path $scratch)) { New-Item -ItemType Directory -Force -Path $scratch | Out-Null }
    $name = Split-Path $root -Leaf
    $st = New-State -ProjectName $name
    Write-State $st
    Write-Host "已创建: $statePath"
    Write-Host "  项目=$name  tier=tech  phase=idea"
    Write-Host ""
    Write-Host "下一步：把三张图与契约写进 CONTEXT.md，然后：" -ForegroundColor Yellow
    Write-Host "  state.ps1 artifact -Name er_diagram -Value true" -ForegroundColor Yellow
    Write-Host "  state.ps1 artifact -Name state_diagram -Value true" -ForegroundColor Yellow
    Write-Host "  state.ps1 artifact -Name interface_contract -Value true" -ForegroundColor Yellow
  }

  'show' {
    $st = Read-State
    Write-Host "=== 项目状态: $($st.project) ===" -ForegroundColor Cyan
    Write-Host "  档位 tier : $($st.tier)$(if ($st.tier -eq 'tech') { '  （日常自用：只需技术红线）' } else { '  （要卖：需 G1–G4 全套）' })"
    Write-Host "  阶段 phase: $($st.phase)"
    Write-Host "  节点 node : $($st.node)"
    if ($st.deadline) { Write-Host "  期限      : $($st.deadline)" -ForegroundColor Yellow }
    Write-Host ""
    Write-Host "  硬结构产物（进 g3-build 前必须全绿）:"
    foreach ($a in @('er_diagram', 'state_diagram', 'interface_contract')) {
      $v = $st.artifacts.$a
      $mark = if ($v) { '✓' } else { '✗' }
      $color = if ($v) { 'Green' } else { 'Red' }
      Write-Host "    [$mark] $a" -ForegroundColor $color
    }
    Write-Host "    context_md = $($st.artifacts.context_md)"
    Write-Host ""
    Write-Host "  闸门:"
    foreach ($g in $GATE_NAMES) {
      $o = $st.gates.$g
      $mark = if ($o.passed) { '已通过' } else { '未通过' }
      $color = if ($o.passed) { 'Green' } else { 'DarkGray' }
      $ev = if ($o.evidence) { "  ← $($o.evidence)" } else { '' }
      Write-Host "    [$mark] $g$ev" -ForegroundColor $color
    }
    if ($st.blockers.Count -gt 0) {
      Write-Host ""
      Write-Host "  阻塞项 ($($st.blockers.Count)):" -ForegroundColor Yellow
      foreach ($b in $st.blockers) { Write-Host "    - $($b.what)  → 需要: $($b.needs)" }
    }
    Write-Host ""
    Write-Host "  更新: $($st.updated_at) by $($st.updated_by)"
  }

  'validate' {
    $st = Read-State
    $problems = @()
    # ⚠️ **先做 schema 校验，再做下面那些"直接取属性"的判断** —— 顺序是有原因的（独立复审 M1）：
    # 本脚本开着 Set-StrictMode -Version Latest，`$st.version` 这类写法在**键不存在时直接抛异常**。
    # 旧顺序把 `$st.version -ne 1` 放在 schema 校验**之前**，于是"顶层缺键"这种最该被报成
    # 「缺必填字段」的情形，用户看到的是 PowerShell 异常栈（方向完全错）。
    # 实测：删掉 version / phase / updated_by / artifacts 四个键里的任意一个 → 4/5 都是异常栈。
    # 现在递归校验先跑（它输出的是"缺必填字段 xxx"，正是人需要的方向），
    # 后面那些判断再逐个用 PSObject.Properties[...] 取值，不再依赖"键一定在"。

    # ── 用 schema 真校验（schema 以前是**没人执行的文档**）──────────────────
    # 实测踩过：state.ps1 init 会写 `redline` 字段，而 state.schema.json 没声明它
    # 且根对象写着 additionalProperties:false —— **机器生成的产物违反自己的 schema**，
    # 而 validate 从不读那份 schema，于是谁也没发现。冷启动测试把它照出来了。
    $here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
    $schemaPath = Join-Path $here 'state.schema.json'
    if (Test-Path $schemaPath) {
      $schema = Get-Content $schemaPath -Raw -Encoding UTF8 | ConvertFrom-Json
      # **递归**校验：类型 / 必填（含深层对象的 required）/ 枚举 / const / 未声明字段 / $ref。
      # 旧版只查顶层键名与几个写死的枚举 → `confirmed: "true"`（字符串）算"已确认"，
      # 深层 required（artifacts.context_md）从没被读过。现在判据只有 schema 这一份。
      $schemaProblems = @(Test-SchemaNode -Value $st -Schema $schema -Path 'state' -FileHint '' -RootSchema $schema)
      # 兜底：schema 本身没写 type 也要能报"缺字段"（比如 root 没有 required 的情况）。
      # 这里也用 PSObject.Properties 取值：根 schema 连 required 都被删掉时，`$schema.required` 会抛。
      $schemaRequired = if ($schema.PSObject.Properties['required']) { @($schema.PSObject.Properties['required'].Value) } else { @() }
      $missing = @($schemaRequired | Where-Object { $st.PSObject.Properties.Name -notcontains $_ })
      if ($missing.Count -gt 0) { $schemaProblems += "state: 缺 schema 要求的字段: $($missing -join ', ')" }
      # schema 用了校验器不认识的关键字 → 那条约束**加了也不生效**，必须说出来（M2）
      $unsupported = @(Find-UnsupportedSchemaKeyword -Node $schema -Path 'schema')
      if ($unsupported.Count -gt 0) {
        $schemaProblems += "state.schema.json 用了本校验器没实现的关键字（加了也不生效）：$($unsupported -join ', ')" +
          " —— 要么在 state.ps1 的 Test-SchemaNode 里实现它，要么别写进 schema"
      }
      if ($schemaProblems.Count -gt 0) {
        $problems += $schemaProblems
        $problems += "（以上来自 state.schema.json 的递归校验；schema 是唯一判据，别在这里另抄规则）"
      }
    } else {
      $problems += "找不到 state.schema.json（$schemaPath）—— 校验器缺一半，别当成通过"
    }

    # 取值助手：键不在时给 $null（而不是抛异常）—— StrictMode 下这是唯一安全的读法
    $get = { param($obj, $key) if ($null -ne $obj -and $obj.PSObject.Properties[$key]) { $obj.PSObject.Properties[$key].Value } else { $null } }

    $ver = & $get $st 'version'
    if ($null -ne $ver -and $ver -ne 1) { $problems += "version 应为 1，实际 $ver" }
    if (-not (& $get $st 'project')) { $problems += "缺 project" }
    if ($PHASES -notcontains (& $get $st 'phase')) { $problems += "phase 非法: $(& $get $st 'phase')（合法: $($PHASES -join ', ')）" }
    if (-not (& $get $st 'tier') -or $TIERS -notcontains (& $get $st 'tier')) { $problems += "tier 非法: $(& $get $st 'tier')" }
    if (-not (& $get $st 'node')) { $problems += "缺 node" }
    if (-not (& $get $st 'artifacts')) { $problems += "缺 artifacts" }
    if ((& $get $st 'updated_by') -ne 'lead') { $problems += "updated_by 必须是 lead" }

    # 档位与阶段的匹配（两级闸门的一致性）
    if ((& $get $st 'tier') -eq 'commercial' -and (& $get $st 'phase') -in @('g1-validate', 'g2-price')) {
      # 合法
    } elseif ((& $get $st 'tier') -eq 'tech' -and (& $get $st 'phase') -in @('g1-validate', 'g2-price')) {
      $problems += "tier=tech 却处于商业阶段 $(& $get $st 'phase')（要么改 tier=commercial，要么回退阶段）"
    }

    # 硬结构校验：进 g3-build 必须三图+契约齐
    $art = & $get $st 'artifacts'
    if ((& $get $st 'phase') -in @('g3-build', 'g4-repeat', 'hardening', 'shipped') -and $null -ne $art) {
      foreach ($a in @('er_diagram', 'state_diagram', 'interface_contract')) {
        if (-not (& $get $art $a)) { $problems += "已进入 $(& $get $st 'phase')，但硬结构产物缺: $a" }
      }
    }
    # 商业阶段必须已过技术红线（同样走 $get：gates 缺键时不该抛异常）
    if ((& $get $st 'tier') -eq 'commercial' -and (& $get $st 'phase') -in @('g1-validate', 'g2-price', 'g3-build', 'g4-repeat')) {
      $gates = & $get $st 'gates'
      $techRedline = & $get $gates 'tech_redline'
      if (-not (& $get $techRedline 'passed')) { $problems += "商业流程必须先过 tech_redline 闸门" }
    }

    if ($problems.Count -eq 0) {
      Write-Host "✓ 状态合法（phase=$(& $get $st 'phase') tier=$(& $get $st 'tier')）" -ForegroundColor Green
      exit 0
    } else {
      Write-Host "✗ 状态有问题：" -ForegroundColor Red
      foreach ($p in $problems) { Write-Host "   - $p" -ForegroundColor Red }
      exit 1
    }
  }

  'tier' {
    if ($TIERS -notcontains $Value) { throw "tier 必须是: $($TIERS -join ' / ')" }
    $st = Read-State
    $old = $st.tier
    $st.tier = $Value
    $st.history += [ordered]@{ at = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'); from = "tier:$old"; to = "tier:$Value"; note = $Note }
    Write-State $st
    Write-Host "档位: $old → $Value"
    if ($Value -eq 'commercial') {
      Write-Host "  已切到商业档：接下来要走 G1 验证（见 commercial-squad）" -ForegroundColor Yellow
    } else {
      Write-Host "  已切到技术档：只需跑技术红线审查" -ForegroundColor Yellow
    }
  }

  'phase' {
    if ($PHASES -notcontains $Value) { throw "phase 必须是: $($PHASES -join ' / ')" }
    $st = Read-State
    $old = $st.phase
    $st.phase = $Value
    $st.history += [ordered]@{ at = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'); from = $old; to = $Value; note = $Note }
    Write-State $st
    Write-Host "阶段: $old → $Value"
    if ($Value -eq 'g3-build') {
      $missing = @(@('er_diagram', 'state_diagram', 'interface_contract') | Where-Object { -not $st.artifacts.$_ })
      if ($missing.Count -gt 0) {
        Write-Host "  ⚠️ 硬结构产物缺失: $($missing -join ', ')" -ForegroundColor Red
        Write-Host "     按纪律，Builder 阶段不该开始。跑 'state.ps1 validate' 会报错。" -ForegroundColor Red
      }
    }
  }

  'node' {
    if (-not $Value) { throw "需要 -Value（节点名）" }
    $st = Read-State
    $old = $st.node
    $st.node = $Value
    Write-State $st
    Write-Host "节点: $old → $Value"
  }

  'gate' {
    if ($GATE_NAMES -notcontains $Name) { throw "闸门名必须是: $($GATE_NAMES -join ' / ')" }
    $st = Read-State
    $g = $st.gates.$Name
    $g.passed = [bool]$Passed
    $g.at = if ($Passed) { Get-Date -Format 'yyyy-MM-dd HH:mm:ss' } else { $null }
    if ($Evidence) { $g.evidence = $Evidence }
    if (-not $Passed) { $g.evidence = '' }
    Write-State $st
    $s = if ($Passed) { '已通过' } else { '已重置为未通过' }
    Write-Host "闸门 $Name ：$s"
    if ($Evidence) { Write-Host "  证据: $Evidence" }
    if ($Passed -and -not $Evidence) {
      Write-Host "  ⚠️ 没有证据的『通过』等于造假——建议补 -Evidence" -ForegroundColor Yellow
    }
  }

  'artifact' {
    if ($ARTIFACT_NAMES -notcontains $Name) { throw "产物名必须是: $($ARTIFACT_NAMES -join ' / ')" }
    $st = Read-State
    if ($Name -eq 'context_md' -or $Name -eq 'api_contract_path') {
      if (-not $Value) { throw "$Name 需要一个路径值（-Value）" }
      $st.artifacts.$Name = $Value
      Write-Host "$Name = $Value"
    } else {
      $bool = $Value -in @('true', 'True', '1', 'yes')
      $st.artifacts.$Name = $bool
      Write-Host "$Name = $bool"
    }
    Write-State $st
  }

  'redline' {
    # 技术红线的两项**人工确认**（机器查不了的部分）。
    # 机器能查的（硬编码密钥 / 无保护 API）由 scripts/redline-check.ps1 负责，不在这里记。
    if ($Name -notin @('data_source_ok', 'no_redistribute')) {
      throw "红线项必须是: data_source_ok（数据来源合法） / no_redistribute（不分发他人内容）"
    }
    $st = Read-State
    $r = $st.redline.$Name
    $r.confirmed = $true
    $r.at = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $r.note = if ($Note) { $Note } else { '' }
    Write-State $st
    $label = if ($Name -eq 'data_source_ok') { '数据来源合法（爬取/用户数据/第三方 API 有授权）' } else { '不分发他人付费内容/数据' }
    Write-Host "红线已确认: $label"
    if (-not $Note) {
      Write-Host "  ⚠️ 没有写依据（-Note）——建议补一句『为什么合法』，将来你自己也要靠它回忆" -ForegroundColor Yellow
    }
  }

  'block' {
    if (-not $What -or -not $Needs) { throw "需要 -What（卡在哪）与 -Needs（需要谁做什么）" }
    $st = Read-State
    $st.blockers += [ordered]@{ what = $What; tried = $Tried; needs = $Needs; since = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') }
    Write-State $st
    Write-Host "已加阻塞项: $What"
  }

  'unblock' {
    if (-not $What) { throw "需要 -What（按关键词匹配要移除的阻塞项）" }
    $st = Read-State
    $before = $st.blockers.Count
    $st.blockers = @($st.blockers | Where-Object { $_.what -notmatch [regex]::Escape($What) })
    Write-State $st
    Write-Host "阻塞项: $before → $($st.blockers.Count)"
  }
}
