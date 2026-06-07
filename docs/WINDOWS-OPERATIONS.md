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

## Candidate Scan

```powershell
pwsh -File .\scripts\main\Register-ProjectCandidate.ps1 -Scan
pwsh -File .\scripts\main\Register-ProjectCandidate.ps1 -RegisterAll
pwsh -File .\scripts\main\Register-ProjectCandidate.ps1 -Project MyProject
pwsh -File .\scripts\main\Register-ProjectCandidate.ps1 -Project MyProject -Unregister
```

`localExcludes` in `config/config.json` prevents folders such as this tool
repository, recycle-bin folders, or archives from appearing as candidates.

## Supervisor

`config/processes.json` includes `registered-project-autonomy`. It reads the
registry, checks session files, and starts `Start-ClaudeAutoTimeout.ps1` for
eligible projects.

Safety controls:

| Setting | Default | Purpose |
|---|---:|---|
| `maxConcurrent` | 1 | Avoid launching too many Claude sessions |
| `restartCooldownMinutes` | 10 | Avoid rapid restart loops |
| `durationMinutes` | 300 | Per-project session cap |

## Legacy Linux

The old bash/tmux/Linux cron runtime is stored under `legacy-linux/`. It is not
part of the Windows execution path.
