/**
 * Smoke Test Script (Node.js) — v2-core Architecture Cleanup Verification
 * 
 * Tests: backend starts, frontend builds, health endpoint responds,
 *        login API works, TypeScript compiles cleanly, tests pass.
 *
 * Usage: node tests/smoke.js
 */

const { execSync, spawn } = require('child_process');
const http = require('http');
const path = require('path');

const BACKEND_PORT = 3002;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
const ROOT_DIR = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(ROOT_DIR, 'backend');
const FRONTEND_DIR = path.join(ROOT_DIR, 'frontend');

let pass = 0;
let fail = 0;
let backendProcess = null;

function log(level, msg) {
  const colors = { PASS: '\x1b[32m', FAIL: '\x1b[31m', INFO: '\x1b[33m' };
  const reset = '\x1b[0m';
  console.log(`${colors[level] || ''}[${level}]${reset} ${msg}`);
  if (level === 'PASS') pass++;
  if (level === 'FAIL') fail++;
}

function run(cmd, cwd) {
  try {
    execSync(cmd, { cwd, stdio: 'pipe', timeout: 120000 });
    return true;
  } catch {
    return false;
  }
}

function cleanup() {
  if (backendProcess) {
    log('INFO', `Stopping backend (PID ${backendProcess.pid})...`);
    backendProcess.kill('SIGTERM');
    try { backendProcess.kill('SIGKILL'); } catch (_) {}
  }
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
process.on('SIGTERM', () => { cleanup(); process.exit(1); });

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function main() {
  console.log('='.repeat(60));
  console.log('  v2-core Smoke Test');
  console.log(`  ${new Date().toISOString()}`);
  console.log('='.repeat(60));
  console.log('');

  // ─── TEST 1: TypeScript Compilation ───────────────────────────
  log('INFO', 'Test 1: TypeScript Compilation (npx tsc --noEmit)...');
  if (run('npx tsc --noEmit', BACKEND_DIR)) {
    log('PASS', 'TypeScript compiles with zero errors');
  } else {
    log('FAIL', 'TypeScript compilation failed');
  }

  // ─── TEST 2: Frontend Build ───────────────────────────────────
  log('INFO', 'Test 2: Frontend Build (npm run build)...');
  if (run('npm run build', FRONTEND_DIR)) {
    log('PASS', 'Frontend builds successfully');
  } else {
    log('FAIL', 'Frontend build failed');
  }

  // ─── TEST 3: Backend Starts ────────────────────────────────────
  log('INFO', `Test 3: Backend starts on port ${BACKEND_PORT}...`);
  
  backendProcess = spawn('node', ['dist/app.js'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, JWT_SECRET: '***', ADMIN_USER: 'admin', ADMIN_PASS: 'admin123' },
    stdio: 'pipe',
  });

  // Wait for backend to be ready (max 15 seconds)
  let ready = false;
  for (let i = 0; i < 15; i++) {
    try {
      const res = await fetch(`${BACKEND_URL}/health`);
      if (res.status === 200) { ready = true; break; }
    } catch (_) {}
    await new Promise(r => setTimeout(r, 1000));
  }

  if (ready) {
    log('PASS', `Backend started successfully (PID ${backendProcess.pid})`);
  } else {
    log('FAIL', 'Backend failed to start within 15 seconds');
    cleanup();
    process.exit(1);
  }

  // ─── TEST 4: Health Endpoint ───────────────────────────────────
  log('INFO', 'Test 4: Health endpoint...');
  try {
    const res = await fetch(`${BACKEND_URL}/health`);
    const health = JSON.parse(res.data);
    if (health.status === 'ok') {
      log('PASS', `Health endpoint responds OK: ${JSON.stringify(health)}`);
    } else {
      log('FAIL', `Health endpoint unexpected: ${res.data}`);
    }
  } catch (e) {
    log('FAIL', `Health endpoint error: ${e.message}`);
  }

  // ─── TEST 5: Login API ────────────────────────────────────────
  log('INFO', 'Test 5: Login API...');
  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: 'admin', pass: 'admin123' }),
    });
    const loginData = JSON.parse(res.data);
    if (loginData.success) {
      const tokenShort = loginData.token ? loginData.token.substring(0, 20) : 'N/A';
      log('PASS', `Login API works, got token: ${tokenShort}...`);
    } else {
      log('FAIL', `Login API failed: ${res.data.substring(0, 100)}`);
    }
  } catch (e) {
    log('FAIL', `Login API error: ${e.message}`);
  }

  // ─── TEST 6: Unit Tests ───────────────────────────────────────
  log('INFO', 'Test 6: Unit Tests (vitest run)...');
  if (run('npx vitest run --reporter=dot', BACKEND_DIR)) {
    log('PASS', 'Unit tests pass');
  } else {
    log('FAIL', 'Unit tests failed');
  }

  // ─── SUMMARY ───────────────────────────────────────────────────
  console.log('');
  console.log('='.repeat(60));
  console.log(`  RESULTS: ${pass} passed, ${fail} failed`);
  console.log('='.repeat(60));

  cleanup();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  log('FAIL', `Unexpected error: ${err.message}`);
  cleanup();
  process.exit(1);
});
