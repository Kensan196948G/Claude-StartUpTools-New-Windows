# Windows Operations

## Project Registry

The Windows registry file is:

```text
%USERPROFILE%\.claudeos\registered-projects.json
```

Each entry has:

```json
{
  "name": "MyProject",
  "path": "D:\\MyProject",
  "hasGit": true,
  "githubUrl": "https://github.com/example/my-project",
  "supervisorEnabled": true,
  "durationMinutes": 300,
  "registeredAt": "2026-06-07T00:00:00.0000000+09:00",
  "updatedAt": "2026-06-07T00:00:00.0000000+09:00"
}
```

Schema rules:

| Field | Rule |
|---|---|
| `name` | Required and unique, case-insensitive |
| `path` | Required Windows path |
| `githubUrl` | Optional, normalized to `https://github.com/owner/repo` |
| `durationMinutes` | Optional, 1 to 1440 |
| `supervisorEnabled` | Optional, defaults to true at registration |

Before overwriting an existing registry, the tool writes a backup under:

```text
%USERPROFILE%\.claudeos\backups\
```

If JSON parsing or schema validation fails, the invalid file is copied to the
same backup folder and the command raises an error that includes the backup path.
Restore the latest valid backup from PowerShell:

```powershell
Import-Module .\scripts\lib\ProjectRegistry.psm1 -Force
Restore-ProjectRegistryBackup
```

## Candidate Scan

```powershell
pwsh -File .\scripts\main\Register-ProjectCandidate.ps1 -Scan
pwsh -File .\scripts\main\Register-ProjectCandidate.ps1 -RegisterAll
pwsh -File .\scripts\main\Register-ProjectCandidate.ps1 -Project MyProject
pwsh -File .\scripts\main\Register-ProjectCandidate.ps1 -Project MyProject -Unregister
```

`localExcludes` in `config/config.json` prevents folders such as this tool
repository, recycle-bin folders, Windows system folders, package folders, or
archives from appearing as candidates. The module also carries a conservative
default exclude list for common D-drive system folders.

## Supervisor

`config/processes.json` includes `registered-project-autonomy`. It reads the
registry, checks session files, and starts `Start-ClaudeAutoTimeout.ps1` for
eligible projects.

Safety controls:

| Setting | Default | Purpose |
|---|---:|---|
| `maxConcurrent` | 1 | Avoid launching too many Claude sessions |
| `restartCooldownMinutes` | 10 | Avoid rapid restart loops |
| `maxRestartsPerProject` | 6 | Block repeated failing projects |
| `durationMinutes` | 300 | Per-project session cap |

`registered-project-autonomy` exposes per-project status in
`%USERPROFILE%\.claudeos\supervisor\state.json`:

| Status | Meaning |
|---|---|
| `running` | A session file or launcher process is active |
| `starting` | The launcher was just started |
| `waiting` | Another project is running and `maxConcurrent` is reached |
| `cooldown` | Restart cooldown is active; see `nextRetryAt` |
| `goal-reached` | `deploy.ready`, `stable.stable_achieved`, maintenance, or released state was detected |
| `blocked` | Launcher/project path is missing or restart limit was reached |

Each project entry includes `restartCount`, `failureCount`, `lastExitCode`,
`lastExitSignal`, `lastExitAt`, `reason`, and `nextRetryAt` where applicable.

## Mission Control

Start the dashboard and open Mission Control:

```powershell
npm run start:dashboard
```

```text
http://127.0.0.1:3737/mission-control
```

Windows release checks:

| Area | Visible check |
|---|---|
| Projects | D-drive candidates, registered projects, Supervisor targets, GitHub-linked projects, and AutoRun count |
| Supervisor | Daemon running/stopped banner plus registered-project autonomy table when state is available |
| Jobs | Windows diagnostics and confirmed Task Scheduler/registry management jobs |
| Health | Task Scheduler, auth, source-of-truth drift, server uptime, and release-readiness signals |

`/api/autorun` is the Windows-facing schedule endpoint. `/api/cron` remains as a
compatibility alias for older tests and local data files.

## Legacy Linux

The old bash/tmux/Linux cron runtime is stored under `legacy-linux/`. It is not
part of the Windows execution path.
