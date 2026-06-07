BeforeAll {
    $script:RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    $script:DocsRoot = Join-Path $script:RepoRoot 'docs'
}

Describe 'Release candidate documentation' {
    It 'RC checklist exists' {
        Test-Path (Join-Path $script:DocsRoot 'release-candidate-checklist.md') | Should -BeTrue
    }

    It 'RC release notes exist' {
        Test-Path (Join-Path $script:DocsRoot 'v1.0.0-rc.1-release-notes.md') | Should -BeTrue
    }

    It 'real machine verification procedure exists' {
        Test-Path (Join-Path $script:DocsRoot 'rc-real-machine-verification.md') | Should -BeTrue
    }

    It 'human final release gate exists' {
        Test-Path (Join-Path $script:DocsRoot 'human-final-release-gate.md') | Should -BeTrue
    }

    It 'human final release gate reserves tag and GitHub Release for the human reviewer' {
        $text = Get-Content (Join-Path $script:DocsRoot 'human-final-release-gate.md') -Raw -Encoding UTF8
        $text | Should -Match 'human reviewer'
        $text | Should -Match 'git tag v1\.0\.0'
        $text | Should -Match 'gh release create v1\.0\.0'
        $text | Should -Match 'Do not release'
    }

    It 'RC release notes state that final release publication is human-only' {
        $text = Get-Content (Join-Path $script:DocsRoot 'v1.0.0-rc.1-release-notes.md') -Raw -Encoding UTF8
        $text | Should -Match 'human-only final actions'
        $text | Should -Match 'CI run `27080036641`'
    }
}
