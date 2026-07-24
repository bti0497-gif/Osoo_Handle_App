'use strict';

const fs = require('fs');
const path = require('path');
const url = require('url');

const DEFAULT_ROADWORK_URL = 'https://nwpo.ex.co.kr:5002/security/login.do';
const APP_DATA_DIR_NAME = 'Osoo_Handle_App';

function getCanonicalAppDataPath(app) {
  if (process.env.APPDATA) {
    return path.join(process.env.APPDATA, APP_DATA_DIR_NAME);
  }

  return app.getPath('userData');
}

function getLocalDbPath(app) {
  return path.join(getCanonicalAppDataPath(app), 'osoo.db');
}

function withLocalDb(app, fallback, reader) {
  let db;
  try {
    const Database = require('better-sqlite3');
    const dbPath = getLocalDbPath(app);

    if (!fs.existsSync(dbPath)) {
      return fallback;
    }

    db = new Database(dbPath, { readonly: true });
    return reader(db) || fallback;
  } catch (err) {
    return { ...fallback, error: err.message };
  } finally {
    db?.close();
  }
}

function registerRuntimeHandlers(ipcMain, app) {
  ipcMain.handle('roadwork:getPreloadPath', async () => {
    const rawPath = path.join(__dirname, 'preload-roadwork.cjs');
    return url.pathToFileURL(rawPath).href;
  });

  ipcMain.handle('roadwork:getRoadworkUrl', async () => withLocalDb(
    app,
    { success: false, url: DEFAULT_ROADWORK_URL },
    (db) => {
      const row = db.prepare("SELECT service_url FROM web_app_credentials WHERE service_key = 'road_web'").get();
      return { success: Boolean(row?.service_url), url: row?.service_url || DEFAULT_ROADWORK_URL };
    },
  ));

  ipcMain.handle('roadwork:getCredentials', async () => withLocalDb(
    app,
    { success: false, userId: '', password: '' },
    (db) => {
      const row = db.prepare("SELECT user_id, password FROM web_app_credentials WHERE service_key = 'road_web'").get();
      return {
        success: Boolean(row?.user_id && row?.password),
        userId: row?.user_id || '',
        password: row?.password || '',
      };
    },
  ));

  ipcMain.handle('roadwork:getCredentialStatus', async () => {
    const dbPath = getLocalDbPath(app);
    return withLocalDb(
      app,
      { success: false, dbPath, dbExists: fs.existsSync(dbPath), hasUserId: false, hasPassword: false, passwordLen: 0 },
      (db) => {
        const row = db.prepare("SELECT user_id, password FROM web_app_credentials WHERE service_key = 'road_web'").get();
        const password = String(row?.password || '');
        return {
          success: Boolean(row?.user_id && row?.password),
          dbPath,
          dbExists: true,
          hasUserId: Boolean(row?.user_id),
          hasPassword: Boolean(row?.password),
          passwordLen: password.length,
        };
      },
    );
  });
}

function sanitizeLabel(value) {
  return String(value || 'dom')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'dom';
}

function formatTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function registerDevHandlers(ipcMain, app) {
  ipcMain.handle('roadwork:dumpStructure', async (_event, payload = {}) => {
    try {
      const timestamp = formatTimestamp();
      const label = sanitizeLabel(payload.label || 'structure');
      const targetDir = path.join(getCanonicalAppDataPath(app), 'roadwork-debug');
      fs.mkdirSync(targetDir, { recursive: true });
      const targetPath = path.join(targetDir, `${timestamp}-${label}.structure.json`);
      fs.writeFileSync(targetPath, JSON.stringify({
        label,
        savedAt: new Date().toISOString(),
        pages: Array.isArray(payload.pages) ? payload.pages : [],
      }, null, 2), 'utf8');
      console.log('[Roadwork] Structure dump saved to:', targetPath);
      return { success: true, path: targetPath, label, fileName: path.basename(targetPath) };
    } catch (err) {
      console.error('[Roadwork] Failed to dump structure:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('roadwork:dumpHtml', async (_event, payload) => {
    try {
      const options = typeof payload === 'string' ? { html: payload } : (payload || {});
      const html = String(options.html || '');
      const timestamp = formatTimestamp();
      const label = sanitizeLabel(options.label || 'dump');
      const targetDir = path.join(getCanonicalAppDataPath(app), 'roadwork-debug');
      fs.mkdirSync(targetDir, { recursive: true });

      const dumpPath = path.join(targetDir, `${timestamp}-${label}.html`);
      const metaPath = path.join(targetDir, `${timestamp}-${label}.meta.json`);

      fs.writeFileSync(dumpPath, html, 'utf8');
      fs.writeFileSync(metaPath, JSON.stringify({
        label,
        savedAt: new Date().toISOString(),
        url: options.url || '',
        title: options.title || '',
        htmlPath: dumpPath,
      }, null, 2), 'utf8');

      console.log('[Roadwork] DOM dump saved to:', dumpPath);
      return {
        success: true,
        path: dumpPath,
        metaPath,
        label,
        fileName: path.basename(dumpPath),
      };
    } catch (err) {
      console.error('[Roadwork] Failed to dump HTML:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('roadwork:generateNewPassword', async () => {
    try {
      const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const lowercase = 'abcdefghijklmnopqrstuvwxyz';
      const numbers = '0123456789';
      const special = '!@#$%^&*';
      const allChars = uppercase + lowercase + numbers + special;
      let password = '';

      password += uppercase[Math.floor(Math.random() * uppercase.length)];
      password += lowercase[Math.floor(Math.random() * lowercase.length)];
      password += numbers[Math.floor(Math.random() * numbers.length)];
      password += special[Math.floor(Math.random() * special.length)];

      for (let i = password.length; i < 12; i += 1) {
        password += allChars[Math.floor(Math.random() * allChars.length)];
      }

      return { success: true, password: password.split('').sort(() => Math.random() - 0.5).join('') };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('roadwork:confirmPasswordChange', async (_event, message) => {
    console.log('[Roadwork] Webview message:', message);
    return { success: true };
  });
}

module.exports = function registerRoadworkHandlers(ipcMain, app, options = {}) {
  registerRuntimeHandlers(ipcMain, app);

  if (options.isDev) {
    registerDevHandlers(ipcMain, app);
  }
};
