const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const { setupAutoUpdater } = require('./updater.cjs');

let mainWindow = null;
let serverProcess = null;

const isDev = !app.isPackaged;
const SERVER_SCRIPT = path.join(__dirname, '..', 'server.cjs');

function startServer() {
  if (serverProcess) return;

  serverProcess = fork(SERVER_SCRIPT, [], {
    cwd: path.join(__dirname, '..'),
    stdio: 'pipe',
    env: { ...process.env, ELECTRON: '1' }
  });

  serverProcess.stdout?.on('data', (data) => {
    console.log(`[Server] ${data.toString().trim()}`);
  });

  serverProcess.stderr?.on('data', (data) => {
    console.error(`[Server Error] ${data.toString().trim()}`);
  });

  serverProcess.on('exit', (code) => {
    console.log(`[Server] Process exited with code ${code}`);
    serverProcess = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      setTimeout(() => startServer(), 2000);
    }
  });

  console.log('[Electron] Server process started');
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Osoo Handle App',
    icon: path.join(__dirname, '..', 'public', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
    autoHideMenuBar: true,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:8900');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  startServer();
  createWindow();

  if (!isDev) {
    setupAutoUpdater(mainWindow);
  }
});

app.on('window-all-closed', () => {
  stopServer();
  app.quit();
});

app.on('before-quit', () => {
  stopServer();
});

ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:checkForUpdates', () => {
  const { autoUpdater } = require('electron-updater');
  autoUpdater.checkForUpdatesAndNotify();
});
