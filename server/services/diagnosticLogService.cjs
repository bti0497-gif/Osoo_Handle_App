const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const { inspectSiteIdentity } = require('./siteIdentityIntegrityService.cjs');

function isDriveServiceLoaded() {
  const loadedService = require.cache[require.resolve('./driveService.cjs')]?.exports;
  return Boolean(loadedService?.isDriveClientInitialized?.());
}

const SECRET_KEY_PATTERN = /(password|passwd|pwd|token|secret|key|credential|authorization|cookie|client_secret|refresh_token)/i;
const MAX_STRING_LENGTH = 2000;
const MAX_DETAIL_LENGTH = 15000;
const SENSITIVE_STRING_PATTERNS = [
  [/-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)* PRIVATE KEY-----/gi, '<redacted:private-key>'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <redacted>'],
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, '<redacted:google-api-key>'],
  [/\bya29\.[0-9A-Za-z._-]+\b/g, '<redacted:oauth-token>'],
  [/(https?:\/\/[^\s?#]+[?&](?:access_token|refresh_token|token|key|client_secret)=)[^&#\s]+/gi, '$1<redacted>'],
  [/(\"?(?:private_key|client_secret|refresh_token|access_token|password|authorization)\"?\s*[:=]\s*\"?)[^\"\s,}]+/gi, '$1<redacted>'],
];
const DIAGNOSTIC_COUNT_TABLES = [
  'flow_readings',
  'medicine_logs',
  'water_quality',
  'qntech_water_quality',
  'kit_logs',
  'operation_status_logs',
  'attendance',
];

function safeString(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  for (const [pattern, replacement] of SENSITIVE_STRING_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text.length > MAX_STRING_LENGTH ? `${text.slice(0, MAX_STRING_LENGTH)}...<truncated>` : text;
}

function sanitize(value, depth = 0) {
  if (depth > 5) return '<max-depth>';
  if (value === null || value === undefined) return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: safeString(value.message),
      stack: safeString(value.stack),
    };
  }
  if (Buffer.isBuffer(value)) return `<buffer:${value.length}>`;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        out[key] = '<redacted>';
      } else {
        out[key] = sanitize(child, depth + 1);
      }
    }
    return out;
  }
  if (typeof value === 'string') return safeString(value);
  return value;
}

function getAppVersion() {
  // main 프로세스가 fork 시 OSOO_APP_VERSION으로 주입한 버전을 최우선으로 사용한다.
  // (asar 패키징 시 package.json이 app.asar.unpacked에 없어 require가 실패하기 때문)
  const envVersion = String(process.env.OSOO_APP_VERSION || '').trim();
  if (envVersion) return envVersion;
  try {
    const pkg = require('../../package.json');
    return pkg.version || '';
  } catch (_) {
    return '';
  }
}

function normalizeSiteName(value) {
  return String(value || 'unknown-site')
    .normalize('NFC')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

function getSiteInfo(db) {
  try {
    const row = db.prepare('SELECT site_id, site_name FROM app_settings WHERE id = 1').get() || {};
    return {
      siteId: row.site_id || null,
      siteName: row.site_name || 'unknown-site',
    };
  } catch (_) {
    return { siteId: null, siteName: 'unknown-site' };
  }
}

function ensureDiagnosticDir(appDataPath) {
  const dir = path.join(appDataPath, 'logs', 'diagnostics');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createDatabaseFingerprint(dbPath, fileSize) {
  const sampleSize = Math.min(64 * 1024, fileSize);
  const first = Buffer.alloc(sampleSize);
  const last = Buffer.alloc(sampleSize);
  const fd = fs.openSync(dbPath, 'r');
  try {
    fs.readSync(fd, first, 0, sampleSize, 0);
    fs.readSync(fd, last, 0, sampleSize, Math.max(0, fileSize - sampleSize));
  } finally {
    fs.closeSync(fd);
  }
  return crypto.createHash('sha256')
    .update(String(fileSize))
    .update(first)
    .update(last)
    .digest('hex')
    .slice(0, 16);
}

function buildDatabaseDiagnosticDetails(db, appDataPath) {
  const dbPath = path.join(appDataPath, 'osoo.db');
  const details = {
    dbPath,
    exists: fs.existsSync(dbPath),
    fileSize: null,
    modifiedAt: null,
    fingerprint: null,
    tableCounts: {},
  };

  try {
    const stat = fs.statSync(dbPath);
    details.fileSize = stat.size;
    details.modifiedAt = stat.mtime.toISOString();
    details.fingerprint = createDatabaseFingerprint(dbPath, stat.size);
  } catch (error) {
    details.fileError = safeString(error.message);
  }

  for (const tableName of DIAGNOSTIC_COUNT_TABLES) {
    try {
      details.tableCounts[tableName] = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get()?.count ?? null;
    } catch (error) {
      details.tableCounts[tableName] = `error:${safeString(error.message)}`;
    }
  }

  try {
    details.siteIdentity = inspectSiteIdentity(db);
  } catch (error) {
    details.siteIdentity = { error: safeString(error.message) };
  }

  return details;
}

function getTodayKst() {
  return new Date(Date.now() + (9 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function getKstDayStartIso(dateKey) {
  return new Date(`${dateKey}T00:00:00+09:00`).toISOString();
}

async function cleanupOldDiagnosticsOnVersionStart(db, appDataPath) {
  const version = getAppVersion();
  if (!version) return { success: false, skipped: true, reason: 'version-unavailable' };

  const markerPath = path.join(
    ensureDiagnosticDir(appDataPath),
    `.cleanup-${version.replace(/[^0-9A-Za-z._-]/g, '_')}.done`
  );
  if (fs.existsSync(markerPath)) {
    return { success: true, skipped: true, reason: 'already-cleaned', version };
  }

  const todayKst = getTodayKst();
  const cutoffIso = getKstDayStartIso(todayKst);
  const localDelete = db.prepare('DELETE FROM app_diagnostic_logs WHERE created_at < ?').run(cutoffIso);
  let localFileCount = 0;
  const diagnosticDir = ensureDiagnosticDir(appDataPath);
  for (const entry of fs.readdirSync(diagnosticDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/^\d{4}-\d{2}-\d{2}_.*_diagnostics\.jsonl$/i.test(entry.name)) continue;
    if (entry.name.slice(0, 10) >= todayKst) continue;
    fs.unlinkSync(path.join(diagnosticDir, entry.name));
    localFileCount += 1;
  }

  const driveCleanup = await runDiagnosticUploadWorker({ action: 'cleanup', cutoffIso });
  if (driveCleanup?.skipped) {
    return {
      success: false,
      skipped: true,
      reason: driveCleanup.reason || 'drive-not-configured',
      localRowCount: localDelete.changes,
      localFileCount,
    };
  }
  if (!driveCleanup?.success) {
    throw new Error(driveCleanup?.error || 'diagnostic-cleanup-worker-failed');
  }
  const driveFileCount = Number(driveCleanup.deletedCount || 0);

  fs.writeFileSync(markerPath, JSON.stringify({
    version,
    completedAt: new Date().toISOString(),
    todayKst,
    localRowCount: localDelete.changes,
    localFileCount,
    driveFileCount,
  }, null, 2), 'utf8');

  return {
    success: true,
    version,
    localRowCount: localDelete.changes,
    localFileCount,
    driveFileCount,
  };
}

function dailyLogPath(appDataPath, siteName) {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(
    ensureDiagnosticDir(appDataPath),
    `${date}_${normalizeSiteName(siteName)}_diagnostics.jsonl`
  );
}

function toDetailsJson(details) {
  const json = JSON.stringify(sanitize(details || {}));
  return json.length > MAX_DETAIL_LENGTH
    ? `${json.slice(0, MAX_DETAIL_LENGTH)}...<truncated>`
    : json;
}

let diagnosticRecordedNotifier = null;

function setDiagnosticRecordedNotifier(notifier) {
  diagnosticRecordedNotifier = typeof notifier === 'function' ? notifier : null;
}

function recordDiagnostic(db, appDataPath, event = {}) {
  const site = getSiteInfo(db);
  const eventTime = event.createdAt ? new Date(event.createdAt) : null;
  const now = eventTime && Number.isFinite(eventTime.getTime())
    ? eventTime.toISOString()
    : new Date().toISOString();
  const payload = {
    created_at: now,
    level: event.level || 'info',
    area: event.area || 'app',
    action: event.action || '',
    result: event.result || '',
    message: safeString(event.message || ''),
    details: sanitize(event.details || {}),
    site_id: event.siteId || site.siteId,
    site_name: event.siteName || site.siteName,
    app_version: event.appVersion || getAppVersion(),
    machine: os.hostname(),
  };
  const detailsJson = toDetailsJson(payload.details);

  let id = null;
  try {
    const info = db.prepare(`
      INSERT INTO app_diagnostic_logs (
        created_at, level, area, action, result, message, details_json,
        site_id, site_name, app_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.created_at,
      payload.level,
      payload.area,
      payload.action,
      payload.result,
      payload.message,
      detailsJson,
      payload.site_id,
      payload.site_name,
      payload.app_version
    );
    id = info.lastInsertRowid;
  } catch (error) {
    console.warn('[diagnostic] failed to insert db log:', error.message);
  }

  try {
    const line = JSON.stringify({ id, ...payload }) + '\n';
    fs.appendFileSync(dailyLogPath(appDataPath, payload.site_name), line, 'utf8');
  } catch (error) {
    console.warn('[diagnostic] failed to append file log:', error.message);
  }

  if (diagnosticRecordedNotifier) {
    try {
      diagnosticRecordedNotifier({
        id,
        level: payload.level,
        area: payload.area,
        action: payload.action,
        result: payload.result,
      });
    } catch (error) {
      console.warn('[diagnostic] immediate upload notification failed:', error.message);
    }
  }

  return id;
}

async function uploadPendingDiagnostics(db, appDataPath, { limit = 200 } = {}) {
  const rows = db.prepare(`
    SELECT *
    FROM app_diagnostic_logs
    WHERE uploaded_at IS NULL
    ORDER BY id ASC
    LIMIT ?
  `).all(limit);

  if (rows.length === 0) return { success: true, count: 0 };

  const site = getSiteInfo(db);

  try {
    const workerResult = await runDiagnosticUploadWorker({
      rows,
      siteName: site.siteName,
      machine: os.hostname(),
      runtime: process.versions?.electron ? 'electron' : 'node',
    });
    if (workerResult?.skipped) return workerResult;
    if (!workerResult?.success) throw new Error(workerResult?.error || 'diagnostic-upload-worker-failed');
    const uploadedAt = new Date().toISOString();
    const markStmt = db.prepare(`
      UPDATE app_diagnostic_logs
      SET uploaded_at = ?, drive_file_id = ?, drive_web_view_link = ?, upload_error = NULL
      WHERE id = ?
    `);
    db.transaction(() => {
      rows.forEach((row) => markStmt.run(
        uploadedAt,
        workerResult.driveFileId || null,
        workerResult.driveWebViewLink || null,
        row.id
      ));
    })();
    return {
      success: true,
      count: rows.length,
      driveFileId: workerResult.driveFileId || null,
      workerElapsedMs: workerResult.elapsedMs || null,
      isolatedWorker: true,
    };
  } catch (error) {
    const failStmt = db.prepare(`
      UPDATE app_diagnostic_logs
      SET upload_attempts = COALESCE(upload_attempts, 0) + 1, upload_error = ?
      WHERE id = ?
    `);
    db.transaction(() => {
      rows.forEach((row) => failStmt.run(safeString(error.message), row.id));
    })();
    return { success: false, count: rows.length, error: error.message };
  }
}

function runDiagnosticUploadWorker(payload, { timeoutMs = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'diagnosticUploadWorker.cjs'), {
      workerData: payload,
    });
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      void worker.terminate();
      finish(reject, new Error(`diagnostic-upload-worker-timeout:${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
    worker.once('message', (message) => {
      if (message?.ok) finish(resolve, message.result || {});
      else finish(reject, new Error(message?.error || 'diagnostic-upload-worker-failed'));
    });
    worker.once('error', (error) => finish(reject, error));
    worker.once('exit', (code) => {
      if (!settled && code !== 0) finish(reject, new Error(`diagnostic-upload-worker-exit:${code}`));
    });
  });
}

module.exports = {
  buildDatabaseDiagnosticDetails,
  cleanupOldDiagnosticsOnVersionStart,
  isDriveServiceLoaded,
  recordDiagnostic,
  setDiagnosticRecordedNotifier,
  uploadPendingDiagnostics,
  sanitize,
};
