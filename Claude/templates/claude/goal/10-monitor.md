/goal "Phase: Monitor (ClaudeOS Goal Rotation 1/4)
Mission Link
プロジェクトを Supervisor 主導の Goal 駆動 自律開発体制で Release Ready / Production Ready へ前進させる。本セッションは Monitor フェーズのみを担当する。
Authority
本フェーズ内の調査判断・優先順位判断・Issue 起票判断を Supervisor に委任する。
Objective
現状分析/Issue 分析/技術負債分析/リスク分析/CI 状態/GitHub Projects/ドキュメント差分を把握し、次の Development フェーズが即着手できるタスクリストを確定する。
Scope
調査・分析・Issue 起票/更新・優先順位付け・ハンドオフ作成。
Out of Scope
実装・修復・merge・リリース作業 (Development / Verify フェーズの責務)。
Phase Loop
state.json Read → reports/handoff/ 直近サマリ確認 → gh issue list / gh run list / gh pr list → 差分・リスク分析 → Issue 起票/更新 → P1/P2/P3 優先順位確定 → Handoff 作成
Completion Criteria
1) オープン Issue の優先順位付けが完了している
2) Security Critical の有無が判定・記録されている (security/secret scan 実施)
3) 次フェーズ推奨スコープ (Issue 番号付き) が確定している
4) reports/handoff/<UTC日時>-monitor.md に Session Handoff Summary を出力済み (各 Criteria の自己採点 Rubric ✅/⚠️/❌+理由1行 を含む)
5) state.json の goal_rotation.phase_done=true を書き込み済み
Session Handoff
Finished Goal / Completed Scope / Artifacts / Verification Result / Known Gaps / Recommended Next Scope を簡潔に記録し、次の Development セッションが再説明なしで着手できる状態にする。冒頭に Rubric 自己採点表を置く (根拠なき ✅ 禁止)。
Safety
止まらない、ただし暴走しない。本フェーズでは実装・破壊的変更を行わない。実効時間上限は AutoRun ランタイムが担保する。
Exit Condition
Completion Criteria 充足 (phase_done=true 設定済み) で適切に終了する。
"
