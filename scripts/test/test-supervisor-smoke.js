'use strict';
// test-supervisor-smoke.js — CI smoke test for supervisor-daemon.js
// Spawns the daemon with a minimal session-file config (no subprocess side effects),
// verifies state.json is written with the correct structure, then kills it.
// Runs on both Linux (ubuntu CI) and Windows.

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawn } = require('child_process');

const DAEMON     = path.resolve(__dirname, '..', 'dashboards', 'supervisor-daemon.js');
const TIMEOUT_MS = 6000;

function fatal(msg) {
  process.stderr.write(`FAIL: ${msg}\n`);
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) fatal(msg);
}

async function run() {
  // ── Temp workspace ─────────────────────────────────────────────────────────
  const tmpDir    = fs.mkdtempSync(path.join(os.tmpdir(), 'sup-smoke-'));
  const procsCfg  = path.join(tmpDir, 'processes.json');
  const stateFile = path.join(tmpDir, 'state.json');

  // ── Minimal config: session-file only (daemon reads files, never spawns) ──
  const cfg = {
    version: '1.0.0',
    processes: [
      {
        id: 'smoke-session',
        type: 'session-file',
        name: 'Smoke Test Session',
        sessionDir: tmpDir,
        staleMinutes: 60,
        enabled: true,
      },
    ],
  };
  fs.writeFileSync(procsCfg, JSON.stringify(cfg, null, 2), 'utf8');

  // ── Spawn daemon ───────────────────────────────────────────────────────────
  const child = spawn(process.execPath, [DAEMON], {
    env: {
      ...process.env,
      SUPERVISOR_PROCESSES_CFG: procsCfg,
      SUPERVISOR_STATE_DIR:     tmpDir,
      SUPERVISOR_STATE_FILE:    stateFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', d => { output += d; });
  child.stderr.on('data', d => { output += d; });

  // ── Wait for initial state.json (written at startup before first tick) ────
  const deadline = Date.now() + TIMEOUT_MS;
  while (!fs.existsSync(stateFile) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 50));
  }

  // ── Terminate daemon ───────────────────────────────────────────────────────
  child.kill('SIGTERM');
  await new Promise(resolve => child.on('exit', resolve));

  // ── Validate state.json ────────────────────────────────────────────────────
  assert(fs.existsSync(stateFile), `state.json was not created within ${TIMEOUT_MS}ms`);

  let state;
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch (e) {
    fatal(`state.json is not valid JSON: ${e.message}`);
  }

  assert(state.version === '1.0.0', `expected version '1.0.0', got '${state.version}'`);
  assert(typeof state.generated === 'string' && state.generated.length > 0,
    'state.generated should be a non-empty ISO string');
  assert(typeof state.processes === 'object' && state.processes !== null,
    'state.processes should be an object');
  assert('smoke-session' in state.processes,
    "state.processes should contain 'smoke-session' entry");

  const entry = state.processes['smoke-session'];
  assert(typeof entry.status === 'string', 'process entry must have a status field');
  assert(entry.type === 'session-file', `expected type 'session-file', got '${entry.type}'`);
  assert(entry.name === 'Smoke Test Session', `unexpected name: ${entry.name}`);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // ── registered-project-autonomy: stable projects must not be restarted ────
  const autoTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sup-auto-smoke-'));
  const projectDir = path.join(autoTmpDir, 'StableProject');
  const sessionsDir = path.join(autoTmpDir, 'sessions');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'state.json'), JSON.stringify({
    stable: { stable_achieved: true },
  }, null, 2), 'utf8');

  const registryFile = path.join(autoTmpDir, 'registered-projects.json');
  fs.writeFileSync(registryFile, JSON.stringify([
    {
      name: 'StableProject',
      path: projectDir,
      supervisorEnabled: true,
      durationMinutes: 300,
    },
  ], null, 2), 'utf8');

  const autoCfg = path.join(autoTmpDir, 'processes.json');
  const autoStateFile = path.join(autoTmpDir, 'state.json');
  fs.writeFileSync(autoCfg, JSON.stringify({
    version: '1.0.0',
    processes: [
      {
        id: 'registered-project-autonomy',
        type: 'registered-project-autonomy',
        name: 'Registered Project Autonomy',
        registryFile,
        sessionDir: sessionsDir,
        launcher: path.join(autoTmpDir, 'missing-launcher.ps1'),
        maxConcurrent: 1,
        restartCooldownMinutes: 1,
        maxRestartsPerProject: 2,
        enabled: true,
      },
    ],
  }, null, 2), 'utf8');

  const autoChild = spawn(process.execPath, [DAEMON], {
    env: {
      ...process.env,
      SUPERVISOR_PROCESSES_CFG: autoCfg,
      SUPERVISOR_STATE_DIR:     autoTmpDir,
      SUPERVISOR_STATE_FILE:    autoStateFile,
      SUPERVISOR_CHECK_INTERVAL_MS: '500',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const autoDeadline = Date.now() + TIMEOUT_MS;
  let autoState = null;
  while (Date.now() < autoDeadline) {
    if (fs.existsSync(autoStateFile)) {
      try {
        autoState = JSON.parse(fs.readFileSync(autoStateFile, 'utf8'));
        const proj = autoState.processes?.['registered-project-autonomy']?.projects?.StableProject;
        if (proj?.status === 'goal-reached') break;
      } catch {}
    }
    await new Promise(r => setTimeout(r, 50));
  }

  autoChild.kill('SIGTERM');
  await new Promise(resolve => autoChild.on('exit', resolve));

  const autoEntry = autoState?.processes?.['registered-project-autonomy'];
  assert(autoEntry, 'registered-project-autonomy state entry should exist');
  assert(autoEntry.status === 'watching', `expected autonomy status 'watching', got '${autoEntry.status}'`);
  assert(autoEntry.maxConcurrent === 1, 'maxConcurrent should be exposed in supervisor state');
  assert(autoEntry.maxRestartsPerProject === 2, 'maxRestartsPerProject should be exposed in supervisor state');

  const stableProject = autoEntry.projects?.StableProject;
  assert(stableProject, 'StableProject state should be exposed');
  assert(stableProject.status === 'goal-reached', `expected StableProject goal-reached, got '${stableProject.status}'`);
  assert(stableProject.reason === 'stable-achieved', `expected stable-achieved reason, got '${stableProject.reason}'`);
  assert(!stableProject.pid, 'stable project should not be launched');

  fs.rmSync(autoTmpDir, { recursive: true, force: true });

  // ── v10.6 Goal Rotation: blocked プロジェクトは再起動しない ────────────────
  const blkTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sup-blk-smoke-'));
  const blkProjectDir = path.join(blkTmpDir, 'BlockedProject');
  const blkSessionsDir = path.join(blkTmpDir, 'sessions');
  fs.mkdirSync(blkProjectDir, { recursive: true });
  fs.mkdirSync(blkSessionsDir, { recursive: true });
  fs.writeFileSync(path.join(blkProjectDir, 'state.json'), JSON.stringify({
    goal_rotation: { mode: 'phase', current: 'development', blocked: true, cycle_count: 1 },
  }, null, 2), 'utf8');

  const blkRegistry = path.join(blkTmpDir, 'registered-projects.json');
  fs.writeFileSync(blkRegistry, JSON.stringify([
    { name: 'BlockedProject', path: blkProjectDir, supervisorEnabled: true, durationMinutes: 300 },
  ], null, 2), 'utf8');

  const blkCfg = path.join(blkTmpDir, 'processes.json');
  const blkStateFile = path.join(blkTmpDir, 'state.json.supervisor');
  fs.writeFileSync(blkCfg, JSON.stringify({
    version: '1.0.0',
    processes: [{
      id: 'registered-project-autonomy',
      type: 'registered-project-autonomy',
      name: 'Registered Project Autonomy',
      registryFile: blkRegistry,
      sessionDir: blkSessionsDir,
      launcher: path.join(blkTmpDir, 'missing-launcher.ps1'),
      maxConcurrent: 1,
      restartCooldownMinutes: 1,
      maxRestartsPerProject: 6,
      enabled: true,
    }],
  }, null, 2), 'utf8');

  const blkChild = spawn(process.execPath, [DAEMON], {
    env: {
      ...process.env,
      SUPERVISOR_PROCESSES_CFG: blkCfg,
      SUPERVISOR_STATE_DIR:     blkTmpDir,
      SUPERVISOR_STATE_FILE:    blkStateFile,
      SUPERVISOR_CHECK_INTERVAL_MS: '500',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const blkDeadline = Date.now() + TIMEOUT_MS;
  let blkState = null;
  while (Date.now() < blkDeadline) {
    if (fs.existsSync(blkStateFile)) {
      try {
        blkState = JSON.parse(fs.readFileSync(blkStateFile, 'utf8'));
        const proj = blkState.processes?.['registered-project-autonomy']?.projects?.BlockedProject;
        if (proj?.status === 'blocked') break;
      } catch {}
    }
    await new Promise(r => setTimeout(r, 50));
  }

  blkChild.kill('SIGTERM');
  await new Promise(resolve => blkChild.on('exit', resolve));

  const blkProject = blkState?.processes?.['registered-project-autonomy']?.projects?.BlockedProject;
  assert(blkProject, 'BlockedProject state should be exposed');
  assert(blkProject.status === 'blocked', `expected BlockedProject blocked, got '${blkProject.status}'`);
  assert(blkProject.reason === 'goal-rotation-blocked',
    `expected goal-rotation-blocked reason, got '${blkProject.reason}'`);
  assert(blkProject.goalRotation?.blocked === true, 'goalRotation observability should expose blocked=true');
  assert(!blkProject.pid, 'blocked project should not be launched');

  fs.rmSync(blkTmpDir, { recursive: true, force: true });

  // ── v10.6: exit 124 (計画タイムアウト) は failureCount に課金しない ─────────
  //    偽 launcher (exit 124) を pwsh で実行し、AUTOEXIT 後の failureCount=0 を確認する。
  //    pwsh が無い環境 (純Linux CI の一部) ではスキップする。
  const { execSync } = require('child_process');
  let pwshAvailable = false;
  try { execSync('pwsh -NoProfile -Command "exit 0"', { stdio: 'ignore', timeout: 30000 }); pwshAvailable = true; } catch {}

  if (pwshAvailable) {
    const toTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sup-124-smoke-'));
    const toProjectDir = path.join(toTmpDir, 'TimeoutProject');
    const toSessionsDir = path.join(toTmpDir, 'sessions');
    fs.mkdirSync(toProjectDir, { recursive: true });
    fs.mkdirSync(toSessionsDir, { recursive: true });
    const fakeLauncher = path.join(toTmpDir, 'fake-launcher.ps1');
    fs.writeFileSync(fakeLauncher, 'exit 124\n', 'utf8');

    const toRegistry = path.join(toTmpDir, 'registered-projects.json');
    fs.writeFileSync(toRegistry, JSON.stringify([
      { name: 'TimeoutProject', path: toProjectDir, supervisorEnabled: true, durationMinutes: 1 },
    ], null, 2), 'utf8');

    const toCfg = path.join(toTmpDir, 'processes.json');
    const toStateFile = path.join(toTmpDir, 'state.json.supervisor');
    fs.writeFileSync(toCfg, JSON.stringify({
      version: '1.0.0',
      processes: [{
        id: 'registered-project-autonomy',
        type: 'registered-project-autonomy',
        name: 'Registered Project Autonomy',
        registryFile: toRegistry,
        sessionDir: toSessionsDir,
        launcher: fakeLauncher,
        maxConcurrent: 1,
        restartCooldownMinutes: 60,
        maxRestartsPerProject: 6,
        enabled: true,
      }],
    }, null, 2), 'utf8');

    const toChild = spawn(process.execPath, [DAEMON], {
      env: {
        ...process.env,
        SUPERVISOR_PROCESSES_CFG: toCfg,
        SUPERVISOR_STATE_DIR:     toTmpDir,
        SUPERVISOR_STATE_FILE:    toStateFile,
        SUPERVISOR_CHECK_INTERVAL_MS: '500',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // pwsh 起動に数秒かかるため余裕を持って待つ
    const toDeadline = Date.now() + 20000;
    let toState = null;
    while (Date.now() < toDeadline) {
      if (fs.existsSync(toStateFile)) {
        try {
          toState = JSON.parse(fs.readFileSync(toStateFile, 'utf8'));
          const proj = toState.processes?.['registered-project-autonomy']?.projects?.TimeoutProject;
          if (proj?.lastExitCode === 124) break;
        } catch {}
      }
      await new Promise(r => setTimeout(r, 100));
    }

    toChild.kill('SIGTERM');
    await new Promise(resolve => toChild.on('exit', resolve));

    const toProject = toState?.processes?.['registered-project-autonomy']?.projects?.TimeoutProject;
    assert(toProject, 'TimeoutProject state should be exposed');
    assert(toProject.lastExitCode === 124,
      `expected lastExitCode 124, got '${toProject?.lastExitCode}' (launcher did not run?)`);
    assert(toProject.failureCount === 0,
      `exit 124 must not increment failureCount, got ${toProject.failureCount}`);

    fs.rmSync(toTmpDir, { recursive: true, force: true });
  } else {
    process.stdout.write('SKIP: exit-124 scenario (pwsh not available)\n');
  }

  process.stdout.write('PASS: supervisor-daemon smoke test\n');
}

run().catch(e => fatal(e.stack || e.message));
