BeforeAll {
    $script:RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    Import-Module (Join-Path $script:RepoRoot 'scripts\lib\ProjectRegistry.psm1') -Force
}

Describe 'ProjectRegistry Windows project discovery' {
    BeforeEach {
        $script:ProjectsRoot = Join-Path $TestDrive 'DDrive'
        $script:RegistryPath = Join-Path $TestDrive 'registered-projects.json'
        New-Item -ItemType Directory -Path $script:ProjectsRoot -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $script:ProjectsRoot 'WithGit') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $script:ProjectsRoot 'WithGit\.git') -Force | Out-Null
        @'
[remote "origin"]
    url = https://github.com/example/with-git.git
'@ | Set-Content -Path (Join-Path $script:ProjectsRoot 'WithGit\.git\config') -Encoding UTF8
        New-Item -ItemType Directory -Path (Join-Path $script:ProjectsRoot 'Plain') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $script:ProjectsRoot 'SkipMe') -Force | Out-Null
    }

    It 'discovers D drive style child folders and applies excludes' {
        $items = Get-WindowsProjectCandidate -ProjectsDir $script:ProjectsRoot -ExcludeNames @('SkipMe')
        $items.name | Should -Contain 'WithGit'
        $items.name | Should -Contain 'Plain'
        $items.name | Should -Not -Contain 'SkipMe'
    }

    It 'applies default Windows system folder excludes' {
        New-Item -ItemType Directory -Path (Join-Path $script:ProjectsRoot 'System Volume Information') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $script:ProjectsRoot '$RECYCLE.BIN') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $script:ProjectsRoot 'node_modules') -Force | Out-Null

        $items = Get-WindowsProjectCandidate -ProjectsDir $script:ProjectsRoot

        $items.name | Should -Not -Contain 'System Volume Information'
        $items.name | Should -Not -Contain '$RECYCLE.BIN'
        $items.name | Should -Not -Contain 'node_modules'
    }

    It 'can filter to Git repositories only' {
        $items = Get-WindowsProjectCandidate -ProjectsDir $script:ProjectsRoot -GitOnly
        $items.name | Should -Contain 'WithGit'
        $items.name | Should -Not -Contain 'Plain'
    }

    It 'extracts GitHub remote URLs from .git/config' {
        $url = Get-ProjectGithubUrl -ProjectPath (Join-Path $script:ProjectsRoot 'WithGit')
        $url | Should -Be 'https://github.com/example/with-git'
    }

    It 'normalizes GitHub SSH remote URLs' {
        $sshProject = Join-Path $script:ProjectsRoot 'WithSshGit'
        New-Item -ItemType Directory -Path (Join-Path $sshProject '.git') -Force | Out-Null
        @'
[remote "origin"]
    url = git@github.com:example/with-ssh.git
'@ | Set-Content -Path (Join-Path $sshProject '.git\config') -Encoding UTF8

        $url = Get-ProjectGithubUrl -ProjectPath $sshProject

        $url | Should -Be 'https://github.com/example/with-ssh'
    }

    It 'registers projects with supervisor enabled by default' {
        $entry = Register-WindowsProject -Name 'WithGit' -Path (Join-Path $script:ProjectsRoot 'WithGit') -RegistryPath $script:RegistryPath
        $entry.supervisorEnabled | Should -BeTrue
        $entries = Read-RegisteredProject -RegistryPath $script:RegistryPath
        $entries.Count | Should -Be 1
        $entries[0].githubUrl | Should -Be 'https://github.com/example/with-git'
    }

    It 'syncs all discovered projects into the registry' {
        $entries = Sync-WindowsProjectRegistry -ProjectsDir $script:ProjectsRoot -ExcludeNames @('SkipMe') -RegistryPath $script:RegistryPath
        $entries.name | Should -Contain 'WithGit'
        $entries.name | Should -Contain 'Plain'
        $entries.name | Should -Not -Contain 'SkipMe'
    }

    It 'validates registry schema and reports duplicate project names' {
        $schema = Test-RegisteredProjectRegistry -Projects @(
            [pscustomobject]@{ name = 'Dup'; path = 'D:\Dup'; durationMinutes = 300 },
            [pscustomobject]@{ name = 'Dup'; path = 'D:\Dup2'; durationMinutes = 300 }
        )

        $schema.IsValid | Should -BeFalse
        ($schema.Errors -join ';') | Should -Match 'duplicate project name'
    }

    It 'creates a pre-write backup before overwriting an existing registry' {
        Register-WindowsProject -Name 'WithGit' -Path (Join-Path $script:ProjectsRoot 'WithGit') -RegistryPath $script:RegistryPath | Out-Null
        Register-WindowsProject -Name 'Plain' -Path (Join-Path $script:ProjectsRoot 'Plain') -RegistryPath $script:RegistryPath | Out-Null

        $backups = @(Get-ProjectRegistryBackup -RegistryPath $script:RegistryPath)

        $backups.Count | Should -BeGreaterOrEqual 1
        $backups[0].Name | Should -Match 'registered-projects_'
    }

    It 'backs up invalid JSON and throws a recovery-oriented error' {
        '{ invalid json' | Set-Content -Path $script:RegistryPath -Encoding UTF8

        { Read-RegisteredProject -RegistryPath $script:RegistryPath } | Should -Throw '*backup:*'
        @(Get-ProjectRegistryBackup -RegistryPath $script:RegistryPath).Count | Should -BeGreaterOrEqual 1
    }

    It 'restores the latest valid backup' {
        $valid = @(
            [pscustomobject]@{
                name = 'WithGit'
                path = (Join-Path $script:ProjectsRoot 'WithGit')
                hasGit = $true
                githubUrl = 'https://github.com/example/with-git'
                supervisorEnabled = $true
                durationMinutes = 300
                registeredAt = (Get-Date).ToString('o')
                updatedAt = (Get-Date).ToString('o')
            }
        )
        Write-RegisteredProject -Projects $valid -RegistryPath $script:RegistryPath | Out-Null
        $backup = Backup-ProjectRegistry -RegistryPath $script:RegistryPath -Reason 'manual-test'
        '[]' | Set-Content -Path $script:RegistryPath -Encoding UTF8

        Restore-ProjectRegistryBackup -RegistryPath $script:RegistryPath -BackupPath $backup | Should -Be $script:RegistryPath
        $entries = @(Read-RegisteredProject -RegistryPath $script:RegistryPath)
        $entries.Count | Should -Be 1
        $entries[0].name | Should -Be 'WithGit'
    }
}
