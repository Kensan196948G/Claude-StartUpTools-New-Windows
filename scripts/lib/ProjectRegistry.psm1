Set-StrictMode -Version Latest

$script:DefaultProjectRegistryExcludeNames = @(
    '$RECYCLE.BIN',
    'System Volume Information',
    'Recovery',
    'Config.Msi',
    'MSOCache',
    'PerfLogs',
    'WindowsApps',
    'WUDownloadCache',
    'OneDriveTemp',
    'Temp',
    'tmp',
    'node_modules',
    '.git',
    'Claude-StartUpTools-New-Windows'
)

function Get-ProjectRegistryDefaultExcludeName {
    return @($script:DefaultProjectRegistryExcludeNames)
}

function Resolve-ProjectRegistryExcludeName {
    param([string[]]$ExcludeNames = @())

    return @($script:DefaultProjectRegistryExcludeNames + @($ExcludeNames) |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Sort-Object -Unique)
}

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
    $data = $null
    try {
        $raw = Get-Content -Path $path -Raw -Encoding UTF8
        if ([string]::IsNullOrWhiteSpace($raw)) { return @() }
        $data = $raw | ConvertFrom-Json
    }
    catch {
        $backup = Backup-ProjectRegistry -RegistryPath $path -Reason 'invalid-json'
        throw "registered project registry is invalid: $path; backup: $backup ($($_.Exception.Message))"
    }

    $items = @($data)
    $schema = Test-RegisteredProjectRegistry -Projects $items
    if (-not $schema.IsValid) {
        $backup = Backup-ProjectRegistry -RegistryPath $path -Reason 'invalid-schema'
        throw "registered project registry schema is invalid: $path; backup: $backup; errors: $($schema.Errors -join '; ')"
    }
    return $items
}

function Test-RegisteredProjectRegistry {
    param([object[]]$Projects = @())

    $errors = New-Object System.Collections.Generic.List[string]
    $seen = @{}
    $index = 0
    foreach ($project in @($Projects)) {
        $prefix = "[$index]"
        if (-not $project) {
            $errors.Add("$prefix entry is null")
            $index++
            continue
        }
        foreach ($required in @('name', 'path')) {
            $prop = $project.PSObject.Properties[$required]
            if (-not $prop -or [string]::IsNullOrWhiteSpace([string]$prop.Value)) {
                $errors.Add("$prefix missing required property: $required")
            }
        }
        if ($project.PSObject.Properties['name'] -and -not [string]::IsNullOrWhiteSpace([string]$project.name)) {
            $key = ([string]$project.name).ToLowerInvariant()
            if ($seen.ContainsKey($key)) {
                $errors.Add("$prefix duplicate project name: $($project.name)")
            }
            else {
                $seen[$key] = $true
            }
        }
        if ($project.PSObject.Properties['durationMinutes']) {
            try {
                $duration = [int]$project.durationMinutes
                if ($duration -lt 1 -or $duration -gt 1440) {
                    $errors.Add("$prefix durationMinutes must be between 1 and 1440")
                }
            }
            catch {
                $errors.Add("$prefix durationMinutes is not an integer")
            }
        }
        if ($project.PSObject.Properties['githubUrl'] -and -not [string]::IsNullOrWhiteSpace([string]$project.githubUrl)) {
            if ([string]$project.githubUrl -notmatch '^https://github\.com/[^/]+/[^/]+$') {
                $errors.Add("$prefix githubUrl must be normalized https://github.com/owner/repo")
            }
        }
        $index++
    }

    return [pscustomobject]@{
        IsValid = ($errors.Count -eq 0)
        Errors = @($errors)
    }
}

function Backup-ProjectRegistry {
    param(
        [string]$RegistryPath = '',
        [string]$Reason = 'backup'
    )

    $path = Expand-ProjectRegistryPath -Path $RegistryPath
    if (-not (Test-Path $path)) { return '' }
    $dir = Split-Path -Parent $path
    $backupDir = Join-Path $dir 'backups'
    if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Force -Path $backupDir | Out-Null }
    $safeReason = ($Reason -replace '[^A-Za-z0-9_.-]', '-')
    $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
    $name = [IO.Path]::GetFileNameWithoutExtension($path)
    $backupPath = Join-Path $backupDir ("{0}_{1}_{2}.json" -f $name, $stamp, $safeReason)
    Copy-Item -Path $path -Destination $backupPath -Force
    return $backupPath
}

function Get-ProjectRegistryBackup {
    param([string]$RegistryPath = '')

    $path = Expand-ProjectRegistryPath -Path $RegistryPath
    $dir = Split-Path -Parent $path
    $backupDir = Join-Path $dir 'backups'
    if (-not (Test-Path $backupDir)) { return @() }
    $name = [IO.Path]::GetFileNameWithoutExtension($path)
    return @(Get-ChildItem -Path $backupDir -Filter "$name*.json" -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending)
}

function Restore-ProjectRegistryBackup {
    param(
        [string]$RegistryPath = '',
        [string]$BackupPath = ''
    )

    $path = Expand-ProjectRegistryPath -Path $RegistryPath
    $source = $BackupPath
    if ([string]::IsNullOrWhiteSpace($source)) {
        $source = @(Get-ProjectRegistryBackup -RegistryPath $path | Select-Object -First 1).FullName
    }
    if ([string]::IsNullOrWhiteSpace($source) -or -not (Test-Path $source)) {
        throw "project registry backup not found"
    }
    $data = @(Get-Content -Path $source -Raw -Encoding UTF8 | ConvertFrom-Json)
    $schema = Test-RegisteredProjectRegistry -Projects $data
    if (-not $schema.IsValid) {
        throw "project registry backup schema is invalid: $source; errors: $($schema.Errors -join '; ')"
    }
    $dir = Split-Path -Parent $path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Copy-Item -Path $source -Destination $path -Force
    return $path
}

function Write-RegisteredProject {
    param(
        [Parameter(Mandatory)][object[]]$Projects,
        [string]$RegistryPath = ''
    )

    $path = Expand-ProjectRegistryPath -Path $RegistryPath
    $dir = Split-Path -Parent $path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $schema = Test-RegisteredProjectRegistry -Projects $Projects
    if (-not $schema.IsValid) {
        throw "registered project registry schema is invalid: $($schema.Errors -join '; ')"
    }
    if (Test-Path $path) {
        Backup-ProjectRegistry -RegistryPath $path -Reason 'pre-write' | Out-Null
    }
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

    $effectiveExcludes = Resolve-ProjectRegistryExcludeName -ExcludeNames $ExcludeNames
    $dirs = Get-ChildItem -Path $root -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notin $effectiveExcludes } |
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
    Get-ProjectRegistryDefaultExcludeName, Resolve-ProjectRegistryExcludeName, `
    Read-RegisteredProject, Write-RegisteredProject, Test-RegisteredProjectRegistry, `
    Backup-ProjectRegistry, Get-ProjectRegistryBackup, Restore-ProjectRegistryBackup, `
    Get-ProjectGithubUrl, `
    Get-WindowsProjectCandidate, Register-WindowsProject, Unregister-WindowsProject, `
    Sync-WindowsProjectRegistry
