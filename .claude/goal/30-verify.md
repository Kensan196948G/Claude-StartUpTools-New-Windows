/goal "Phase: Verify (ClaudeOS Goal Rotation 3/4)
Mission Link
プロジェクトを Supervisor 主導の Goal 駆動 自律開発体制で Release Ready / Production Ready へ前進させる。本セッションは Verify フェーズのみを担当する。
Authority
本フェーズ内の検証判断・STABLE 判定・merge 可否判断を Supervisor に委任する。
Objective
直前 Development フェーズの成果物 (PR/変更差分) を Verification First で検証し、STABLE 判定と merge 可否を確定する。
Scope
test/lint/build/typecheck/CI 確認、security/secret scan、CodeRabbit レビュー (/coderabbit:review committed --base main)、Codex Review (利用可能時)、回帰確認、STABLE 判定、CI 成功 PR の merge 判断。
Out of Scope
新規実装・機能追加 (Development フェーズの責務)・リファクタ (Improvement フェーズの責務)。修復は最小差分のみ許可。
Phase Loop
state.json Read → reports/handoff/ 直近サマリ確認 → 対象 PR/差分確定 → test/lint/build/CI 確認 → security scan → CodeRabbit/Codex Review → 指摘の最小修正 → 再検証 → STABLE 判定 → Handoff 作成
Completion Criteria
1) 対象差分の test/lint/build/CI 結果が記録されている
2) security scan と CodeRabbit レビューが完了し Critical/High が 0 または Issue 化済み
3) STABLE 判定 (達成/未達と連続成功カウント) が state.json に記録されている
4) reports/handoff/<UTC日時>-verify.md に Session Handoff Summary を出力済み
5) state.json の goal_rotation.phase_done=true を書き込み済み
Session Handoff
検証結果・STABLE 判定・merge 実施有無・Improvement フェーズへの改善候補 (指摘残・技術負債) を簡潔に記録する。
Safety
止まらない、ただし暴走しない。未検証 merge・CI 未通過 merge は禁止。修復試行は3回まで。実効時間上限は AutoRun ランタイムが担保する。
Exit Condition
Completion Criteria 充足 (phase_done=true 設定済み) で適切に終了する。
"
