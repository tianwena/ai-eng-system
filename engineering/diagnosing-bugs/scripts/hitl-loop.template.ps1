#!/usr/bin/env pwsh
# 人在回路（HITL）复现环路 —— PowerShell 版
#
# 复制本文件、改下面的步骤，然后运行。
# agent 负责跑脚本；用户在终端里照着提示操作。
#
# 用法:
#   powershell -NoProfile -ExecutionPolicy Bypass -File hitl-loop.template.ps1
#
# 两个辅助函数:
#   Step "<说明>"              → 显示说明，等用户按 Enter
#   Capture VAR "<问题>"       → 显示问题，把回答读进变量 VAR
#
# 结束时会把采集到的值按 KEY=VALUE 打印出来，供 agent 解析。
#
# ⚠️ 注意：`Capture` 会把值回显到终端，agent 从那里读取——
#    所以只采集**观测结果**；让用户登录这类动作请用 `Step`（不回显敏感输入）。
#
# ⚠️ 编码：本文件必须存成 **UTF-8 带 BOM**（Windows PowerShell 5.1 对无 BOM 的
#    UTF-8 脚本按 GBK 解码，中文会吞掉字符串结束引号 → 报 "missing the terminator"）。

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:Captured = [ordered]@{}

function Step {
  param([Parameter(Mandatory)][string]$Text)
  Write-Host ''
  Write-Host ">>> $Text" -ForegroundColor Cyan
  Write-Host '    [完成后按 Enter] ' -ForegroundColor DarkGray -NoNewline
  [void](Read-Host)
}

function Capture {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$Question
  )
  Write-Host ''
  Write-Host ">>> $Question" -ForegroundColor Cyan
  Write-Host '    > ' -ForegroundColor DarkGray -NoNewline
  $answer = Read-Host
  $script:Captured[$Name] = $answer
}

# ─── 在下面编辑 ─────────────────────────────────────────────────────────

Step "打开应用 http://localhost:3000 并登录。"

Capture -Name 'ERRORED' -Question "点『导出』按钮。它报错了吗？(y/n)"

Capture -Name 'ERROR_MSG' -Question "把报错信息粘贴过来（没有就填 none）："

# ─── 在上面编辑 ─────────────────────────────────────────────────────────

Write-Host ''
Write-Host '--- 采集结果 ---' -ForegroundColor Yellow
foreach ($k in $script:Captured.Keys) {
  Write-Host ("{0}={1}" -f $k, $script:Captured[$k])
}
