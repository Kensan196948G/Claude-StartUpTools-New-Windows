---
description: 現セッションの最大作業時間 max_duration_minutes を変更する
---

# /work-time-set — 作業時間の変更

引数:
- `$1 = <minutes>`: その分数に設定。例: `/work-time-set 240`

Windows 版では `%USERPROFILE%\.claudeos\sessions\<session-id>.json` を更新する。

```powershell
$NewMinutes = 300  # replace with the requested minutes
$SessionId = $env:CLAUDE_SESSION_ID
if (-not $SessionId) {
  throw "CLAUDE_SESSION_ID is not set. Mission Control or session info can be used to identify the active session."
}

$SessionFile = Join-Path $env:USERPROFILE ".claudeos\sessions\$SessionId.json"
if (-not (Test-Path -LiteralPath $SessionFile)) {
  throw "session.json not found: $SessionFile"
}

$session = Get-Content -LiteralPath $SessionFile -Raw | ConvertFrom-Json
$start = [DateTimeOffset]::Parse($session.start_time)
$session.max_duration_minutes = $NewMinutes
$session.end_time_planned = $start.AddMinutes($NewMinutes).ToString("o")
$session.last_updated = [DateTimeOffset]::Now.ToString("o")
$session | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $SessionFile -Encoding UTF8

"[OK] max_duration_minutes = $NewMinutes"
```

注意:
- 変更は現在セッションにのみ適用する。
- Task Scheduler 登録の既定実行時間は `Register-AutoRunTask.ps1` 側で変更する。
