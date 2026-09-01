'use strict';

/**
 * operation-status 시나리오: 운전상태(PH/DO/SVI) 입력의 저장·재조회·DB 불변식을 검증한다.
 * 계약 출처: server/routes/operationStatusRoutes.cjs (POST /api/operation-status)
 */

function approxEqual(a, b, epsilon = 1e-6) {
  return Math.abs(Number(a) - Number(b)) < epsilon;
}

module.exports = {
  id: 'operation-status',
  version: '0.1.0',
  status: 'implemented',
  async run({ ctx, fixtures, dbPath, expected }) {
    const date = fixtures.dataset.fixedDate;

    await ctx.step('operation-status-save', async () => {
      const response = await ctx.request('POST', '/api/operation-status', {
        body: { date, ph: 7.2, do_value: 3.1, svi: 120 },
      });
      ctx.assert(response.ok, `운전상태 저장 실패: HTTP ${response.status}`, 'OPSTATUS_SAVE_FAILED', { status: response.status, body: response.json });
    });

    await ctx.step('operation-status-reload', async () => {
      const response = await ctx.request('GET', '/api/operation-status', { query: { date } });
      ctx.assert(response.ok, `운전상태 재조회 실패: HTTP ${response.status}`, 'OPSTATUS_RELOAD_FAILED');
      const payload = response.json && response.json.record !== undefined ? response.json.record : (response.json && response.json.data !== undefined ? response.json.data : response.json);
      ctx.assert(payload, '운전상태 응답에 데이터가 없습니다.', 'DATA_NOT_PERSISTED', response.json);
      ctx.assert(approxEqual(payload.ph, 7.2) && approxEqual(payload.do_value, 3.1) && approxEqual(payload.svi, 120), '재조회한 운전상태 값이 저장 값과 다릅니다.', 'DATA_CORRUPTED', payload);
    });

    await ctx.step('operation-status-update', async () => {
      // 수정 경로: ph 7.2 -> 7.8 재입력. 갱신 반영 + 행 1개 유지.
      const response = await ctx.request('POST', '/api/operation-status', {
        body: { date, ph: 7.8, do_value: 3.1, svi: 120 },
      });
      ctx.assert(response.ok, `운전상태 수정 실패: HTTP ${response.status}`, 'OPSTATUS_UPDATE_FAILED', response.json);
      const reload = await ctx.request('GET', '/api/operation-status', { query: { date } });
      const payload = reload.json && reload.json.record !== undefined ? reload.json.record : reload.json;
      ctx.assert(approxEqual(payload.ph, 7.8), '수정한 운전상태 값이 반영되지 않았습니다.', 'UPDATE_NOT_APPLIED', payload);
    });
    await ctx.step('operation-status-db-invariant', async () => {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      try {
        const rows = db.prepare('SELECT ph, do_value, svi, site_id, is_synced FROM operation_status_logs WHERE date = ?').all(date);
        ctx.assert(rows.length === 1, `operation_status_logs 행 수가 예상(1)과 다릅니다: ${rows.length}`, 'DB_ROW_COUNT_MISMATCH', rows);
        ctx.assert(rows[0].site_id === expected.siteId, 'operation_status_logs.site_id 가 seed 현장과 다릅니다.', 'DB_SITE_ISOLATION_BROKEN', rows[0]);
        ctx.assert(Number(rows[0].is_synced) === 0, '임시 DB 행이 동기화 완료로 표시되어 있습니다.', 'DB_SYNC_FLAG_UNEXPECTED', rows[0]);
      } finally {
        db.close();
      }
    });
  },
};
