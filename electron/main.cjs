const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');
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
let serverProcess = null;
let tray = null;
let isQuitting = false;

const isDev = !app.isPackaged;
const useExternalServer = isDev && process.env.OSOO_EXTERNAL_SERVER === '1';

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
  if (serverProcess) return;

  const appRootPath = isDev ? path.join(__dirname, '..') : app.getAppPath();
  const unpackedServerScript = path.join(process.resourcesPath, 'app.asar.unpacked', 'server.cjs');
  const serverScriptPath = !isDev && fs.existsSync(unpackedServerScript)
    ? unpackedServerScript
    : path.join(appRootPath, 'server.cjs');
  // In packaged builds, force cwd to app.asar.unpacked for native modules and assets.
  const serverWorkingDirectory = isDev
    ? path.join(__dirname, '..')
    : path.join(process.resourcesPath, 'app.asar.unpacked');

  serverProcess = fork(serverScriptPath, [], {
    cwd: serverWorkingDirectory,
    stdio: 'pipe',
    env: {
      ...process.env,
      ELECTRON: '1',
      OSOO_PACKAGED: app.isPackaged ? '1' : '0',
      OSOO_APP_DATA_PATH: app.getPath('userData'),
      // 진단 로그가 asar 패키징 환경에서도 정확한 버전을 기록하도록 main 프로세스에서 주입.
      OSOO_APP_VERSION: app.getVersion(),
    }
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
    if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
      setTimeout(() => startServer(), 2000);
    }
  });

  console.log('[Electron] Server process started');
}

function stopServer() {
  if (useExternalServer) return;
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

function stopServerGracefully(timeoutMs = 3000) {
  if (useExternalServer || !serverProcess) return Promise.resolve();
  const proc = serverProcess;

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

function createWindow() {
  const iconPath = isDev
    ? path.join(__dirname, '..', 'public', 'icon.ico')
    : path.join(process.resourcesPath, 'app.asar.unpacked', 'public', 'icon.ico');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'PDF로 저장',
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
    mainWindow.show();
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:18735');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
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
    mainWindow = null;
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
      label: '열기',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: '종료',
      click: () => {
        isQuitting = true;
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
    }
  });
}

// 단일 인스턴스 락: 이미 실행 중인 경우 두 번째 창은 종료하고 기존 창을 포커스한다.
// 트레이 아이콘이 2개 뜨거나 두 프로세스가 같은 DB를 잡고 충돌하는 것을 방지한다.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  try {
    require('./roadworkDumpHelper.cjs')(ipcMain, app, { isDev });
    console.log('[Roadwork] IPC handlers loaded.');
  } catch (error) {
    console.warn('[Roadwork] Failed to load IPC handlers:', error.message);
  }

  handleVersionMigration();
  startServer();
  createWindow();
  createTray();

  if (!isDev) {
    setupAutoUpdater(mainWindow, {
      onBeforeInstall: async () => {
        isQuitting = true;
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
  stopServer();
});

ipcMain.handle('app:getVersion', () => app.getVersion());
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

