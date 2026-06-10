#!/usr/bin/env node
// test-goal-rotation.js — goal-rotation.js の単体テスト + goal テンプレ検査
//
// 実行: node scripts/test/test-goal-rotation.js
// 検証項目:
//   1. advanced       : phase_done=true → 次フェーズへ前進 (exit 10)
//   2. cycle wrap     : improvement → monitor で cycle_count++
//   3. retry          : 未達 completed → retry_count++ / current 不変 (exit 11)
//   4. forced-advance : リトライ枯渇 → 強制前進 + warning (exit 12)
//   5. blocked        : on_retry_exhausted=block → blocked=true (exit 13)
//   6. idempotent     : 同一セッション二重 finalize → 二度目は noop
//   7. crash          : status=failed → retry 非課金 (exit 0)
//   8. validate       : 4000字超過=exit 6 / 非 /goal 形式=exit 7 / 正常=exit 0
//   9. catchup        : phase_done=true 取り残し → 前進消化 (exit 10)
//  10. goal templates : 5枚すべて ≤3,800字 + PHASE_KEYWORDS 充足

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "Claude", "templates", "claudeos", "scripts", "hooks", "goal-rotation.js");
const GOAL_DIR = path.join(REPO_ROOT, "Claude", "templates", "claude", "goal");
const mod = require(CLI);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ❌ ${name}: ${err.message}`);
  }
}

function tmpState(rotation) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goal-rotation-test-"));
  const stateFile = path.join(dir, "state.json");
  fs.writeFileSync(stateFile, JSON.stringify({ goal: { title: "test" }, goal_rotation: rotation }, null, 2), "utf8");
  return { dir, stateFile };
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
}

function readState(stateFile) {
  return JSON.parse(fs.readFileSync(stateFile, "utf8"));
}

console.log("🧪 goal-rotation.js unit tests");

// 1. advanced
test("finalize: phase_done=true → advanced (exit 10)", () => {
  const { stateFile } = tmpState({ mode: "phase", current: "monitor", phase_done: true });
  const r = runCli(["finalize", "--status", "completed", "--session", "s1", "--state", stateFile]);
  assert.strictEqual(r.status, 10, `exit=${r.status} stdout=${r.stdout}`);
  const s = readState(stateFile);
  assert.strictEqual(s.goal_rotation.current, "development");
  assert.strictEqual(s.goal_rotation.phase_done, false);
  assert.strictEqual(s.goal_rotation.retry_count, 0);
  assert.strictEqual(s.goal_rotation.last_outcome, "advanced");
  assert.strictEqual(s.goal_rotation.history[0].from, "monitor");
});

// 2. cycle wrap
test("finalize: improvement → monitor で cycle_count++", () => {
  const { stateFile } = tmpState({ mode: "phase", current: "improvement", phase_done: true, cycle_count: 3 });
  const r = runCli(["finalize", "--status", "completed", "--session", "s1", "--state", stateFile]);
  assert.strictEqual(r.status, 10);
  const s = readState(stateFile);
  assert.strictEqual(s.goal_rotation.current, "monitor");
  assert.strictEqual(s.goal_rotation.cycle_count, 4);
});

// 3. retry
test("finalize: 未達 timeout → retry (exit 11, current 不変)", () => {
  const { stateFile } = tmpState({ mode: "phase", current: "verify", phase_done: false, max_retries: 2 });
  const r = runCli(["finalize", "--status", "timeout", "--session", "s1", "--state", stateFile]);
  assert.strictEqual(r.status, 11);
  const s = readState(stateFile);
  assert.strictEqual(s.goal_rotation.current, "verify");
  assert.strictEqual(s.goal_rotation.retry_count, 1);
});

// 4. forced-advance
test("finalize: リトライ枯渇 → forced-advance + warning (exit 12)", () => {
  const { stateFile } = tmpState({ mode: "phase", current: "development", phase_done: false, retry_count: 2, max_retries: 2 });
  const r = runCli(["finalize", "--status", "completed", "--session", "s1", "--state", stateFile]);
  assert.strictEqual(r.status, 12);
  const s = readState(stateFile);
  assert.strictEqual(s.goal_rotation.current, "verify");
  assert.ok(s.warnings.some((w) => w.kind === "goal_rotation_forced_advance"));
});

// 5. blocked
test("finalize: on_retry_exhausted=block → blocked (exit 13)", () => {
  const { stateFile } = tmpState({
    mode: "phase", current: "development", phase_done: false,
    retry_count: 2, max_retries: 2, on_retry_exhausted: "block",
  });
  const r = runCli(["finalize", "--status", "completed", "--session", "s1", "--state", stateFile]);
  assert.strictEqual(r.status, 13);
  const s = readState(stateFile);
  assert.strictEqual(s.goal_rotation.blocked, true);
  assert.strictEqual(s.goal_rotation.current, "development"); // 前進しない
  assert.ok(s.warnings.some((w) => w.kind === "goal_rotation_blocked"));
});

// 6. idempotent
test("finalize: 同一セッション二重実行 → 二度目は noop (二重前進なし)", () => {
  const { stateFile } = tmpState({ mode: "phase", current: "monitor", phase_done: true });
  const r1 = runCli(["finalize", "--status", "completed", "--session", "same", "--state", stateFile]);
  assert.strictEqual(r1.status, 10);
  // 二度目: phase_done を不正に true へ戻しても session ガードで noop
  const s1 = readState(stateFile);
  s1.goal_rotation.phase_done = true;
  fs.writeFileSync(stateFile, JSON.stringify(s1, null, 2), "utf8");
  const r2 = runCli(["finalize", "--status", "completed", "--session", "same", "--state", stateFile]);
  assert.strictEqual(r2.status, 0, `exit=${r2.status}`);
  assert.strictEqual(readState(stateFile).goal_rotation.current, "development");
});

// 7. crash 非課金
test("finalize: status=failed → crash (retry 非課金, exit 0)", () => {
  const { stateFile } = tmpState({ mode: "phase", current: "monitor", phase_done: false, retry_count: 1 });
  const r = runCli(["finalize", "--status", "failed", "--session", "s1", "--state", stateFile]);
  assert.strictEqual(r.status, 0);
  const s = readState(stateFile);
  assert.strictEqual(s.goal_rotation.retry_count, 1); // 消費されない
  assert.strictEqual(s.goal_rotation.current, "monitor");
});

// 7b. mission モード noop
test("finalize: mode=mission → noop (exit 0)", () => {
  const { stateFile } = tmpState({ mode: "mission", current: "monitor", phase_done: true });
  const r = runCli(["finalize", "--status", "completed", "--session", "s1", "--state", stateFile]);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(readState(stateFile).goal_rotation.current, "monitor");
});

// 8. validate
test("validate: 正常 /goal ファイル → exit 0", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goal-validate-"));
  const f = path.join(dir, "ok.md");
  fs.writeFileSync(f, '/goal "Phase: Test\nshort body\n"\n', "utf8");
  assert.strictEqual(runCli(["validate", "--file", f], dir).status, 0);
});

test("validate: 4000字超過 → exit 6", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goal-validate-"));
  const f = path.join(dir, "big.md");
  fs.writeFileSync(f, '/goal "' + "x".repeat(4001) + '"\n', "utf8");
  assert.strictEqual(runCli(["validate", "--file", f], dir).status, 6);
});

test("validate: /goal で始まらない → exit 7", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goal-validate-"));
  const f = path.join(dir, "bad.md");
  fs.writeFileSync(f, '# README\n/goal "body"\n', "utf8");
  assert.strictEqual(runCli(["validate", "--file", f], dir).status, 7);
});

// 9. catchup
test("catchup: phase_done=true 取り残し → 前進消化 (exit 10)", () => {
  const { stateFile } = tmpState({ mode: "phase", current: "verify", phase_done: true });
  const r = runCli(["catchup", "--state", stateFile]);
  assert.strictEqual(r.status, 10);
  const s = readState(stateFile);
  assert.strictEqual(s.goal_rotation.current, "improvement");
  assert.strictEqual(s.goal_rotation.history[0].via, "catchup");
});

test("catchup: phase_done=false → noop (exit 0)", () => {
  const { stateFile } = tmpState({ mode: "phase", current: "verify", phase_done: false });
  assert.strictEqual(runCli(["catchup", "--state", stateFile]).status, 0);
});

// 9b. advance --manual
test("advance --manual: phase_done=true → 前進 (exit 10)", () => {
  const { stateFile } = tmpState({ mode: "phase", current: "monitor", phase_done: true });
  const r = runCli(["advance", "--manual", "--state", stateFile]);
  assert.strictEqual(r.status, 10);
  assert.strictEqual(readState(stateFile).goal_rotation.history[0].via, "manual");
});

test("advance --manual: phase_done=false → exit 2", () => {
  const { stateFile } = tmpState({ mode: "phase", current: "monitor", phase_done: false });
  assert.strictEqual(runCli(["advance", "--manual", "--state", stateFile]).status, 2);
});

// state.json 欠損 → noop
test("finalize: state.json 欠損 → noop (exit 0)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goal-nostate-"));
  const r = runCli(["finalize", "--status", "completed", "--session", "s1", "--state", path.join(dir, "state.json")]);
  assert.strictEqual(r.status, 0);
});

// 10. goal テンプレ検査 (字数 + フェーズ別キーワード)
console.log("🧪 goal template checks");
const TEMPLATE_PHASES = [
  { file: "00-mission.md", phase: "mission" },
  { file: "10-monitor.md", phase: "monitor" },
  { file: "20-development.md", phase: "development" },
  { file: "30-verify.md", phase: "verify" },
  { file: "40-improvement.md", phase: "improvement" },
];

for (const t of TEMPLATE_PHASES) {
  test(`template ${t.file}: /goal 形式 + ≤${mod.GOAL_CHAR_WARN}字 + キーワード充足`, () => {
    const f = path.join(GOAL_DIR, t.file);
    assert.ok(fs.existsSync(f), `テンプレが存在しない: ${f}`);
    const content = fs.readFileSync(f, "utf8");
    const v = mod.validateGoalFile(content);
    assert.ok(v.ok, v.reason);
    assert.ok(v.length <= mod.GOAL_CHAR_WARN,
      `${v.length} 字 > 警告閾値 ${mod.GOAL_CHAR_WARN} 字 (上限 ${mod.GOAL_CHAR_FAIL})`);
    const missing = (mod.PHASE_KEYWORDS[t.phase] || []).filter((kw) => !content.includes(kw));
    assert.strictEqual(missing.length, 0, `必須キーワード欠落: ${missing.join(", ")}`);
  });
}

console.log("");
console.log(`📊 result: ${passed} passed / ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
