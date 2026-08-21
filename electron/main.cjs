const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { fork, spawnSync } = require('child_process');
const { writeMaintenanceLock, clearMaintenanceLockIfReason } = require('./maintenanceLock.cjs');
const { setupAutoUpdater, checkForUpdates, installDownloadedUpdateAndQuit, hasDownloadedUpdate } = require('./updater.cjs');

function isBrokenPipeError(error) {
  return error && (error.code === 'EPIPE' || /EPIPE|broken pipe/i.test(String(error.message || '')));
}

function setupSafeConsole() {
  process.stdout?.on?.('error', (error) => {
    if (!isBrokenPipeError(error)) {
      throw error;
    }
  });
  process.stderr?.on?.('error', (error) => {
    if (!isBrokenPipeError(error)) {
      throw error;
    }
  });

  for (const method of ['log', 'warn', 'error']) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      try {
        original(...args);
      } catch (error) {
        if (!isBrokenPipeError(error)) {
          throw error;
        }
      }
    };
  }
}

setupSafeConsole();

let mainWindow = null;
const siteWindows = new Map();
let serverProcess = null;
let tray = null;
let isQuitting = false;
let isUpdateInstalling = false;
let serverGuardTimer = null;
let serverRestartTimer = null;
let serverRecoveryRequestTimer = null;
let serverHealthFailures = 0;
let serverInstanceToken = null;
let serverLaunchedAt = 0;
let lastReadyServerPid = null;
let lastServerStderr = '';
const plannedServerStopPids = new Set();
let watchdogHeartbeatTimer = null;
let runtimeTelemetryTimer = null;
let embeddedServerRecoveryInProgress = false;
let rendererReadyTimer = null;
let rendererRecoveryAttempts = 0;
let rendererRecoveryInProgress = false;
let externalRecoveryRequested = false;
let externalRecoveryRequestId = null;
let startupRecoveryState = { phase: 'idle', updatedAt: null };
const appStartedAt = new Date().toISOString();

const FULL_EXIT_LOCK_TTL_MS = 8 * 60 * 60 * 1000;

const DEDICATED_SERVER_PORT = 18731;
const SERVER_GUARD_INTERVAL_MS = 3000;
const SERVER_HEALTH_FAILURE_LIMIT = 3;
const SERVER_STARTUP_GRACE_MS = 120000;
const WATCHDOG_HEARTBEAT_INTERVAL_MS = 15000;
const SERVER_RECOVERY_REQUEST_INTERVAL_MS = 2000;
const RENDERER_READY_TIMEOUT_MS = 20000;
const EXTERNAL_RECOVERY_REQUEST_TTL_MS = 3 * 60 * 1000;

const isDev = !app.isPackaged;
const useExternalServer = isDev && process.env.OSOO_EXTERNAL_SERVER === '1';
const isBackgroundStartup = process.argv.includes('--osoo-background-start');

function getOsooAppDataPath() {
  return path.join(
    process.env.APPDATA || process.env.LOCALAPPDATA || app.getPath('appData'),
    'Osoo_Handle_App'
  );
}

function getWatchdogHeartbeatPath() {
  return path.join(getOsooAppDataPath(), 'runtime', 'app-heartbeat.json');
}

function getWatchdogServerRecoveryRequestPath() {
  return path.join(getOsooAppDataPath(), 'runtime', 'server-recovery-request.json');
}

function getEnvironmentBaselineMarkerPath() {
  const version = String(app.getVersion() || 'unknown').replace(/[^0-9A-Za-z._-]/g, '_');
  return path.join(getOsooAppDataPath(), 'runtime', `.environment-baseline-${version}.done`);
}

function classifyInstallationScope() {
  const executablePath = String(process.execPath || '').toLowerCase();
  if (executablePath.includes('\\program files\\')) return 'machine-program-files';
  if (executablePath.includes('\\appdata\\')) return 'user-appdata';
  return 'other';
}

function readAppDataDiskSnapshot() {
  try {
    if (typeof fs.statfsSync !== 'function') return { available: false, reason: 'statfs-unavailable' };
    const stats = fs.statfsSync(getOsooAppDataPath());
    const blockSize = Number(stats.bsize || 0);
    const totalBlocks = Number(stats.blocks || 0);
    const freeBlocks = Number(stats.bavail ?? stats.bfree ?? 0);
    if (!blockSize || !totalBlocks) return { available: false, reason: 'statfs-empty' };
    return {
      available: true,
      totalBytes: blockSize * totalBlocks,
      freeBytes: blockSize * freeBlocks,
    };
  } catch (error) {
    return { available: false, reason: String(error?.code || error?.message || 'statfs-failed').slice(0, 80) };
  }
}

function readWatchdogEnvironmentStatus() {
  const statusPath = path.join(getOsooAppDataPath(), 'runtime', 'watchdog-status.json');
  let status = {};
  try {
    status = JSON.parse(fs.readFileSync(statusPath, 'utf8')) || {};
  } catch (_) {
    // The watchdog can be starting independently. Its absence is diagnostic data,
    // not an application failure.
  }
  return {
    packagedBinaryPresent: !isDev && fs.existsSync(path.join(process.resourcesPath, 'watchdog', 'OsooWatchdog.exe')),
    version: String(status.version || '').trim() || null,
    state: String(status.state || '').trim() || null,
    checkedAt: String(status.checkedAt || '').trim() || null,
    maintenanceReason: String(status.maintenanceReason || '').trim() || null,
  };
}

function recordEnvironmentBaseline() {
  if (isDev) return;
  const markerPath = getEnvironmentBaselineMarkerPath();
  if (fs.existsSync(markerPath)) return;

  let systemMemory = null;
  try {
    systemMemory = process.getSystemMemoryInfo?.() || null;
  } catch (_) {
    // Memory collection is optional and must never affect application startup.
  }

  const dbPath = path.join(getOsooAppDataPath(), 'osoo.db');
  const details = {
    schemaVersion: 1,
    app: {
      version: app.getVersion(),
      packaged: app.isPackaged,
      installationScope: classifyInstallationScope(),
      architecture: process.arch,
      runtime: {
        electron: process.versions.electron || null,
        chrome: process.versions.chrome || null,
        node: process.versions.node || null,
      },
    },
    operatingSystem: {
      platform: process.platform,
      systemVersion: process.getSystemVersion?.() || os.release(),
      kernelRelease: os.release(),
      architecture: os.arch(),
    },
    resources: {
      systemMemory,
      appDataVolume: readAppDataDiskSnapshot(),
    },
    localRuntime: {
      localDatabasePresent: fs.existsSync(dbPath),
      serverReadyAtCollection: true,
      watchdog: readWatchdogEnvironmentStatus(),
    },
  };

  if (!appendElectronRecoveryDiagnostic('environment-baseline', 'observed', details)) return;
  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, JSON.stringify({
      schemaVersion: 1,
      appVersion: app.getVersion(),
      recordedAt: new Date().toISOString(),
    }, null, 2), 'utf8');
  } catch (error) {
    console.warn('[Electron] Failed to write environment baseline marker:', error.message);
  }
}

function writeWatchdogHeartbeat(serverReady) {
  try {
    const targetPath = getWatchdogHeartbeatPath();
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const temporaryPath = `${targetPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify({
      version: 1,
      appPid: process.pid,
      appStartedAt,
      checkedAt: new Date().toISOString(),
      serverReady: Boolean(serverReady),
      serverPort: DEDICATED_SERVER_PORT,
      serverPid: serverProcess?.pid || 0,
      serverStartedAt: serverLaunchedAt ? new Date(serverLaunchedAt).toISOString() : null,
      serverRecoveryInProgress: Boolean(embeddedServerRecoveryInProgress || serverRestartTimer),
      sessionActive: Boolean(sharedAuthenticatedUser?.id),
      windowVisible: BrowserWindow.getAllWindows().some((window) => !window.isDestroyed() && window.isVisible()),
    }), 'utf8');
    fs.renameSync(temporaryPath, targetPath);
  } catch (error) {
    console.warn('[Watchdog] Failed to write app heartbeat:', error.message);
  }
}

function startWatchdogHeartbeat() {
  if (useExternalServer || watchdogHeartbeatTimer) return;
  const refreshHeartbeat = async () => {
    writeWatchdogHeartbeat(await checkEmbeddedServerHealth());
  };
  void refreshHeartbeat();
  watchdogHeartbeatTimer = setInterval(() => {
    void refreshHeartbeat();
  }, WATCHDOG_HEARTBEAT_INTERVAL_MS);
  watchdogHeartbeatTimer.unref?.();
}

function stopWatchdogHeartbeat() {
  if (watchdogHeartbeatTimer) clearInterval(watchdogHeartbeatTimer);
  watchdogHeartbeatTimer = null;
  try { fs.unlinkSync(getWatchdogHeartbeatPath()); } catch (_) {}
}

function sanitizeRuntimeMessage(value) {
  return String(value || '')
    .replace(/([A-Za-z]:\\Users\\)[^\\\s]+/gi, '$1<user>')
    .replace(/(password|token|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=<redacted>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-500);
}

function resolveDefaultWindowSiteId() {
  const dbPath = path.join(getOsooAppDataPath(), 'osoo.db');
  if (!fs.existsSync(dbPath)) return '';

  let db = null;
  try {
    const Database = require('better-sqlite3');
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const row = db.prepare(`
      SELECT site_id, multi_site_enabled, primary_site_id
      FROM app_settings
      WHERE id = 1
    `).get() || {};
    const multiEnabled = Number(row.multi_site_enabled || 0) === 1;
    return String(
      (multiEnabled ? row.primary_site_id : row.site_id) || row.site_id || ''
    ).trim();
  } catch (error) {
    console.warn('[Electron] Failed to resolve default window siteId:', error.message);
    return '';
  } finally {
    try { db?.close(); } catch (_) {}
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServerReadyAndClearMaintenanceLocks(timeoutMs = SERVER_STARTUP_GRACE_MS) {
  if (useExternalServer) return;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const healthy = await checkEmbeddedServerHealth();
    if (healthy) {
      recordEnvironmentBaseline();
      ['update', 'full-exit'].forEach((reason) => {
        const cleared = clearMaintenanceLockIfReason(reason, {
          onlyIfNotExpired: true,
          clearOnInvalidExpiresAt: true,
        });
        if (cleared) {
          console.log(`[MaintenanceLock] Cleared ${reason} lock after server-ready startup`);
        }
      });
      return;
    }
    await delay(1000);
  }
  console.warn('[MaintenanceLock] Server did not reach ready state in time; maintenance lock untouched');
}

function shouldKeepEmbeddedServerAlive() {
  return !isQuitting && !isUpdateInstalling && !useExternalServer;
}

function configureWindowsBackgroundStartup() {
  if (isDev || process.platform !== 'win32') return;
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true,
      path: process.execPath,
      args: ['--osoo-background-start'],
    });
    const settings = app.getLoginItemSettings({
      path: process.execPath,
      args: ['--osoo-background-start'],
    });
    console.log(`[Electron] Windows background startup: ${settings.openAtLogin ? 'enabled' : 'disabled'}`);
  } catch (error) {
    console.warn('[Electron] Failed to configure Windows background startup:', error.message);
  }
}

function reclaimDedicatedServerPort() {
  if (useExternalServer || process.platform !== 'win32') return true;

  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$currentPid = ${process.pid}
$port = ${DEDICATED_SERVER_PORT}
$owners = Get-NetTCPConnection -State Listen |
  Where-Object { $_.LocalPort -eq $port -and $_.OwningProcess -ne $currentPid } |
  Select-Object -ExpandProperty OwningProcess -Unique

foreach ($ownerPid in $owners) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerPid"
  $name = if ($proc) { [string]$proc.Name } else { '<unknown>' }
  $path = if ($proc) { [string]$proc.ExecutablePath } else { '' }
  Write-Output "reclaim pid=$ownerPid name=$name path=$path"
  Stop-Process -Id $ownerPid -Force
}
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  $remaining = Get-NetTCPConnection -State Listen |
    Where-Object { $_.LocalPort -eq $port } |
    Select-Object -First 1
  if (-not $remaining) { exit 0 }
  Start-Sleep -Milliseconds 250
}
Write-Error "전용 포트 $port 해제 실패"
exit 1
`.trim();

  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 10000,
  });
  if (result.error) {
    console.error('[Electron] Dedicated server port reclaim failed:', result.error.message);
    return false;
  }
  if (result.stdout?.trim()) console.warn(`[Electron] ${result.stdout.trim()}`);
  if (result.status !== 0) {
    console.error('[Electron] Dedicated server port is still occupied:', result.stderr?.trim() || result.status);
    return false;
  }
  return true;
}

function scheduleServerRestart(delayMs = 500) {
  if (!shouldKeepEmbeddedServerAlive() || serverRestartTimer) return;
  serverRestartTimer = setTimeout(() => {
    serverRestartTimer = null;
    startServer();
  }, delayMs);
}

function notifyRendererServerRecovery(phase) {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) window.webContents.send('server:recovery-progress', { phase });
  });
}

function appendElectronRecoveryDiagnostic(action, result, details = {}) {
  try {
    const runtimeDirectory = path.join(getOsooAppDataPath(), 'runtime');
    fs.mkdirSync(runtimeDirectory, { recursive: true });
    fs.appendFileSync(path.join(runtimeDirectory, 'electron-recovery-events.jsonl'), `${JSON.stringify({
      createdAt: new Date().toISOString(),
      version: app.getVersion(),
      area: 'electron',
      action,
      result,
      details,
    })}\n`, 'utf8');
    return true;
  } catch (error) {
    console.warn('[Electron] Failed to record renderer recovery diagnostic:', error.message);
    return false;
  }
}

function startRuntimeTelemetry() {
  if (runtimeTelemetryTimer) return;
  const collect = async () => {
    try {
      const memory = await process.getProcessMemoryInfo();
      appendElectronRecoveryDiagnostic('runtime-telemetry', 'observed', {
        appUptimeSeconds: Math.round(process.uptime()),
        pid: process.pid,
        memory,
      });
    } catch (error) {
      appendElectronRecoveryDiagnostic('runtime-telemetry', 'failed', {
        message: String(error?.message || error).slice(0, 160),
      });
    }
  };
  void collect();
  runtimeTelemetryTimer = setInterval(() => void collect(), 6 * 60 * 60 * 1000);
  runtimeTelemetryTimer.unref?.();
}

function stopRuntimeTelemetry() {
  if (!runtimeTelemetryTimer) return;
  clearInterval(runtimeTelemetryTimer);
  runtimeTelemetryTimer = null;
}

function getExternalRecoveryRequestPath() {
  return path.join(getOsooAppDataPath(), 'runtime', 'emergency-recovery-request.json');
}

function clearExternalEmergencyRecoveryRequest(result = 'cancelled') {
  if (!externalRecoveryRequested) return;
  try { fs.unlinkSync(getExternalRecoveryRequestPath()); } catch (_) {}
  appendElectronRecoveryDiagnostic('external-recovery-handoff', result, {
    requestId: externalRecoveryRequestId,
  });
  externalRecoveryRequested = false;
  externalRecoveryRequestId = null;
}

function requestExternalEmergencyRecovery(reason) {
  if (externalRecoveryRequested || isQuitting || isDev) return false;
  externalRecoveryRequested = true;
  externalRecoveryRequestId = crypto.randomBytes(12).toString('hex');
  const requestedAt = new Date();
  try {
    const requestPath = getExternalRecoveryRequestPath();
    fs.mkdirSync(path.dirname(requestPath), { recursive: true });
    const temporaryPath = `${requestPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify({
      version: 1,
      requestId: externalRecoveryRequestId,
      requestedAt: requestedAt.toISOString(),
      expiresAt: new Date(requestedAt.getTime() + EXTERNAL_RECOVERY_REQUEST_TTL_MS).toISOString(),
      reason,
    }), 'utf8');
    fs.renameSync(temporaryPath, requestPath);
    publishStartupRecoveryState('external-recovery-handoff', { reason, requestId: externalRecoveryRequestId }, { diagnostic: true });
    appendElectronRecoveryDiagnostic('external-recovery-handoff', 'requested', {
      reason,
      requestId: externalRecoveryRequestId,
    });
    return true;
  } catch (error) {
    appendElectronRecoveryDiagnostic('external-recovery-handoff', 'failed', {
      reason,
      message: String(error?.message || error).slice(0, 160),
    });
    externalRecoveryRequested = false;
    externalRecoveryRequestId = null;
    return false;
  }
}

function publishStartupRecoveryState(phase, details = {}, { diagnostic = false } = {}) {
  startupRecoveryState = {
    phase,
    details,
    updatedAt: new Date().toISOString(),
  };
  if (diagnostic) {
    appendElectronRecoveryDiagnostic('renderer-startup', phase === 'renderer-ready' ? 'ok' : 'failed', {
      phase,
      ...details,
    });
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('app:startup-recovery-progress', startupRecoveryState);
}

function clearRendererReadyTimer() {
  if (rendererReadyTimer) clearTimeout(rendererReadyTimer);
  rendererReadyTimer = null;
}

function startCleanRendererRecovery(reason) {
  if (rendererRecoveryInProgress || isQuitting || !mainWindow || mainWindow.isDestroyed()) return;
  rendererRecoveryInProgress = true;
  rendererRecoveryAttempts += 1;
  publishStartupRecoveryState('renderer-clean-boot', { reason, attempt: rendererRecoveryAttempts }, { diagnostic: true });

  const failedProcess = serverProcess;
  serverProcess = null;
  serverInstanceToken = null;
  serverLaunchedAt = 0;
  try { failedProcess?.kill('SIGKILL'); } catch (_) {}
  scheduleServerRestart(250);

  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed() || isQuitting) return;
    publishStartupRecoveryState('renderer-reloading', { reason, attempt: rendererRecoveryAttempts }, { diagnostic: true });
    mainWindow.webContents.reloadIgnoringCache();
    rendererRecoveryInProgress = false;
  }, 1200).unref?.();
}

function armRendererReadyTimeout() {
  clearRendererReadyTimer();
  rendererReadyTimer = setTimeout(() => {
    rendererReadyTimer = null;
    if (rendererRecoveryAttempts >= 1) {
      publishStartupRecoveryState('renderer-recovery-failed', { attempts: rendererRecoveryAttempts }, { diagnostic: true });
      requestExternalEmergencyRecovery('renderer-ready-timeout-after-clean-boot');
      return;
    }
    startCleanRendererRecovery('renderer-ready-timeout');
  }, RENDERER_READY_TIMEOUT_MS);
  rendererReadyTimer.unref?.();
}

function inspectEmbeddedServerHealth() {
  const startedAt = Date.now();
  if (!shouldKeepEmbeddedServerAlive()) {
    return Promise.resolve({ healthy: false, reason: 'server-not-required', durationMs: 0 });
  }
  if (!serverProcess) {
    return Promise.resolve({ healthy: false, reason: 'server-process-missing', durationMs: 0 });
  }
  if (!serverInstanceToken) {
    return Promise.resolve({ healthy: false, reason: 'server-token-missing', durationMs: 0 });
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve({ ...result, durationMs: Date.now() - startedAt });
    };
    const request = http.get({
      hostname: '127.0.0.1',
      port: DEDICATED_SERVER_PORT,
      path: '/api/ping',
      timeout: 1200,
      headers: { 'x-osoo-server-token': serverInstanceToken },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          const payload = JSON.parse(body);
          const healthy = response.statusCode === 200
            && payload?.app === 'osoo-handle-app'
            && payload?.ready === true
            && payload?.instanceVerified === true;
          let reason = 'ok';
          if (response.statusCode !== 200) reason = `status-${response.statusCode}`;
          else if (payload?.app !== 'osoo-handle-app') reason = 'unexpected-server';
          else if (payload?.ready !== true) reason = 'server-not-ready';
          else if (payload?.instanceVerified !== true) reason = 'instance-token-mismatch';
          finish({ healthy, reason, statusCode: response.statusCode });
        } catch (_) {
          finish({ healthy: false, reason: 'invalid-ping-response', statusCode: response.statusCode });
        }
      });
    });
    request.on('timeout', () => {
      finish({ healthy: false, reason: 'ping-timeout' });
      request.destroy();
    });
    request.on('error', (error) => {
      finish({ healthy: false, reason: `request-error-${error?.code || 'unknown'}` });
    });
  });
}

function checkEmbeddedServerHealth() {
  return inspectEmbeddedServerHealth().then((result) => result.healthy);
}

function forceEmbeddedServerRecovery(reason, requestId = null) {
  if (!shouldKeepEmbeddedServerAlive()) return false;
  if (embeddedServerRecoveryInProgress) {
    const recoveryServerIsStarting = serverRestartTimer
      || !serverProcess
      || (serverLaunchedAt && Date.now() - serverLaunchedAt < SERVER_STARTUP_GRACE_MS);
    if (recoveryServerIsStarting) return true;
  }

  embeddedServerRecoveryInProgress = true;
  notifyRendererServerRecovery('server-restarting');
  const failedProcess = serverProcess;
  const failedPid = failedProcess?.pid || null;
  if (failedPid) plannedServerStopPids.add(failedPid);
  serverProcess = null;
  serverInstanceToken = null;
  serverLaunchedAt = 0;
  lastReadyServerPid = null;
  appendElectronRecoveryDiagnostic('embedded-server-recovery', 'started', {
    reason,
    requestId,
    failedPid,
    sessionActive: Boolean(sharedAuthenticatedUser?.id),
    windowVisible: BrowserWindow.getAllWindows().some((window) => !window.isDestroyed() && window.isVisible()),
  });
  try { failedProcess?.kill('SIGKILL'); } catch (_) {}
  scheduleServerRestart(250);
  return true;
}

async function processWatchdogServerRecoveryRequest() {
  if (useExternalServer || isQuitting) return;
  const requestPath = getWatchdogServerRecoveryRequestPath();
  if (!fs.existsSync(requestPath)) return;

  let request;
  try {
    request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
  } catch (error) {
    try { fs.unlinkSync(requestPath); } catch (_) {}
    appendElectronRecoveryDiagnostic('watchdog-server-recovery-request', 'failed', {
      reason: 'invalid-request',
      errorName: error?.name || 'Error',
    });
    return;
  }

  const expiresAt = new Date(request?.expiresAt || 0).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    try { fs.unlinkSync(requestPath); } catch (_) {}
    appendElectronRecoveryDiagnostic('watchdog-server-recovery-request', 'failed', {
      reason: 'expired-request',
      requestId: String(request?.requestId || '').slice(0, 80),
    });
    return;
  }

  const health = await inspectEmbeddedServerHealth();
  try { fs.unlinkSync(requestPath); } catch (_) {}
  if (health.healthy) {
    appendElectronRecoveryDiagnostic('watchdog-server-recovery-request', 'ignored', {
      reason: 'server-already-ready',
      requestId: String(request?.requestId || '').slice(0, 80),
      serverPid: serverProcess?.pid || null,
    });
    return;
  }

  appendElectronRecoveryDiagnostic('watchdog-server-recovery-request', 'accepted', {
    reason: String(request?.reason || 'watchdog-health-failure').slice(0, 120),
    requestId: String(request?.requestId || '').slice(0, 80),
    healthReason: health.reason,
  });
  forceEmbeddedServerRecovery('watchdog-server-only-request', String(request?.requestId || '').slice(0, 80));
}

function startWatchdogServerRecoveryRequestMonitor() {
  if (useExternalServer || serverRecoveryRequestTimer) return;
  void processWatchdogServerRecoveryRequest();
  serverRecoveryRequestTimer = setInterval(() => {
    void processWatchdogServerRecoveryRequest();
  }, SERVER_RECOVERY_REQUEST_INTERVAL_MS);
  serverRecoveryRequestTimer.unref?.();
}

function stopWatchdogServerRecoveryRequestMonitor() {
  if (serverRecoveryRequestTimer) clearInterval(serverRecoveryRequestTimer);
  serverRecoveryRequestTimer = null;
  try { fs.unlinkSync(getWatchdogServerRecoveryRequestPath()); } catch (_) {}
}

function startServerGuard() {
  if (useExternalServer || serverGuardTimer) return;
  serverGuardTimer = setInterval(async () => {
    if (!shouldKeepEmbeddedServerAlive()) return;
    const health = await inspectEmbeddedServerHealth();
    if (health.healthy) {
      serverHealthFailures = 0;
      const readyPid = serverProcess?.pid || null;
      if (readyPid && readyPid !== lastReadyServerPid) {
        lastReadyServerPid = readyPid;
        appendElectronRecoveryDiagnostic('embedded-server-ready', 'ok', {
          pid: readyPid,
          readyElapsedMs: serverLaunchedAt ? Date.now() - serverLaunchedAt : null,
          recovery: embeddedServerRecoveryInProgress,
        });
      }
      if (embeddedServerRecoveryInProgress) {
        embeddedServerRecoveryInProgress = false;
        notifyRendererServerRecovery('server-ready');
      }
      return;
    }
    if (serverProcess && Date.now() - serverLaunchedAt < SERVER_STARTUP_GRACE_MS) return;
    serverHealthFailures += 1;
    if (serverHealthFailures < SERVER_HEALTH_FAILURE_LIMIT) return;
    const failureCount = serverHealthFailures;
    serverHealthFailures = 0;
    console.error('[Electron] Embedded server health lost; forcing clean restart on port 18731.');
    appendElectronRecoveryDiagnostic('embedded-server-health-failed', 'failed', {
      reason: health.reason,
      statusCode: health.statusCode || null,
      durationMs: health.durationMs,
      failureCount,
      serverPid: serverProcess?.pid || null,
      serverUptimeMs: serverLaunchedAt ? Date.now() - serverLaunchedAt : null,
      lastServerStderr,
    });
    forceEmbeddedServerRecovery('electron-health-failure');
  }, SERVER_GUARD_INTERVAL_MS);
  serverGuardTimer.unref?.();
}

function handleVersionMigration() {
  const userDataPath = app.getPath('userData');
  const versionFilePath = path.join(userDataPath, 'version.json');
  const currentVersion = app.getVersion();

  let lastVersion = null;
  try {
    if (fs.existsSync(versionFilePath)) {
      const versionData = JSON.parse(fs.readFileSync(versionFilePath, 'utf-8'));
      lastVersion = versionData.version;
    }
  } catch (err) {
    console.warn('[Migration] Failed to read previous version file:', err.message);
  }

  if (lastVersion !== currentVersion) {
    console.log(`[Migration] Version change detected: ${lastVersion || 'first-run'} -> ${currentVersion}`);
    try {
      const migrationMarker = path.join(userDataPath, '.version-changed');
      fs.writeFileSync(migrationMarker, currentVersion, 'utf-8');
      console.log('[Migration] Marker file created:', migrationMarker);
    } catch (err) {
      console.error('[Migration] Failed to create marker file:', err);
    }
  }

  try {
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    fs.writeFileSync(versionFilePath, JSON.stringify({ version: currentVersion, timestamp: new Date().toISOString() }, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Migration] Failed to save version file:', err);
  }
}
function startServer() {
  if (useExternalServer) {
    console.log('[Electron] External dev server mode: skip embedded server start');
    return;
  }
  if (serverProcess || !shouldKeepEmbeddedServerAlive()) return;
  if (!reclaimDedicatedServerPort()) {
    console.error('[Electron] Cannot start until dedicated port 18731 is clean. Retrying.');
    scheduleServerRestart(1500);
    return;
  }

  const appRootPath = isDev ? path.join(__dirname, '..') : app.getAppPath();
  const unpackedServerScript = path.join(process.resourcesPath, 'app.asar.unpacked', 'server.cjs');
  const serverScriptPath = !isDev && fs.existsSync(unpackedServerScript)
    ? unpackedServerScript
    : path.join(appRootPath, 'server.cjs');
  // In packaged builds, force cwd to app.asar.unpacked for native modules and assets.
  const serverWorkingDirectory = isDev
    ? path.join(__dirname, '..')
    : path.join(process.resourcesPath, 'app.asar.unpacked');
  // Keep server credentials and the SQLite database on the same release-contract
  // root. app.getPath('userData') may resolve from the package name instead.
  const osooAppDataPath = path.join(
    process.env.APPDATA || process.env.LOCALAPPDATA || app.getPath('appData'),
    'Osoo_Handle_App'
  );

  serverInstanceToken = crypto.randomUUID();
  serverLaunchedAt = Date.now();
  const launchedAt = serverLaunchedAt;
  lastServerStderr = '';
  const launchedToken = serverInstanceToken;
  serverProcess = fork(serverScriptPath, [], {
    cwd: serverWorkingDirectory,
    stdio: 'pipe',
    env: {
      ...process.env,
      ELECTRON: '1',
      OSOO_PACKAGED: app.isPackaged ? '1' : '0',
      OSOO_APP_DATA_PATH: osooAppDataPath,
      // 진단 로그가 asar 패키징 환경에서도 정확한 버전을 기록하도록 main 프로세스에서 주입.
      OSOO_APP_VERSION: app.getVersion(),
      OSOO_API_PORT: String(DEDICATED_SERVER_PORT),
      OSOO_SERVER_TOKEN: launchedToken,
    }
  });
  const launchedProcess = serverProcess;
  let launchedStderr = '';
  appendElectronRecoveryDiagnostic('embedded-server-process', 'started', {
    pid: launchedProcess.pid,
    recovery: embeddedServerRecoveryInProgress,
  });

  serverProcess.stdout?.on('data', (data) => {
    console.log(`[Server] ${data.toString().trim()}`);
  });

  serverProcess.stderr?.on('data', (data) => {
    const message = sanitizeRuntimeMessage(data.toString());
    if (message) {
      launchedStderr = message;
      if (serverProcess === launchedProcess) lastServerStderr = message;
    }
    console.error(`[Server Error] ${data.toString().trim()}`);
  });

  launchedProcess.on('exit', (code, signal) => {
    const planned = plannedServerStopPids.delete(launchedProcess.pid);
    console.log(`[Server] Process exited with code ${code} signal ${signal || 'none'}`);
    appendElectronRecoveryDiagnostic('embedded-server-process', planned ? 'stopped' : 'failed', {
      pid: launchedProcess.pid,
      code,
      signal: signal || null,
      planned,
      uptimeMs: Date.now() - launchedAt,
      lastStderr: launchedStderr,
    });
    if (serverProcess === launchedProcess) serverProcess = null;
    if (serverInstanceToken === launchedToken) serverInstanceToken = null;
    if (serverProcess === null) serverLaunchedAt = 0;
    if (shouldKeepEmbeddedServerAlive() && !serverProcess && !serverRestartTimer) {
      embeddedServerRecoveryInProgress = true;
      notifyRendererServerRecovery('server-restarting');
      scheduleServerRestart();
    }
  });

  console.log('[Electron] Server process started');
}

function stopServer() {
  if (useExternalServer) return;
  if (serverProcess) {
    plannedServerStopPids.add(serverProcess.pid);
    serverProcess.kill();
    serverProcess = null;
    serverInstanceToken = null;
    serverLaunchedAt = 0;
  }
}

function stopServerGracefully(timeoutMs = 3000) {
  if (useExternalServer || !serverProcess) return Promise.resolve();
  const proc = serverProcess;
  plannedServerStopPids.add(proc.pid);

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (serverProcess === proc) serverProcess = null;
      resolve();
    };

    const timer = setTimeout(() => {
      try {
        if (!proc.killed) proc.kill('SIGKILL');
      } catch (_) {}
      finish();
    }, timeoutMs);
    timer.unref?.();

    proc.once('exit', () => {
      clearTimeout(timer);
      finish();
    });

    try {
      proc.kill();
    } catch (_) {
      clearTimeout(timer);
      finish();
    }
  });
}

function createWindow({ showOnReady = true } = {}) {
  const defaultSiteId = resolveDefaultWindowSiteId();
  const iconPath = isDev
    ? path.join(__dirname, '..', 'public', 'icon.ico')
    : path.join(process.resourcesPath, 'app.asar.unpacked', 'public', 'icon.ico');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },
    show: false,
    autoHideMenuBar: true,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    if (showOnReady) {
      mainWindow.show();
    }
  });

  if (isDev) {
    const url = defaultSiteId
      ? `http://localhost:18735/?siteId=${encodeURIComponent(defaultSiteId)}`
      : 'http://localhost:18735';
    mainWindow.loadURL(url);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
    if (defaultSiteId) {
      mainWindow.loadFile(indexPath, { query: { siteId: defaultSiteId } });
    } else {
      mainWindow.loadFile(indexPath);
    }
  }
  if (defaultSiteId) {
    console.log(`[Electron] Main window started with default siteId=${defaultSiteId}`);
  }

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.webContents.send('app:session-reset');
      mainWindow.hide();
      return false;
    }
  });

  mainWindow.on('closed', () => {
    clearRendererReadyTimer();
    mainWindow = null;
  });

  mainWindow.webContents.on('did-finish-load', () => {
    armRendererReadyTimeout();
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    appendElectronRecoveryDiagnostic('renderer-load-failed', 'failed', {
      errorCode,
      errorDescription: String(errorDescription || '').slice(0, 160),
      url: String(validatedURL || '').slice(0, 240),
    });
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    clearRendererReadyTimer();
    startCleanRendererRecovery(`render-process-gone:${String(details?.reason || 'unknown').slice(0, 80)}`);
  });

  const emitNativeFocusEvent = (eventName, details = {}) => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send('app:native-focus-event', {
      event: eventName,
      at: new Date().toISOString(),
      windowFocused: mainWindow.isFocused(),
      webContentsFocused: mainWindow.webContents.isFocused(),
      visible: mainWindow.isVisible(),
      minimized: mainWindow.isMinimized(),
      ...details,
    });
  };
  mainWindow.on('focus', () => emitNativeFocusEvent('browser-window-focus'));
  mainWindow.on('blur', () => emitNativeFocusEvent('browser-window-blur'));
  mainWindow.on('show', () => emitNativeFocusEvent('browser-window-show'));
  mainWindow.on('hide', () => emitNativeFocusEvent('browser-window-hide'));
  mainWindow.webContents.on('focus', () => emitNativeFocusEvent('web-contents-focus'));
  mainWindow.webContents.on('blur', () => emitNativeFocusEvent('web-contents-blur'));
}

function createSiteWindow(siteId, siteName) {
  const normalizedSiteId = String(siteId || '').trim();
  if (!normalizedSiteId) throw new Error('siteId is required');

  const existing = siteWindows.get(normalizedSiteId);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.maximize();
    existing.focus();
    if (!existing.webContents.isDestroyed()) {
      existing.webContents.focus();
      existing.webContents.send('app:window-restored', { reason: 'site-window-focus' });
    }
    return existing;
  }

  const iconPath = isDev
    ? path.join(__dirname, '..', 'public', 'icon.ico')
    : path.join(process.resourcesPath, 'app.asar.unpacked', 'public', 'icon.ico');
  const child = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: String(siteName || 'Osoo Handle App'),
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },
    show: false,
    autoHideMenuBar: true,
  });
  siteWindows.set(normalizedSiteId, child);

  child.once('ready-to-show', () => {
    child.maximize();
    child.show();
  });
  if (isDev) {
    child.loadURL(`http://localhost:18735/?siteId=${encodeURIComponent(normalizedSiteId)}`);
  } else {
    child.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
      query: { siteId: normalizedSiteId },
    });
  }
  child.on('focus', () => {
    if (!child.webContents.isDestroyed()) {
      child.webContents.send('app:window-restored', { reason: 'site-window-focus' });
    }
  });
  child.on('closed', () => {
    if (siteWindows.get(normalizedSiteId) === child) {
      siteWindows.delete(normalizedSiteId);
    }
  });
  return child;
}

function registerSiteWindow(siteId, window) {
  const normalizedSiteId = String(siteId || '').trim();
  if (!normalizedSiteId || !window || window.isDestroyed()) return;

  // A BrowserWindow represents exactly one active site. Remove any stale
  // alias for the same window before registering its current site.
  for (const [registeredSiteId, registeredWindow] of siteWindows.entries()) {
    if (registeredWindow === window && registeredSiteId !== normalizedSiteId) {
      siteWindows.delete(registeredSiteId);
    }
  }
  siteWindows.set(normalizedSiteId, window);
}

let sharedAuthenticatedUser = null;

function setupRoadworkSafeUsePopupGuard() {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return;

    contents.on('did-create-window', (popupWindow) => {
      let inspectionStarted = false;
      let exactTitleSeen = popupWindow.getTitle() === '도로통합플랫폼 안내';
      const inspectExactNotice = async () => {
        if (inspectionStarted || popupWindow.isDestroyed()) return;
        if (!exactTitleSeen && popupWindow.getTitle() !== '도로통합플랫폼 안내') return;
        inspectionStarted = true;
        popupWindow.hide();

        try {
          const matched = await popupWindow.webContents.executeJavaScript(`
            (() => {
              const text = String(document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
              const isExactNotice = text.includes('[안전한 PC 사용을 위한 공지]')
                && text.includes('사용자 계정 공유사용 금지')
                && text.includes('오늘 하루 그만보기')
                && !text.includes('확인번호')
                && !text.includes('인증번호');
              if (!isExactNotice) return false;

              const checkbox = document.querySelector('input[type="checkbox"]');
              if (checkbox && !checkbox.checked) checkbox.click();
              const controls = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a'));
              const confirm = controls.find((control) => {
                const label = String(control.innerText || control.value || '').replace(/\\s+/g, ' ').trim();
                return label === '확인';
              });
              if (confirm) confirm.click();
              return true;
            })()
          `);
          if (matched) {
            if (!popupWindow.isDestroyed()) popupWindow.close();
          } else if (!popupWindow.isDestroyed()) {
            popupWindow.show();
          }
        } catch (error) {
          console.warn('[Roadwork] Safe-use notice inspection failed:', error.message);
          if (!popupWindow.isDestroyed()) popupWindow.show();
        }
      };

      popupWindow.webContents.on('page-title-updated', (_titleEvent, title) => {
        if (title !== '도로통합플랫폼 안내') return;
        exactTitleSeen = true;
        if (!popupWindow.isDestroyed()) popupWindow.hide();
      });
      popupWindow.webContents.once('did-finish-load', inspectExactNotice);
    });
  });
}

function createHiddenPdfWindow() {
  return new BrowserWindow({
    show: false,
    width: 1280,
    height: 960,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
    },
  });
}

async function waitForPdfContentReady(webContents) {
  await webContents.executeJavaScript(`
    new Promise((resolve) => {
      const imagePromises = Array.from(document.images || []).map((image) => {
        if (image.complete) {
          return Promise.resolve();
        }

        return new Promise((done) => {
          image.addEventListener('load', done, { once: true });
          image.addEventListener('error', done, { once: true });
        });
      });

      const fontReady = document.fonts?.ready || Promise.resolve();

      Promise.all([fontReady, ...imagePromises])
        .catch(() => undefined)
        .finally(() => setTimeout(resolve, 150));
    });
  `);
}

async function buildPdfBufferFromHtml(htmlContent, printBackground) {
  const pdfWindow = createHiddenPdfWindow();

  try {
    await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
    await waitForPdfContentReady(pdfWindow.webContents);
    return await pdfWindow.webContents.printToPDF({
      printBackground,
      pageSize: 'A4',
      preferCSSPageSize: true,
    });
  } finally {
    if (!pdfWindow.isDestroyed()) {
      pdfWindow.destroy();
    }
  }
}

function createTray() {
  const iconPath = isDev
    ? path.join(__dirname, '..', 'public', 'icon.ico')
    : path.join(process.resourcesPath, 'app.asar.unpacked', 'public', 'icon.ico');

  tray = new Tray(iconPath);
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '창 열기',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.focus();
          console.log('[Tray] Restore requested from menu');
          setTimeout(() => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            mainWindow.focus();
            mainWindow.webContents.focus();
            mainWindow.webContents.send('app:window-restored', { reason: 'tray-menu' });
          }, 50);
        }
      }
    },
    { type: 'separator' },
    {
      label: '완전 종료',
      click: () => {
        try {
          writeMaintenanceLock('full-exit', FULL_EXIT_LOCK_TTL_MS);
          console.log('[MaintenanceLock] Full-exit lock written');
        } catch (error) {
          console.warn('[MaintenanceLock] Failed to write full-exit lock:', error.message);
        }
        isQuitting = true;
        console.log('[Tray] Full exit requested by user');
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Osoo Handle App');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.focus();
      console.log('[Tray] Restore requested by double-click');
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.focus();
        mainWindow.webContents.focus();
        mainWindow.webContents.send('app:window-restored', { reason: 'tray-double-click' });
      }, 50);
    }
  });
}

// 단일 인스턴스 락: 이미 실행 중인 경우 두 번째 창은 종료하고 기존 창을 포커스한다.
// 트레이 아이콘이 2개 뜨거나 두 프로세스가 같은 DB를 잡고 충돌하는 것을 방지한다.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // app.quit() is asynchronous and can still allow whenReady handlers to run.
  // A duplicate process must never start the local server or updater.
  console.log('[Electron] Duplicate instance rejected before initialization');
  app.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.focus();
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.focus();
      mainWindow.webContents.focus();
      mainWindow.webContents.send('app:window-restored', { reason: 'second-instance' });
    }, 50);
  }
});

app.whenReady().then(() => {
  console.log(`[Electron] App startup (background=${isBackgroundStartup ? 'yes' : 'no'})`);
  configureWindowsBackgroundStartup();
  setupRoadworkSafeUsePopupGuard();
  try {
    require('./roadworkDumpHelper.cjs')(ipcMain, app, { isDev });
    console.log('[Roadwork] IPC handlers loaded.');
  } catch (error) {
    console.warn('[Roadwork] Failed to load IPC handlers:', error.message);
  }

  handleVersionMigration();
  startServer();
  startServerGuard();
  startWatchdogServerRecoveryRequestMonitor();
  startWatchdogHeartbeat();
  startRuntimeTelemetry();
  createWindow({ showOnReady: !isBackgroundStartup });
  createTray();
  waitForServerReadyAndClearMaintenanceLocks().catch((error) => {
    console.warn('[MaintenanceLock] Failed while waiting for server readiness:', error.message);
  });

  if (!isDev) {
    setupAutoUpdater(mainWindow, {
      logFilePath: path.join(app.getPath('appData'), 'Osoo_Handle_App', 'logs', 'electron-updater.log'),
      onUpdaterDiagnostic: ({ action, result, message }) => {
        appendElectronRecoveryDiagnostic(action, result, { message });
      },
      onBeforeInstall: async () => {
        isUpdateInstalling = true;
        isQuitting = true;
        if (serverGuardTimer) clearInterval(serverGuardTimer);
        if (serverRestartTimer) clearTimeout(serverRestartTimer);
        serverGuardTimer = null;
        serverRestartTimer = null;
        stopWatchdogServerRecoveryRequestMonitor();
        stopWatchdogHeartbeat();
        stopRuntimeTelemetry();
        await stopServerGracefully();
      },
    });
  }
});

app.on('window-all-closed', () => {
  stopServer();
  app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  console.log('[Electron] before-quit: app shutdown sequence started');
  if (serverGuardTimer) clearInterval(serverGuardTimer);
  if (serverRestartTimer) clearTimeout(serverRestartTimer);
  serverGuardTimer = null;
  serverRestartTimer = null;
  stopWatchdogServerRecoveryRequestMonitor();
  stopWatchdogHeartbeat();
  stopRuntimeTelemetry();
  stopServer();
});

ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:getDefaultSiteContext', () => {
  const siteId = resolveDefaultWindowSiteId();
  return { siteId };
});
ipcMain.handle('app:getWindowFocusState', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return {
      available: false,
      windowFocused: false,
      webContentsFocused: false,
      visible: false,
      minimized: false,
    };
  }
  return {
    available: true,
    windowFocused: mainWindow.isFocused(),
    webContentsFocused: mainWindow.webContents.isFocused(),
    visible: mainWindow.isVisible(),
    minimized: mainWindow.isMinimized(),
  };
});
ipcMain.handle('app:recoverWindowFocus', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { recovered: false, reason: 'window-unavailable' };
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  // Chromium can lose document focus while Electron still reports the
  // BrowserWindow/webContents as focused. A plain focus() is then a no-op.
  // Only the renderer's anomaly detector calls this handler, so force a real
  // native focus transition to rebuild the Windows/Chromium focus chain.
  mainWindow.blur();
  await new Promise((resolve) => setTimeout(resolve, 40));
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { recovered: false, reason: 'window-destroyed-during-recovery' };
  }
  mainWindow.focus();
  mainWindow.webContents.focus();
  await new Promise((resolve) => setTimeout(resolve, 20));
  return {
    recovered: true,
    windowFocused: mainWindow.isFocused(),
    webContentsFocused: mainWindow.webContents.isFocused(),
  };
});
ipcMain.handle('server:getToken', () => serverInstanceToken || '');
ipcMain.handle('app:getStartupRecoveryState', () => startupRecoveryState);
ipcMain.handle('app:reportRendererReady', () => {
  clearRendererReadyTimer();
  clearExternalEmergencyRecoveryRequest('cancelled-renderer-ready');
  const recovered = rendererRecoveryAttempts > 0;
  rendererRecoveryAttempts = 0;
  rendererRecoveryInProgress = false;
  publishStartupRecoveryState('renderer-ready', { recovered }, { diagnostic: recovered });
  return { ok: true, recovered };
});
ipcMain.handle('app:checkVersionChanged', async () => {
  const userDataPath = app.getPath('userData');
  const markerPath = path.join(userDataPath, '.version-changed');
  try {
    const exists = fs.existsSync(markerPath);
    if (exists) {
      const version = fs.readFileSync(markerPath, 'utf-8').trim();
      return { versionChanged: true, version };
    }
    return { versionChanged: false };
  } catch (err) {
    console.error('[IPC] Failed to check version marker:', err);
    return { versionChanged: false, error: err.message };
  }
});
ipcMain.handle('app:clearVersionMarker', async () => {
  const userDataPath = app.getPath('userData');
  const markerPath = path.join(userDataPath, '.version-changed');
  try {
    if (fs.existsSync(markerPath)) {
      fs.unlinkSync(markerPath);
      console.log('[IPC] Version marker cleared');
    }
    return { ok: true };
  } catch (err) {
    console.error('[IPC] Failed to clear version marker:', err);
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('shell:openFile', async (_event, filePath) => {
  const err = await shell.openPath(filePath);
  if (err) throw new Error(err);
  return { ok: true };
});
ipcMain.handle('shell:openFolder', async (_event, target) => {
  const appDataRoot = path.join(
    process.env.APPDATA || process.env.LOCALAPPDATA || app.getPath('appData'),
    'Osoo_Handle_App'
  );
  const folderMap = {
    'excel-originals': path.join(appDataRoot, 'templates', 'excel-originals'),
    reports: path.join(appDataRoot, 'templates', 'reports'),
  };
  const folderPath = folderMap[String(target || '').trim()];
  if (!folderPath) throw new Error('허용되지 않은 폴더입니다.');
  fs.mkdirSync(folderPath, { recursive: true });
  const err = await shell.openPath(folderPath);
  if (err) throw new Error(err);
  return { ok: true, path: folderPath };
});
ipcMain.handle('app:checkForUpdates', (_event, reason = 'manual') => {
  return checkForUpdates(reason);
});

ipcMain.handle('app:installUpdate', async () => {
  if (!hasDownloadedUpdate()) {
    return { ok: false, reason: 'no-downloaded-update' };
  }
  const started = await installDownloadedUpdateAndQuit();
  return { ok: started };
});

ipcMain.handle('app:getUpdateStatus', () => {
  return { hasDownloadedUpdate: hasDownloadedUpdate() };
});

ipcMain.handle('app:hideToTray', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:session-reset');
    mainWindow.hide();
  }
  return { ok: true };
});
ipcMain.handle('app:openSiteWindow', (event, site = {}) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  registerSiteWindow(site.currentSiteId, sourceWindow);
  const child = createSiteWindow(site.siteId, site.siteName);
  return { success: true, siteId: String(site.siteId || ''), focused: child.isFocused() };
});
ipcMain.handle('auth:setSharedUser', (_event, user = null) => {
  sharedAuthenticatedUser = user && typeof user === 'object'
    ? { ...user, password: undefined }
    : null;
  return { success: true };
});
ipcMain.handle('auth:getSharedUser', () => sharedAuthenticatedUser);
ipcMain.handle('auth:resetGlobalSession', (_event, options = {}) => {
  const hideMain = options?.hideMain === true;
  sharedAuthenticatedUser = null;

  for (const siteWindow of new Set(siteWindows.values())) {
    if (siteWindow && !siteWindow.isDestroyed() && siteWindow !== mainWindow) {
      siteWindow.close();
    }
  }
  siteWindows.clear();

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('app:global-session-reset');
    }
    if (hideMain) {
      mainWindow.hide();
    } else {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  }
  return { success: true };
});

ipcMain.handle('notification:showPopupNotice', (event, rawNotice = {}) => {
  const noticeId = String(rawNotice?.id || '').trim().slice(0, 160);
  if (!noticeId || !Notification.isSupported()) {
    return { shown: false, reason: noticeId ? 'unsupported' : 'invalid-notice' };
  }

  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  if (sourceWindow && !sourceWindow.isDestroyed()
    && sourceWindow.isVisible() && !sourceWindow.isMinimized() && sourceWindow.isFocused()) {
    return { shown: false, reason: 'window-active' };
  }
  const title = String(rawNotice?.title || '🚨 [중앙 긴급 공지]').trim().slice(0, 120);
  const body = String(
    rawNotice?.body || '새 중요 메시지가 등록되었습니다'
  ).trim().slice(0, 240);
  const notification = new Notification({
    title,
    body,
    silent: false,
    timeoutType: 'default',
  });

  notification.on('click', () => {
    const targetWindow = sourceWindow && !sourceWindow.isDestroyed()
      ? sourceWindow
      : mainWindow;
    if (!targetWindow || targetWindow.isDestroyed()) return;
    if (targetWindow.isMinimized()) targetWindow.restore();
    targetWindow.show();
    targetWindow.setAlwaysOnTop(true);
    targetWindow.focus();
    targetWindow.webContents.focus();
    targetWindow.webContents.send('notification:openPopupModal', { noticeId });
    setTimeout(() => {
      if (!targetWindow.isDestroyed()) targetWindow.setAlwaysOnTop(false);
    }, 1200);
  });

  notification.show();
  return { shown: true };
});

ipcMain.handle('pdf:save', async (_event, options = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('메인 윈도우가 준비되지 않았습니다.');
  }

  const { defaultFileName = 'report.pdf', printBackground = true, htmlContent = '' } = options;

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'PDF로 저장',
    defaultPath: defaultFileName,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });

  if (canceled || !filePath) {
    return { canceled: true };
  }

  const pdfBuffer = htmlContent
    ? await buildPdfBufferFromHtml(htmlContent, printBackground)
    : await mainWindow.webContents.printToPDF({
      printBackground,
      pageSize: 'A4',
    });

  fs.writeFileSync(filePath, pdfBuffer);
  return { canceled: false, filePath };
});
