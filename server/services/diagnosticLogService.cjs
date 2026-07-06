const fs = require('fs');
const os = require('os');
const path = require('path');
const { getOrCreateFolderPath, getDriveRootFolderId, isDriveConfigured, uploadBufferToFolder } = require('./driveService.cjs');

const SECRET_KEY_PATTERN = /(password|passwd|pwd|token|secret|key|credential|authorization|cookie|client_secret|refresh_token)/i;
const MAX_STRING_LENGTH = 2000;
const MAX_DETAIL_LENGTH = 15000;

function safeString(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
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

function parseDetailsJson(value) {
  if (!value) return {};
  try {
    return JSON.parse(String(value));
  } catch (_) {
    return { raw: safeString(value) };
  }
}

function recordDiagnostic(db, appDataPath, event = {}) {
  const site = getSiteInfo(db);
  const now = new Date().toISOString();
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

  return id;
}

async function uploadPendingDiagnostics(db, appDataPath, { limit = 200 } = {}) {
  if (!isDriveConfigured()) return { success: false, skipped: true, reason: 'drive-not-configured' };

  const rows = db.prepare(`
    SELECT *
    FROM app_diagnostic_logs
    WHERE uploaded_at IS NULL
    ORDER BY id ASC
    LIMIT ?
  `).all(limit);

  if (rows.length === 0) return { success: true, count: 0 };

  const site = getSiteInfo(db);
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const fileName = `${stamp}_${normalizeSiteName(site.siteName)}_diagnostics.jsonl`;
  const buffer = Buffer.from(rows.map((row) => JSON.stringify({
    id: row.id,
    created_at: row.created_at,
    level: row.level,
    area: row.area,
    action: row.action,
    result: row.result,
    message: row.message,
    details: parseDetailsJson(row.details_json),
    site_id: row.site_id,
    site_name: row.site_name,
    app_version: row.app_version,
  })).join('\n') + '\n', 'utf8');

  try {
    const folder = await getOrCreateFolderPath(getDriveRootFolderId(), ['앱진단로그', yyyy, mm]);
    const file = await uploadBufferToFolder({
      folderId: folder.id,
      fileName,
      buffer,
      mimeType: 'application/jsonl',
    });
    const uploadedAt = new Date().toISOString();
    const markStmt = db.prepare(`
      UPDATE app_diagnostic_logs
      SET uploaded_at = ?, drive_file_id = ?, drive_web_view_link = ?, upload_error = NULL
      WHERE id = ?
    `);
    db.transaction(() => {
      rows.forEach((row) => markStmt.run(uploadedAt, file.id || null, file.webViewLink || null, row.id));
    })();
    return { success: true, count: rows.length, driveFileId: file.id || null };
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

module.exports = {
  recordDiagnostic,
  uploadPendingDiagnostics,
  sanitize,
};
