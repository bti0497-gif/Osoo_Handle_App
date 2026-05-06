'use strict';

/**
 * attendanceBigQueryService.cjs
 * ?????????????????????????????????????????????????????????????????????
 * 異쒓껐 湲곕줉 ??BigQuery ?숆린???쒕퉬??
 *
 * 濡쒖뺄 SQLite attendance ?뚯씠釉붿쓽 誘몃룞湲고솕(is_synced=0) ?덉퐫?쒕?
 * BigQuery attendance ?뚯씠釉붿뿉 ?ㅽ듃由щ컢 insert ?쒕떎.
 * ?깃났?섎㈃ 濡쒖뺄 is_synced = 1, ?ㅽ뙣?대룄 濡쒖뺄 ?덉퐫?쒕뒗 蹂댁〈?쒕떎.
 */

const crypto = require('crypto');
const { getBigQueryClient, DATASET_ID } = require('./bigQueryClientService.cjs');

/**
 * 異쒓껐 濡쒓렇 諛곗튂 ?숆린??
 * @param {Array}  logs      SQLite attendance ?덉퐫??諛곗뿴
 * @param {{siteId?: string, siteName?: string}} siteMeta  ?꾩옣 ?뺣낫
 * @returns {{ syncedIds: number[], errors: string[] }}
 */
async function syncAttendanceLogs(logs, siteMeta = {}) {
  const bq = getBigQueryClient();
  if (!bq) return { syncedIds: [], errors: ['BigQuery ?대씪?댁뼵??珥덇린???ㅽ뙣'] };
  if (!logs || logs.length === 0) return { syncedIds: [], errors: [] };

  const siteName = String(siteMeta.siteName || '');
  const siteId = siteMeta.siteId ? String(siteMeta.siteId) : null;

  const now = new Date().toISOString();
  const rows = logs.map(log => ({
    json: {
      id:               String(log.id),
      site_id:          log.site_id ? String(log.site_id) : siteId,
      site_name:        siteName || '',
      member_id:        String(log.member_id),
      member_name:      log.member_name  || '',
      date:             log.date         || '',
      login_time:       log.login_time   || null,
      logout_time:      log.logout_time  || null,
      login_lat:        log.login_lat    != null ? Number(log.login_lat)  : null,
      login_lng:        log.login_lng    != null ? Number(log.login_lng)  : null,
      logout_lat:       log.logout_lat   != null ? Number(log.logout_lat) : null,
      logout_lng:       log.logout_lng   != null ? Number(log.logout_lng) : null,
      location_matched: Boolean(log.location_matched),
      remote_session_detected: Boolean(log.remote_session_detected),
      remote_session_type: log.remote_session_type || 'local',
      remote_session_evidence: log.remote_session_evidence || '',
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
    await bq.dataset(DATASET_ID).table('attendance').insert(rows, { ignoreUnknownValues: true });
    syncedIds.push(...logs.map(l => l.id));
  } catch (err) {
    const msg = err.errors ? JSON.stringify(err.errors) : err.message;
    console.error('[BigQuery] attendance ?숆린???ㅽ뙣:', msg);
    errors.push(msg);
  }

  return { syncedIds, errors };
}

module.exports = { syncAttendanceLogs };
