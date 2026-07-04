const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
  installUpdate: () => ipcRenderer.invoke('app:installUpdate'),
  onUpdateChecking: (callback) => ipcRenderer.on('update:checking', (_event, info) => callback(info)),
  onUpdateAvailable: (callback) => ipcRenderer.on('update:available', (_event, info) => callback(info)),
  onUpdateNotAvailable: (callback) => ipcRenderer.on('update:not-available', (_event, info) => callback(info)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update:downloaded', (_event, info) => callback(info)),
  onUpdateProgress: (callback) => ipcRenderer.on('update:progress', (_event, progress) => callback(progress)),
  onUpdateError: (callback) => ipcRenderer.on('update:error', (_event, err) => callback(err)),
  onUpdateInstalling: (callback) => ipcRenderer.on('update:installing', (_event, info) => callback(info)),
  savePdf: (options) => ipcRenderer.invoke('pdf:save', options),
  openFile: (filePath) => ipcRenderer.invoke('shell:openFile', filePath),
  checkVersionChanged: () => ipcRenderer.invoke('app:checkVersionChanged'),
  clearVersionMarker: () => ipcRenderer.invoke('app:clearVersionMarker'),
  hideToTray: () => ipcRenderer.invoke('app:hideToTray'),
  invokeRoadwork: (channel, ...args) => {
    const allowed = [
      'roadwork:getPreloadPath',
      'roadwork:dumpHtml',
      'roadwork:generateNewPassword',
      'roadwork:confirmPasswordChange',
      'roadwork:getRoadworkUrl',
      'roadwork:getCredentials',
      'roadwork:getCredentialStatus'
    ];
    if (allowed.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    return Promise.reject(new Error('Unauthorized channel'));
  }
});
