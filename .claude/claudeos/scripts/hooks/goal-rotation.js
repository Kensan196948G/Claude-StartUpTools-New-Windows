#!/usr/bin/env node
// goal-rotation.js (ClaudeOS v10.6 — Goal Rotation 単一正本モジュール + CLI)
//
// フェーズローテーション (Monitor → Development → Verify → Improvement) の
// ポインタ前進ロジックを一元管理する。launcher (Start-ClaudeAutoTimeout.ps1) と
// 手動セッション (/phase-loop) の両方が本 CLI を呼ぶことでロジック分裂を防ぐ。
//
// 設計上の重要事実:
// - Stop hook (session-end.js) は毎ターン発火し得る上、タイムアウト kill 時は
//   発火しない。そのためポインタ前進の正本は launcher の finalize に置き、
//   session-end.js は phase_done_at の記録のみを担当する。
// - last_finalized_session による冪等ガードで「1セッション=最大1前進」を保証する。
//
// CLI:
//   node goal-rotation.js finalize --status <completed|timeout|failed> --session <id> [--state <path>]
//   node goal-rotation.js catchup  [--state <path>]
//   node goal-rotation.js validate --file <goal.md>
//   node goal-rotation.js advance --manual [--state <path>]
//
// Exit codes:
//   0  = noop (mission モード / 冪等スキップ / crash 非課金 / validate OK)
//   2  = advance --manual で phase_done=false (前提未充足)
//   5  = state.json 読み書き失敗などの内部エラー
//   6  = validate: /goal 本文が 4000 字超過
//   7  = validate: ファイルが /goal " で始まっていない (自動実行不可形式)
//   10 = advanced (正常前進)
//   11 = retry (同フェーズ再走)
//   12 = forced-advance (リトライ枯渇による強制前進)
//   13 = blocked (on_retry_exhausted=block で停止)

"use strict";

const fs = require("fs");
const path = require("path");

// フェーズ順序とファイル名の正本マッピング (.claude/goal/ 配下)
const DEFAULT_SEQ = ["monitor", "development", "verify", "improvement"];
const FILE_MAP = {
  monitor: "10-monitor.md",
  development: "20-development.md",
  verify: "30-verify.md",
  improvement: "40-improvement.md",
};

// /goal 本文の字数制約 (Claude Code CLI: Goal condition is limited to 4000 characters)
const GOAL_CHAR_FAIL = 4000;
const GOAL_CHAR_WARN = 3800;

// verify-goal-set.js と共有するフェーズ別必須キーワード。
// mission は従来の 11 キーワードを維持 (後方互換)。
const PHASE_COMMON_KEYWORDS = [
  "Supervisor",
  "Completion Criteria",
  "phase_done",
  "Session Handoff",
  "security",
];
const PHASE_KEYWORDS = {
  mission: [
    "Supervisor", "Monitor", "Verify", "Agent Teams", "Dynamic Workflows",
    "README", "GitHub Projects", "security", "CodeRabbit",
    "Completion Criteria", "Release Ready",
  ],
  monitor: [...PHASE_COMMON_KEYWORDS, "Monitor", "Issue"],
  development: [...PHASE_COMMON_KEYWORDS, "Development", "Agent Teams"],
  verify: [...PHASE_COMMON_KEYWORDS, "Verify", "STABLE", "CodeRabbit"],
  improvement: [...PHASE_COMMON_KEYWORDS, "Improvement", "README"],
};

const HISTORY_LIMIT = 20;

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

// goal_rotation を既定値で補完する (state.json 欠損フィールドに fail-soft)
function ensureRotation(state) {
  if (!state.goal_rotation || typeof state.goal_rotation !== "object") {
    state.goal_rotation = {};
  }
  const rot = state.goal_rotation;
  if (rot.mode !== "phase" && rot.mode !== "mission") rot.mode = "phase";
  if (!DEFAULT_SEQ.includes(rot.current)) rot.current = DEFAULT_SEQ[0];
  if (!Array.isArray(rot.sequence) || rot.sequence.length === 0 ||
      !rot.sequence.every((p) => DEFAULT_SEQ.includes(p))) {
    rot.sequence = [...DEFAULT_SEQ];
  }
  if (typeof rot.phase_done !== "boolean") rot.phase_done = false;
  if (rot.phase_done_at === undefined) rot.phase_done_at = null;
  if (!Number.isInteger(rot.retry_count) || rot.retry_count < 0) rot.retry_count = 0;
  if (!Number.isInteger(rot.max_retries) || rot.max_retries < 0) rot.max_retries = 2;
  if (rot.on_retry_exhausted !== "block") rot.on_retry_exhausted = "advance";
  if (typeof rot.blocked !== "boolean") rot.blocked = false;
  if (!Number.isInteger(rot.cycle_count) || rot.cycle_count < 0) rot.cycle_count = 0;
  if (rot.last_advanced_at === undefined) rot.last_advanced_at = null;
  if (rot.last_outcome === undefined) rot.last_outcome = null;
  if (rot.last_finalized_session === undefined) rot.last_finalized_session = null;
  if (!Array.isArray(rot.history)) rot.history = [];
  return rot;
}

function pushWarning(state, kind, message, extra) {
  state.warnings = Array.isArray(state.warnings) ? state.warnings : [];
  state.warnings.push({
    at: new Date().toISOString(),
    kind,
    message,
    ...(extra || {}),
  });
}

// ポインタを 1 フェーズ前進する。improvement → monitor で cycle_count++。
// phase_done のリセットも同一オブジェクト内で行い、不整合を構造的に防ぐ。
function advance(rot, outcome, via) {
  const seq = rot.sequence;
  const i = seq.indexOf(rot.current);
  let next;
  let wrapped = false;
  if (i < 0) {
    next = seq[0]; // current が sequence 外 → 先頭へリセット (周回加算なし)
  } else {
    next = seq[(i + 1) % seq.length];
    wrapped = i + 1 >= seq.length;
  }
  if (wrapped) rot.cycle_count += 1;
  rot.history.unshift({
    at: new Date().toISOString(),
    from: rot.current,
    to: next,
    outcome,
    via: via || "finalize",
  });
  if (rot.history.length > HISTORY_LIMIT) rot.history.length = HISTORY_LIMIT;
  rot.current = next;
  rot.phase_done = false;
  rot.phase_done_at = null;
  rot.retry_count = 0;
  rot.last_advanced_at = new Date().toISOString();
  rot.last_outcome = outcome;
  return { outcome, next, wrapped };
}

// finalize: セッション終了後にポインタ前進を判定する (launcher §8 から呼ばれる)
function finalize(state, opts) {
  const rot = ensureRotation(state);
  const status = opts.status || "completed";
  const sessionId = opts.sessionId || null;

  if (rot.mode !== "phase") return { outcome: "noop", reason: "mission-mode" };
  if (sessionId && rot.last_finalized_session === sessionId) {
    return { outcome: "noop", reason: "already-finalized" }; // 冪等ガード
  }
  if (sessionId) rot.last_finalized_session = sessionId;

  if (rot.phase_done === true) {
    return advance(rot, "advanced");
  }
  if (status === "failed") {
    // claude 起動失敗等のインフラ障害は retry 予算を消費しない。
    // 再起動制御は supervisor の failureCount が担当する。
    rot.last_outcome = "crash";
    return { outcome: "crash" };
  }

  rot.retry_count += 1;
  if (rot.retry_count <= rot.max_retries) {
    rot.last_outcome = "retry";
    return { outcome: "retry", phase: rot.current, retry: rot.retry_count, max: rot.max_retries };
  }

  if (rot.on_retry_exhausted === "block") {
    rot.blocked = true;
    rot.last_outcome = "blocked";
    pushWarning(state, "goal_rotation_blocked",
      `フェーズ ${rot.current} がリトライ上限 (${rot.max_retries}) を超過したため blocked。` +
      "goal_rotation.blocked=false へ戻すか phase_done=true で解除してください。",
      { phase: rot.current });
    return { outcome: "blocked", phase: rot.current };
  }

  pushWarning(state, "goal_rotation_forced_advance",
    `フェーズ ${rot.current} が Completion Criteria 未達のままリトライ上限 (${rot.max_retries}) を超過。` +
    "次フェーズへ強制前進しました。未達項目は次周回で回収してください。",
    { phase: rot.current });
  return advance(rot, "forced-advance");
}

// catchup: 前回 finalize 前にプロセスが死んだ場合の phase_done=true 取り残しを
// 起動時に前進消化する (launcher §5 から呼ばれる)
function catchup(state) {
  const rot = ensureRotation(state);
  if (rot.mode !== "phase") return { outcome: "noop", reason: "mission-mode" };
  if (rot.phase_done !== true) return { outcome: "noop", reason: "no-pending" };
  return advance(rot, "advanced", "catchup");
}

// validate: goal ファイルが /goal 自動実行可能かつ 4000 字以内かを検査する
function validateGoalFile(content) {
  if (!content.startsWith('/goal "')) {
    return { ok: false, code: 7, reason: 'ファイルが /goal " で始まっていません (自動実行不可形式)' };
  }
  const lastQuote = content.lastIndexOf('"');
  const inner = content.slice('/goal "'.length, lastQuote > 7 ? lastQuote : content.length);
  const length = inner.length;
  if (length > GOAL_CHAR_FAIL) {
    return { ok: false, code: 6, length, reason: `/goal 本文が ${GOAL_CHAR_FAIL} 字を超過 (${length} 字)` };
  }
  return { ok: true, code: 0, length, warn: length > GOAL_CHAR_WARN };
}

// ── CLI ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--manual") args.manual = true;
    else if (a.startsWith("--")) { args[a.slice(2)] = argv[i + 1]; i++; }
    else args._.push(a);
  }
  return args;
}

function loadState(stateFile) {
  if (!fs.existsSync(stateFile)) return null;
  return readJson(stateFile);
}

const OUTCOME_EXIT = {
  noop: 0, crash: 0, advanced: 10, retry: 11, "forced-advance": 12, blocked: 13,
};

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  const stateFile = args.state
    ? path.resolve(args.state)
    : path.join(process.cwd(), "state.json");

  if (cmd === "validate") {
    if (!args.file || !fs.existsSync(args.file)) {
      console.log(`[GoalRotation] ❌ validate: ファイルが見つかりません: ${args.file || "(未指定)"}`);
      process.exit(5);
    }
    const content = fs.readFileSync(args.file, "utf8");
    const v = validateGoalFile(content);
    if (!v.ok) {
      console.log(`[GoalRotation] ❌ validate NG: ${v.reason} (${path.basename(args.file)})`);
      process.exit(v.code);
    }
    if (v.warn) {
      console.log(`[GoalRotation] ⚠️ validate WARN: /goal 本文 ${v.length} 字 (警告閾値 ${GOAL_CHAR_WARN} 字超過、上限 ${GOAL_CHAR_FAIL} 字)`);
    } else {
      console.log(`[GoalRotation] ✅ validate OK: /goal 本文 ${v.length} 字 (上限 ${GOAL_CHAR_FAIL} 字)`);
    }
    process.exit(0);
  }

  const state = loadState(stateFile);
  if (!state) {
    console.log(`[GoalRotation] state.json なし — noop (${stateFile})`);
    process.exit(0);
  }

  let result;
  try {
    if (cmd === "finalize") {
      result = finalize(state, { status: args.status, sessionId: args.session });
    } else if (cmd === "catchup") {
      result = catchup(state);
    } else if (cmd === "advance" && args.manual) {
      const rot = ensureRotation(state);
      if (rot.phase_done !== true) {
        console.log("[GoalRotation] ⚠️ advance --manual: phase_done=false のため前進不可。" +
          "Completion Criteria 充足後に goal_rotation.phase_done=true を設定してから再実行してください。");
        process.exit(2);
      }
      result = advance(rot, "advanced", "manual");
    } else {
      console.log("[GoalRotation] usage: goal-rotation.js <finalize|catchup|validate|advance --manual> [options]");
      process.exit(5);
    }
    writeJsonAtomic(stateFile, state);
  } catch (err) {
    console.error(`[GoalRotation] ❌ ${cmd} failed: ${err.message}`);
    process.exit(5);
  }

  const rot = state.goal_rotation || {};
  switch (result.outcome) {
    case "advanced":
      console.log(`[GoalRotation] ✅ advanced: → ${result.next} (cycle=${rot.cycle_count})`);
      break;
    case "forced-advance":
      console.log(`[GoalRotation] ⚠️ forced-advance: → ${result.next} (リトライ枯渇、cycle=${rot.cycle_count})`);
      break;
    case "retry":
      console.log(`[GoalRotation] 🔁 retry: ${result.phase} を再走 (${result.retry}/${result.max})`);
      break;
    case "blocked":
      console.log(`[GoalRotation] 🚨 blocked: ${result.phase} がリトライ枯渇 (on_retry_exhausted=block)`);
      break;
    case "crash":
      console.log("[GoalRotation] 💥 crash: 起動失敗のため retry 非課金 (supervisor failureCount が担当)");
      break;
    default:
      console.log(`[GoalRotation] noop (${result.reason || ""})`);
  }
  process.exit(OUTCOME_EXIT[result.outcome] ?? 0);
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_SEQ,
  FILE_MAP,
  PHASE_KEYWORDS,
  GOAL_CHAR_FAIL,
  GOAL_CHAR_WARN,
  ensureRotation,
  finalize,
  catchup,
  advance,
  validateGoalFile,
};
