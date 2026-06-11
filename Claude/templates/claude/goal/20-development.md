/goal "Phase: Development (ClaudeOS Goal Rotation 2/4)
Mission Link
プロジェクトを Supervisor 主導の Goal 駆動 自律開発体制で Release Ready / Production Ready へ前進させる。本セッションは Development フェーズのみを担当する。
Authority
本フェーズ内の設計判断・実装判断・テスト実装判断を Supervisor に委任する。
Objective
直前 Monitor フェーズの Session Handoff (reports/handoff/) で確定した優先タスクを、アーキテクチャ設計/実装/テスト実装/ドキュメント実装としてスコープ厳守で完了させる。
Scope
Handoff に記載された優先 Issue の実装・テスト追加・関連ドキュメント更新・PR 作成 (branch/WorkTree 必須)。並列実装が有効な場合は Agent Teams (パターン A) を編成してよい。
Out of Scope
Handoff 外の新規機能・ついでの大規模整理・main 直接 push・未検証 merge (Verify フェーズの責務)。
Phase Loop
state.json Read → reports/handoff/ 直近サマリ確認 → 対象 Issue 確定 → 設計 → 実装 → テスト実装 → ローカル検証 (test/lint/build) → PR 作成 → Handoff 作成
Completion Criteria
1) Handoff 記載の優先タスクが実装され、対応テストが追加されている
2) ローカルで test/lint/build が通過している (security/secret scan 含む)
3) PR が作成済み (未完成部分は Draft PR + 残課題明記)
4) reports/handoff/<UTC日時>-development.md に Session Handoff Summary を出力済み (各 Criteria の自己採点 Rubric ✅/⚠️/❌+理由1行 を含む)
5) state.json の goal_rotation.phase_done=true を書き込み済み
Session Handoff
実装内容・変更ファイル・PR 番号・未解決事項・Verify フェーズへの検証依頼事項を簡潔に記録する。冒頭に Rubric 自己採点表を置く (根拠なき ✅ 禁止)。
Safety
止まらない、ただし暴走しない。同一エラー修復は3回まで。破壊的変更・Security Downgrade は禁止。実効時間上限は AutoRun ランタイムが担保する。
Exit Condition
Completion Criteria 充足 (phase_done=true 設定済み) で適切に終了する。
"
