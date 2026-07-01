const { powerMonitor } = require('electron');

let autoUpdater = null;
let updateDownloaded = false;
let updateCheckTimer = null;
let checkingForUpdate = false;
let installRetryTimer = null;
let lastActivityAt = Date.now();
let installingUpdate = false;

const UPDATE_CHECK_INTERVAL_MS = Number(process.env.OSOO_UPDATE_CHECK_INTERVAL_MS || 60 * 60 * 1000);
const UPDATE_INSTALL_IDLE_MS = Number(process.env.OSOO_UPDATE_INSTALL_IDLE_MS || 5 * 60 * 1000);
const UPDATE_INSTALL_RETRY_MS = Number(process.env.OSOO_UPDATE_INSTALL_RETRY_MS || 30 * 1000);

try {
  ({ autoUpdater } = require('electron-updater'));
} catch (error) {
  console.warn('[Updater] electron-updater를 찾을 수 없어 자동 업데이트를 비활성화합니다.', error.message);
}

function checkForUpdates(reason = 'manual') {
  if (!autoUpdater) {
    throw new Error('자동 업데이트 모듈을 찾을 수 없습니다.');
  }
  if (checkingForUpdate) {
    console.log(`[Updater] Skip update check (${reason}): already checking`);
    return Promise.resolve({ skipped: true, reason: 'already-checking' });
  }
  checkingForUpdate = true;
  console.log(`[Updater] Check requested: ${reason}`);
  return autoUpdater.checkForUpdatesAndNotify()
    .finally(() => {
      checkingForUpdate = false;
    });
}

function markUserActivity() {
  lastActivityAt = Date.now();
}

function getIdleMs() {
  const appIdleMs = Date.now() - lastActivityAt;
  let systemIdleMs = appIdleMs;
  try {
    systemIdleMs = Number(powerMonitor.getSystemIdleTime() || 0) * 1000;
  } catch (_) {
    systemIdleMs = appIdleMs;
  }
  return Math.min(appIdleMs, systemIdleMs);
}

function scheduleIdleInstall(mainWindow, options = {}) {
  if (!autoUpdater || !updateDownloaded || installingUpdate) return;
  if (installRetryTimer) return;

  const tryInstall = () => {
    installRetryTimer = null;
    if (!updateDownloaded || installingUpdate) return;

    const idleMs = getIdleMs();
    if (idleMs < UPDATE_INSTALL_IDLE_MS) {
      const waitMs = Math.max(UPDATE_INSTALL_RETRY_MS, UPDATE_INSTALL_IDLE_MS - idleMs);
      console.log(`[Updater] Waiting for idle install: idle=${Math.round(idleMs / 1000)}s`);
      installRetryTimer = setTimeout(tryInstall, waitMs);
      installRetryTimer.unref?.();
      return;
    }

    installingUpdate = true;
    console.log('[Updater] Idle window reached. Installing update and restarting app...');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:installing', {
        idleSeconds: Math.round(idleMs / 1000),
      });
    }
    options.onBeforeInstall?.();
    autoUpdater.quitAndInstall(false, true);
  };

  installRetryTimer = setTimeout(tryInstall, UPDATE_INSTALL_RETRY_MS);
  installRetryTimer.unref?.();
}

function setupAutoUpdater(mainWindow, options = {}) {
  if (!autoUpdater) {
    return false;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.on('before-input-event', () => {
      markUserActivity();
    });
    mainWindow.on('show', markUserActivity);
    mainWindow.on('focus', markUserActivity);
  }

  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update available:', info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:available', {
        version: info.version,
        releaseDate: info.releaseDate,
      });
    }
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] App is up to date.');
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[Updater] Download: ${Math.round(progress.percent)}%`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:progress', {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateDownloaded = true;
    console.log('[Updater] Update downloaded:', info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:downloaded', {
        version: info.version,
        releaseDate: info.releaseDate,
      });
    }
    scheduleIdleInstall(mainWindow, options);
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:error', err.message);
    }
  });

  checkForUpdates('startup').catch((err) => {
    console.error('[Updater] Startup check failed:', err.message);
  });

  if (!updateCheckTimer && UPDATE_CHECK_INTERVAL_MS > 0) {
    updateCheckTimer = setInterval(() => {
      checkForUpdates('periodic').catch((err) => {
        console.error('[Updater] Periodic check failed:', err.message);
      });
    }, UPDATE_CHECK_INTERVAL_MS);
    updateCheckTimer.unref?.();
  }

  return true;
}

function installDownloadedUpdateAndQuit() {
  if (!autoUpdater) {
    return false;
  }
  if (!updateDownloaded) {
    return false;
  }
  console.log('[Updater] Installing downloaded update and quitting...');
  autoUpdater.quitAndInstall(false, true);
  return true;
}

function hasDownloadedUpdate() {
  return updateDownloaded;
}

module.exports = {
  setupAutoUpdater,
  checkForUpdates,
  installDownloadedUpdateAndQuit,
  hasDownloadedUpdate,
  markUserActivity,
};
