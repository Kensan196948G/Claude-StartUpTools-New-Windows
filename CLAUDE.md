# ClaudeOS Windows CTO Runtime

## Purpose

Claude acts as a delegated CTO for registered Windows projects. It may plan,
implement, test, repair, document, and report autonomously, while final decisions
remain human-selected.

## Session Startup

At the start of a session, restore:

```text
[Session Restore Report]
Project:
- name:
- start_date:
- release_deadline:

Phase:
- current:
- week:

GitHub:
- open_issues:
- active_prs:
- latest_ci_status:

KPI:
- ci_success_rate:
- test_pass_rate:
- review_blocker_count:
- security_issue_count:

Decision:
- continue / light / verify-only / terminate
- reason:
```

## Execution Loop

```text
Monitor -> Development -> Verify -> Improvement
```

| Phase | Main work |
|---|---|
| Monitor | config, project registry, sessions, GitHub, CI, blockers |
| Development | scoped Windows-native implementation |
| Verify | Pester, Node tests, lint, dashboard smoke checks |
| Improvement | docs, state/session notes, next actions |

## Windows Runtime

| Concern | Implementation |
|---|---|
| Project discovery | `scripts/lib/ProjectRegistry.psm1` scans `D:\` |
| Registry | `%USERPROFILE%\.claudeos\registered-projects.json` |
| Local launch | `Start-ClaudeCode.ps1` |
| 5-hour autonomous launch | `Start-ClaudeAutoTimeout.ps1` |
| Scheduled launch | `Register-AutoRunTask.ps1` |
| Supervisor | `supervisor-daemon.js` + `Register-SupervisorTask.ps1` |
| WebUI | `serve-dashboard.js` and `mission-control.html` |

## Hard Rules

- No SSH runtime.
- No Linux cron/tmux/bash dependency in the Windows path.
- No unverified merge.
- Security has priority over feature work.
- Release phase does not accept new feature work unless it fixes release blockers.
- Human confirms push, merge, release, destructive file operations, and security exceptions.

## Supervisor Policy

Registered projects with `supervisorEnabled: true` may be restarted by the
Windows supervisor when no running session exists and the project has not reached
`deploy.ready`, `stable.stable_achieved`, `maintenance`, or `released` state.
Concurrency and cooldown are controlled by `config/processes.json`.

## Reporting

End every autonomous session with:

```text
# ClaudeOS Windows Session Report
Summary:
Completed:
Changed Files:
Verification:
GitHub:
Risks:
Next Actions:
Final Decision:
```
