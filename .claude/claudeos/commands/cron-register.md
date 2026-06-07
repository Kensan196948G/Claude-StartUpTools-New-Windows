---
description: Windows Task Scheduler に ClaudeOS AutoRun エントリを登録する
---

# /cron-register — Windows AutoRun 登録

互換名として `/cron-register` を残すが、Windows 版では
`Register-AutoRunTask.ps1` を使う。

1. 現在のプロジェクト名を確認する。
   - `$CLAUDE_PROJECT` があれば使う。
   - 未設定なら `state.json`、カレントディレクトリ名、またはユーザー確認で決める。
2. 引数が未指定なら聞き取る。
   - 曜日: `Monday..Sunday` の配列、既定は Monday-Saturday
   - 時刻: `HH:MM`
   - 作業時間: 分、既定 `300`
3. リポジトリルートから PowerShell で登録する。

```powershell
pwsh -NoProfile -File .\scripts\main\Register-AutoRunTask.ps1 `
  -Project "<project-name>" `
  -Time "09:00" `
  -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday,Saturday `
  -DurationMinutes 300
```

4. 状態確認を実行する。

```powershell
pwsh -NoProfile -File .\scripts\main\Register-AutoRunTask.ps1 `
  -Project "<project-name>" `
  -Status
```

5. 登録結果として、Task Scheduler のタスク名、開始時刻、曜日、実行時間を報告する。

注意:
- SSH、tmux、bash は使用しない。
- 最終的な有効化・削除・リリース判断は人間に確認する。
- AutoRun の実行本体は `Start-ClaudeAutoTimeout.ps1`。
