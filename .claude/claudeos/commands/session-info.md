---
description: 現セッションの session.json を整形表示する
---

# /session-info — セッション情報

Windows 版では `%USERPROFILE%\.claudeos\sessions` 配下を確認する。

```powershell
$SessionId = $env:CLAUDE_SESSION_ID
if (-not $SessionId) {
  Write-Host "CLAUDE_SESSION_ID が未設定です。Mission Control または Show-SessionInfoTab.ps1 でアクティブセッションを確認してください。"
  return
}

$SessionFile = Join-Path $env:USERPROFILE ".claudeos\sessions\$SessionId.json"
if (-not (Test-Path -LiteralPath $SessionFile)) {
  Write-Host "session 情報が見つかりません: $SessionFile"
  return
}

Get-Content -LiteralPath $SessionFile -Raw | ConvertFrom-Json | ConvertTo-Json -Depth 20
```

表示後、残り時間と status から「このセッションがあとどれくらい走るか」をユーザーに分かりやすく要約してください。
