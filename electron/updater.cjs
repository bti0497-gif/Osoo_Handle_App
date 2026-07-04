let autoUpdater = null;
let updateDownloaded = false;
let checkingForUpdate = false;
let installingUpdate = false;
let downloadedVersion = null;

const DAILY_UPDATE_CHECK_HOUR = Number(process.env.OSOO_DAILY_UPDATE_CHECK_HOUR || 9);
const DAILY_UPDATE_CHECK_MINUTE = Number(process.env.OSOO_DAILY_UPDATE_CHECK_MINUTE || 0);

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
  console.log(`[Updater] Check requested: ${reason}`);
  if (autoUpdater.__mainWindow) {
    sendUpdateEvent(autoUpdater.__mainWindow, 'update:checking', { reason });
  }
  return autoUpdater.checkForUpdatesAndNotify()
    .finally(() => {
      checkingForUpdate = false;
    });
}

function scheduleDailyUpdateCheck() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(
    Number.isFinite(DAILY_UPDATE_CHECK_HOUR) ? DAILY_UPDATE_CHECK_HOUR : 9,
    Number.isFinite(DAILY_UPDATE_CHECK_MINUTE) ? DAILY_UPDATE_CHECK_MINUTE : 0,
    0,
    0
  );
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  const delayMs = next.getTime() - now.getTime();
  const timer = setTimeout(() => {
    checkForUpdates('daily-09:00').catch((err) => {
      console.error('[Updater] Daily check failed:', err.message);
    }).finally(scheduleDailyUpdateCheck);
  }, delayMs);
  timer.unref?.();
}

function setupAutoUpdater(mainWindow, options = {}) {
  if (!autoUpdater) {
    return false;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.__mainWindow = mainWindow;
  autoUpdater.__installOptions = options;

  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update available:', info.version);
    sendUpdateEvent(mainWindow, 'update:available', {
      version: info.version,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] App is up to date.');
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
    console.log('[Updater] Update downloaded:', info.version);
    sendUpdateEvent(mainWindow, 'update:downloaded', {
      version: info.version,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err);
    sendUpdateEvent(mainWindow, 'update:error', err.message);
  });

  checkForUpdates('startup').catch((err) => {
    console.error('[Updater] Startup check failed:', err.message);
  });
  scheduleDailyUpdateCheck();

  return true;
}

async function installDownloadedUpdateAndQuit() {
  if (!autoUpdater) {
    return false;
  }
  if (!updateDownloaded) {
    return false;
  }
  console.log('[Updater] Installing downloaded update and quitting...');
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
