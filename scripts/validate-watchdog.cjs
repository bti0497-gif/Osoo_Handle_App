'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const executable = path.join(root, 'watchdog', 'dist', 'OsooWatchdog.exe');
assert.ok(fs.existsSync(executable), 'watchdog executable is missing; run watchdog/build-watchdog.ps1');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'osoo-watchdog-'));
const fakeApp = path.join(testRoot, 'Osoo Handle App.exe');
fs.copyFileSync(executable, fakeApp);

function run(runtime, extraArgs) {
  const result = spawnSync(executable, [
    '--once', '--dry-run', '--no-delay', '--simulate-process-absent',
    '--app', fakeApp, '--runtime', runtime,
    ...(extraArgs || []),
  ], { windowsHide: true, timeout: 10_000 });
  assert.strictEqual(result.status, 0, result.error?.message || `watchdog exited ${result.status}`);
  return JSON.parse(fs.readFileSync(path.join(runtime, 'watchdog-status.json'), 'utf8'));
}

try {
  const restartRuntime = path.join(testRoot, 'restart');
  const restartStatus = run(restartRuntime);
  assert.strictEqual(restartStatus.state, 'dry-run-restart');

  const lockedRuntime = path.join(testRoot, 'locked');
  fs.mkdirSync(lockedRuntime, { recursive: true });
  fs.writeFileSync(path.join(lockedRuntime, 'maintenance.json'), JSON.stringify({
    reason: 'update',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    requestedBy: 'test',
  }));
  const lockedStatus = run(lockedRuntime);
  assert.strictEqual(lockedStatus.state, 'maintenance');
  assert.strictEqual(lockedStatus.maintenanceReason, 'update');

  const expiredRuntime = path.join(testRoot, 'expired');
  fs.mkdirSync(expiredRuntime, { recursive: true });
  fs.writeFileSync(path.join(expiredRuntime, 'maintenance.json'), JSON.stringify({
    reason: 'update',
    createdAt: new Date(Date.now() - 120_000).toISOString(),
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
    requestedBy: 'test',
  }));
  const expiredStatus = run(expiredRuntime);
  assert.strictEqual(expiredStatus.state, 'dry-run-restart');
  assert.ok(!fs.existsSync(path.join(expiredRuntime, 'maintenance.json')));

  const malformedRuntime = path.join(testRoot, 'malformed');
  fs.mkdirSync(malformedRuntime, { recursive: true });
  fs.writeFileSync(path.join(malformedRuntime, 'maintenance.json'), '{broken-json');
  const malformedStatus = run(malformedRuntime);
  assert.strictEqual(malformedStatus.state, 'dry-run-restart');
  assert.ok(!fs.existsSync(path.join(malformedRuntime, 'maintenance.json')));

  const singletonRuntime = path.join(testRoot, 'singleton');
  const firstInstance = spawn(executable, [
    '--dry-run', '--no-delay', '--simulate-process-absent', '--interval', '30',
    '--app', fakeApp, '--runtime', singletonRuntime,
  ], { windowsHide: true, stdio: 'ignore' });
  spawnSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 500'], { windowsHide: true });
  const duplicate = spawnSync(executable, [
    '--once', '--dry-run', '--app', fakeApp, '--runtime', singletonRuntime,
  ], { windowsHide: true, timeout: 10_000 });
  assert.strictEqual(duplicate.status, 2);
  firstInstance.kill();

  console.log('✓ watchdog restart decision, maintenance locks, and single-instance simulations passed');
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
}
