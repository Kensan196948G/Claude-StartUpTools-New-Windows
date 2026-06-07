# RC Real Machine Verification

Target: `v1.0.0-rc.1`

Use this procedure on a clean Windows machine, a disposable Windows VM, or a
fresh clone directory on the current machine. Do not create the final `v1.0.0`
tag during this verification.

## Prerequisites

| Tool | Check |
|---|---|
| PowerShell 7 | `pwsh --version` |
| Node.js 18+ | `node --version` |
| npm | `npm --version` |
| git | `git --version` |
| GitHub CLI | `gh --version` and `gh auth status` |
| Claude CLI | `claude --version` when available |

## Clean Setup

```powershell
git clone https://github.com/Kensan196948G/Claude-StartUpTools-New-Windows.git
Set-Location .\Claude-StartUpTools-New-Windows
Copy-Item .\config\config.json.template .\config\config.json
```

Confirm `projectsDir`:

```powershell
Get-Content .\config\config.json -Raw | ConvertFrom-Json | Select-Object projectsDir
```

Expected default: `D:\`.

## Gate 1: Local Verification

```powershell
npm test
npm run lint:pester
node scripts\validate-state-example.js
node scripts\check-doc-versions.js
```

Required result:

| Gate | Required result |
|---|---|
| Pester | 0 failed |
| Node smoke | PASS |
| PSScriptAnalyzer | No error-level issue |
| State example | PASS |
| Doc versions | PASS |

## Gate 2: D-drive Candidate Scan

```powershell
pwsh -File .\scripts\main\Register-ProjectCandidate.ps1 -Scan
```

Required result:

| Check | Required result |
|---|---|
| System folders | Excluded |
| Development folders | Listed as candidates |
| GitHub remotes | Normalized when present |
| No registration side effect | Scan-only mode does not modify registry |

## Gate 3: Registry Registration

Use real projects only when it is safe to register them:

```powershell
pwsh -File .\scripts\main\Register-ProjectCandidate.ps1 -Project MyProject
pwsh -File .\scripts\main\Register-ProjectCandidate.ps1 -Scan
```

Then verify:

```powershell
Get-Content "$env:USERPROFILE\.claudeos\registered-projects.json" -Raw | ConvertFrom-Json
```

Backup and restore smoke:

```powershell
Import-Module .\scripts\lib\ProjectRegistry.psm1 -Force
Backup-ProjectRegistry
Get-ProjectRegistryBackup
```

## Gate 4: Supervisor

Start Supervisor:

```powershell
pwsh -File .\scripts\main\Register-SupervisorTask.ps1 -RunNow
pwsh -File .\scripts\main\Register-SupervisorTask.ps1 -Status
```

Inspect state:

```powershell
Get-Content "$env:USERPROFILE\.claudeos\supervisor\state.json" -Raw | ConvertFrom-Json
```

Required result:

| Check | Required result |
|---|---|
| `registered-project-autonomy` | Present when enabled |
| `maxConcurrent` | Exposed |
| `restartCooldownMinutes` | Exposed |
| Project status | One of running, starting, waiting, cooldown, goal-reached, blocked |
| Stop reasons | Stable/deploy/maintenance/released states stop safely |

## Gate 5: Task Scheduler

Dashboard:

```powershell
pwsh -File .\scripts\main\Register-DashboardTask.ps1 -RunNow
pwsh -File .\scripts\main\Register-DashboardTask.ps1 -Status
```

Supervisor:

```powershell
pwsh -File .\scripts\main\Register-SupervisorTask.ps1 -RunNow
pwsh -File .\scripts\main\Register-SupervisorTask.ps1 -Status
```

AutoRun for a safe test project:

```powershell
pwsh -File .\scripts\main\Register-AutoRunTask.ps1 -Project MyProject -Status
```

Unregister only when the reviewer intentionally wants cleanup:

```powershell
pwsh -File .\scripts\main\Register-DashboardTask.ps1 -Unregister
pwsh -File .\scripts\main\Register-SupervisorTask.ps1 -Unregister
```

## Gate 6: Mission Control

```powershell
npm run start:dashboard
```

Open:

```text
http://127.0.0.1:3737/mission-control
```

Required browser checks:

| Panel | Required result |
|---|---|
| Projects | D-drive candidates, registered projects, Supervisor targets, GitHub links visible |
| Supervisor | Daemon banner and registered-project autonomy table when state is available |
| Jobs | Windows jobs visible; state-changing actions require confirmation |
| Health | Task Scheduler and release-readiness checks visible |
| Console | 0 errors |

## Result

Record each gate result in `docs/release-candidate-checklist.md` or the human
review notes. Proceed to final release only when the human reviewer approves.
