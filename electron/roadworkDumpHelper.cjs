'use strict';

const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const { session, webContents } = require('electron');
const { readPhotoPreparationManifest } = require('../server/services/qntechWaterPhotoManifestService.cjs');

const DEFAULT_ROADWORK_URL = 'https://nwpo.ex.co.kr:5002/security/login.do';
const APP_DATA_DIR_NAME = 'Osoo_Handle_App';
const ROADWORK_PARTITION_PREFIX = 'persist:osoo-roadwork';
const ROADWORK_KEEP_ALIVE_MS = 4 * 60 * 1000;
const roadworkKeepAliveTimers = new Map();
const registeredRoadworkPartitions = new Set();
const roadworkPhotoTokens = new Map();

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

function resolveRoadworkPhotoPreparation(db, app, date, siteId) {
  const scoped = siteId
    ? db.prepare('SELECT qntech_photo_root FROM site_settings WHERE site_id = ?').get(siteId)
    : null;
  const global = db.prepare('SELECT qntech_photo_root FROM app_settings WHERE id = 1').get();
  const configuredRoot = String(scoped?.qntech_photo_root || global?.qntech_photo_root || '').trim();
  const photoRoot = configuredRoot
    ? (path.isAbsolute(configuredRoot) ? configuredRoot : path.join(getCanonicalAppDataPath(app), configuredRoot))
    : path.join(getCanonicalAppDataPath(app), '사진관리', '수질분석');
  return readPhotoPreparationManifest({
    photoRoot,
    siteId,
    date,
  });
}

function resolveRoadworkPhotos(db, app, date, siteId) {
  return resolveRoadworkPhotoPreparation(db, app, date, siteId).photos;
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

function sanitizeDiagnosticContext(value) {
  return String(value || '')
    .replace(/\b(password|passwd|token|secret|authorization|credential|value)\s+[^\s]+/gi, '$1 [redacted]')
    .slice(0, 320);
}

function createFileChooserWaiter(debuggerApi, timeoutMs) {
  let settled = false;
  let timer = null;
  let handler = null;
  let resolvePromise;
  const startedAt = Date.now();
  const finish = (value) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    if (handler) debuggerApi.removeListener('message', handler);
    resolvePromise({ value, waitedMs: Date.now() - startedAt });
  };
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
    handler = (_event, method, params) => {
      if (method === 'Page.fileChooserOpened') finish(params || null);
    };
    debuggerApi.on('message', handler);
    timer = setTimeout(() => finish(null), timeoutMs);
  });
  return { promise, cancel: () => finish(null) };
}

async function findUploaderFileInput(debuggerApi, uploaderIndex) {
  const documentResult = await debuggerApi.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
  const inputs = collectFileInputNodes(documentResult?.root);
  const token = `dragdrop${uploaderIndex}`.toLowerCase();
  const matched = inputs.find((input) => String(input.context || '').toLowerCase().includes(token));
  return {
    nodeId: matched?.nodeId || null,
    discoveredInputCount: inputs.length,
    matchedContext: matched?.context ? sanitizeDiagnosticContext(matched.context) : '',
    candidates: inputs.slice(0, 12).map((input) => ({
      nodeId: input.nodeId,
      context: sanitizeDiagnosticContext(input.context),
    })),
  };
}

function getTargetDiagnostics(target) {
  let url = '';
  let title = '';
  try {
    const parsed = new URL(target?.getURL?.() || '');
    url = `${parsed.origin}${parsed.pathname}`.slice(0, 320);
  } catch {}
  try {
    title = String(target?.getTitle?.() || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  } catch {}
  return { targetUrl: url, targetTitle: title };
}

async function attachRoadworkPhotoFile({
  target,
  filePath,
  uploaderIndex,
  chooserTimeouts = [2500, 4000, 6000],
  retryDelayMs = 500,
}) {
  const debuggerApi = target.debugger;
  let wasAttached = false;
  let attachedByThisCall = false;
  const attemptDetails = [];
  const targetDiagnostics = getTargetDiagnostics(target);
  try {
    wasAttached = Boolean(debuggerApi.isAttached());
    if (!wasAttached) {
      debuggerApi.attach('1.3');
      attachedByThisCall = true;
    }
    await debuggerApi.sendCommand('DOM.enable');
    await debuggerApi.sendCommand('Page.enable');
    await debuggerApi.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true });

    for (let index = 0; index < chooserTimeouts.length; index += 1) {
      const attempt = index + 1;
      const waiter = createFileChooserWaiter(debuggerApi, chooserTimeouts[index]);
      // Chromium은 파일선택창을 사용자 활성화가 없는 비신뢰 click에서 차단한다.
      // userGesture를 켜고, 두 번째 시도에서는 포커스된 버튼에 CDP 키 입력을 보낸다.
      const useTrustedKey = index === 1;
      const clickResult = await debuggerApi.sendCommand('Runtime.evaluate', {
        expression: `(() => {
          const visited = [];
          const visit = (targetWindow) => {
            if (!targetWindow || visited.includes(targetWindow)) return null;
            visited.push(targetWindow);
            try {
              const button = targetWindow.document?.getElementById('dragDrop${uploaderIndex}_anchor2');
              if (button) {
                button.scrollIntoView?.({ block: 'center', inline: 'center' });
                button.focus?.();
                ${useTrustedKey ? '' : 'button.click();'}
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
        userGesture: true,
      });
      attemptDetails.push({
        attempt,
        method: useTrustedKey ? 'trusted-key-focus' : 'script-click',
        result: clickResult?.result?.value ? 'target-found' : 'target-not-found',
      });
      if (!clickResult?.result?.value) {
        waiter.cancel();
        return {
          success: false,
          error: 'roadwork photo add button not found',
          errorCode: 'PHOTO_ADD_BUTTON_NOT_FOUND',
          attempts: attempt,
          attemptDetails,
          ...targetDiagnostics,
        };
      }

      if (useTrustedKey) {
        try {
          await debuggerApi.sendCommand('Input.dispatchKeyEvent', {
            type: 'rawKeyDown', key: 'Enter', code: 'Enter',
            windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
          });
          await debuggerApi.sendCommand('Input.dispatchKeyEvent', {
            type: 'keyUp', key: 'Enter', code: 'Enter',
            windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
          });
          attemptDetails.push({ attempt, method: 'trusted-key', result: 'dispatched' });
        } catch (error) {
          attemptDetails.push({ attempt, method: 'trusted-key', result: 'dispatch-failed', errorCode: error?.code || '' });
        }
      }

      const chooserEvent = await waiter.promise;
      const chooser = chooserEvent?.value || null;
      if (chooser?.backendNodeId) {
        try {
          await debuggerApi.sendCommand('DOM.setFileInputFiles', {
            files: [filePath],
            backendNodeId: chooser.backendNodeId,
          });
          return {
            success: true,
            method: 'file-chooser',
            attempts: attempt,
            chooserWaitMs: chooserEvent.waitedMs,
            ...targetDiagnostics,
            attemptDetails,
          };
        } catch (error) {
          attemptDetails.push({
            attempt,
            method: 'file-chooser',
            result: 'set-files-failed',
            errorCode: error?.code || '',
            errorName: error?.name || '',
            chooserWaitMs: chooserEvent.waitedMs,
            backendNodeId: chooser.backendNodeId || null,
          });
        }
      } else {
        attemptDetails.push({
          attempt,
          method: 'file-chooser',
          result: 'not-opened',
          chooserWaitMs: chooserEvent?.waitedMs || chooserTimeouts[index],
        });
      }

      try {
        const directInput = await findUploaderFileInput(debuggerApi, uploaderIndex);
        if (directInput.nodeId) {
          await debuggerApi.sendCommand('DOM.setFileInputFiles', {
            files: [filePath],
            nodeId: directInput.nodeId,
          });
          return {
            success: true,
            method: 'direct-file-input',
            attempts: attempt,
            discoveredInputCount: directInput.discoveredInputCount,
            matchedContext: directInput.matchedContext,
            candidates: directInput.candidates,
            ...targetDiagnostics,
            attemptDetails,
          };
        }
        attemptDetails.push({
          attempt,
          method: 'direct-file-input',
          result: 'matching-input-not-found',
          discoveredInputCount: directInput.discoveredInputCount,
          candidates: directInput.candidates,
        });
      } catch (error) {
        attemptDetails.push({
          attempt,
          method: 'direct-file-input',
          result: 'inspection-failed',
          errorCode: error?.code || '',
          errorName: error?.name || '',
        });
      }

      if (index + 1 < chooserTimeouts.length) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }

    return {
      success: false,
      error: 'roadwork file chooser not opened',
      errorCode: 'PHOTO_CHOOSER_NOT_OPENED',
      attempts: chooserTimeouts.length,
      ...targetDiagnostics,
      attemptDetails,
    };
  } catch (error) {
    console.warn('[Roadwork Photo] File input injection failed:', error?.message || error);
    return {
      success: false,
      error: 'roadwork photo injection failed',
      errorCode: 'CDP_FILE_INPUT_FAILED',
      attempts: attemptDetails.length,
      ...targetDiagnostics,
      attemptDetails,
    };
  } finally {
    let stillAttached = false;
    try {
      stillAttached = Boolean(debuggerApi.isAttached());
    } catch {}
    if (stillAttached) {
      try {
        await debuggerApi.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false });
      } catch {}
    }
    if (attachedByThisCall && stillAttached) {
      try { debuggerApi.detach(); } catch {}
    }
  }
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
      const now = Date.now();
      for (const [token, entry] of roadworkPhotoTokens) {
        if (entry.expiresAt < now) roadworkPhotoTokens.delete(token);
      }
      const preparation = resolveRoadworkPhotoPreparation(db, app, date, siteId);
      const photos = preparation.photos.map(({ key, label, filePath, available, availabilityReason }) => {
        if (!available || !filePath) return { key, label, available: false, availabilityReason, token: '' };
        const token = crypto.randomBytes(18).toString('hex');
        roadworkPhotoTokens.set(token, { senderId, filePath, expiresAt: Date.now() + (10 * 60 * 1000) });
        return { key, label, available: true, availabilityReason: 'ready', token };
      });
      return {
        success: true,
        date,
        preparationStatus: preparation.preparationStatus,
        manifestFound: preparation.manifestFound,
        preparedAt: preparation.preparedAt,
        selectedProjectIndex: preparation.selectedProjectIndex,
        readyPhotoCount: photos.filter((photo) => photo.available).length,
        unavailableReasons: photos.reduce((result, photo) => {
          if (!photo.available) result[photo.availabilityReason] = (result[photo.availabilityReason] || 0) + 1;
          return result;
        }, {}),
        photos,
      };
    },
  ));

  ipcMain.handle('roadwork:setPhotoFile', async (event, payload = {}) => {
    const token = String(payload.token || '');
    const tokenEntry = roadworkPhotoTokens.get(token);
    if (!tokenEntry || tokenEntry.senderId !== event.sender.id || tokenEntry.expiresAt < Date.now()) {
      roadworkPhotoTokens.delete(token);
      return { success: false, error: 'invalid or expired photo token' };
    }
    if (!fs.existsSync(tokenEntry.filePath)) {
      roadworkPhotoTokens.delete(token);
      return { success: false, error: 'local photo not found' };
    }
    const target = webContents.fromId(Number(payload.webContentsId));
    if (!target || target.isDestroyed() || target.hostWebContents?.id !== event.sender.id) {
      return { success: false, error: 'invalid roadwork webview' };
    }
    if (!/^https:\/\/nwpo\.ex\.co\.kr(?::\d+)?\//i.test(target.getURL())) {
      return { success: false, error: 'unexpected roadwork origin' };
    }

    const result = await attachRoadworkPhotoFile({
      target,
      filePath: tokenEntry.filePath,
      uploaderIndex: Number(payload.uploaderIndex),
    });
    if (result.success) roadworkPhotoTokens.delete(token);
    return result;
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

// 진단 러너(tools/diagnostic-runner)가 사진 날짜 호환 계약을 검증할 수 있도록
// 읽기 전용 헬퍼만 노출한다. 런타임 동작에는 영향이 없다.
module.exports.resolveRoadworkPhotos = resolveRoadworkPhotos;
module.exports.resolveRoadworkPhotoPreparation = resolveRoadworkPhotoPreparation;
module.exports.attachRoadworkPhotoFile = attachRoadworkPhotoFile;
