'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { restoreOperationalData } = require('./bigQueryRestoreService.cjs');

const ENABLED_MANAGER_NAMES = new Set(['손규복']);
const CACHE_TTL_MS = 2 * 60 * 1000;
const cache = new Map();
const pending = new Map();

function normalizeDate(value) {
  const date = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function expandToMonthRange(startDate, endDate) {
  const start = normalizeDate(startDate);
  const end = normalizeDate(endDate || startDate);
  if (!start || !end) throw new Error('원격 일지 조회 날짜가 올바르지 않습니다.');
  const monthStart = `${start.slice(0, 7)}-01`;
  const endCursor = new Date(`${end.slice(0, 7)}-01T00:00:00`);
  const monthEnd = new Date(endCursor.getFullYear(), endCursor.getMonth() + 1, 0);
  return {
    startDate: monthStart,
    endDate: `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, '0')}-${String(monthEnd.getDate()).padStart(2, '0')}`,
  };
}

function resolveAuthorizedTarget(db, context = {}) {
  if (String(context.dataSource || '').toLowerCase() !== 'bigquery') return null;

  const author = String(context.author || '').trim();
  if (!ENABLED_MANAGER_NAMES.has(author)) {
    throw new Error('양방향 일지 조회 권한이 없습니다.');
  }

  const local = db.prepare('SELECT site_id, site_name, manager_name FROM app_settings WHERE id = 1').get() || {};
  const targetSiteId = String(context.siteId || '').trim();
  const targetSiteName = String(context.siteName || '').trim();
  const target = targetSiteId
    ? db.prepare('SELECT id, site_name, manager_name FROM sites WHERE id = ? AND COALESCE(is_active, 1) = 1').get(targetSiteId)
    : db.prepare('SELECT id, site_name, manager_name FROM sites WHERE site_name = ? AND COALESCE(is_active, 1) = 1').get(targetSiteName);

  if (!target || String(target.manager_name || '').trim() !== author) {
    throw new Error('선택한 현장이 로그인 사용자의 관리 현장이 아닙니다.');
  }
  if (!String(target.site_name || '').includes('죽암휴게소')) {
    throw new Error('현재 양방향 일지 조회는 죽암휴게소에만 허용됩니다.');
  }
  if (!String(local.site_name || '').includes('죽암휴게소')) {
    throw new Error('죽암휴게소 앱에서만 양방향 일지를 조회할 수 있습니다.');
  }
  if (String(target.id || '') === String(local.site_id || '')) return null;

  return {
    siteId: String(target.id || '').trim(),
    siteName: String(target.site_name || '').trim(),
    managerName: author,
    localSiteName: String(local.site_name || '').trim(),
  };
}

function cacheDirectory(appDataPath) {
  const root = appDataPath || path.join(os.tmpdir(), 'osoo-handle-app');
  const dir = path.join(root, 'temp', 'bidirectional-daily-log');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupExpired() {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now - entry.createdAt <= CACHE_TTL_MS) continue;
    cache.delete(key);
    try { fs.unlinkSync(entry.dbPath); } catch (_) {}
  }
}

async function buildSnapshot(db, appDataPath, target, range, key) {
  const token = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
  const dbPath = path.join(cacheDirectory(appDataPath), `daily-log-${token}-${Date.now()}.db`);
  await db.backup(dbPath);

  const snapshot = new Database(dbPath);
  try {
    snapshot.pragma('journal_mode = DELETE');
    snapshot.transaction(() => {
      for (const tableName of [
        'flow_readings',
        'medicine_logs',
        'kit_logs',
        'qntech_water_quality',
        'operation_status_logs',
        'sludge_photo_logs',
      ]) {
        snapshot.prepare(`DELETE FROM ${tableName}`).run();
      }
      snapshot.prepare(`
        UPDATE app_settings
        SET site_id = ?, site_name = ?, manager_name = ?, updated_at = datetime('now', 'localtime')
        WHERE id = 1
      `).run(target.siteId, target.siteName, target.managerName);
    })();

    const restored = await restoreOperationalData(snapshot, {
      startDate: range.startDate,
      endDate: range.endDate,
      siteId: target.siteId,
      siteName: target.siteName,
      tables: ['flow_readings', 'medicine_logs', 'kit_logs', 'qntech_water_quality', 'operation_status_logs'],
    });
    const failures = Object.entries(restored.result || {}).filter(([, result]) => !result?.success);
    if (!restored.success || failures.length) {
      throw new Error(failures.map(([table, result]) => `${table}: ${result.error || '조회 실패'}`).join(', ') || 'BigQuery 원격 일지 데이터를 불러오지 못했습니다.');
    }
  } catch (error) {
    snapshot.close();
    try { fs.unlinkSync(dbPath); } catch (_) {}
    throw error;
  }
  snapshot.close();

  const entry = { dbPath, createdAt: Date.now(), target, range };
  cache.set(key, entry);
  return entry;
}

async function acquireDailyLogDatabase(db, appDataPath, context, startDate, endDate) {
  const target = resolveAuthorizedTarget(db, context);
  if (!target) {
    return { db, context, isRemote: false, release() {} };
  }

  cleanupExpired();
  const range = expandToMonthRange(startDate, endDate);
  const key = [target.siteId, range.startDate, range.endDate].join('|');
  let entry = cache.get(key);
  if (!entry || !fs.existsSync(entry.dbPath)) {
    if (!pending.has(key)) {
      pending.set(key, buildSnapshot(db, appDataPath, target, range, key).finally(() => pending.delete(key)));
    }
    entry = await pending.get(key);
  }

  const snapshot = new Database(entry.dbPath, { readonly: true, fileMustExist: true });
  return {
    db: snapshot,
    context: {
      ...context,
      siteId: target.siteId,
      siteName: target.siteName,
      author: target.managerName,
      localSiteName: target.localSiteName,
      dataSource: 'bigquery',
    },
    isRemote: true,
    release() {
      try { snapshot.close(); } catch (_) {}
    },
  };
}

module.exports = {
  ENABLED_MANAGER_NAMES,
  resolveAuthorizedTarget,
  acquireDailyLogDatabase,
};
