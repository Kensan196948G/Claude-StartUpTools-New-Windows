'use strict';
// supervisor-daemon.js — ClaudeOS Process Supervisor v1.0.0
// Node.js built-ins only (no npm deps). Win32 / Linux both supported.
// Reads:  config/processes.json
// Writes: ~/.claudeos/supervisor/state.json (atomically)
// Launched by: Task Scheduler (Windows) or systemd user service (Linux)

const fs   = require('fs');
const path = require('path');
const http = require('http');
const os   = require('os');
const { spawn } = require('child_process');

// ── Paths ────────────────────────────────────────────────────────────────────
const PROJ_ROOT      = path.resolve(__dirname, '..', '..');
const PROCESSES_CFG  = process.env.SUPERVISOR_PROCESSES_CFG || path.join(PROJ_ROOT, 'config', 'processes.json');
const SUPERVISOR_DIR = process.env.SUPERVISOR_STATE_DIR     || path.join(os.homedir(), '.claudeos', 'supervisor');
const STATE_FILE     = process.env.SUPERVISOR_STATE_FILE    || path.join(SUPERVISOR_DIR, 'state.json');

// ── Constants ────────────────────────────────────────────────────────────────
const CHECK_INTERVAL_MS  = parseInt(process.env.SUPERVISOR_CHECK_INTERVAL_MS || '8000', 10); // main loop cadence
const MAX_COOLDOWN_SEC   = 300;    // exponential backoff ceiling
const LOG_PREFIX         = '[supervisor]';

// ── Runtime state ─────────────────────────────────────────────────────────────
// processState: { [id]: ProcessEntry }
const processState = {};
// childHandles: { [id]: ChildProcess }
const childHandles = {};
const projectLastStart = {};
const projectStats = {};

// ── Logging ──────────────────────────────────────────────────────────────────
function log(msg) {
  process.stdout.write(`${LOG_PREFIX} ${new Date().toISOString()} ${msg}\n`);
}

// ── Path template expansion ──────────────────────────────────────────────────
function expandPath(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace('${PROJ_ROOT}', PROJ_ROOT)
    .replace('${HOME}', os.homedir())
    .replace('~', os.homedir());
}

function readJsonFile(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function latestSessionForProject(sessionDir, project) {
  try {
    if (!fs.existsSync(sessionDir)) return null;
    const files = fs.readdirSync(sessionDir).filter(f => f.endsWith('.json'));
    let latest = null;
    let latestTs = 0;
    for (const f of files) {
      const data = readJsonFile(path.join(sessionDir, f), null);
      if (!data || data.project !== project) continue;
      const ts = new Date(data.last_updated || data.start_time || 0).getTime();
      if (ts > latestTs) { latest = data; latestTs = ts; }
    }
    return latest;
  } catch {
    return null;
  }
}

function projectGoalReached(projectPath) {
  const state = readJsonFile(path.join(projectPath, 'state.json'), null);
  if (!state) return { reached: false, reason: '' };
  if (state.deploy?.ready === true) return { reached: true, reason: 'deploy-ready' };
  if (state.stable?.stable_achieved === true) return { reached: true, reason: 'stable-achieved' };
  const phaseMode = state.project?.phase_mode || state.maintenance?.phase_mode || '';
  if (phaseMode === 'maintenance') return { reached: true, reason: 'maintenance-mode' };
  if (phaseMode === 'released') return { reached: true, reason: 'released' };
  return { reached: false, reason: '' };
}

// ── Config loader ────────────────────────────────────────────────────────────
function loadConfig() {
  try {
    const raw = fs.readFileSync(PROCESSES_CFG, 'utf8');
    const cfg = JSON.parse(raw);
    return (cfg.processes || []).filter(p => p.enabled !== false);
  } catch (e) {
    log(`ERROR: cannot load ${PROCESSES_CFG}: ${e.message}`);
    return [];
  }
}

// ── Atomic state write ───────────────────────────────────────────────────────
function writeState() {
  try {
    if (!fs.existsSync(SUPERVISOR_DIR)) fs.mkdirSync(SUPERVISOR_DIR, { recursive: true });
    const snapshot = {
      version:   '1.0.0',
      generated: new Date().toISOString(),
      processes: processState,
    };
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) {
    log(`WARN: failed to write state: ${e.message}`);
  }
}

// ── PID liveness check ───────────────────────────────────────────────────────
function isPidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// ── HTTP health check (returns Promise<boolean>) ─────────────────────────────
function checkHttp(url) {
  return new Promise(resolve => {
    const timeout = setTimeout(() => { try { req.destroy(); } catch {} resolve(false); }, 4000);
    const req = http.get(url, res => {
      clearTimeout(timeout);
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on('error', () => { clearTimeout(timeout); resolve(false); });
  });
}

// ── Exponential backoff cooldown (seconds) ───────────────────────────────────
function cooldownSec(base, failures) {
  return Math.min(base * Math.pow(2, failures), MAX_COOLDOWN_SEC);
}

// ── Spawn managed process (type=http) ────────────────────────────────────────
function spawnProcess(cfg) {
  const id  = cfg.id;
  const cwd = expandPath(cfg.cwd || PROJ_ROOT);
  const args = (cfg.args || []).map(expandPath);
  log(`START  ${id}: ${cfg.command} ${args.join(' ')}`);

  const child = spawn(cfg.command, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  });

  const entry = processState[id];
  entry.pid       = child.pid;
  entry.startedAt = new Date().toISOString();
  entry.status    = 'starting';

  child.on('exit', (code, signal) => {
    const e = processState[id];
    if (!e) return;
    log(`EXIT   ${id}: code=${code} signal=${signal}`);
    delete childHandles[id];

    const now       = new Date();
    const uptimeSec = e.startedAt ? (now - new Date(e.startedAt)) / 1000 : 0;

    if (uptimeSec < (cfg.minUptimeSec || 10)) {
      e.consecutiveFailures = (e.consecutiveFailures || 0) + 1;
    } else {
      e.consecutiveFailures = 0;
    }
    e.restartCount = (e.restartCount || 0) + 1;
    e.status       = 'stopped';
    e.pid          = null;

    if (e.restartCount >= (cfg.maxRestarts || 10)) {
      log(`DISABLE ${id}: maxRestarts (${cfg.maxRestarts}) reached`);
      e.disabled = true;
      e.status   = 'disabled';
      writeState();
      return;
    }

    const delay = cooldownSec(cfg.backoffBaseSec || 5, e.consecutiveFailures) * 1000;
    const retryAt = new Date(now.getTime() + delay).toISOString();
    e.nextRetryAt = retryAt;
    log(`RETRY  ${id} in ${delay / 1000}s (failures=${e.consecutiveFailures})`);
    writeState();

    setTimeout(() => {
      const curr = processState[id];
      if (!curr || curr.disabled) return;
      childHandles[id] = spawnProcess(cfg);
    }, delay);
  });

  childHandles[id] = child;
  return child;
}

// ── Initialize process state entries ─────────────────────────────────────────
function initProcessState(configs) {
  for (const cfg of configs) {
    if (!processState[cfg.id]) {
      processState[cfg.id] = {
        id:                   cfg.id,
        type:                 cfg.type,
        name:                 cfg.name,
        status:               'unknown',
        pid:                  null,
        startedAt:            null,
        lastCheckedAt:        null,
        restartCount:         0,
        consecutiveFailures:  0,
        nextRetryAt:          null,
        disabled:             false,
      };
    }
  }
}

// ── Check loop (one tick per process) ────────────────────────────────────────
async function checkProcess(cfg) {
  const id    = cfg.id;
  const entry = processState[id];
  if (!entry) return;

  entry.lastCheckedAt = new Date().toISOString();

  // ── session-file type: observe only (no spawn) ──────────────────────────
  if (cfg.type === 'session-file') {
    const sessDir = expandPath(cfg.sessionDir || '');
    try {
      if (!fs.existsSync(sessDir)) { entry.status = 'idle'; entry.activeSession = null; return; }
      const files = fs.readdirSync(sessDir).filter(f => f.endsWith('.json'));
      let running = null;
      let newest  = 0;
      for (const f of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(sessDir, f), 'utf8'));
          if (data.status === 'running') {
            const ts = new Date(data.last_updated || data.start_time || 0).getTime();
            if (ts > newest) { newest = ts; running = data; }
          }
        } catch {}
      }
      if (!running) { entry.status = 'idle'; entry.activeSession = null; return; }

      const staleSec = (Date.now() - newest) / 1000;
      const staleLimit = (cfg.staleMinutes || 15) * 60;
      if (staleSec > staleLimit) {
        entry.status        = 'stale';
        entry.activeSession = { sessionId: running.sessionId, project: running.project, staleSec: Math.floor(staleSec) };
      } else {
        entry.status        = 'running';
        entry.activeSession = { sessionId: running.sessionId, project: running.project, staleSec: Math.floor(staleSec) };
      }
    } catch (e) {
      entry.status = 'unknown';
    }
    return;
  }

  // ── registered-project-autonomy: launch Windows auto sessions for all registered projects ──
  if (cfg.type === 'registered-project-autonomy') {
    const registryFile = expandPath(cfg.registryFile || path.join(os.homedir(), '.claudeos', 'registered-projects.json'));
    const sessionDir = expandPath(cfg.sessionDir || path.join(os.homedir(), '.claudeos', 'sessions'));
    const launcher = expandPath(cfg.launcher || path.join(PROJ_ROOT, 'scripts', 'main', 'Start-ClaudeAutoTimeout.ps1'));
    const maxConcurrent = cfg.maxConcurrent || 1;
    const cooldownMs = (cfg.restartCooldownMinutes || 10) * 60 * 1000;
    const maxRestartsPerProject = cfg.maxRestartsPerProject || 6;
    const entries = readJsonFile(registryFile, []);
    const enabled = Array.isArray(entries) ? entries.filter(p => p && p.supervisorEnabled !== false) : [];
    const projects = {};
    let runningCount = 0;

    for (const p of enabled) {
      const projectName = p.name;
      const handleKey = `${cfg.id}:${projectName}`;
      if (!projectStats[projectName]) {
        projectStats[projectName] = { restartCount: 0, failureCount: 0, lastExitCode: null, lastExitSignal: null, lastExitAt: null };
      }
      const stats = projectStats[projectName];
      const latest = latestSessionForProject(sessionDir, projectName);
      const child = childHandles[handleKey] || null;
      const childAlive = child ? isPidAlive(child.pid) : false;
      const running = latest?.status === 'running' || childAlive;
      if (running) runningCount += 1;
      const goal = projectGoalReached(p.path || '');
      projects[projectName] = {
        project: projectName,
        path: p.path || '',
        status: goal.reached ? 'goal-reached' : (running ? 'running' : 'idle'),
        reason: goal.reason || (running ? (latest?.status === 'running' ? 'active-session' : 'launcher-process-running') : ''),
        latestSession: latest?.sessionId || null,
        supervisorEnabled: p.supervisorEnabled !== false,
        durationMinutes: p.durationMinutes || 300,
        pid: child?.pid || null,
        restartCount: stats.restartCount,
        failureCount: stats.failureCount,
        lastExitCode: stats.lastExitCode,
        lastExitSignal: stats.lastExitSignal,
        lastExitAt: stats.lastExitAt,
        nextRetryAt: null,
      };

      if (goal.reached || running) continue;
      if (stats.failureCount >= maxRestartsPerProject) {
        projects[projectName].status = 'blocked';
        projects[projectName].reason = 'max-restarts-per-project';
        continue;
      }
      if (runningCount >= maxConcurrent) {
        projects[projectName].status = 'waiting';
        projects[projectName].reason = 'max-concurrent-reached';
        continue;
      }
      const launcherExists = fs.existsSync(launcher);
      const projectPathExists = fs.existsSync(p.path || '');
      if (!launcherExists || !projectPathExists) {
        projects[projectName].status = 'blocked';
        projects[projectName].reason = !launcherExists ? 'launcher-missing' : 'project-path-missing';
        continue;
      }
      const lastStart = projectLastStart[projectName] || 0;
      const nextRetryAtMs = lastStart + cooldownMs;
      if (Date.now() < nextRetryAtMs) {
        projects[projectName].status = 'cooldown';
        projects[projectName].reason = 'restart-cooldown';
        projects[projectName].nextRetryAt = new Date(nextRetryAtMs).toISOString();
        continue;
      }

      const psExe = process.env.CLAUDEOS_PWSH || 'pwsh';
      const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher,
        '-Project', projectName, '-DurationMinutes', String(p.durationMinutes || 300), '-Trigger', 'cron'];
      log(`AUTOSTART ${projectName}: ${psExe} ${args.join(' ')}`);
      const autoChild = spawn(psExe, args, { cwd: PROJ_ROOT, stdio: 'inherit', shell: false, windowsHide: true });
      childHandles[handleKey] = autoChild;
      projectLastStart[projectName] = Date.now();
      runningCount += 1;
      projects[projectName].status = 'starting';
      projects[projectName].reason = 'launched';
      projects[projectName].pid = autoChild.pid;
      stats.restartCount += 1;
      autoChild.on('exit', (code, signal) => {
        log(`AUTOEXIT ${projectName}: code=${code} signal=${signal}`);
        stats.lastExitCode = code;
        stats.lastExitSignal = signal;
        stats.lastExitAt = new Date().toISOString();
        if (code !== 0) stats.failureCount += 1;
        delete childHandles[handleKey];
        writeState();
      });
    }

    entry.status = enabled.length ? 'watching' : 'idle';
    entry.projects = projects;
    entry.registryFile = registryFile;
    entry.sessionDir = sessionDir;
    entry.maxConcurrent = maxConcurrent;
    entry.restartCooldownMinutes = cfg.restartCooldownMinutes || 10;
    entry.maxRestartsPerProject = maxRestartsPerProject;
    entry.runningCount = runningCount;
    entry.lastCheckedAt = new Date().toISOString();
    return;
  }

  // ── http type: spawn-managed + health check ──────────────────────────────
  if (entry.disabled) return;

  // If process is in cooldown, skip
  if (entry.nextRetryAt && new Date(entry.nextRetryAt) > new Date()) {
    entry.status = 'cooldown';
    return;
  }

  const child = childHandles[id];
  const pidAlive = child ? isPidAlive(child.pid) : false;

  if (!pidAlive && !child) {
    // Not yet started: spawn
    if (entry.restartCount === 0 && entry.status === 'unknown') {
      log(`INIT   ${id}: first start`);
      spawnProcess(cfg);
      entry.status = 'starting';
      return;
    }
    // Stopped without exit handler scheduling retry: restart
    if (entry.status !== 'disabled' && entry.status !== 'cooldown') {
      log(`RESTART ${id}: process gone without scheduled retry`);
      entry.restartCount = (entry.restartCount || 0) + 1;
      if (entry.restartCount >= (cfg.maxRestarts || 10)) {
        log(`DISABLE ${id}: maxRestarts reached`);
        entry.disabled = true; entry.status = 'disabled'; return;
      }
      spawnProcess(cfg);
      entry.status = 'starting';
    }
    return;
  }

  // Process is alive; perform HTTP health check
  if (cfg.healthUrl) {
    const healthy = await checkHttp(cfg.healthUrl);
    if (healthy) {
      entry.status              = 'running';
      entry.consecutiveFailures = 0;
      entry.nextRetryAt         = null;
    } else {
      entry.consecutiveFailures = (entry.consecutiveFailures || 0) + 1;
      entry.status              = 'unhealthy';
      log(`UNHEALTHY ${id}: failures=${entry.consecutiveFailures}`);

      // Kill and let exit handler reschedule restart
      if (child && isPidAlive(child.pid)) {
        try { child.kill('SIGTERM'); } catch {}
      }
    }
  } else {
    entry.status = pidAlive ? 'running' : 'stopped';
  }
}

// ── Main check loop ───────────────────────────────────────────────────────────
async function tick(configs) {
  for (const cfg of configs) {
    try { await checkProcess(cfg); } catch (e) { log(`ERROR check ${cfg.id}: ${e.message}`); }
  }
  writeState();
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function shutdown(signal) {
  log(`${signal} received — shutting down`);
  for (const [id, child] of Object.entries(childHandles)) {
    try {
      log(`KILL   ${id} (pid=${child.pid})`);
      child.kill('SIGTERM');
    } catch {}
  }
  for (const entry of Object.values(processState)) {
    entry.status = 'stopped';
  }
  writeState();
  process.exit(0);
}

// ── Entry point ───────────────────────────────────────────────────────────────
function main() {
  log(`ClaudeOS Supervisor starting (pid=${process.pid})`);
  log(`PROJ_ROOT: ${PROJ_ROOT}`);
  log(`STATE_FILE: ${STATE_FILE}`);

  const configs = loadConfig();
  if (configs.length === 0) {
    log('No enabled processes in config/processes.json. Exiting.');
    process.exit(0);
  }
  log(`Loaded ${configs.length} process(es): ${configs.map(c => c.id).join(', ')}`);

  initProcessState(configs);
  writeState();

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  // Start first tick immediately, then loop
  tick(configs);
  setInterval(() => tick(configs), CHECK_INTERVAL_MS);
}

main();
