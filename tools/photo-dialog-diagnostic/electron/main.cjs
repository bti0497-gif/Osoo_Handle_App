const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

let mainWindow = null;
let sessionFolder = '';
let eventsPath = '';
let sequence = 0;

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function resolveOutputRoot() {
  const desktop = app.getPath('desktop');
  const root = path.join(desktop, '더죤환경');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function ensureSession() {
  if (sessionFolder) return;
  sessionFolder = path.join(resolveOutputRoot(), `Osoo-Photo-Dialog-Diagnostic-${stamp()}`);
  fs.mkdirSync(sessionFolder, { recursive: true });
  eventsPath = path.join(sessionFolder, 'events.jsonl');
}

function safeDetails(details) {
  if (!details || typeof details !== 'object') return details ?? null;
  const copy = JSON.parse(JSON.stringify(details));
  for (const key of ['path', 'filePath', 'fullPath']) {
    if (copy[key]) copy[key] = path.basename(String(copy[key]));
  }
  return copy;
}

function writeEvent(event, details = {}) {
  ensureSession();
  const record = {
    sequence: ++sequence,
    at: new Date().toISOString(),
    event,
    details: safeDetails(details),
  };
  fs.appendFileSync(eventsPath, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

function mimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.bmp': 'image/bmp', '.gif': 'image/gif' })[extension] || 'application/octet-stream';
}

function pingPort(port) {
  return new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/api/ping', timeout: 1200 }, (response) => {
      response.resume();
      resolve({ ok: response.statusCode >= 200 && response.statusCode < 500, port, statusCode: response.statusCode });
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', (error) => resolve({ ok: false, port, error: error.code || error.message }));
  });
}

async function probeServer() {
  const attempts = [];
  for (let port = 18731; port <= 18734; port += 1) {
    const result = await pingPort(port);
    attempts.push(result);
    if (result.ok) {
      writeEvent('existing-server-detected', { port, statusCode: result.statusCode, attempts });
      return { status: '응답 정상', port, statusCode: result.statusCode };
    }
  }
  writeEvent('existing-server-not-detected', { attempts });
  return { status: '응답 없음', attempts };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 800,
    minHeight: 640,
    show: false,
    title: 'Osoo 사진 선택 진단',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const rendererPath = path.join(__dirname, '..', 'dist', 'index.html');
  mainWindow.loadFile(rendererPath);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('focus', () => writeEvent('browser-window-focus'));
  mainWindow.on('blur', () => writeEvent('browser-window-blur'));
  mainWindow.on('unresponsive', () => writeEvent('browser-window-unresponsive'));
  mainWindow.on('responsive', () => writeEvent('browser-window-responsive'));
  mainWindow.webContents.on('render-process-gone', (_event, details) => writeEvent('render-process-gone', details));
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => writeEvent('renderer-load-failed', { errorCode, errorDescription, validatedURL }));
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => writeEvent('renderer-console', { level, message, line, sourceId }));
}

ipcMain.handle('diagnostic:choose-reference', async () => {
  writeEvent('native-dialog-requested');
  const startedAt = Date.now();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '진단에 사용할 사진 한 장을 선택하세요',
    properties: ['openFile'],
    filters: [
      { name: '사진 파일', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] },
      { name: '모든 파일', extensions: ['*'] },
    ],
  });
  writeEvent('native-dialog-returned', { canceled: result.canceled, fileCount: result.filePaths.length, elapsedMs: Date.now() - startedAt });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
  try {
    const selectedPath = result.filePaths[0];
    const stat = fs.statSync(selectedPath);
    const bytes = fs.readFileSync(selectedPath);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const file = {
      name: path.basename(selectedPath),
      size: stat.size,
      type: mimeType(selectedPath),
      lastModified: stat.mtimeMs,
    };
    writeEvent('native-file-read-success', { file, sha256: hash });
    return { ok: true, file, sha256: hash, base64: bytes.toString('base64') };
  } catch (error) {
    writeEvent('native-file-read-failed', { name: error.name, message: error.message, code: error.code });
    return { ok: false, canceled: false, message: error.message, code: error.code };
  }
});

ipcMain.handle('diagnostic:probe-server', probeServer);

ipcMain.on('diagnostic:log', (_event, payload = {}) => {
  writeEvent(payload.event || 'renderer-event', payload.details || {});
});

ipcMain.handle('diagnostic:finish', async (_event, summary = {}) => {
  ensureSession();
  const report = {
    createdAt: new Date().toISOString(),
    diagnosticVersion: app.getVersion(),
    environment: {
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      osVersion: typeof os.version === 'function' ? os.version() : '',
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      locale: app.getLocale(),
      systemLocale: app.getSystemLocale(),
      userDataName: path.basename(app.getPath('userData')),
    },
    summary: safeDetails(summary),
    eventsFile: path.basename(eventsPath),
  };
  const reportPath = path.join(sessionFolder, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  writeEvent('diagnostic-report-saved', { reportPath: path.basename(reportPath) });
  await shell.openPath(sessionFolder);
  return { ok: true, folder: sessionFolder, report: reportPath };
});

app.whenReady().then(() => {
  app.setAppUserModelId('com.osoo.photo-dialog-diagnostic');
  ensureSession();
  writeEvent('diagnostic-app-started', {
    version: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  });
  createWindow();
  probeServer().catch((error) => writeEvent('server-probe-failed', { message: error.message }));
});

app.on('child-process-gone', (_event, details) => writeEvent('child-process-gone', details));
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => writeEvent('diagnostic-app-before-quit'));
