---
description: Windows Task Scheduler の ClaudeOS AutoRun エントリを解除する
---

# /cron-cancel — Windows AutoRun 解除

互換名として `/cron-cancel` を残す。Windows 版では Task Scheduler の
`ClaudeOS AutoRun - <project>` タスクを解除する。

引数:
- `$1 = <project-name>`: 指定プロジェクトの AutoRun を解除
- 未指定: 現在のプロジェクトを確認してから解除

```powershell
pwsh -NoProfile -File .\scripts\main\Register-AutoRunTask.ps1 `
  -Project "<project-name>" `
  -Unregister
```

解除後は状態確認を行う。

```powershell
pwsh -NoProfile -File .\scripts\main\Register-AutoRunTask.ps1 `
  -Project "<project-name>" `
  -Status
```

注意:
- Windows Task Scheduler の対象タスクだけを扱う。
- 全件解除は危険操作なので、対象一覧を出して人間に確認してから行う。
