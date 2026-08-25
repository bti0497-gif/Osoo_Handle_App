'use strict';

const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const { session, webContents } = require('electron');

const DEFAULT_ROADWORK_URL = 'https://nwpo.ex.co.kr:5002/security/login.do';
const APP_DATA_DIR_NAME = 'Osoo_Handle_App';
const ROADWORK_PARTITION_PREFIX = 'persist:osoo-roadwork';
const ROADWORK_KEEP_ALIVE_MS = 4 * 60 * 1000;
const roadworkKeepAliveTimers = new Map();
const registeredRoadworkPartitions = new Set();
const roadworkPhotoTokens = new Map();

const ROADWORK_PHOTO_ITEMS = [
  { key: 'alkalinity', label: '알칼리도', keywords: ['알칼리도', '알칼리'] },
  { key: 'nh3_n', label: '암모니아성질소', keywords: ['암모니아성질소', '암모니아성 질소', '암모니아'] },
  { key: 'no3_n', label: '질산성질소', keywords: ['질산성질소', '질산성 질소', '질산'] },
  { key: 'po4_p', label: '인산염인', keywords: ['오르토인산염', '오르토 인산염', '인산염인', '인산염'] },
];

function normalizeRoadworkPartition(value) {
  const partition = String(value || ROADWORK_PARTITION_PREFIX).trim();
  return partition.startsWith(ROADWORK_PARTITION_PREFIX) ? partition : ROADWORK_PARTITION_PREFIX;
}

function getSiteIdFromRoadworkPartition(partition) {
  const prefix = `${ROADWORK_PARTITION_PREFIX}-`;
  const normalized = String(partition || '').trim();
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : '';
}

function getSiteIdFromSender(event) {
  const partitionSiteId = getSiteIdFromRoadworkPartition(
    event?.sender?.session?.getPartition?.(),
  );
  if (partitionSiteId) return partitionSiteId;

  try {
    const sourceUrl = event?.senderFrame?.url || event?.sender?.getURL?.() || '';
    return String(new URL(sourceUrl).searchParams.get('siteId') || '').trim();
  } catch {
    return '';
  }
}

function getScopedCredential(db, serviceKey, siteId) {
  const global = db.prepare(`
    SELECT service_url, user_id, password FROM web_app_credentials WHERE service_key = ?
  `).get(serviceKey);
  if (!global) return null;
  if (!siteId || !['road_web', 'water_analysis_app'].includes(serviceKey)) {
    return {
      ...global,
      requested_site_id: String(siteId || ''),
      credential_source: 'global',
      scoped_credential_found: false,
    };
  }
  const scoped = db.prepare(`
    SELECT user_id, password FROM site_web_app_credentials
    WHERE site_id = ? AND service_key = ?
  `).get(siteId, serviceKey);
  if (scoped) {
    return {
      ...global,
      ...scoped,
      requested_site_id: siteId,
      credential_source: 'site-scoped',
      scoped_credential_found: true,
    };
  }

  const multiSite = db.prepare(`
    SELECT multi_site_enabled, primary_site_id, secondary_site_id
    FROM app_settings WHERE id = 1
  `).get();
  const directionalSiteIds = [multiSite?.primary_site_id, multiSite?.secondary_site_id]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const isConfiguredDirectionalSite = Number(multiSite?.multi_site_enabled || 0) === 1
    && directionalSiteIds.includes(siteId);

  // A configured direction must never borrow the legacy/global account.  An
  // empty result leaves the login page available for manual recovery without
  // opening another site's authenticated session.
  if (isConfiguredDirectionalSite) {
    return {
      ...global,
      user_id: '',
      password: '',
      requested_site_id: siteId,
      credential_source: 'missing-site-scoped',
      scoped_credential_found: false,
    };
  }

  return {
    ...global,
    requested_site_id: siteId,
    credential_source: 'legacy-fallback',
    scoped_credential_found: false,
  };
}

function stopRoadworkKeepAlive(partition) {
  const timer = roadworkKeepAliveTimers.get(partition);
  if (timer) clearInterval(timer);
  roadworkKeepAliveTimers.delete(partition);
}

async function pingRoadworkSession(partition, targetUrl) {
  const checkedAt = new Date().toISOString();
  try {
    const roadworkSession = session.fromPartition(partition);
    if (typeof roadworkSession.fetch === 'function') {
      const response = await roadworkSession.fetch(targetUrl, { method: 'GET', redirect: 'follow' });
      await response.arrayBuffer();
      let finalOrigin = '';
      let finalPath = '';
      try {
        const finalUrl = new URL(response.url || targetUrl);
        finalOrigin = finalUrl.origin;
        finalPath = finalUrl.pathname;
      } catch {}
      return {
        success: response.ok,
        statusCode: response.status,
        finalOrigin,
        finalPath,
        redirectedToLogin: /\/security\/login\.do(?:[?#]|$)/i.test(response.url || ''),
        checkedAt,
      };
    }
    return {
      success: false,
      statusCode: 0,
      finalOrigin: '',
      finalPath: '',
      redirectedToLogin: false,
      checkedAt,
      errorName: 'SessionFetchUnavailable',
    };
  } catch (error) {
    console.warn('[Roadwork Session] keep-alive failed:', error?.message || error);
    return {
      success: false,
      statusCode: 0,
      finalOrigin: '',
      finalPath: '',
      redirectedToLogin: false,
      checkedAt,
      errorName: String(error?.name || 'Error').slice(0, 80),
    };
  }
}

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

function listFilesRecursive(rootPath, maxDepth = 4) {
  const files = [];
  const visit = (currentPath, depth) => {
    if (depth > maxDepth || !fs.existsSync(currentPath)) return;
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const targetPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) visit(targetPath, depth + 1);
      else if (entry.isFile()) files.push(targetPath);
    }
  };
  visit(rootPath, 0);
  return files;
}

function resolveRoadworkPhotos(db, app, date, siteId) {
  const scoped = siteId
    ? db.prepare('SELECT qntech_photo_root FROM site_settings WHERE site_id = ?').get(siteId)
    : null;
  const global = db.prepare('SELECT qntech_photo_root FROM app_settings WHERE id = 1').get();
  const configuredRoot = String(scoped?.qntech_photo_root || global?.qntech_photo_root || '').trim();
  const photoRoot = configuredRoot
    ? (path.isAbsolute(configuredRoot) ? configuredRoot : path.join(getCanonicalAppDataPath(app), configuredRoot))
    : path.join(getCanonicalAppDataPath(app), '사진관리', '수질분석');
  const monthRoot = path.join(photoRoot, date.slice(0, 4), date.slice(5, 7));
  const candidates = listFilesRecursive(monthRoot)
    .filter((filePath) => path.basename(filePath).includes(date))
    .filter((filePath) => /\.(jpe?g|png|webp)$/i.test(filePath));

  let firstRowId = '';
  try {
    const row = db.prepare(`
      SELECT id FROM qntech_water_quality
      WHERE date = ? AND source_type = 'qntech'
        AND (? = '' OR site_id = ?)
      ORDER BY measurement_order ASC, id ASC LIMIT 1
    `).get(date, siteId, siteId);
    firstRowId = String(row?.id || '');
  } catch {
    firstRowId = '';
  }

  return ROADWORK_PHOTO_ITEMS.map((item) => {
    const matches = candidates.filter((filePath) => {
      const compactName = path.basename(filePath).replace(/\s+/g, '');
      return item.keywords.some((keyword) => compactName.includes(keyword.replace(/\s+/g, '')));
    }).sort((left, right) => {
      const leftFirst = firstRowId && path.basename(left).startsWith(`${firstRowId}_`) ? 0 : 1;
      const rightFirst = firstRowId && path.basename(right).startsWith(`${firstRowId}_`) ? 0 : 1;
      return leftFirst - rightFirst || path.basename(left).localeCompare(path.basename(right), 'ko');
    });
    return { key: item.key, label: item.label, filePath: matches[0] || '' };
  });
}

function collectFileInputNodes(node, ancestors = [], result = []) {
  if (!node || typeof node !== 'object') return result;
  const attributes = Array.isArray(node.attributes) ? node.attributes : [];
  const attributeText = attributes.join(' ');
  const nextAncestors = [...ancestors.slice(-10), `${node.nodeName || ''} ${attributeText}`];
  if (String(node.nodeName || '').toUpperCase() === 'INPUT' && /(?:^|\s)type\s+file(?:\s|$)/i.test(attributeText)) {
    result.push({ nodeId: node.nodeId, context: nextAncestors.join(' ') });
  }
  for (const child of node.children || []) collectFileInputNodes(child, nextAncestors, result);
  for (const shadowRoot of node.shadowRoots || []) collectFileInputNodes(shadowRoot, nextAncestors, result);
  for (const contentDocument of node.contentDocument ? [node.contentDocument] : []) collectFileInputNodes(contentDocument, nextAncestors, result);
  return result;
}

function registerRuntimeHandlers(ipcMain, app) {
  ipcMain.handle('roadwork:getLocalPhotos', async (event, payload = {}) => withLocalDb(
    app,
    { success: false, photos: [] },
    (db) => {
      const date = String(payload.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { success: false, photos: [], error: 'invalid date' };
      const senderId = event.sender.id;
      const siteId = getSiteIdFromSender(event);
      const photos = resolveRoadworkPhotos(db, app, date, siteId).map(({ key, label, filePath }) => {
        if (!filePath) return { key, label, available: false, token: '' };
        const token = crypto.randomBytes(18).toString('hex');
        roadworkPhotoTokens.set(token, { senderId, filePath, expiresAt: Date.now() + (10 * 60 * 1000) });
        return { key, label, available: true, token };
      });
      return { success: true, date, photos };
    },
  ));

  ipcMain.handle('roadwork:setPhotoFile', async (event, payload = {}) => {
    const tokenEntry = roadworkPhotoTokens.get(String(payload.token || ''));
    roadworkPhotoTokens.delete(String(payload.token || ''));
    if (!tokenEntry || tokenEntry.senderId !== event.sender.id || tokenEntry.expiresAt < Date.now()) {
      return { success: false, error: 'invalid or expired photo token' };
    }
    if (!fs.existsSync(tokenEntry.filePath)) return { success: false, error: 'local photo not found' };
    const target = webContents.fromId(Number(payload.webContentsId));
    if (!target || target.isDestroyed() || target.hostWebContents?.id !== event.sender.id) {
      return { success: false, error: 'invalid roadwork webview' };
    }
    if (!/^https:\/\/nwpo\.ex\.co\.kr(?::\d+)?\//i.test(target.getURL())) {
      return { success: false, error: 'unexpected roadwork origin' };
    }

    const uploaderIndex = Number(payload.uploaderIndex);
    const debuggerApi = target.debugger;
    const wasAttached = debuggerApi.isAttached();
    let fileChooserHandler = null;
    try {
      if (!wasAttached) debuggerApi.attach('1.3');
      await debuggerApi.sendCommand('DOM.enable');
      await debuggerApi.sendCommand('Page.enable');
      await debuggerApi.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true });

      const chooserPromise = new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (fileChooserHandler) debuggerApi.removeListener('message', fileChooserHandler);
          fileChooserHandler = null;
          resolve(null);
        }, 4000);
        fileChooserHandler = (_event, method, params) => {
          if (method !== 'Page.fileChooserOpened') return;
          clearTimeout(timeout);
          debuggerApi.removeListener('message', fileChooserHandler);
          fileChooserHandler = null;
          resolve(params || null);
        };
        debuggerApi.on('message', fileChooserHandler);
      });

      const clickResult = await debuggerApi.sendCommand('Runtime.evaluate', {
        expression: `(() => {
          const visited = [];
          const visit = (targetWindow) => {
            if (!targetWindow || visited.includes(targetWindow)) return null;
            visited.push(targetWindow);
            try {
              const button = targetWindow.document?.getElementById('dragDrop${uploaderIndex}_anchor2');
              if (button) {
                button.click();
                return true;
              }
              for (const frame of targetWindow.document?.querySelectorAll('iframe') || []) {
                try {
                  const clicked = visit(frame.contentWindow);
                  if (clicked) return true;
                } catch {}
              }
            } catch {}
            return false;
          };
          return visit(window);
        })()`,
        returnByValue: true,
        awaitPromise: true,
      });
      if (!clickResult?.result?.value) {
        return { success: false, error: 'roadwork photo add button not found', errorCode: 'PHOTO_ADD_BUTTON_NOT_FOUND' };
      }

      const chooser = await chooserPromise;
      if (!chooser?.backendNodeId) {
        return { success: false, error: 'roadwork file chooser not opened', errorCode: 'PHOTO_CHOOSER_NOT_OPENED' };
      }
      await debuggerApi.sendCommand('DOM.setFileInputFiles', {
        files: [tokenEntry.filePath],
        backendNodeId: chooser.backendNodeId,
      });
      return { success: true };
    } catch (error) {
      console.warn('[Roadwork Photo] File input injection failed:', error?.message || error);
      return { success: false, error: 'roadwork photo injection failed', errorCode: 'CDP_FILE_INPUT_FAILED' };
    } finally {
      if (fileChooserHandler) debuggerApi.removeListener('message', fileChooserHandler);
      if (debuggerApi.isAttached()) {
        try {
          await debuggerApi.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false });
        } catch {}
      }
      if (!wasAttached && debuggerApi.isAttached()) debuggerApi.detach();
    }
  });

  ipcMain.handle('roadwork:keepSessionAlive', async (_event, payload = {}) => {
    const partition = normalizeRoadworkPartition(payload.partition);
    const targetUrl = String(payload.url || '').trim();
    if (!/^https:\/\/nwpo\.ex\.co\.kr(?::\d+)?\//i.test(targetUrl)) {
      return { success: false, error: '허용되지 않은 도로공사 세션 URL입니다.' };
    }

    registeredRoadworkPartitions.add(partition);
    stopRoadworkKeepAlive(partition);
    roadworkKeepAliveTimers.set(partition, setInterval(() => {
      void pingRoadworkSession(partition, targetUrl);
    }, ROADWORK_KEEP_ALIVE_MS));
    const check = await pingRoadworkSession(partition, targetUrl);
    return { success: true, partition, check };
  });

  ipcMain.handle('roadwork:clearSessions', async () => {
    const livePartitions = typeof session.getAllPartitions === 'function'
      ? session.getAllPartitions().filter((partition) => partition.startsWith(ROADWORK_PARTITION_PREFIX))
      : [];
    const partitions = new Set([ROADWORK_PARTITION_PREFIX, ...registeredRoadworkPartitions, ...livePartitions]);
    for (const partition of partitions) {
      stopRoadworkKeepAlive(partition);
      try {
        await session.fromPartition(partition).clearStorageData({
          storages: ['cookies', 'localstorage', 'cachestorage', 'indexdb', 'serviceworkers'],
        });
      } catch (error) {
        console.warn(`[Roadwork Session] clear failed (${partition}):`, error?.message || error);
      }
    }
    registeredRoadworkPartitions.clear();
    return { success: true, cleared: partitions.size };
  });

  ipcMain.handle('roadwork:getPreloadPath', async () => {
    const rawPath = path.join(__dirname, 'preload-roadwork.cjs');
    return url.pathToFileURL(rawPath).href;
  });

  ipcMain.handle('roadwork:getRoadworkUrl', async (event) => withLocalDb(
    app,
    { success: false, url: DEFAULT_ROADWORK_URL },
    (db) => {
      const row = getScopedCredential(db, 'road_web', getSiteIdFromSender(event));
      return { success: Boolean(row?.service_url), url: row?.service_url || DEFAULT_ROADWORK_URL };
    },
  ));

  ipcMain.handle('roadwork:getCredentials', async (event) => withLocalDb(
    app,
    { success: false, userId: '', password: '' },
    (db) => {
      const row = getScopedCredential(db, 'road_web', getSiteIdFromSender(event));
      return {
        success: Boolean(row?.user_id && row?.password),
        userId: row?.user_id || '',
        password: row?.password || '',
        credentialSource: row?.credential_source || '',
        requestedSiteId: row?.requested_site_id || '',
        scopedCredentialFound: row?.scoped_credential_found === true,
      };
    },
  ));

  ipcMain.handle('roadwork:getCredentialStatus', async (event) => {
    const dbPath = getLocalDbPath(app);
    return withLocalDb(
      app,
      { success: false, dbPath, dbExists: fs.existsSync(dbPath), hasUserId: false, hasPassword: false, passwordLen: 0 },
      (db) => {
        const row = getScopedCredential(db, 'road_web', getSiteIdFromSender(event));
        const password = String(row?.password || '');
        return {
          success: Boolean(row?.user_id && row?.password),
          dbPath,
          dbExists: true,
          hasUserId: Boolean(row?.user_id),
          hasPassword: Boolean(row?.password),
          passwordLen: password.length,
          credentialSource: row?.credential_source || '',
          requestedSiteId: row?.requested_site_id || '',
          scopedCredentialFound: row?.scoped_credential_found === true,
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
