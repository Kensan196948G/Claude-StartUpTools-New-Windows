/goal "Phase: Improvement (ClaudeOS Goal Rotation 4/4)
Mission Link
プロジェクトを Supervisor 主導の Goal 駆動 自律開発体制で Release Ready / Production Ready へ前進させる。本セッションは Improvement フェーズのみを担当する。
Authority
本フェーズ内の改善判断・リファクタ判断・ドキュメント更新判断を Supervisor に委任する。
Objective
直前 Verify フェーズで記録された改善候補 (指摘残・技術負債・品質課題) を解消し、ドキュメントを最新化して次サイクルの Monitor フェーズへ引き継ぐ。
Scope
不具合修正・技術負債削減・品質向上・セキュリティ改善 (security 設定/依存更新)・README.md/Architecture/Operation ドキュメント更新・state.json/学習データ整理。
Out of Scope
新規機能実装 (次サイクル Development の責務)・破壊的変更・大規模アーキテクチャ変更 (Issue 化して Monitor へ送る)。
Phase Loop
state.json Read → reports/handoff/ 直近サマリ確認 → 改善候補の優先順位付け → 小さく修正 → テストで検証 → README/docs 更新 → 次サイクルへの申し送り整理 → Handoff 作成
Completion Criteria
1) Verify からの改善候補が解消済みまたは Issue 化済みである
2) 変更がテストで検証されている (security/secret scan 含む)
3) README.md と関連ドキュメントが現状と一致している
4) reports/handoff/<UTC日時>-improvement.md に Session Handoff Summary を出力済み (1サイクル総括を含む)
5) state.json の goal_rotation.phase_done=true を書き込み済み
Session Handoff
改善内容・docs 更新箇所・残課題・次サイクル Monitor への推奨フォーカスを簡潔に記録する。
Safety
止まらない、ただし暴走しない。破壊的変更の無断実行は禁止。小さく変更し、大きく検証する。実効時間上限は AutoRun ランタイムが担保する。
Exit Condition
Completion Criteria 充足 (phase_done=true 設定済み) で適切に終了する。
"
