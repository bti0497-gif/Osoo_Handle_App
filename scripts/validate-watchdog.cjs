'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const { importWatchdogDiagnostics } = require('../server/services/watchdogDiagnosticImportService.cjs');

const root = path.resolve(__dirname, '..');
const executable = path.join(root, 'watchdog', 'dist', 'OsooWatchdog.exe');
assert.ok(fs.existsSync(executable), 'watchdog executable is missing; run watchdog/build-watchdog.ps1');
const builderConfig = fs.readFileSync(path.join(root, 'electron-builder.config.cjs'), 'utf8');
const installerGuard = fs.readFileSync(path.join(root, 'scripts', 'installer-process-guard.nsh'), 'utf8');
const installerHooks = fs.readFileSync(path.join(root, 'scripts', 'installer-hooks.nsh'), 'utf8');
const integratedInstaller = fs.readFileSync(path.join(root, 'scripts', 'build-integrated-installer.ps1'), 'utf8');
const packageJson = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
assert.ok(builderConfig.includes("watchdog/dist/OsooWatchdog.exe"), 'watchdog is not packaged as an extra resource');
assert.ok(builderConfig.includes("include: 'scripts/installer-hooks.nsh'"), 'normal installer does not use watchdog hooks');
assert.ok(installerHooks.includes('!insertmacro InstallOsooWatchdog'), 'normal installer does not install watchdog');
assert.ok(installerGuard.includes('schtasks /Create /F /SC ONLOGON'), 'watchdog scheduled task registration is missing');
assert.ok(installerGuard.includes('schtasks /Delete /F /TN "Osoo Handle App Watchdog"'), 'watchdog scheduled task cleanup is missing');
assert.ok(installerGuard.includes('taskkill /F /T /IM "OsooWatchdog.exe"'), 'installer does not stop watchdog before replacing the app');
assert.ok(integratedInstaller.includes("'  !insertmacro InstallOsooWatchdog'"), 'integrated installer does not install watchdog');
assert.ok(packageJson.includes('watchdog:build'), 'release scripts do not rebuild watchdog');

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

  const importAppData = path.join(testRoot, 'import-app-data');
  const importRuntime = path.join(importAppData, 'runtime');
  run(importRuntime);
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE app_settings (id INTEGER PRIMARY KEY, site_id TEXT, site_name TEXT);
      INSERT INTO app_settings VALUES (1, 'site-test', '테스트현장');
      CREATE TABLE app_diagnostic_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, level TEXT, area TEXT,
        action TEXT, result TEXT, message TEXT, details_json TEXT, site_id TEXT,
        site_name TEXT, app_version TEXT, uploaded_at TEXT, drive_file_id TEXT,
        drive_web_view_link TEXT, upload_attempts INTEGER DEFAULT 0, upload_error TEXT
      );
    `);
    const firstImport = importWatchdogDiagnostics(db, importAppData);
    assert.ok(firstImport.imported >= 1);
    assert.strictEqual(db.prepare("SELECT COUNT(*) count FROM app_diagnostic_logs WHERE area = 'watchdog'").get().count, firstImport.imported);
    const secondImport = importWatchdogDiagnostics(db, importAppData);
    assert.strictEqual(secondImport.imported, 0);
  } finally {
    db.close();
  }

  console.log('✓ watchdog restart, locks, single-instance, and Drive diagnostic handoff simulations passed');
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
}
