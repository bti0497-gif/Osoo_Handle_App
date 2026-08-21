const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('photoDiagnostic', {
  chooseReference: () => ipcRenderer.invoke('diagnostic:choose-reference'),
  probeServer: () => ipcRenderer.invoke('diagnostic:probe-server'),
  log: (event, details) => ipcRenderer.send('diagnostic:log', { event, details }),
  finish: (summary) => ipcRenderer.invoke('diagnostic:finish', summary),
});
