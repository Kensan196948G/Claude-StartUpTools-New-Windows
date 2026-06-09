#!/usr/bin/env node
// SessionStart hook (ClaudeOS v9.0)
// 起動時に state.json を読み、前回セッションの再開ヒントを提示する。
// v9.0: 週次フェーズ計算・KPI 詳細・blocked_issues 表示を追加。
// current_session_start_at を書き込み、セッション追跡を確立する。
//
// v9.1 (ChangeLog v2.1.152/154 取り込み): 出力を hookSpecificOutput JSON 化する。
//   - additionalContext : 従来の resume 情報を *完全保持* して Claude に注入
//   - sessionTitle      : Agent View (claude agents) で並列セッションを識別
//   - reloadSkills       : .skills-dirty sentinel 在る時のみ skill 再スキャン
//   加えて dynamic workflows 起動可否ヒントを additionalContext に追加する。
//
// 設計方針:
//   - 通常成功パスのみ JSON を 1 個だけ stdout に出す (混在で parse 失敗するため)
//   - state 欠落などの早期 exit パスはプレーン text のまま (どちらも valid な SessionStart 出力)
//   - JSON 出力に失敗した場合はプレーン text へ fall back し、セッション起動を絶対に壊さない

const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(process.cwd(), "state.json");

// 出力アイコン規約（必須）: モデル既定の「絵文字控えめ」挙動を上書きするため、
// 毎セッション additionalContext で強制注入する。CLAUDE.md §3 と対。
// fresh / 通常の両出力経路で必ず注入すること（新規プロジェクトでも効かせるため）。
const ICON_DIRECTIVE =
  "🎨 出力アイコン規約（必須）: この応答以降、すべての応答と Agent 発話でアイコン/emoji を多用すること。" +
  "章見出し(## 📌)・箇条書き・表の各行・ステータス・役割ラベルにアイコンを付け、アイコン無しのプレーンな応答は避ける。" +
  "役割ラベルは [👔 CTO] [💻 Developer] [🧪 QA] [🔒 Security] 等のアイコン付きヘッダを使う。" +
  "Agent を spawn する際は spawn prompt に「出力にアイコン多用・役割ラベルにアイコン付与」を明記する。" +
  "（端末が emoji 非対応のときのみ CLAUDEOS_PLAIN_OUTPUT=1 でプレーン化）";

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

// v9.0: 週次フェーズを start_date から計算する
function calcWeekPhase(startDate) {
  if (!startDate) return null;
  const start = Date.parse(startDate);
  if (isNaN(start)) return null;
  const weeks = Math.floor((Date.now() - start) / (7 * 24 * 60 * 60 * 1000)) + 1;
  if (weeks <= 8)  return { week: weeks, phase: "Build",      focus: "実装優先 / Agent Teams パターン A" };
  if (weeks <= 16) return { week: weeks, phase: "Quality",    focus: "テスト・レビュー強化 / パターン B" };
  if (weeks <= 20) return { week: weeks, phase: "Stabilize",  focus: "新機能凍結 / CI 安定化のみ" };
  return           { week: weeks, phase: "Release",           focus: "変更最小化 / セキュリティ最終確認" };
}

const state = readJson(STATE_FILE);
if (!state) {
  // 早期 exit (fresh session): state は無いが、アイコン規約だけは additionalContext で必ず注入する。
  try {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "[SessionStart] state.json not found — fresh session\n" + ICON_DIRECTIVE,
      },
    }));
  } catch {
    // JSON 出力失敗時もプレーン text で起動を壊さない
    console.log("[SessionStart] state.json not found — fresh session\n" + ICON_DIRECTIVE);
  }
  process.exit(0);
}

const exec    = state.execution || {};
const stable  = state.stable || {};
const token   = state.token || {};
const compact = state.compact || {};
const kpi     = state.kpi || {};
const project = state.project || {};

// 以降の resume 情報は lines[] に集約し、末尾で additionalContext として 1 個の JSON に出力する。
const lines = [];

// 出力アイコン規約を先頭に置き、毎セッション最優先で読ませる（モデル既定の控えめ挙動を上書き）。
lines.push(ICON_DIRECTIVE);
lines.push("");
lines.push("[SessionStart] ClaudeOS v9.0 resume context");
lines.push(`  phase: ${exec.phase || "unknown"}`);
lines.push(`  last_summary: ${exec.last_session_summary || "(none)"}`);
lines.push(`  stable_achieved: ${stable.stable_achieved ? "yes" : "no"}`);
lines.push(`  consecutive_success: ${stable.consecutive_success ?? 0}`);
lines.push(`  token: used=${token.used ?? 0}% / remaining=${token.remaining ?? 100}%`);
lines.push(`  last_pre_compact_at: ${compact.last_pre_compact_at || "(never)"}`);

// v9.0: KPI サマリー
if (kpi.ci_success_rate !== undefined || kpi.blocker_count !== undefined) {
  lines.push(
    `  kpi: ci_success=${kpi.ci_success_rate ?? "n/a"} test_pass=${kpi.test_pass_rate ?? "n/a"} security_critical=${kpi.security_critical ?? 0} blockers=${kpi.blocker_count ?? 0}`
  );
}

// v9.0: blocked_issues サマリー
const blocked = state.blocked_issues || [];
if (blocked.length > 0) {
  lines.push(`  blocked_issues: ${blocked.map(b => (typeof b === "object" ? b.issue || b : b)).join(", ")}`);
}

// v10.6 Goal Rotation: ローテーション状態と直近の強制前進警告を提示する。
// phase モードでは「現フェーズの Completion Criteria 充足時に goal_rotation.phase_done=true を
// 書いて終了する」が前進の唯一の契約であることを毎セッション明示する。
const rot = state.goal_rotation || null;
if (rot && rot.mode === "phase") {
  lines.push(
    `  goal_rotation: 🔁 phase=${rot.current || "monitor"} cycle=${rot.cycle_count ?? 0} retry=${rot.retry_count ?? 0}/${rot.max_retries ?? 2} last_outcome=${rot.last_outcome || "(none)"}`
  );
  lines.push(
    "  goal_rotation_contract: フェーズの Completion Criteria 充足時に state.json の goal_rotation.phase_done=true を書き、reports/handoff/<UTC日時>-<phase>.md に Session Handoff Summary を出力して終了すること"
  );
  const forced = (state.warnings || []).filter((w) => w.kind === "goal_rotation_forced_advance").slice(-1)[0];
  if (forced) {
    lines.push(`  goal_rotation_warning: ⚠️ 前回 ${forced.phase || "?"} フェーズが未達のまま強制前進 — 未達項目を本セッションで考慮すること`);
  }
} else if (rot && rot.mode === "mission") {
  lines.push("  goal_rotation: mission モード (従来のミッション一括 /goal)");
}

// v10.6: 直近の Session Handoff Summary (reports/handoff/) を注入する。
// フェーズ分割セッションの引き継ぎ正本。≤1500 字に切り詰めて context 圧迫を防ぐ。
try {
  const handoffDir = path.join(process.cwd(), "reports", "handoff");
  if (fs.existsSync(handoffDir)) {
    const latest = fs.readdirSync(handoffDir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .slice(-1)[0];
    if (latest) {
      const raw = fs.readFileSync(path.join(handoffDir, latest), "utf8");
      const clipped = raw.length > 1500 ? raw.slice(0, 1500) + "\n…(truncated)" : raw;
      lines.push("");
      lines.push(`[Session Handoff] 直近の引き継ぎ (reports/handoff/${latest}):`);
      clipped.split(/\r?\n/).forEach((l) => lines.push(`  ${l}`));
    }
  }
} catch { /* fail-soft */ }

// v9.0: 週次フェーズ表示
const wp = calcWeekPhase(project.start_date);
if (wp) {
  lines.push(`  week_phase: Week ${wp.week} → ${wp.phase} (${wp.focus})`);
}

// v9.0+: Agent Teams 推奨パターン提示
//   フェーズに応じた CTO 判断の指針を提示する（強制ではない）
function recommendPattern(phase) {
  const p = (phase || "").toLowerCase();
  if (p.includes("build") || p.includes("development")) {
    return { pattern: "A", desc: "並列実装 (Backend + Frontend + テスト)" };
  }
  if (p.includes("verify") || p.includes("quality") || p.includes("repair")) {
    return { pattern: "B", desc: "品質強化 (バグ修復 + Security + 回帰)" };
  }
  if (p.includes("monitor") || p.includes("research") || p.includes("design")) {
    return { pattern: "C", desc: "調査・設計 (技術調査 + 設計 + Devil's Advocate)" };
  }
  return null;
}
const rec = recommendPattern(exec.phase);
if (rec) {
  lines.push(`  agent_teams_recommended: パターン ${rec.pattern} — ${rec.desc}`);
}

// Agent Teams 直近使用状況サマリ
const atu = state.agent_teams_usage || {};
const atuCur = atu.current_session || {};
if (atuCur.team_create_count || atuCur.send_message_count) {
  lines.push(`  agent_teams_current: TeamCreate=${atuCur.team_create_count || 0} SendMessage=${atuCur.send_message_count || 0} patterns=[${(atuCur.patterns_used || []).join(",")}]`);
}

// Dashboard URL 案内（Agent View 代替）
const dashPort = process.env.CLAUDEOS_DASHBOARD_PORT || "3737";
lines.push(`  dashboard: http://localhost:${dashPort}/mission-control (Agent Teams Activity パネル参照)`);

// ChangeLog v2.1.154: dynamic workflows 起動可否ヒント
//   workflow は session 終了で in-progress 分が破棄される & token をプラン上限に計上するため、
//   token < 70% (§13) かつ 残り >= 60min (§14) のときのみ「起動可」を提示する。
//   詳細ガードレールは core/04-agent-teams.md「dynamic workflows」§ を参照。
const tokenUsedPct  = Number(token.used) || 0;
const remainingMin  = Number(exec.remaining_minutes);
const remainingKnown = Number.isFinite(remainingMin);
const wfOkToken = tokenUsedPct < 70;
const wfOkTime  = !remainingKnown || remainingMin >= 60;
const wfReasons = [];
if (!wfOkToken) wfReasons.push("token≥70%");
if (!wfOkTime)  wfReasons.push("残<60min");
const wfGate   = wfReasons.length === 0 ? "起動可" : "抑制";
const wfRemStr = remainingKnown ? `${remainingMin}min` : "n/a";
lines.push(
  `  workflows: ${wfGate} (token ${tokenUsedPct}% / 残 ${wfRemStr})${wfReasons.length ? " ← " + wfReasons.join(",") : ""}`
);

// state.json に current_session_start_at を書き込む
try {
  const now = new Date().toISOString();
  state.execution = exec;
  state.execution.current_session_start_at = now;

  // cron 起動の場合は trigger を記録（CLAUDE_SESSION_ID env var が存在する）
  const cronSessionId = process.env.CLAUDE_SESSION_ID;
  if (cronSessionId) {
    state.execution.last_trigger = "cron";
    state.execution.last_cron_session_id = cronSessionId;
  } else {
    state.execution.last_trigger = "manual";
  }

  writeJsonAtomic(STATE_FILE, state);
  lines.push(`  session_start_at: ${now}`);
  lines.push(`  trigger: ${state.execution.last_trigger}`);
} catch (err) {
  // 書き込み失敗は無視（resume 情報の提示は継続する）
  console.error(`[SessionStart] state.json write failed: ${err.message}`);
}

// Stage 3: ReasoningBank — 関連パターンをセッション開始時に注入（fail-soft）
// state.json 書き込み完了後に実行するため、最新のフェーズ・要約を参照できる。
try {
  const rb      = require("./reasoning-bank.js");
  const dataDir = path.join(__dirname, "..", "..", "data");
  const bank    = rb.loadBank(dataDir);
  const projectName = path.basename(process.cwd());
  const phase       = exec.phase || "unknown";
  const summary     = exec.last_session_summary || "";
  const currentTags = rb.extractTags(summary);
  // グローバルバンク（他プロジェクトのパターンも含む）から取得
  const patterns = typeof rb.retrieveRelevantPatternsGlobal === "function"
    ? rb.retrieveRelevantPatternsGlobal(bank, projectName, phase, currentTags, 3)
    : rb.retrieveRelevantPatterns(bank, projectName, phase, currentTags, 3);
  if (patterns.length > 0) {
    lines.push("");
    lines.push("[ReasoningBank] 過去の有効パターン（参考）:");
    patterns.forEach((p, i) => {
      const confStr  = (p.confidence || 0).toFixed(2);
      const tagsStr  = (p.tags || []).slice(0, 4).join(",");
      const crossMk  = p._cross_project ? " [cross-project]" : "";
      lines.push(`  [${i + 1}] conf=${confStr} | ${p.outcome} | phase=${p.phase} | tags=[${tagsStr}]${crossMk}`);
      lines.push(`       問題: ${p.problem_pattern}`);
      const approachPreview = (p.approach || "").slice(0, 120);
      lines.push(`       対応: ${approachPreview}${(p.approach || "").length > 120 ? "…" : ""}`);
    });
  }
} catch (_rbErr) {
  // fail-soft: SessionStart フックをブロックしない
}

// ChangeLog v2.1.152: sessionTitle — Agent View で並列セッションを識別する短い識別子
const titleProject = path.basename(process.cwd());
const titlePhase   = exec.phase || "unknown";
const sessionTitle = `ClaudeOS·${titleProject}·${titlePhase}`;

// ChangeLog v2.1.152: reloadSkills — .skills-dirty sentinel が在る時のみ skill 再スキャン。
//   migration / 配布スクリプトが skill を更新したら本 sentinel を touch する設計。
//   常時 true は無駄な再スキャンになるため条件付き。
const skillsDirty = path.join(process.cwd(), ".claude", "claudeos", ".skills-dirty");
let reloadSkills = false;
try {
  if (fs.existsSync(skillsDirty)) {
    reloadSkills = true;
    fs.unlinkSync(skillsDirty);
    lines.push("  reloadSkills: true (.skills-dirty 検出 → skill 再スキャン)");
  }
} catch {
  // fail-soft: sentinel 削除失敗は無視
}

// hookSpecificOutput JSON を 1 個だけ stdout に出力する。
const hookOut = {
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: lines.join("\n"),
    sessionTitle,
  },
};
if (reloadSkills) hookOut.hookSpecificOutput.reloadSkills = true;

try {
  process.stdout.write(JSON.stringify(hookOut));
} catch (_jsonErr) {
  // 最終フォールバック: JSON 出力に失敗してもプレーン text で additionalContext を出し、起動を壊さない
  console.log(lines.join("\n"));
}

process.exit(0);
