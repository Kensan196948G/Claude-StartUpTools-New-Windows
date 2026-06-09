# 📁 goal/ — Goal Rotation 用 /goal 本文フォルダ (ClaudeOS v10.6)

このフォルダは **AutoRun (無人運用) がセッション起動時に読み込む /goal 本文ファイル** を格納します。
テンプレ正本は `Claude/templates/claude/goal/`、配布先は各プロジェクトの `.claude/goal/` です
(TemplateSyncManager と Start-ClaudeAutoTimeout.ps1 の両経路で同期されます)。

## 🔁 ローテーション仕様

- `state.json` の `goal_rotation.mode = "phase"` (AutoRun 既定) のとき、launcher は
  `goal_rotation.current` に対応するファイルを選択して claude に渡し、冒頭の `/goal "..."` が自動実行されます。
- 1 セッション = 1 フェーズ /goal。フェーズ前進はセッション終了後に launcher が
  `goal-rotation.js finalize` で判定します (Claude が `goal_rotation.phase_done=true` を書いた場合のみ前進)。
- 巡回順序: `10-monitor.md → 20-development.md → 30-verify.md → 40-improvement.md → (cycle_count++) → 10-monitor.md …`
- `goal_rotation.mode = "mission"` に設定すると従来どおり START_PROMPT.md (= `00-mission.md` と同内容) を使用します。

## 📛 命名規則

| ファイル | 役割 | 巡回対象 |
|---|---|---|
| `00-mission.md` | ミッション一括 /goal (mission モード正本。START_PROMPT.md と同期維持) | ❌ |
| `10-monitor.md` | 🔍 Monitor フェーズ | ✅ |
| `20-development.md` | 💻 Development フェーズ | ✅ |
| `30-verify.md` | 🧪 Verify フェーズ | ✅ |
| `40-improvement.md` | 🧬 Improvement フェーズ | ✅ |
| `README.md` | 本ドキュメント | ❌ |

## 📏 制約

- 各ファイルは **完全な `/goal "..."` ペイロード** であること (冒頭が `/goal "` で始まる)。
  途中に別テキストを置くと Claude Code の /goal 自動実行が壊れます。
- `/goal` 本文 (引用符内) は **4000 字以内** (Claude Code CLI 制限)。
  3,800 字超で警告、4,000 字超で launcher が起動を fail-fast します
  (`node .claude/claudeos/scripts/hooks/goal-rotation.js validate --file <path>` で検査可能)。
- 各フェーズファイルには「充足時に `goal_rotation.phase_done=true` を書き、
  `reports/handoff/<stamp>-<phase>.md` に Session Handoff Summary を出力して終了する」旨を必ず含めること。
  これが launcher の前進判定と次セッションへの引き継ぎを繋ぐ唯一の契約です。

## ⚠️ `.claude/claudeos/goals/` との違い

- `.claude/claudeos/goals/` (hotfix.md / mvp-release.md 等) は **用途別ゴール型の参照文書** であり、
  Claude がセッション中に Read する設計資料です。字数制限はありません。
- 本フォルダ (`.claude/goal/`) は **launcher が /goal コマンドとしてそのまま注入する本文** です。
  役割が異なるため統合しないでください。

## 🛠️ 手動セッションでの利用

手動起動 (`start.bat` / `Start-ClaudeCode.ps1`) ではミッション /goal が固定で入ります。
セッション内でフェーズを回す場合は `/loop 45m /phase-loop` を使用してください
(`/phase-loop` が `goal_rotation.current` のフェーズ定義を読み込んで実行し、
充足時に `goal-rotation.js advance --manual` で前進します)。
