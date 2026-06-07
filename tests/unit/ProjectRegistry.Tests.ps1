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

    It 'can filter to Git repositories only' {
        $items = Get-WindowsProjectCandidate -ProjectsDir $script:ProjectsRoot -GitOnly
        $items.name | Should -Contain 'WithGit'
        $items.name | Should -Not -Contain 'Plain'
    }

    It 'extracts GitHub remote URLs from .git/config' {
        $url = Get-ProjectGithubUrl -ProjectPath (Join-Path $script:ProjectsRoot 'WithGit')
        $url | Should -Be 'https://github.com/example/with-git'
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
}
