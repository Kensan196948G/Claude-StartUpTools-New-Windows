<#
.SYNOPSIS
    全登録プロジェクトへ Claude テンプレート群を一括同期する。
.DESCRIPTION
    registered-projects.json の各プロジェクトに対して Sync-LauncherClaudeGlobalConfig を実行し、
    テンプレ更新 (CLAUDE.md / START_PROMPT.md / .claude/claudeos など。例: ClaudeOS v10.5) を
    まとめて反映する。対話起動 (Start-ClaudeCode.ps1) を各プロジェクトで行うのを待たずに、
    登録済みプロジェクト全体へ一括配布できる。

    同期内容 (Sync-LauncherClaudeGlobalConfig と同一):
      - 差分上書き同期: CLAUDE.md / .claude/START_PROMPT.md / .claude/claudeos /
        .claude/agents / .claude/commands / .claude/skills / .claude/hooks /
        .claude/workflows / .claude/statusline.py / scripts/tools
      - 初回のみ配置 (既存維持): .claude/settings.json / .mcp.json

    注意:
      - Sync は差分があれば上書きする。プロジェクト側で手編集した CLAUDE.md /
        .claude/START_PROMPT.md などはテンプレ内容で上書きされる (テンプレを単一の真実とする設計)。
      - settings.json / .mcp.json は初回のみ配置され、既存は維持される。
.PARAMETER DryRun
    実際の同期を行わず、対象プロジェクト一覧と同期予定のみ表示する (ファイルは変更しない)。
.PARAMETER Project
    指定時はその name のプロジェクトのみ同期する (登録済みであること)。
.PARAMETER RegistryPath
    レジストリファイルパスの上書き (テスト/特殊環境用)。未指定なら既定 (~/.claudeos) を解決。
.EXAMPLE
    pwsh -NoProfile -File .\scripts\main\Sync-AllRegisteredProjects.ps1 -DryRun
.EXAMPLE
    pwsh -NoProfile -File .\scripts\main\Sync-AllRegisteredProjects.ps1
.EXAMPLE
    pwsh -NoProfile -File .\scripts\main\Sync-AllRegisteredProjects.ps1 -Project MyApp
#>
param(
    [switch]$DryRun,
    [string]$Project = '',
    [string]$RegistryPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $ScriptRoot 'scripts\lib\LauncherCommon.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $ScriptRoot 'scripts\lib\ProjectRegistry.psm1') -Force -DisableNameChecking

function Write-Info { param($Message) Write-Host "[INFO]  $Message" -ForegroundColor Cyan }
function Write-Ok   { param($Message) Write-Host "[ OK ]  $Message" -ForegroundColor Green }
function Write-Warn { param($Message) Write-Host "[WARN]  $Message" -ForegroundColor Yellow }
function Write-Err  { param($Message) Write-Host "[ERR ]  $Message" -ForegroundColor Red }

# StartupRoot を確実に解決する (Get-StartupRoot があれば優先)。
if (Get-Command Get-StartupRoot -ErrorAction SilentlyContinue) {
    $ScriptRoot = Get-StartupRoot -PSScriptRootPath $PSScriptRoot
}
Write-Info "StartupRoot: $ScriptRoot"
if ($DryRun) { Write-Warn 'DryRun モード: ファイルは変更しません (対象と同期予定のみ表示)' }

# 登録プロジェクトを読み込む (0 件なら @())。
$projects = @(Read-RegisteredProject -RegistryPath $RegistryPath)
if (-not [string]::IsNullOrWhiteSpace($Project)) {
    $projects = @($projects | Where-Object { [string]$_.name -eq $Project })
}

if ($projects.Count -eq 0) {
    Write-Warn '対象プロジェクトがありません (登録 0 件、またはフィルタ一致なし)。'
    Write-Info 'プロジェクト登録後に再実行してください: scripts\main\Register-ProjectCandidate.ps1'
    exit 0
}

Write-Info "対象プロジェクト数: $($projects.Count)"

$done = 0; $skipped = 0; $failed = 0
foreach ($p in $projects) {
    $name = [string]$p.name
    $dir  = [string]$p.path
    Write-Host ''
    Write-Host "=== $name ===" -ForegroundColor White
    Write-Info "path: $dir"

    if ([string]::IsNullOrWhiteSpace($dir) -or -not (Test-Path $dir)) {
        Write-Warn "プロジェクトディレクトリが存在しません。スキップ: $dir"
        $skipped++
        continue
    }

    if ($DryRun) {
        Write-Info '同期予定 (差分上書き): CLAUDE.md / .claude/START_PROMPT.md / .claude/claudeos / agents / commands / skills / hooks / workflows / statusline.py / scripts/tools'
        Write-Info '同期予定 (初回のみ)    : .claude/settings.json / .mcp.json'
        $done++
        continue
    }

    try {
        Sync-LauncherClaudeGlobalConfig -StartupRoot $ScriptRoot -ProjectDir $dir
        Write-Ok "同期完了: $name"
        $done++
    }
    catch {
        Write-Err "同期失敗: $name — $($_.Exception.Message)"
        $failed++
    }
}

Write-Host ''
Write-Host '===== Summary =====' -ForegroundColor White
$verb = if ($DryRun) { 'preview' } else { 'synced' }
Write-Info "$verb=$done skipped=$skipped failed=$failed (total $($projects.Count))"
if ($failed -gt 0) { exit 1 }
exit 0
