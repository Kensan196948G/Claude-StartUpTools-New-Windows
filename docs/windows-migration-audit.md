# Windows Migration Audit

Generated: 2026-06-07

## Session Restore Report

| Area | Status |
|---|---|
| Project | `Claude-StartUpTools-New-Windows` |
| GitHub | `Kensan196948G/Claude-StartUpTools-New-Windows` |
| Branch | `main` |
| Open issues | `0` |
| Active PRs | `0` |
| Latest CI status | No workflow runs yet |
| Local state | `state.json` is not present; `state.json.example` is the template |
| Decision | continue |
| Reason | Windows root is initialized, but template/docs/UI remnants still need migration before release |

## Executive Verdict

The active runtime is already Windows-first: PowerShell, Node.js, Windows Task
Scheduler, local project registry, and Mission Control. The old Linux runtime
has been moved under `legacy-linux/` and no active `.sh` file remains under the
current `scripts/` tree.

The release blocker is not a live SSH/tmux/bash executable path. The remaining
work is documentation and template drift: deployable ClaudeOS templates must
continue to prefer Windows AutoRun, Task Scheduler, PowerShell, and local
project registry operations before `v1.0.0`.

## Current Runtime Boundary

```mermaid
flowchart LR
  D["D:\\ project folders"] --> R["ProjectRegistry.psm1"]
  R --> J["%USERPROFILE%\\.claudeos\\registered-projects.json"]
  J --> S["supervisor-daemon.js"]
  S --> A["Start-ClaudeAutoTimeout.ps1"]
  A --> C["Claude Code on Windows"]
  S --> M["Mission Control"]
  T["Windows Task Scheduler"] --> S
  T --> M
```

## Scan Summary

Search scope excluded `legacy-linux/**`, `node_modules/**`, and
`package-lock.json`.

| Pattern | Hits | Interpretation |
|---|---:|---|
| `SSH` / `ssh` | 60 | Mostly old history, templates, and explicit "do not use" docs |
| `Linux cron` / `crontab` / `cron-launcher` | 70 | Template drift and compatibility registry/API names |
| `tmux` | 44 | Old history and templates |
| `bash` / `.sh` | 183 | Mostly markdown fences, old history, and scanner code |
| Legacy home paths | 9 | Baseline from first scan; command templates have since been rewritten |
| `Linux` | 68 | Mixed legacy references, project names, and old template guidance |
| Active `.sh` files outside `legacy-linux/` | 0 | Pass |

## Classification

| Class | Files | Release Action |
|---|---|---|
| Active Windows runtime | `scripts/main/*.ps1`, `scripts/lib/*.psm1`, `scripts/dashboards/*.js`, `config/*.json.template` | Keep and harden |
| Compatibility names | `serve-dashboard.js` `/api/cron`, `cron-registry.json`, `hasCron` | Keep temporarily; UI must say AutoRun / Task Scheduler |
| Legacy source history | `CHANGELOG.md`, `ONBOARDING.md`, `TASKS.md` | Split into migration-source history or add a top notice |
| Deployable templates needing rewrite | `Claude/templates/claude/CLAUDE.md`, `Claude/templates/claudeos/commands/cron-*.md`, `work-time-reset.md`, `webhook-setup.md`, `parallel-cron-experiment.md`, review config docs | Initial Windows rewrite completed; continue reducing legacy experiment text |
| Explicit guardrails | `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/WINDOWS-OPERATIONS.md` | Keep; these correctly state no active SSH/Linux runtime |

## Findings

### P1: Deployable command templates still instruct Linux cron

Original examples from the first scan:

| File | Problem |
|---|---|
| `Claude/templates/claudeos/commands/cron-register.md` | Describes Linux crontab registration |
| `Claude/templates/claudeos/commands/cron-cancel.md` | Called the old Linux CLI |
| `Claude/templates/claudeos/commands/cron-list.md` | Listed old scheduler entries directly |
| `Claude/templates/claudeos/commands/work-time-reset.md` | Called the old Linux CLI |

Status: fixed in Issue #1 work. The compatibility command names remain
`/cron-*`, but the instructions now use Windows AutoRun, Task Scheduler,
`Register-AutoRunTask.ps1`, and PowerShell session JSON updates.

### P1: Main Claude template still claims Linux cron execution

`Claude/templates/claude/CLAUDE.md` still says autonomous execution is handled
by Linux cron. This is a deployable template, so it can misconfigure every
registered project.

Status: fixed in Issue #1 work. Startup checks now reference
`Register-ProjectCandidate.ps1`, `Register-SupervisorTask.ps1`, and
`Register-AutoRunTask.ps1`.

### P2: Historical docs are not separated from Windows current state

`CHANGELOG.md`, `ONBOARDING.md`, and `TASKS.md` contain many correct historical
entries from the upstream Linux/tmux era. They are useful as migration evidence
but confusing as current Windows guidance.

Action: add a top-level migration notice now; later split source history into
`legacy-linux/docs/source-history/` if needed.

### P2: Mission Control terminology is mid-migration

The main UI now presents Windows and AutoRun labels, but internal API and data
names still use `cron` for compatibility. This is acceptable for Phase 1, but
the release UI should not expose `crontab`, Linux cron, or systemd references.

Action: keep `/api/cron` as an alias, add `/api/autorun` later, and migrate
visible text first.

### P3: Cross-platform comments remain in active scripts

Some comments mention Linux compatibility in Node smoke tests, supervisor, and
watcher scripts. These are not active Linux dependencies, but they should be
trimmed when the Windows-only release message is finalized.

## Release Gate Impact

| Gate | Current Result |
|---|---|
| No active `.sh` outside `legacy-linux/` | Pass |
| No active SSH helper module | Pass |
| No live tmux/bash launcher in Windows path | Pass |
| Windows Task Scheduler path present | Pass |
| D-drive registry present | Pass |
| Deployable templates Windows-only | Partial: command templates and main CLAUDE template fixed; legacy experiment docs remain labeled |
| Current docs separated from source history | Partial |
| Mission Control Windows terminology | Partial |

## Next Implementation Order

1. Rewrite deployable Claude templates for Windows AutoRun.
2. Add migration-source notice to `CHANGELOG.md`, `ONBOARDING.md`, and `TASKS.md`.
3. Add `/api/autorun` as an alias for `/api/cron` while keeping backward compatibility.
4. Expand Pester tests for `WindowsHost` / `Host` registry entries.
5. Re-run `npm test`, browser Mission Control check, and push.
