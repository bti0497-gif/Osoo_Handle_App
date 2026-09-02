'use strict';

/**
 * water-quality 시나리오: 수질분석 수동 입력의 저장·재조회·DB 불변식을 검증한다.
 * 계약 출처: server/routes/waterQualityRoutes.cjs
 * - POST /api/water-quality 는 항목별 행(qntech_water_quality 롱형식)으로 upsert 한다.
 * - GET /api/water-quality?date= 는 항목을 피벗한 객체 배열을 반환한다.
 */

function approxEqual(a, b, epsilon = 1e-6) {
  return Math.abs(Number(a) - Number(b)) < epsilon;
}

module.exports = {
  id: 'water-quality',
    covers: ["water"],
  version: '0.1.0',
  status: 'implemented',
  async run({ ctx, fixtures, dbPath, expected }) {
    const date = fixtures.dataset.fixedDate;
    const location = '유입수';

    await ctx.step('water-save-manual', async () => {
      const response = await ctx.request('POST', '/api/water-quality', {
        body: { date, tn: '28.4', ss: '3.2', input_status: 'manual' },
      });
      ctx.assert(response.ok, `수치 입력 저장 실패: HTTP ${response.status}`, 'WATER_SAVE_FAILED', { status: response.status, body: response.json });
      ctx.assert(response.json && response.json.success === true, '수치 입력이 success를 반환하지 않았습니다.', 'WATER_SAVE_REJECTED', response.json);
    });

    await ctx.step('water-reload', async () => {
      const response = await ctx.request('GET', '/api/water-quality', { query: { date } });
      ctx.assert(response.ok, `수치 재조회 실패: HTTP ${response.status}`, 'WATER_RELOAD_FAILED');
      const rows = Array.isArray(response.json) ? response.json : (response.json && response.json.items) || [];
      const row = rows.find((item) => item.location === location);
      ctx.assert(row, '저장한 수치가 재조회에 없습니다.', 'DATA_NOT_PERSISTED', rows);
      ctx.assert(approxEqual(row.tn, 28.4) && approxEqual(row.ss, 3.2), '재조회한 수치값이 저장 값과 다릅니다.', 'DATA_CORRUPTED', { tn: row.tn, ss: row.ss });
    });

    await ctx.step('water-update-value', async () => {
      // 수정 경로: tn 28.4 -> 30 재입력. 갱신 반영 + 항목 행 중복 없음.
      const response = await ctx.request('POST', '/api/water-quality', {
        body: { date, tn: '30', input_status: 'manual' },
      });
      ctx.assert(response.ok, `수치 수정 실패: HTTP ${response.status}`, 'WATER_UPDATE_FAILED', response.json);
      const reload = await ctx.request('GET', '/api/water-quality', { query: { date } });
      const rows = Array.isArray(reload.json) ? reload.json : (reload.json && reload.json.items) || [];
      const row = rows.find((item) => item.location === location);
      ctx.assert(row && approxEqual(row.tn, 30), '수정한 수치값이 반영되지 않았습니다.', 'UPDATE_NOT_APPLIED', row);
    });
    await ctx.step('water-db-invariant', async () => {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      try {
        const rows = db.prepare('SELECT item_code, result_numeric, site_id, is_synced FROM qntech_water_quality WHERE date = ? ORDER BY item_code').all(date);
        ctx.assert(rows.length === 2, `qntech_water_quality 행 수가 예상(2)과 다릅니다: ${rows.length}`, 'DB_ROW_COUNT_MISMATCH', rows);
        const byCode = Object.fromEntries(rows.map((row) => [row.item_code, row]));
        ctx.assert(approxEqual(byCode.tn && byCode.tn.result_numeric, 30), 'tn 숫자값이 수정 후 저장 값과 다릅니다.', 'DB_VALUE_MISMATCH', byCode.tn);
        for (const row of rows) {
          ctx.assert(row.site_id === expected.siteId, 'qntech_water_quality.site_id 가 seed 현장과 다릅니다.', 'DB_SITE_ISOLATION_BROKEN', row);
          ctx.assert(Number(row.is_synced) === 0, '임시 DB 행이 동기화 완료로 표시되어 있습니다.', 'DB_SYNC_FLAG_UNEXPECTED', row);
        }
        return { codes: rows.map((row) => row.item_code).join(',') };
      } finally {
        db.close();
      }
    });
  },
};
