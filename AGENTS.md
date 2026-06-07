# AGENTS.md

This repository is the Windows-only Claude StartUpTools workspace.

## Mission

Turn D-drive project folders into registered Claude development targets, launch
Claude Code locally on Windows, and supervise autonomous sessions while leaving
final human decisions such as push, merge, release, and destructive operations to
the user.

## Required Flow

1. Monitor: read `config/config.json`, registered projects, session JSON, GitHub
   state, CI state, and open risks.
2. Development: make small Windows-native changes. Prefer PowerShell, Node.js
   built-ins, and existing modules under `scripts/lib`.
3. Verify: run Pester/Node checks that match the touched surface.
4. Improvement: update README/docs/config examples and record remaining risks.

## Windows Rules

- Do not add SSH, Linux cron, tmux, or bash as active runtime dependencies.
- Keep legacy Linux assets under `legacy-linux/` only.
- Use `D:\` project discovery through `ProjectRegistry.psm1`.
- Use Windows Task Scheduler for scheduled work.
- Use `supervisor-daemon.js` for registered project supervision.
- Keep `config/config.json` untracked; update `config/config.json.template`
  instead.
- Do not claim readiness if external GitHub/CI/secret/tooling evidence is
  missing.

## Human Decision Boundary

Automate investigation, implementation, tests, docs, local task registration, and
status reporting. Ask or stop before push, merge, release, deleting user data,
changing credentials, or approving security exceptions.

## Standard Checks

```powershell
npm run test:pester
npm run test:node
npm run lint:pester
```
