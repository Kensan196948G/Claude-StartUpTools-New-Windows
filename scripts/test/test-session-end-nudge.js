'use strict';
// test-session-end-nudge.js — session-end.js v10.7 Continuation Nudge unit test
// テンプレ正本の session-end.js を一時ディレクトリへ単体コピーして実行する。
// 兄弟モジュール (quality-gate-check.js 等) の require は fail-soft 設計のため
// 欠如していてもよく、repo 内 data/ への書き込み副作用を避けられる。

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawnSync } = require('child_process');

const HOOK_SRC = path.resolve(__dirname, '..', '..',
  'Claude', 'templates', 'claudeos', 'scripts', 'hooks', 'session-end.js');

function fatal(msg) { process.stderr.write(`FAIL: ${msg}\n`); process.exit(1); }
function assert(cond, msg) { if (!cond) fatal(msg); }

const tmp      = fs.mkdtempSync(path.join(os.tmpdir(), 'sess-end-nudge-'));
const hooksDir = path.join(tmp, 'hooks');
const projDir  = path.join(tmp, 'project');
fs.mkdirSync(hooksDir, { recursive: true });
fs.mkdirSync(projDir, { recursive: true });
fs.copyFileSync(HOOK_SRC, path.join(hooksDir, 'session-end.js'));

function writeState(rot) {
  fs.writeFileSync(path.join(projDir, 'state.json'),
    JSON.stringify({ goal_rotation: rot }, null, 2), 'utf8');
}
function readState() {
  return JSON.parse(fs.readFileSync(path.join(projDir, 'state.json'), 'utf8'));
}
function runHook(input, env) {
  return spawnSync(process.execPath, [path.join(hooksDir, 'session-end.js')], {
    cwd: projDir,
    input: JSON.stringify(input || {}),
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 30000,
  });
}
function tryParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// Case 1: phase 未達 + CLAUDEOS_GOAL_MODE=phase → stdout は nudge JSON のみ
writeState({ mode: 'phase', current: 'development', phase_done: false });
let r = runHook({ session_id: 'sess-A' }, { CLAUDEOS_GOAL_MODE: 'phase' });
assert(r.status === 0, `case1: exit ${r.status} stderr=${r.stderr}`);
let payload = tryParse(r.stdout);
assert(payload, `case1: stdout must be pure JSON, got: ${JSON.stringify(r.stdout)}`);
assert(payload.hookSpecificOutput?.hookEventName === 'Stop', 'case1: hookEventName should be Stop');
assert(typeof payload.hookSpecificOutput.additionalContext === 'string'
  && payload.hookSpecificOutput.additionalContext.includes('phase_done'),
  'case1: additionalContext should mention phase_done');
assert(r.stderr.includes('[SessionEnd]'), 'case1: normal logs should be diverted to stderr');
let st = readState();
assert(st.goal_rotation.nudge.count === 1 && st.goal_rotation.nudge.session_id === 'sess-A',
  'case1: nudge counter should be {sess-A, 1}');

// Case 2: 同一セッション 2 回目 → まだ nudge (count=2)
r = runHook({ session_id: 'sess-A' }, { CLAUDEOS_GOAL_MODE: 'phase' });
payload = tryParse(r.stdout);
assert(payload?.hookSpecificOutput?.additionalContext, 'case2: second stop should still nudge');
assert(readState().goal_rotation.nudge.count === 2, 'case2: count should be 2');

// Case 3: 3 回目 → 上限到達で nudge しない (stdout は通常ログ)
r = runHook({ session_id: 'sess-A' }, { CLAUDEOS_GOAL_MODE: 'phase' });
assert(r.status === 0, 'case3: exit 0');
payload = tryParse(r.stdout);
assert(!(payload && payload.hookSpecificOutput), 'case3: must not emit nudge JSON after max_nudges');
assert(readState().goal_rotation.nudge.count === 2, 'case3: count should stay 2');

// Case 4: 別セッション ID → カウンタがリセットされ再 nudge
r = runHook({ session_id: 'sess-B' }, { CLAUDEOS_GOAL_MODE: 'phase' });
payload = tryParse(r.stdout);
assert(payload?.hookSpecificOutput?.additionalContext, 'case4: new session should nudge again');
st = readState();
assert(st.goal_rotation.nudge.session_id === 'sess-B' && st.goal_rotation.nudge.count === 1,
  'case4: counter should reset for new session');

// Case 5: phase_done=true → nudge せず phase_done_at を記録
writeState({ mode: 'phase', current: 'verify', phase_done: true });
r = runHook({ session_id: 'sess-C' }, { CLAUDEOS_GOAL_MODE: 'phase' });
payload = tryParse(r.stdout);
assert(!(payload && payload.hookSpecificOutput), 'case5: must not nudge when phase_done=true');
st = readState();
assert(typeof st.goal_rotation.phase_done_at === 'string', 'case5: phase_done_at should be recorded');

// Case 6: CLAUDEOS_GOAL_MODE 未設定 (手動/mission セッション) → nudge しない
writeState({ mode: 'phase', current: 'monitor', phase_done: false });
const cleanEnv = { ...process.env };
delete cleanEnv.CLAUDEOS_GOAL_MODE;
r = spawnSync(process.execPath, [path.join(hooksDir, 'session-end.js')], {
  cwd: projDir, input: JSON.stringify({ session_id: 'sess-D' }),
  encoding: 'utf8', env: cleanEnv, timeout: 30000,
});
payload = tryParse(r.stdout);
assert(!(payload && payload.hookSpecificOutput), 'case6: must not nudge outside phase AutoRun');

// Case 7: blocked=true → nudge しない
writeState({ mode: 'phase', current: 'monitor', phase_done: false, blocked: true });
r = runHook({ session_id: 'sess-E' }, { CLAUDEOS_GOAL_MODE: 'phase' });
payload = tryParse(r.stdout);
assert(!(payload && payload.hookSpecificOutput), 'case7: must not nudge when blocked');

fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write('PASS: session-end continuation nudge (7 cases)\n');
