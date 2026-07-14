let autoUpdater = null;
let updateDownloaded = false;
let checkingForUpdate = false;
let installingUpdate = false;
let downloadedVersion = null;
let updateLogPath = null;

function writeUpdateLog(event, details = {}) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...details,
  });
  console.log(`[Updater] ${entry}`);
  if (!updateLogPath) return;
  try {
    const fs = require('fs');
    const path = require('path');
    fs.mkdirSync(path.dirname(updateLogPath), { recursive: true });
    fs.appendFileSync(updateLogPath, `${entry}\n`, 'utf8');
  } catch (error) {
    console.warn('[Updater] Failed to write update log:', error.message);
  }
}

try {
  ({ autoUpdater } = require('electron-updater'));
} catch (error) {
  console.warn('[Updater] electron-updater를 찾을 수 없어 자동 업데이트를 비활성화합니다.', error.message);
}

function sendUpdateEvent(mainWindow, channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
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
  writeUpdateLog('check-requested', { reason });
  if (autoUpdater.__mainWindow) {
    sendUpdateEvent(autoUpdater.__mainWindow, 'update:checking', { reason });
  }
  return autoUpdater.checkForUpdatesAndNotify()
    .then((result) => {
      writeUpdateLog('check-completed', {
        reason,
        version: result?.updateInfo?.version || null,
      });
      return result;
    })
    .catch((error) => {
      writeUpdateLog('check-failed', { reason, message: error.message });
      throw error;
    })
    .finally(() => {
      checkingForUpdate = false;
    });
}

function setupAutoUpdater(mainWindow, options = {}) {
  if (!autoUpdater) {
    return false;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.__mainWindow = mainWindow;
  autoUpdater.__installOptions = options;
  updateLogPath = options.logFilePath || null;
  writeUpdateLog('updater-initialized', { currentVersion: autoUpdater.currentVersion?.version || null });

  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    writeUpdateLog('update-available', { version: info.version });
    sendUpdateEvent(mainWindow, 'update:available', {
      version: info.version,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on('update-not-available', () => {
    writeUpdateLog('update-not-available');
    sendUpdateEvent(mainWindow, 'update:not-available', {});
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[Updater] Download: ${Math.round(progress.percent)}%`);
    sendUpdateEvent(mainWindow, 'update:progress', {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateDownloaded = true;
    downloadedVersion = info.version || null;
    writeUpdateLog('update-downloaded', { version: info.version });
    sendUpdateEvent(mainWindow, 'update:downloaded', {
      version: info.version,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on('error', (err) => {
    writeUpdateLog('updater-error', { message: err.message });
    sendUpdateEvent(mainWindow, 'update:error', err.message);
  });

  return true;
}

async function installDownloadedUpdateAndQuit() {
  if (!autoUpdater) {
    return false;
  }
  if (!updateDownloaded) {
    return false;
  }
  writeUpdateLog('install-started', { version: downloadedVersion });
  installingUpdate = true;
  sendUpdateEvent(autoUpdater.__mainWindow, 'update:installing', {
    version: downloadedVersion,
  });
  await autoUpdater.__installOptions?.onBeforeInstall?.();
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
};
