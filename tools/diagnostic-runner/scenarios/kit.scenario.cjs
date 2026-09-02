'use strict';

/**
 * kit 시나리오: 키트관리 일괄 입력의 저장·재조회·DB 불변식을 검증한다.
 * 계약 출처: server/routes/kitRoutes.cjs (POST /api/kits/bulk)
 */

function approxEqual(a, b, epsilon = 1e-6) {
  return Math.abs(Number(a) - Number(b)) < epsilon;
}

module.exports = {
  id: 'kit',
    covers: ["kit"],
  version: '0.1.0',
  status: 'implemented',
  async run({ ctx, fixtures, dbPath, expected }) {
    const date = fixtures.dataset.fixedDate;
    const kitName = 'DO측정키트';

    await ctx.step('kit-save-bulk', async () => {
      const response = await ctx.request('POST', '/api/kits/bulk', {
        body: { items: [{ kit_name: kitName, date, purchase_amount: 5, usage_amount: 2, current_inventory: 3, input_status: 'manual' }] },
      });
      ctx.assert(response.ok, `키트 일괄 입력 실패: HTTP ${response.status}`, 'KIT_SAVE_FAILED', { status: response.status, body: response.json });
    });

    await ctx.step('kit-update-usage', async () => {
      // 수정 경로: 사용량 2 -> 4 재입력. 값 갱신 + 행 1개 유지.
      const response = await ctx.request('POST', '/api/kits/bulk', {
        body: { items: [{ kit_name: kitName, date, purchase_amount: 5, usage_amount: 4, current_inventory: 1, input_status: 'manual' }] },
      });
      ctx.assert(response.ok, `키트 수정 실패: HTTP ${response.status}`, 'KIT_UPDATE_FAILED', response.json);
    });
    await ctx.step('kit-db-invariant', async () => {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      try {
        const rows = db.prepare('SELECT kit_name, purchase_amount, usage_amount, current_inventory, site_id, is_synced FROM kit_logs WHERE date = ?').all(date);
        ctx.assert(rows.length === 1, `kit_logs 행 수가 예상(1)과 다릅니다: ${rows.length}`, 'DB_ROW_COUNT_MISMATCH', rows);
        const row = rows[0];
        ctx.assert(approxEqual(row.purchase_amount, 5) && approxEqual(row.usage_amount, 4), '입고/사용량이 수정 후 저장 값과 다릅니다.', 'DB_VALUE_MISMATCH', row);
        ctx.assert(row.site_id === expected.siteId, 'kit_logs.site_id 가 seed 현장과 다릅니다.', 'DB_SITE_ISOLATION_BROKEN', row);
        ctx.assert(Number(row.is_synced) === 0, '임시 DB 행이 동기화 완료로 표시되어 있습니다.', 'DB_SYNC_FLAG_UNEXPECTED', row);
        return { kit: row.kit_name };
      } finally {
        db.close();
      }
    });
  },
};
