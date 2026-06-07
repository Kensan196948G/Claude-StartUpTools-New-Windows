# Release Candidate Checklist

Target: `v1.0.0-rc.1`

Human final decision remains required for final release, production rollout,
security exceptions, GitHub Projects final Done status, and release tagging.

## Evidence Gate

| Gate | Required result | Current local evidence |
|---|---|---|
| Pester | Pass | `395 passed / 0 failed` on 2026-06-07 |
| Node smoke | Pass | `PASS: supervisor-daemon smoke test` |
| PSScriptAnalyzer | Error count 0 | `npm run lint:pester` passed |
| Mission Control | Browser console error 0 | Verified at `http://127.0.0.1:3737/mission-control` |
| Project Registry | D-drive candidates visible | `/api/data.registrySummary` returned candidates and GitHub links |
| Supervisor | Registered-project autonomy visible | Supervisor tab verified with Windows Task Scheduler hint |
| CI | GitHub Actions green | Pending next push |

## Windows Setup Check

1. Clone the repository.
2. Copy `config/config.json.template` to `config/config.json`.
3. Confirm `projectsDir` is `D:\` or change it to the local project root.
4. Run `npm test`.
5. Run `npm run lint:pester`.
6. Run `pwsh -File .\scripts\main\Register-ProjectCandidate.ps1 -Scan`.
7. Start Mission Control with `npm run start:dashboard`.
8. Open `http://127.0.0.1:3737/mission-control`.
9. Optionally register Supervisor with
   `pwsh -File .\scripts\main\Register-SupervisorTask.ps1 -RunNow`.

## Release Blockers

| Blocker | Required resolution |
|---|---|
| CI not green | Wait for GitHub Actions after push |
| Console errors | Fix Mission Control before RC tag |
| Registry corruption | Restore from `%USERPROFILE%\.claudeos\backups\` and retest |
| Missing `claude` CLI | Document install prerequisite; do not fake runtime success |
| Human decision pending | Do not tag `v1.0.0` |

## RC Decision

`v1.0.0-rc.1` may be proposed when all local gates and GitHub Actions are green.
`v1.0.0` requires explicit human approval after RC evidence review.
