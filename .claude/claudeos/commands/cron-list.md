---
description: Windows Task Scheduler の ClaudeOS AutoRun エントリ一覧を表示する
---

# /cron-list — Windows AutoRun 一覧

互換名として `/cron-list` を残す。Windows 版では Task Scheduler と
登録プロジェクト台帳を確認する。

```powershell
Get-ScheduledTask -TaskName "ClaudeOS AutoRun -*" -ErrorAction SilentlyContinue |
  Select-Object TaskName, State, TaskPath

pwsh -NoProfile -File .\scripts\main\Register-ProjectCandidate.ps1 -List
```

出力があれば、プロジェクト名、Task Scheduler 状態、Supervisor 対象、
GitHub URL を表形式で報告する。出力が無ければ
「登録済みの ClaudeOS AutoRun はありません」と伝える。

注意:
- Windows Task Scheduler と登録プロジェクト台帳だけを確認する。
- `.claudeos\registered-projects.json` は登録候補の正本。
