'use strict';

/**
 * medicine 시나리오: 약품관리 입력의 저장·재조회·재고 계산 규칙을 검증한다.
 * 계약 출처: server/routes/medicineRoutes.cjs (POST /api/medicines)
 * - 재고 규칙: current_inventory = 전일 재고 + 입고 - 사용량 (첫 입력은 0 기준)
 */

function approxEqual(a, b, epsilon = 1e-6) {
  return Math.abs(Number(a) - Number(b)) < epsilon;
}

module.exports = {
  id: 'medicine',
  version: '0.1.0',
  status: 'implemented',
  async run({ ctx, fixtures, dbPath, expected }) {
    const date = fixtures.dataset.fixedDate;
    const medicineName = '염소';

    await ctx.step('medicine-save', async () => {
      const response = await ctx.request('POST', '/api/medicines', {
        body: { medicine_name: medicineName, date, purchase_amount: 10, usage_amount: 3, input_status: 'manual' },
      });
      ctx.assert(response.ok, `약품 입력 저장 실패: HTTP ${response.status}`, 'MEDICINE_SAVE_FAILED', { status: response.status, body: response.json });
    });

    await ctx.step('medicine-reload-and-inventory-rule', async () => {
      const response = await ctx.request('GET', '/api/medicines', { query: { date } });
      ctx.assert(response.ok, `약품 재조회 실패: HTTP ${response.status}`, 'MEDICINE_RELOAD_FAILED');
      const rows = response.json && Array.isArray(response.json.medicines) ? response.json.medicines : response.json;
      const row = (rows || []).find((item) => item.medicine_name === medicineName);
      ctx.assert(row, '저장한 약품 기록이 재조회에 없습니다.', 'DATA_NOT_PERSISTED', rows);
      ctx.assert(approxEqual(row.current_inventory, 7), '재고 계산 규칙(입고-사용)이 깨졌습니다.', 'INVENTORY_RULE_BROKEN', row);
    });

    await ctx.step('medicine-update-usage', async () => {
      // 수정 경로: 사용량 3 -> 5 재입력. 재고는 입고-사용=5로 갱신되고 행은 1개여야 한다.
      const response = await ctx.request('POST', '/api/medicines', {
        body: { medicine_name: medicineName, date, purchase_amount: 10, usage_amount: 5, input_status: 'manual' },
      });
      ctx.assert(response.ok, `약품 수정 실패: HTTP ${response.status}`, 'MEDICINE_UPDATE_FAILED', response.json);
      const reload = await ctx.request('GET', '/api/medicines', { query: { date } });
      const rows = reload.json && Array.isArray(reload.json.medicines) ? reload.json.medicines : reload.json;
      const matching = (rows || []).filter((item) => item.medicine_name === medicineName);
      ctx.assert(matching.length === 1, '수정 재입력 후 행이 중복 생성되었습니다.', 'UPDATE_CREATED_DUPLICATE', matching.length);
      ctx.assert(approxEqual(matching[0].current_inventory, 5), '수정 후 재고가 입고-사용 규칙과 다릅니다.', 'INVENTORY_RULE_BROKEN', matching[0]);
    });
    await ctx.step('medicine-db-invariant', async () => {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      try {
        const rows = db.prepare('SELECT medicine_name, current_inventory, site_id, is_synced FROM medicine_logs WHERE date = ?').all(date);
        ctx.assert(rows.length === 1, `medicine_logs 행 수가 예상(1)과 다릅니다: ${rows.length}`, 'DB_ROW_COUNT_MISMATCH', rows);
        const row = rows[0];
        ctx.assert(approxEqual(row.current_inventory, 5), 'DB 재고값이 수정 후 계산 규칙(입고10-사용5)과 다릅니다.', 'DB_VALUE_MISMATCH', row);
        ctx.assert(row.site_id === expected.siteId, 'medicine_logs.site_id 가 seed 현장과 다릅니다.', 'DB_SITE_ISOLATION_BROKEN', row);
        ctx.assert(Number(row.is_synced) === 0, '임시 DB 행이 동기화 완료로 표시되어 있습니다.', 'DB_SYNC_FLAG_UNEXPECTED', row);
      } finally {
        db.close();
      }
    });
  },
};
