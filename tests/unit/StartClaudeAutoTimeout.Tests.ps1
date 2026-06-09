# ============================================================
# StartClaudeAutoTimeout.Tests.ps1 - Start-ClaudeAutoTimeout.ps1 unit tests
# Pester 5.x / Phase 1 (Windows ローカル一本化)
#
# exit を呼ぶ起動スクリプトのため、子プロセス (pwsh -File) で実行し
# 終了コードと session.json の副作用を検証する。
# -ProjectsDir / -SessionsDir 上書きで FS を TestDrive に隔離する。
# ============================================================

BeforeAll {
    $script:RepoRoot   = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    $script:ScriptPath = Join-Path $script:RepoRoot 'scripts\main\Start-ClaudeAutoTimeout.ps1'
    $script:PsExe = if (Get-Command pwsh -ErrorAction SilentlyContinue) {
        (Get-Command pwsh).Source
    } else {
        (Get-Command powershell).Source
    }

    # 子プロセスでスクリプトを実行し終了コードを返すヘルパ。
    function Invoke-AutoTimeout {
        param([string[]]$ScriptArgs)
        & $script:PsExe -NoProfile -ExecutionPolicy Bypass -File $script:ScriptPath @ScriptArgs *> $null
        return $LASTEXITCODE
    }
}

Describe 'Start-ClaudeAutoTimeout -DryRun' {

    It 'generates a session.json with completed status (DryRun)' {
        $proj = Join-Path $TestDrive 'projects'
        New-Item -ItemType Directory -Path (Join-Path $proj 'demo') -Force | Out-Null
        $sess = Join-Path $TestDrive 'sessions'

        $code = Invoke-AutoTimeout @('-Project', 'demo', '-DurationMinutes', '2', '-DryRun',
            '-ProjectsDir', $proj, '-SessionsDir', $sess)

        $code | Should -Be 0
        $file = Get-ChildItem -Path $sess -Filter '*.json' -ErrorAction SilentlyContinue | Select-Object -First 1
        $file | Should -Not -BeNullOrEmpty
        $json = Get-Content $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
        $json.status               | Should -Be 'completed'
        $json.project              | Should -Be 'demo'
        $json.max_duration_minutes | Should -Be 2
        $json.trigger              | Should -Be 'cron'
    }

    It 'exits 3 when project dir does not exist' {
        $proj = Join-Path $TestDrive 'projects-empty'
        New-Item -ItemType Directory -Path $proj -Force | Out-Null
        $sess = Join-Path $TestDrive 'sessions-x'

        $code = Invoke-AutoTimeout @('-Project', 'ghost', '-DryRun',
            '-ProjectsDir', $proj, '-SessionsDir', $sess)

        $code | Should -Be 3
    }

    It 'caps DurationMinutes to session_max_minutes in maintenance mode' {
        $proj = Join-Path $TestDrive 'projects-maint'
        $pdir = Join-Path $proj 'mapp'
        New-Item -ItemType Directory -Path $pdir -Force | Out-Null
        @{
            project     = @{ phase_mode = 'maintenance' }
            maintenance = @{ session_max_minutes = 120 }
        } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $pdir 'state.json') -Encoding UTF8
        $sess = Join-Path $TestDrive 'sessions-maint'

        $code = Invoke-AutoTimeout @('-Project', 'mapp', '-DurationMinutes', '300', '-DryRun',
            '-ProjectsDir', $proj, '-SessionsDir', $sess)

        $code | Should -Be 0
        $file = Get-ChildItem -Path $sess -Filter '*.json' | Select-Object -First 1
        $json = Get-Content $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
        $json.max_duration_minutes | Should -Be 120
    }

    It 'does not mutate state.json (Phase 1: read-only resume)' {
        $proj = Join-Path $TestDrive 'projects-resume'
        $pdir = Join-Path $proj 'rapp'
        New-Item -ItemType Directory -Path $pdir -Force | Out-Null
        @{
            execution = @{ phase = 'Verify' }
            stable    = @{ consecutive_success = 2 }
        } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $pdir 'state.json') -Encoding UTF8
        $sess = Join-Path $TestDrive 'sessions-resume'

        $code = Invoke-AutoTimeout @('-Project', 'rapp', '-DryRun',
            '-ProjectsDir', $proj, '-SessionsDir', $sess)

        $code | Should -Be 0
        $stateAfter = Get-Content (Join-Path $pdir 'state.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        $stateAfter.execution.phase            | Should -Be 'Verify'
        $stateAfter.stable.consecutive_success | Should -Be 2
    }
}

Describe 'Goal Rotation (v10.6) - DryRun でのフェーズ選択' {

    BeforeAll {
        # 出力もキャプチャするヘルパ (goal_source= 等の DryRun 出力を検証する)。
        function Invoke-AutoTimeoutCapture {
            param([string[]]$ScriptArgs)
            $output = & $script:PsExe -NoProfile -ExecutionPolicy Bypass -File $script:ScriptPath @ScriptArgs 2>&1 | Out-String
            return @{ ExitCode = $LASTEXITCODE; Output = $output }
        }
    }

    It 'state.json あり (goal_rotation 未定義) → 既定 phase モードで monitor を選択する' {
        $proj = Join-Path $TestDrive 'projects-rot-default'
        $pdir = Join-Path $proj 'rotapp'
        New-Item -ItemType Directory -Path $pdir -Force | Out-Null
        @{ execution = @{ phase = 'Monitor' } } | ConvertTo-Json -Depth 5 |
            Set-Content -Path (Join-Path $pdir 'state.json') -Encoding UTF8
        $sess = Join-Path $TestDrive 'sessions-rot-default'

        $r = Invoke-AutoTimeoutCapture @('-Project', 'rotapp', '-DryRun',
            '-ProjectsDir', $proj, '-SessionsDir', $sess)

        $r.ExitCode | Should -Be 0
        $r.Output   | Should -Match 'goal_source=phase:monitor'
        # DryRun は state.json を変更しない (catchup スキップ契約)
        $stateAfter = Get-Content (Join-Path $pdir 'state.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        $stateAfter.PSObject.Properties['goal_rotation'] | Should -BeNullOrEmpty
    }

    It 'goal_rotation.current=verify → 30-verify.md を選択する' {
        $proj = Join-Path $TestDrive 'projects-rot-verify'
        $pdir = Join-Path $proj 'vapp'
        New-Item -ItemType Directory -Path $pdir -Force | Out-Null
        @{ goal_rotation = @{ mode = 'phase'; current = 'verify'; cycle_count = 2 } } |
            ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $pdir 'state.json') -Encoding UTF8
        $sess = Join-Path $TestDrive 'sessions-rot-verify'

        $r = Invoke-AutoTimeoutCapture @('-Project', 'vapp', '-DryRun',
            '-ProjectsDir', $proj, '-SessionsDir', $sess)

        $r.ExitCode | Should -Be 0
        $r.Output   | Should -Match 'goal_source=phase:verify'
        $r.Output   | Should -Match 'cycle=2'
    }

    It 'goal_rotation.mode=mission → 従来の START_PROMPT 経路を使う' {
        $proj = Join-Path $TestDrive 'projects-rot-mission'
        $pdir = Join-Path $proj 'mapp2'
        New-Item -ItemType Directory -Path $pdir -Force | Out-Null
        @{ goal_rotation = @{ mode = 'mission' } } | ConvertTo-Json -Depth 5 |
            Set-Content -Path (Join-Path $pdir 'state.json') -Encoding UTF8
        $sess = Join-Path $TestDrive 'sessions-rot-mission'

        $r = Invoke-AutoTimeoutCapture @('-Project', 'mapp2', '-DryRun',
            '-ProjectsDir', $proj, '-SessionsDir', $sess)

        $r.ExitCode | Should -Be 0
        $r.Output   | Should -Match 'goal_source=mission'
    }

    It 'maintenance モード → phase を mission に縮退する' {
        $proj = Join-Path $TestDrive 'projects-rot-maint'
        $pdir = Join-Path $proj 'mtapp'
        New-Item -ItemType Directory -Path $pdir -Force | Out-Null
        @{
            project       = @{ phase_mode = 'maintenance' }
            maintenance   = @{ session_max_minutes = 120 }
            goal_rotation = @{ mode = 'phase'; current = 'development' }
        } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $pdir 'state.json') -Encoding UTF8
        $sess = Join-Path $TestDrive 'sessions-rot-maint'

        $r = Invoke-AutoTimeoutCapture @('-Project', 'mtapp', '-DryRun',
            '-ProjectsDir', $proj, '-SessionsDir', $sess)

        $r.ExitCode | Should -Be 0
        $r.Output   | Should -Match 'goal_source=mission'
        $r.Output   | Should -Match 'rotation_mode=mission'
    }

    It 'state.json 無し → mission のまま (フレッシュプロジェクト安全側)' {
        $proj = Join-Path $TestDrive 'projects-rot-fresh'
        New-Item -ItemType Directory -Path (Join-Path $proj 'fresh') -Force | Out-Null
        $sess = Join-Path $TestDrive 'sessions-rot-fresh'

        $r = Invoke-AutoTimeoutCapture @('-Project', 'fresh', '-DryRun',
            '-ProjectsDir', $proj, '-SessionsDir', $sess)

        $r.ExitCode | Should -Be 0
        $r.Output   | Should -Match 'goal_source=mission'
    }

    It 'goal/ テンプレがプロジェクト .claude\goal へ自己同期される' {
        $proj = Join-Path $TestDrive 'projects-rot-sync'
        $pdir = Join-Path $proj 'syncapp'
        New-Item -ItemType Directory -Path $pdir -Force | Out-Null
        $sess = Join-Path $TestDrive 'sessions-rot-sync'

        $null = Invoke-AutoTimeoutCapture @('-Project', 'syncapp', '-DryRun',
            '-ProjectsDir', $proj, '-SessionsDir', $sess)

        foreach ($f in @('10-monitor.md', '20-development.md', '30-verify.md', '40-improvement.md')) {
            Test-Path (Join-Path $pdir ".claude\goal\$f") | Should -BeTrue
        }
        Test-Path (Join-Path $pdir '.claude\claudeos\scripts\hooks\goal-rotation.js') | Should -BeTrue
    }
}

Describe 'SessionTabManager timeout status (Phase 1 拡張)' {

    BeforeAll {
        Import-Module (Join-Path $script:RepoRoot 'scripts\lib\SessionTabManager.psm1') -Force
    }

    It 'Set-SessionStatus accepts and persists timeout' {
        $sess = Join-Path $TestDrive 'sessions-timeout'
        $s = New-SessionInfo -Project 'totest' -ConfigSessionsDir $sess
        { Set-SessionStatus -SessionId $s.sessionId -Status 'timeout' -ConfigSessionsDir $sess } |
            Should -Not -Throw
        $loaded = Get-SessionInfo -SessionId $s.sessionId -ConfigSessionsDir $sess
        $loaded.status | Should -Be 'timeout'
    }
}
