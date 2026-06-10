#!/usr/bin/env node
// SessionStart hook (ClaudeOS v10.6)
// アクティブな /goal 本文 (phase モード: .claude/goal/<phase>.md、mission モード:
// START_PROMPT.md) を抽出し、テンプレ整合性チェックと手動起動時のコピー元として提示する。
//
// 重要な背景:
// - 通常運用 (start.bat → Start-ClaudeCode.ps1 経由): START_PROMPT.md 全文が
//   `& claude @args` で claude に渡され、冒頭 /goal は Claude Code UI が
//   自動実行する。ユーザーは何もしなくてよい。
// - AutoRun phase モード (Start-ClaudeAutoTimeout.ps1): state.json の
//   goal_rotation.current に対応する .claude/goal/<NN-phase>.md が注入される。
// - 手動運用 (`claude` を直接起動): このリマインダがユーザーへのコピー元として機能する。
//
// 設計方針:
//  - state.json の goal_rotation を読んでアクティブな goal ファイルを解決する
//  - フェーズ別必須キーワード (goal-rotation.js の PHASE_KEYWORDS と共有) をチェック
//  - /goal 本文の字数 (4000 字制限) をレポートする
//  - hook 出力は Claude にも見えるため、Claude は /goal の現在内容を把握できる
//  - /goal の実行自体は Skill ツール経由不可 (UI コマンド仕様)

const fs = require("fs");
const path = require("path");

// goal-rotation.js から正本のキーワード/字数定数を取得する (単一正本)。
// 配布漏れ環境でも hook を壊さないよう内蔵フォールバックを持つ。
let PHASE_KEYWORDS, GOAL_CHAR_FAIL, GOAL_CHAR_WARN, FILE_MAP;
try {
  const rotation = require("./goal-rotation.js");
  PHASE_KEYWORDS = rotation.PHASE_KEYWORDS;
  GOAL_CHAR_FAIL = rotation.GOAL_CHAR_FAIL;
  GOAL_CHAR_WARN = rotation.GOAL_CHAR_WARN;
  FILE_MAP = rotation.FILE_MAP;
} catch {
  GOAL_CHAR_FAIL = 4000;
  GOAL_CHAR_WARN = 3800;
  FILE_MAP = {
    monitor: "10-monitor.md",
    development: "20-development.md",
    verify: "30-verify.md",
    improvement: "40-improvement.md",
  };
  const common = ["Supervisor", "Completion Criteria", "phase_done", "Session Handoff", "security"];
  PHASE_KEYWORDS = {
    mission: [
      "Supervisor", "Monitor", "Verify", "Agent Teams", "Dynamic Workflows",
      "README", "GitHub Projects", "security", "CodeRabbit",
      "Completion Criteria", "Release Ready",
    ],
    monitor: [...common, "Monitor", "Issue"],
    development: [...common, "Development", "Agent Teams"],
    verify: [...common, "Verify", "STABLE", "CodeRabbit"],
    improvement: [...common, "Improvement", "README"],
  };
}

const START_PROMPT_CANDIDATES = [
  "Claude/templates/claude/START_PROMPT.md",
  ".claude/START_PROMPT.md",
  "START_PROMPT.md",
];

// state.json の goal_rotation からアクティブな goal ファイルとフェーズ名を解決する。
// phase モードで goal ファイルが見つからない場合は mission (START_PROMPT) に縮退する。
function resolveActiveGoal() {
  let rot = null;
  try {
    const state = JSON.parse(fs.readFileSync(path.join(process.cwd(), "state.json"), "utf8"));
    rot = state.goal_rotation || null;
  } catch { /* state 無し → mission */ }

  if (rot && rot.mode === "phase") {
    const phase = FILE_MAP[rot.current] ? rot.current : "monitor";
    const goalFile = path.join(process.cwd(), ".claude", "goal", FILE_MAP[phase]);
    if (fs.existsSync(goalFile)) {
      return { phase, file: goalFile, mode: "phase", cycle: rot.cycle_count ?? 0 };
    }
  }
  for (const rel of START_PROMPT_CANDIDATES) {
    const abs = path.join(process.cwd(), rel);
    if (fs.existsSync(abs)) return { phase: "mission", file: abs, mode: "mission", cycle: null };
  }
  return null;
}

function extractGoalLine(content) {
  // 優先 1: ファイル冒頭が /goal "..." で始まる場合（自動実行用の正規形式）
  // 優先 2: フェンス付きコードブロック内の /goal "..."（後方互換）
  // 短すぎる "..." プレースホルダは除外。
  function tryExtractFrom(text, startIdx) {
    let i = startIdx + '/goal "'.length;
    let escaped = false;
    while (i < text.length) {
      const c = text[i];
      if (escaped) { escaped = false; i++; continue; }
      if (c === '\\') { escaped = true; i++; continue; }
      if (c === '"') {
        const candidate = text.slice(startIdx, i + 1);
        return candidate.length > 20 ? candidate : null;
      }
      i++;
    }
    return null;
  }

  // 優先 1: 冒頭の /goal "..." (launcher 経由で自動実行される位置)
  if (content.startsWith('/goal "')) {
    const result = tryExtractFrom(content, 0);
    if (result) return result;
  }

  // 優先 2: フェンス付きコードブロック内 (旧形式の後方互換)
  const fenceRe = /```[a-zA-Z]*\r?\n([\s\S]*?)```/g;
  let m;
  while ((m = fenceRe.exec(content)) !== null) {
    const block = m[1];
    const idx = block.indexOf('/goal "');
    if (idx < 0) continue;
    const result = tryExtractFrom(block, idx);
    if (result) return result;
  }
  return null;
}

const active = resolveActiveGoal();
if (!active) {
  console.log("[verify-goal-set] goal ファイル / START_PROMPT.md が見つかりません — skip");
  process.exit(0);
}

let content;
try {
  content = fs.readFileSync(active.file, "utf8");
} catch (e) {
  console.log(`[verify-goal-set] read failed: ${e.message}`);
  process.exit(0);
}

const goalLine = extractGoalLine(content);
if (!goalLine) {
  console.log(`[verify-goal-set] ⚠️ ${path.basename(active.file)} に /goal \"...\" ブロックが見つかりません`);
  console.log(`  確認対象: ${active.file}`);
  process.exit(0);
}

const keywords = PHASE_KEYWORDS[active.phase] || PHASE_KEYWORDS.mission;
const missing = keywords.filter((kw) => !goalLine.includes(kw));
// 字数: /goal " と末尾 " を除いた本文を計測する (Claude Code CLI の 4000 字制限)
const innerLength = Math.max(0, goalLine.length - '/goal "'.length - 1);

const phaseLabel = active.mode === "phase"
  ? `phase=${active.phase} (cycle=${active.cycle})`
  : "mission";
console.log(`[verify-goal-set] 🔒 アクティブ /goal 整合性チェック [${phaseLabel}]`);
console.log("");
console.log("  start.bat / AutoRun 経由起動時: 冒頭 /goal は Claude Code 本体が自動実行します。");
console.log("  手動 claude 起動時:   以下を対話プロンプトにコピー＆Enter してください:");
console.log("");
console.log(`  ───────── /goal (${phaseLabel}) ─────────`);
goalLine.split(/\r?\n/).forEach((line) => console.log(`  ${line}`));
console.log("  ─────────  END  /goal  ─────────");
console.log("");

if (missing.length > 0) {
  console.log(`  ⚠️ テンプレ整合性警告: 必須キーワード欠落 = ${missing.join(", ")}`);
  console.log(`     → ${path.basename(active.file)} の /goal 文面を見直してください`);
} else {
  console.log(`  ✅ 必須キーワード ${keywords.length}/${keywords.length} 整合`);
}

if (innerLength > GOAL_CHAR_FAIL) {
  console.log(`  🚨 字数超過: /goal 本文 ${innerLength} 字 > 上限 ${GOAL_CHAR_FAIL} 字 (自動実行が失敗します)`);
} else if (innerLength > GOAL_CHAR_WARN) {
  console.log(`  ⚠️ 字数警告: /goal 本文 ${innerLength} 字 (警告閾値 ${GOAL_CHAR_WARN} / 上限 ${GOAL_CHAR_FAIL})`);
} else {
  console.log(`  📏 字数: /goal 本文 ${innerLength} 字 (上限 ${GOAL_CHAR_FAIL} 字)`);
}

console.log("");
console.log("  Note: /goal は Claude Code UI コマンドのため Skill ツールから実行不可。");
console.log("        Claude は本リマインダを参考に /goal の現在内容を把握できる。");

process.exit(0);
