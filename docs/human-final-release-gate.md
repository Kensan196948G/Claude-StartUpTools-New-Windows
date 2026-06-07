# Human Final Release Gate

This document defines the actions reserved for the human reviewer.

The development process may prepare code, docs, CI, evidence, release notes,
and RC handoff material. It must not create the final `v1.0.0` tag or publish
the GitHub Release without explicit human approval.

## Human-only Decisions

| Decision | Human action |
|---|---|
| Final release approval | Confirm all RC evidence |
| `v1.0.0` tag | Create only after final approval |
| GitHub Release | Publish only after final approval |
| Production rollout | Start only after final approval |
| Security exception | Approve or reject explicitly |
| GitHub Projects final Done | Confirm final status |

## Pre-release Evidence

| Evidence | Required state |
|---|---|
| Open issues | 0, or explicitly accepted by human reviewer |
| CI | Green on latest release candidate HEAD |
| Local tests | `npm test` PASS |
| PSScriptAnalyzer | Error severity 0 |
| Mission Control | Console error 0 |
| Project Registry | D-drive scan and registry backup/restore verified |
| Supervisor | Registered-project autonomy verified |
| Task Scheduler | Dashboard, Supervisor, and AutoRun task flows verified |
| README | A Windows user can install and operate from the README |
| Release notes | `docs/v1.0.0-rc.1-release-notes.md` reviewed |

## Suggested Human Commands

Run only after deciding to release.

```powershell
git status --short
git log --oneline -5
gh run list --repo Kensan196948G/Claude-StartUpTools-New-Windows --workflow CI --limit 3
```

Create final tag only after approval:

```powershell
git tag v1.0.0
git push origin v1.0.0
```

Create GitHub Release only after approval:

```powershell
gh release create v1.0.0 --repo Kensan196948G/Claude-StartUpTools-New-Windows --title "v1.0.0" --notes-file docs/v1.0.0-rc.1-release-notes.md
```

## Stop Conditions

Do not release if any of these are true:

| Stop condition | Action |
|---|---|
| CI is red | Fix and rerun CI |
| Console errors exist | Fix Mission Control and retest |
| Registry restore fails | Fix Project Registry recovery |
| Supervisor loops unexpectedly | Fix cooldown/restart controls |
| Secrets are detected | Remove and rotate before release |
| Human reviewer is unsure | Keep RC status; do not tag |
