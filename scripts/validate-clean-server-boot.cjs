'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const TEMP_ROOT = path.join(PROJECT_ROOT, '.tmp-validation', 'clean-server-boot');
const TEST_PORT = 19731;
const TOKEN = 'clean-server-boot-test-token';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ping() {
  return new Promise((resolve) => {
    const request = http.get({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/ping',
      timeout: 500,
      headers: { 'x-osoo-server-token': TOKEN },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (_) { resolve(null); }
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(null));
  });
}

function launch(appDataRoot) {
  return spawn(process.execPath, ['server.cjs'], {
    cwd: PROJECT_ROOT,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      APPDATA: appDataRoot,
      ELECTRON: '1',
      OSOO_API_PORT: String(TEST_PORT),
      OSOO_SERVER_TOKEN: TOKEN,
      OSOO_MINIMAL_BUILD: '1',
      BIGQUERY_SYNC_ENABLED: 'false',
    },
  });
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGKILL');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    wait(3000),
  ]);
}

async function waitForReady(child, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && child.exitCode === null) {
    const payload = await ping();
    if (payload?.ready === true) return payload;
    await wait(250);
  }
  return null;
}

async function run() {
  assert.ok(TEMP_ROOT.startsWith(path.join(PROJECT_ROOT, '.tmp-validation')), 'unsafe temporary path');
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TEMP_ROOT, { recursive: true });

  const healthyRoot = path.join(TEMP_ROOT, 'healthy');
  const healthy = launch(healthyRoot);
  let stdout = '';
  let stderr = '';
  healthy.stdout.on('data', (chunk) => { stdout += chunk; });
  healthy.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    const payload = await waitForReady(healthy);
    assert.ok(payload, `server did not become ready\n${stdout}\n${stderr}`);
    assert.strictEqual(payload.app, 'osoo-handle-app');
    assert.strictEqual(payload.instanceVerified, true);
    assert.strictEqual(Object.hasOwn(payload, 'serverToken'), false, 'ping must not expose the capability token');
    assert.strictEqual(
      fs.readFileSync(path.join(healthyRoot, 'Osoo_Handle_App', 'server.port'), 'utf8').trim(),
      String(TEST_PORT)
    );
    assert.ok(fs.statSync(path.join(healthyRoot, 'Osoo_Handle_App', 'osoo.db')).size > 0);
  } finally {
    await stop(healthy);
  }

  const corruptRoot = path.join(TEMP_ROOT, 'corrupt');
  const corruptAppRoot = path.join(corruptRoot, 'Osoo_Handle_App');
  fs.mkdirSync(corruptAppRoot, { recursive: true });
  fs.writeFileSync(path.join(corruptAppRoot, 'osoo.db'), 'not-a-sqlite-database', 'utf8');
  const corrupt = launch(corruptRoot);
  try {
    let becameReady = false;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && corrupt.exitCode === null) {
      const payload = await ping();
      if (payload?.ready === true) becameReady = true;
      await wait(200);
    }
    assert.strictEqual(becameReady, false, 'corrupt database must never become ready');
    assert.strictEqual(fs.existsSync(path.join(corruptAppRoot, 'server.port')), false, 'failed boot must not publish server.port');
  } finally {
    await stop(corrupt);
  }

  console.log('[CLEAN BOOT PASS] ready handshake, private token verification, port publication, DB integrity gate');
}

run()
  .catch((error) => {
    console.error('[CLEAN BOOT FAIL]', error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
  });
