# Final Release Handoff

Status: ready for human final decision.

This repository is prepared for `v1.0.0` release review. The development
process has intentionally not created the final tag or GitHub Release.

## Current Release Candidate

| Item | Value |
|---|---|
| Repository | `Kensan196948G/Claude-StartUpTools-New-Windows` |
| Branch | `main` |
| Release candidate HEAD | Confirm with `git rev-parse --short HEAD` |
| Latest passing CI | Confirm with `gh run list --workflow CI --limit 3` |
| Open issues | `0` |
| Local Pester | `401 passed / 0 failed` |
| Node smoke | `PASS: supervisor-daemon smoke test` |
| PSScriptAnalyzer | Error severity 0 |
| Final tag | Not created |
| GitHub Release | Not created |

## Final Human Review

Before running the release commands, confirm:

1. `git status --short` is clean.
2. The latest CI run for `main` is green.
3. `docs/v1.0.0-rc.1-release-notes.md` is acceptable as release notes.
4. `docs/rc-real-machine-verification.md` has been reviewed or executed.
5. No security exception is pending.
6. You explicitly approve publishing `v1.0.0`.

## Human-only Release Commands

Run these only after the final human decision.

```powershell
git status --short
git log --oneline -5
gh run list --repo Kensan196948G/Claude-StartUpTools-New-Windows --workflow CI --limit 3
```

Create and push the final tag:

```powershell
git tag v1.0.0
git push origin v1.0.0
```

Create the GitHub Release:

```powershell
gh release create v1.0.0 --repo Kensan196948G/Claude-StartUpTools-New-Windows --title "v1.0.0" --notes-file docs/v1.0.0-rc.1-release-notes.md
```

## Stop If

| Condition | Action |
|---|---|
| Working tree is dirty | Inspect and commit or discard intentionally |
| CI is not green | Fix before release |
| Release notes are wrong | Edit docs and rerun CI |
| Any secret is detected | Remove, rotate, and rerun checks |
| You are not ready to publish | Keep RC status |

## Completion

After the human-created GitHub Release is published, this development thread can
be treated as complete.
