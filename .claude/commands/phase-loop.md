---
description: Goal Rotation の現在フェーズ (Monitor/Development/Verify/Improvement) を1つ実行し、充足時にポインタを前進する
---

# /phase-loop — フェーズローテーション実行 (手動セッション用)

手動起動セッション (ミッション /goal 固定) の中で、AutoRun と同じ
Monitor → Development → Verify → Improvement のフェーズローテーションを1フェーズずつ回す。
連続実行する場合は `/loop 45m /phase-loop` を推奨する。

🎨 出力アイコン規約: 本コマンドの全出力でアイコンを多用し、役割ラベルは
`[👔 CTO]` `[🔁 Loop Operator]` 等のアイコン付きヘッダを使うこと。

## 実行手順

1. 📊 **現在フェーズの確認** — `state.json` の `goal_rotation` を Read する。
   - `goal_rotation` が無い場合は既定値 (`mode=phase, current=monitor`) で初期化してよい。
   - `blocked=true` の場合は実行せず、ブロック理由 (`state.warnings` の `goal_rotation_blocked`) を
     ユーザーに提示して停止する。
2. 📄 **フェーズ定義の読込** — `.claude/goal/` から `current` に対応するファイルを Read する。
   | current | ファイル |
   |---|---|
   | monitor | `.claude/goal/10-monitor.md` |
   | development | `.claude/goal/20-development.md` |
   | verify | `.claude/goal/30-verify.md` |
   | improvement | `.claude/goal/40-improvement.md` |
3. 🔁 **Phase Loop の実行** — ファイル内の Objective / Scope / Out of Scope / Phase Loop に従い、
   そのフェーズの作業のみを実行する (Out of Scope の作業へ踏み出さない)。
4. ✅ **Completion Criteria 判定** — ファイル内の Completion Criteria を1項目ずつ検証する。
   - 充足: `reports/handoff/<UTC日時>-<phase>.md` に Session Handoff Summary を出力し、
     `state.json` の `goal_rotation.phase_done=true` を書き込む。
   - 未充足: 残項目と理由を整理して報告し、前進しない (次回 /phase-loop で同フェーズを再開)。
5. ⏭️ **ポインタ前進** — 充足時のみ以下を実行する (手動セッションでは launcher finalize が
   走らないため、これが唯一の前進経路):

   ```bash
   node .claude/claudeos/scripts/hooks/goal-rotation.js advance --manual
   ```

   - exit 10: ✅ 前進成功 (improvement→monitor で cycle_count++)
   - exit 2: ⚠️ phase_done=false (手順4の書き込み漏れ — 修正して再実行)
6. 📋 **報告** — 以下の形式で簡潔に報告する:

   ```text
   [🔁 Phase Loop Report]
   Phase: <実行フェーズ> (cycle=<n>)
   Result: ✅ 充足・前進 / ⚠️ 未達・継続
   Completed: <実施内容>
   Handoff: reports/handoff/<ファイル名>
   Next: <次フェーズ または 同フェーズ残項目>
   ```

## 注意

- `/goal` 自体はセッション内から変更できない (UI コマンド)。本コマンドはミッション /goal の
  配下でフェーズ作業を構造化する位置づけ。
- AutoRun (無人) セッションでは launcher がフェーズ別 /goal を注入するため本コマンドは不要。
- 1回の /phase-loop では1フェーズのみ実行する (1セッション1ゴール原則のフェーズ版)。
