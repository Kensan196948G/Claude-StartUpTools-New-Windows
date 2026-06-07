#Requires -Version 5.1
param(
    [switch]$Scan,
    [switch]$RegisterAll,
    [string]$Project = '',
    [switch]$Unregister,
    [switch]$List,
    [switch]$GitOnly,
    [switch]$NoSupervisor,
    [int]$DurationMinutes = 300,
    [switch]$NonInteractive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $ScriptRoot 'scripts\lib\Config.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $ScriptRoot 'scripts\lib\LauncherCommon.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $ScriptRoot 'scripts\lib\ProjectRegistry.psm1') -Force -DisableNameChecking

$ConfigPath = Get-StartupConfigPath -StartupRoot $ScriptRoot
$Config = Import-StartupConfig -ConfigPath $ConfigPath
$RegistryPath = Get-ProjectRegistryPath -Config $Config
$ProjectsDir = if ($Config.projectsDir) { [string]$Config.projectsDir } else { 'D:\' }
$ExcludeNames = if ($Config.localExcludes) { @($Config.localExcludes) } else { @() }
$UseGitOnly = $GitOnly
if (-not $UseGitOnly -and ($Config.PSObject.Properties.Name -contains 'projectRegistry') -and $Config.projectRegistry) {
    $prop = $Config.projectRegistry.PSObject.Properties['includeGitOnly']
    if ($prop -and $prop.Value -eq $true) { $UseGitOnly = $true }
}
$SupervisorEnabled = -not $NoSupervisor
if ($SupervisorEnabled -and ($Config.PSObject.Properties.Name -contains 'projectRegistry') -and $Config.projectRegistry) {
    $prop = $Config.projectRegistry.PSObject.Properties['autoApplySupervisor']
    if ($prop -and $prop.Value -eq $false) { $SupervisorEnabled = $false }
}

function Write-ProjectTable {
    param([object[]]$Items)
    if (-not $Items -or @($Items).Count -eq 0) {
        Write-Host '  (none)' -ForegroundColor DarkGray
        return
    }
    $Items | Select-Object name,path,hasGit,githubUrl,supervisorEnabled,durationMinutes |
        Format-Table -AutoSize | Out-String | Write-Host
}

if ($Scan) {
    Write-Host ''
    Write-Host "D drive candidates: $ProjectsDir" -ForegroundColor Cyan
    $items = @(Get-WindowsProjectCandidate -ProjectsDir $ProjectsDir -ExcludeNames $ExcludeNames -GitOnly:$UseGitOnly)
    Write-ProjectTable -Items $items
    return
}

if ($RegisterAll) {
    $items = @(Sync-WindowsProjectRegistry -ProjectsDir $ProjectsDir -ExcludeNames $ExcludeNames -GitOnly:$UseGitOnly -RegistryPath $RegistryPath -SupervisorEnabled:$SupervisorEnabled -DurationMinutes $DurationMinutes)
    Write-Host "[OK] registered projects synced: $RegistryPath" -ForegroundColor Green
    Write-ProjectTable -Items $items
    return
}

if ($List -or ([string]::IsNullOrWhiteSpace($Project) -and -not $Unregister)) {
    Write-Host ''
    Write-Host "Registered projects: $RegistryPath" -ForegroundColor Cyan
    Write-ProjectTable -Items @(Read-RegisteredProject -RegistryPath $RegistryPath)
    return
}

if ($Unregister) {
    if ([string]::IsNullOrWhiteSpace($Project)) { throw '-Project is required with -Unregister' }
    $remaining = @(Unregister-WindowsProject -Name $Project -RegistryPath $RegistryPath)
    Write-Host "[OK] unregistered: $Project" -ForegroundColor Green
    Write-ProjectTable -Items $remaining
    return
}

$path = Join-Path $ProjectsDir $Project
if (-not (Test-Path $path)) { throw "Project directory not found: $path" }
$entry = Register-WindowsProject -Name $Project -Path $path -RegistryPath $RegistryPath -SupervisorEnabled:$SupervisorEnabled -DurationMinutes $DurationMinutes
Write-Host "[OK] registered: $($entry.name)" -ForegroundColor Green
Write-ProjectTable -Items @($entry)
