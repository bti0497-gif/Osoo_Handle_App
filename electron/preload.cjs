const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getDefaultSiteContext: () => ipcRenderer.invoke('app:getDefaultSiteContext'),
  getServerToken: () => ipcRenderer.invoke('server:getToken'),
  checkForUpdates: (reason) => ipcRenderer.invoke('app:checkForUpdates', reason),
  installUpdate: () => ipcRenderer.invoke('app:installUpdate'),
  getUpdateStatus: () => ipcRenderer.invoke('app:getUpdateStatus'),
  onUpdateChecking: (callback) => ipcRenderer.on('update:checking', (_event, info) => callback(info)),
  onUpdateAvailable: (callback) => ipcRenderer.on('update:available', (_event, info) => callback(info)),
  onUpdateNotAvailable: (callback) => ipcRenderer.on('update:not-available', (_event, info) => callback(info)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update:downloaded', (_event, info) => callback(info)),
  onUpdateProgress: (callback) => ipcRenderer.on('update:progress', (_event, progress) => callback(progress)),
  onUpdateError: (callback) => ipcRenderer.on('update:error', (_event, err) => callback(err)),
  onUpdateInstalling: (callback) => ipcRenderer.on('update:installing', (_event, info) => callback(info)),
  savePdf: (options) => ipcRenderer.invoke('pdf:save', options),
  openFile: (filePath) => ipcRenderer.invoke('shell:openFile', filePath),
  openFolder: (target) => ipcRenderer.invoke('shell:openFolder', target),
  checkVersionChanged: () => ipcRenderer.invoke('app:checkVersionChanged'),
  clearVersionMarker: () => ipcRenderer.invoke('app:clearVersionMarker'),
  getWindowFocusState: () => ipcRenderer.invoke('app:getWindowFocusState'),
  recoverWindowFocus: () => ipcRenderer.invoke('app:recoverWindowFocus'),
  onNativeFocusEvent: (callback) => {
    const listener = (_event, info) => callback(info || {});
    ipcRenderer.on('app:native-focus-event', listener);
    return () => ipcRenderer.removeListener('app:native-focus-event', listener);
  },
  hideToTray: () => ipcRenderer.invoke('app:hideToTray'),
  openSiteWindow: (site) => ipcRenderer.invoke('app:openSiteWindow', site),
  setSharedAuthenticatedUser: (user) => ipcRenderer.invoke('auth:setSharedUser', user),
  getSharedAuthenticatedUser: () => ipcRenderer.invoke('auth:getSharedUser'),
  resetGlobalAuthenticatedSession: (options) => ipcRenderer.invoke('auth:resetGlobalSession', options),
  showPopupNotification: (notice) => ipcRenderer.invoke('notification:showPopupNotice', notice),
  onOpenPopupModal: (callback) => {
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('notification:openPopupModal', listener);
    return () => ipcRenderer.removeListener('notification:openPopupModal', listener);
  },
  onSessionReset: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('app:session-reset', listener);
    return () => ipcRenderer.removeListener('app:session-reset', listener);
  },
  onGlobalSessionReset: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('app:global-session-reset', listener);
    return () => ipcRenderer.removeListener('app:global-session-reset', listener);
  },
  onWindowRestored: (callback) => {
    const listener = (_event, info) => callback(info || {});
    ipcRenderer.on('app:window-restored', listener);
    return () => ipcRenderer.removeListener('app:window-restored', listener);
  },
  invokeRoadwork: (channel, ...args) => {
    const allowed = [
      'roadwork:getPreloadPath',
      'roadwork:dumpHtml',
      'roadwork:generateNewPassword',
      'roadwork:confirmPasswordChange',
      'roadwork:getRoadworkUrl',
      'roadwork:getCredentials',
      'roadwork:getCredentialStatus',
      'roadwork:dumpStructure',
      'roadwork:keepSessionAlive',
      'roadwork:clearSessions',
    ];
    if (allowed.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    return Promise.reject(new Error('Unauthorized channel'));
  }
});
