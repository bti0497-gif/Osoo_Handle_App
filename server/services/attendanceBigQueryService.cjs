'use strict';

/**
 * attendanceBigQueryService.cjs
 * ─────────────────────────────────────────────────────────────────────
 * 출결 기록 → BigQuery 동기화 서비스
 *
 * 로컬 SQLite attendance 테이블의 미동기화(is_synced=0) 레코드를
 * BigQuery attendance 테이블에 스트리밍 insert 한다.
 * 성공하면 로컬 is_synced = 1, 실패해도 로컬 레코드는 보존된다.
 */

const crypto = require('crypto');
const { getBigQueryClient, DATASET_ID } = require('./bigQueryClientService.cjs');

/**
 * 출결 로그 배치 동기화
 * @param {Array}  logs      SQLite attendance 레코드 배열
 * @param {string} siteName  현장명 (app_settings.site_name)
 * @returns {{ syncedIds: number[], errors: string[] }}
 */
async function syncAttendanceLogs(logs, siteName) {
  const bq = getBigQueryClient();
  if (!bq) return { syncedIds: [], errors: ['BigQuery 클라이언트 초기화 실패'] };
  if (!logs || logs.length === 0) return { syncedIds: [], errors: [] };

  const now = new Date().toISOString();
  const rows = logs.map(log => ({
    json: {
      id:               String(log.id),
      site_name:        siteName || '',
      member_id:        Number(log.member_id),
      member_name:      log.member_name  || '',
      date:             log.date         || '',
      login_time:       log.login_time   || null,
      logout_time:      log.logout_time  || null,
      login_lat:        log.login_lat    != null ? Number(log.login_lat)  : null,
      login_lng:        log.login_lng    != null ? Number(log.login_lng)  : null,
      location_matched: Boolean(log.location_matched),
      auto_logout:      Boolean(log.auto_logout),
      uploaded_at:      now
    },
    insertId: crypto.createHash('sha1')
      .update(`attendance|${siteName}|${log.id}|${log.login_time || ''}`)
      .digest('hex')
  }));

  const syncedIds = [];
  const errors = [];

  try {
    await bq.dataset(DATASET_ID).table('attendance').insert(rows);
    syncedIds.push(...logs.map(l => l.id));
  } catch (err) {
    const msg = err.errors ? JSON.stringify(err.errors) : err.message;
    console.error('[BigQuery] attendance 동기화 실패:', msg);
    errors.push(msg);
  }

  return { syncedIds, errors };
}

module.exports = { syncAttendanceLogs };
