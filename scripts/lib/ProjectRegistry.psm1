Set-StrictMode -Version Latest

function Expand-ProjectRegistryPath {
    param([string]$Path = '')

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return (Join-Path $env:USERPROFILE '.claudeos\registered-projects.json')
    }
    return [Environment]::ExpandEnvironmentVariables($Path)
}

function Get-ProjectRegistryPath {
    param([object]$Config)

    $path = ''
    if ($Config -and ($Config.PSObject.Properties.Name -contains 'projectRegistry') -and $Config.projectRegistry) {
        $prop = $Config.projectRegistry.PSObject.Properties['registryFile']
        if ($prop -and -not [string]::IsNullOrWhiteSpace([string]$prop.Value)) {
            $path = [string]$prop.Value
        }
    }
    return (Expand-ProjectRegistryPath -Path $path)
}

function Read-RegisteredProject {
    param([string]$RegistryPath = '')

    $path = Expand-ProjectRegistryPath -Path $RegistryPath
    if (-not (Test-Path $path)) { return @() }
    try {
        $raw = Get-Content -Path $path -Raw -Encoding UTF8
        if ([string]::IsNullOrWhiteSpace($raw)) { return @() }
        $data = $raw | ConvertFrom-Json
        return @($data)
    }
    catch {
        throw "registered project registry is invalid: $path ($($_.Exception.Message))"
    }
}

function Write-RegisteredProject {
    param(
        [Parameter(Mandatory)][object[]]$Projects,
        [string]$RegistryPath = ''
    )

    $path = Expand-ProjectRegistryPath -Path $RegistryPath
    $dir = Split-Path -Parent $path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $tmp = "$path.tmp"
    @($Projects) | ConvertTo-Json -Depth 8 | Set-Content -Path $tmp -Encoding UTF8
    Move-Item -Path $tmp -Destination $path -Force
    return $path
}

function Get-ProjectGithubUrl {
    param([Parameter(Mandatory)][string]$ProjectPath)

    $gitConfig = Join-Path $ProjectPath '.git\config'
    if (-not (Test-Path $gitConfig)) { return '' }
    try {
        $content = Get-Content -Path $gitConfig -Raw -Encoding UTF8
        $match = [regex]::Match($content, 'url\s*=\s*(https://github\.com/[^\s]+|git@github\.com:[^\s]+)', 'IgnoreCase')
        if (-not $match.Success) { return '' }
        $url = $match.Groups[1].Value.Trim()
        if ($url -like 'git@github.com:*') {
            $url = $url -replace '^git@github\.com:', 'https://github.com/'
        }
        return ($url -replace '\.git$', '')
    }
    catch {
        return ''
    }
}

function Get-WindowsProjectCandidate {
    param(
        [string]$ProjectsDir = 'D:\',
        [string[]]$ExcludeNames = @(),
        [switch]$GitOnly
    )

    $root = [Environment]::ExpandEnvironmentVariables($ProjectsDir)
    if (-not (Test-Path $root)) { return @() }

    $dirs = Get-ChildItem -Path $root -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notin $ExcludeNames } |
        Sort-Object Name

    $items = foreach ($dir in $dirs) {
        $hasGit = Test-Path (Join-Path $dir.FullName '.git')
        if ($GitOnly -and -not $hasGit) { continue }
        [pscustomobject]@{
            name = $dir.Name
            path = $dir.FullName
            hasGit = $hasGit
            githubUrl = Get-ProjectGithubUrl -ProjectPath $dir.FullName
            discoveredAt = (Get-Date).ToString('o')
        }
    }
    return @($items)
}

function Register-WindowsProject {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Path,
        [string]$RegistryPath = '',
        [bool]$SupervisorEnabled = $true,
        [int]$DurationMinutes = 300
    )

    $entries = @(Read-RegisteredProject -RegistryPath $RegistryPath)
    $githubUrl = Get-ProjectGithubUrl -ProjectPath $Path
    $now = (Get-Date).ToString('o')
    $next = [pscustomobject]@{
        name = $Name
        path = $Path
        hasGit = (Test-Path (Join-Path $Path '.git'))
        githubUrl = $githubUrl
        supervisorEnabled = $SupervisorEnabled
        durationMinutes = $DurationMinutes
        registeredAt = $now
        updatedAt = $now
    }

    $filtered = @($entries | Where-Object { $_.name -ne $Name })
    $all = @($filtered + $next) | Sort-Object name
    Write-RegisteredProject -Projects $all -RegistryPath $RegistryPath | Out-Null
    return $next
}

function Unregister-WindowsProject {
    param(
        [Parameter(Mandatory)][string]$Name,
        [string]$RegistryPath = ''
    )

    $entries = @(Read-RegisteredProject -RegistryPath $RegistryPath)
    $remaining = @($entries | Where-Object { $_.name -ne $Name })
    Write-RegisteredProject -Projects $remaining -RegistryPath $RegistryPath | Out-Null
    return $remaining
}

function Sync-WindowsProjectRegistry {
    param(
        [string]$ProjectsDir = 'D:\',
        [string[]]$ExcludeNames = @(),
        [switch]$GitOnly,
        [string]$RegistryPath = '',
        [bool]$SupervisorEnabled = $true,
        [int]$DurationMinutes = 300
    )

    $candidates = @(Get-WindowsProjectCandidate -ProjectsDir $ProjectsDir -ExcludeNames $ExcludeNames -GitOnly:$GitOnly)
    foreach ($candidate in $candidates) {
        Register-WindowsProject -Name $candidate.name -Path $candidate.path -RegistryPath $RegistryPath -SupervisorEnabled:$SupervisorEnabled -DurationMinutes $DurationMinutes | Out-Null
    }
    return @(Read-RegisteredProject -RegistryPath $RegistryPath)
}

Export-ModuleMember -Function Expand-ProjectRegistryPath, Get-ProjectRegistryPath, `
    Read-RegisteredProject, Write-RegisteredProject, Get-ProjectGithubUrl, `
    Get-WindowsProjectCandidate, Register-WindowsProject, Unregister-WindowsProject, `
    Sync-WindowsProjectRegistry
