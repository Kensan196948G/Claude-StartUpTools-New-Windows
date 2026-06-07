# Config

Copy `config.json.template` to `config.json` for local use.

`config.json` is ignored by Git because it can contain local paths, dashboard
auth settings, and environment-specific values.

## Windows Fields

| Field | Purpose |
|---|---|
| `projectsDir` | D-drive project root. Default: `D:\` |
| `localExcludes` | Folder names excluded from candidate scanning |
| `projectRegistry.registryFile` | Registered project registry path |
| `projectRegistry.autoApplySupervisor` | Register candidates with Supervisor enabled |
| `cron.defaultDurationMinutes` | Compatibility name for timed Windows sessions |
| `sessionTabs.localSessionsDir` | Session JSON directory |

Removed from the active Windows runtime:

| Legacy concept | Replacement |
|---|---|
| SSH remote launch | Local Claude Code launch |
| Linux cron | Windows Task Scheduler |
| tmux monitor | Session JSON + Mission Control |
| bash supervisor | Node supervisor daemon |
