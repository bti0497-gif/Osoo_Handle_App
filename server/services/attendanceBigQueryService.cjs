'use strict';

/**
 * attendanceBigQueryService.cjs
 * ─────────────────────────────────────────────────────────────────────
 * 출결 기록 → BigQuery 동기화 서비스
 *
 * 로컬 SQLite attendance 테이블의 미동기화(is_synced=0) 레코드를
 * BigQuery attendance 테이블에 최신 상태로 업서트한다.
 * 성공하면 로컬 is_synced = 1, 실패해도 로컬 레코드는 보존된다.
 */

const { getBigQueryClient, DATASET_ID } = require('./bigQueryClientService.cjs');

async function getAttendanceTimeColumnType(bq) {
  try {
    const [metadata] = await bq.dataset(DATASET_ID).table('attendance').getMetadata();
    const field = (metadata.schema.fields || []).find((item) => item.name === 'login_time');
    return String(field?.type || 'TIMESTAMP').toUpperCase();
  } catch (_) {
    return 'TIMESTAMP';
  }
}

function buildTimeExpression(jsonPath, targetType) {
  const raw = `JSON_VALUE(item, '${jsonPath}')`;
  const normalized = `REPLACE(${raw}, 'T', ' ')`;
  const hasTimezone = `REGEXP_CONTAINS(IFNULL(${raw}, ''), r'(Z|[+-]\\d{2}:\\d{2})$')`;
  const isTimeOnly = `REGEXP_CONTAINS(IFNULL(${raw}, ''), r'^\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?$')`;
  const sourceDate = `SAFE_CAST(JSON_VALUE(item, '$.date') AS DATE)`;

  if (targetType === 'TIME') {
    return `
          CASE
            WHEN ${raw} IS NULL OR TRIM(${raw}) = '' THEN NULL
            WHEN ${isTimeOnly} THEN SAFE_CAST(${raw} AS TIME)
            WHEN ${hasTimezone} THEN TIME(DATETIME(SAFE_CAST(${raw} AS TIMESTAMP), 'Asia/Seoul'))
            ELSE TIME(SAFE_CAST(${normalized} AS DATETIME))
          END`;
  }

  if (targetType === 'DATETIME') {
    return `
          CASE
            WHEN ${raw} IS NULL OR TRIM(${raw}) = '' THEN NULL
            WHEN ${isTimeOnly}
              THEN DATETIME(${sourceDate}, SAFE_CAST(${raw} AS TIME))
            WHEN ${hasTimezone}
              THEN DATETIME(SAFE_CAST(${raw} AS TIMESTAMP), 'Asia/Seoul')
            ELSE SAFE_CAST(${normalized} AS DATETIME)
          END`;
  }

  return `
          CASE
            WHEN ${raw} IS NULL OR TRIM(${raw}) = '' THEN NULL
            WHEN ${isTimeOnly}
              THEN TIMESTAMP(DATETIME(${sourceDate}, SAFE_CAST(${raw} AS TIME)), 'Asia/Seoul')
            WHEN ${hasTimezone}
              THEN SAFE_CAST(${raw} AS TIMESTAMP)
            ELSE TIMESTAMP(SAFE_CAST(${normalized} AS DATETIME), 'Asia/Seoul')
          END`;
}

/**
 * ─────────────────────────────────────────────────────────────────────
 * @param {Array}  logs      SQLite attendance 레코드 배열
 * @param {{siteId?: string, siteName?: string}} siteMeta  현장 정보
 * @returns {{ syncedIds: number[], errors: string[] }}
 */
async function syncAttendanceLogs(logs, siteMeta = {}) {
  const bq = getBigQueryClient();
  if (!bq) return { syncedIds: [], errors: ['BigQuery 클라이언트 초기화 실패'] };
  if (!logs || logs.length === 0) return { syncedIds: [], errors: [] };

  const defaultSiteName = String(siteMeta.siteName || '');
  const defaultSiteId = siteMeta.siteId ? String(siteMeta.siteId) : null;

  const now = new Date().toISOString();
  const timeColumnType = await getAttendanceTimeColumnType(bq);
  const loginTimeExpression = buildTimeExpression('$.login_time', timeColumnType);
  const logoutTimeExpression = buildTimeExpression('$.logout_time', timeColumnType);
  const rows = logs.map(log => {
    const rowSiteName = String(log.site_name || defaultSiteName || '');
    return {
      id:               String(log.id),
      site_id:          log.site_id ? String(log.site_id) : defaultSiteId,
      site_name:        rowSiteName,
      member_id:        String(log.member_id),
      member_name:      log.member_name  || '',
      date:             log.date         || '',
      login_time:       log.login_time   || null,
      logout_time:      log.logout_time  || null,
      location_matched: Boolean(log.location_matched),
      remote_session_detected: Boolean(log.remote_session_detected),
      remote_session_type: log.remote_session_type || 'local',
      remote_session_evidence: log.remote_session_evidence || '',
      auto_logout:      Boolean(log.auto_logout),
      uploaded_at:      now
    };
  });

  const syncedIds = [];
  const errors = [];

  try {
    const rowsJson = JSON.stringify(rows);
    await bq.query({
      query: `
        CREATE TEMP TABLE source_rows AS
        SELECT
          JSON_VALUE(item, '$.id') AS id,
          NULLIF(JSON_VALUE(item, '$.site_id'), '') AS site_id,
          JSON_VALUE(item, '$.site_name') AS site_name,
          JSON_VALUE(item, '$.member_id') AS member_id,
          JSON_VALUE(item, '$.member_name') AS member_name,
          SAFE_CAST(JSON_VALUE(item, '$.date') AS DATE) AS date,
          ${loginTimeExpression} AS login_time,
          ${logoutTimeExpression} AS logout_time,
          SAFE_CAST(JSON_VALUE(item, '$.location_matched') AS BOOL) AS location_matched,
          SAFE_CAST(JSON_VALUE(item, '$.remote_session_detected') AS BOOL) AS remote_session_detected,
          JSON_VALUE(item, '$.remote_session_type') AS remote_session_type,
          JSON_VALUE(item, '$.remote_session_evidence') AS remote_session_evidence,
          SAFE_CAST(JSON_VALUE(item, '$.auto_logout') AS BOOL) AS auto_logout,
          SAFE_CAST(JSON_VALUE(item, '$.uploaded_at') AS TIMESTAMP) AS uploaded_at
        FROM UNNEST(JSON_QUERY_ARRAY(@rows_json)) AS item;

        DELETE FROM \`${DATASET_ID}.attendance\` T
        WHERE EXISTS (
          SELECT 1
          FROM source_rows S
          WHERE T.id = S.id
            AND COALESCE(T.site_id, '') = COALESCE(S.site_id, '')
            AND COALESCE(T.site_name, '') = COALESCE(S.site_name, '')
            AND T.login_time = S.login_time
        );

        INSERT INTO \`${DATASET_ID}.attendance\` (
          id, site_id, site_name, member_id, member_name, date,
          login_time, logout_time, location_matched, remote_session_detected, remote_session_type,
          remote_session_evidence, auto_logout, uploaded_at
        )
        SELECT
          id, site_id, site_name, member_id, member_name, date,
          login_time, logout_time, location_matched, remote_session_detected, remote_session_type,
          remote_session_evidence, auto_logout, uploaded_at
        FROM source_rows;
      `,
      params: { rows_json: rowsJson },
    });
    syncedIds.push(...logs.map(l => l.id));
  } catch (err) {
    const msg = err.errors ? JSON.stringify(err.errors) : err.message;
    console.error('[BigQuery] attendance 동기화 실패:', msg);
    errors.push(msg);
  }

  return { syncedIds, errors };
}

module.exports = { syncAttendanceLogs };
