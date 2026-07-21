function setupAutoUpdater() {
  console.log('[Updater] Windows 7 x86 호환판은 자동 업데이트를 사용하지 않습니다.');
  return false;
}

function checkForUpdates() {
  return Promise.resolve({ skipped: true, reason: 'legacy-win7-x86' });
}

function installDownloadedUpdateAndQuit() {
  return Promise.resolve(false);
}

function hasDownloadedUpdate() {
  return false;
}

module.exports = {
  setupAutoUpdater,
  checkForUpdates,
  installDownloadedUpdateAndQuit,
  hasDownloadedUpdate,
};
