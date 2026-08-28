'use strict';

/**
 * dailylog 시나리오: 일일 검침(유량) 입력의 저장·재조회·검침 보정 규칙·거부 규칙을 검증한다.
 * 계약 출처: server/routes/flowRoutes.cjs (POST /api/flows 의 전일 대비 증감 계산과 감소 거부)
 */

function nextDate(dateText, offsetDays) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function approxEqual(a, b, epsilon = 1e-6) {
  return Math.abs(Number(a) - Number(b)) < epsilon;
}

module.exports = {
  id: 'dailylog',
  version: '0.1.0',
  status: 'implemented',
  async run({ ctx, fixtures, dbPath, expected }) {
    const { deterministicUuid } = require('../lib/fixture-seeder.cjs');
    const day1 = fixtures.dataset.fixedDate;
    const day2 = nextDate(day1, 1);
    const flowType = '여과지유입량';

    await ctx.step('flow-create-first-reading', async () => {
      const response = await ctx.request('POST', '/api/flows', {
        body: { date: day1, type: flowType, raw_value: 100.5, reading_unit: 'KWH', input_status: 'manual' },
      });
      ctx.assert(response.ok, `첫 검침 저장 실패: HTTP ${response.status}`, 'FLOW_SAVE_FAILED', { status: response.status, body: response.json });
    });

    await ctx.step('flow-reload-first-reading', async () => {
      const response = await ctx.request('GET', '/api/flows', { query: { date: day1 } });
      ctx.assert(response.ok, `검침 재조회 실패: HTTP ${response.status}`, 'FLOW_RELOAD_FAILED');
      const row = (response.json && Array.isArray(response.json.flows) ? response.json.flows : response.json)
        .find((item) => item.type === flowType);
      ctx.assert(row, '저장한 첫 검침이 재조회에 없습니다.', 'DATA_NOT_PERSISTED', response.json);
      ctx.assert(approxEqual(row.raw_value, 100.5), '재조회한 검침값이 저장 값과 다릅니다.', 'DATA_CORRUPTED', { raw: row.raw_value });
    });

    await ctx.step('flow-correction-rule', async () => {
      // 전일(raw 100.5) 대비 증분 계산: 150.5 - 100.5 = 50
      const response = await ctx.request('POST', '/api/flows', {
        body: { date: day2, type: flowType, raw_value: 150.5, reading_unit: 'KWH', input_status: 'manual' },
      });
      ctx.assert(response.ok, `둘째 날 검침 저장 실패: HTTP ${response.status}`, 'FLOW_SAVE_FAILED', response.json);
      const reload = await ctx.request('GET', '/api/flows', { query: { date: day2 } });
      const row = (reload.json && Array.isArray(reload.json.flows) ? reload.json.flows : reload.json)
        .find((item) => item.type === flowType);
      ctx.assert(row && approxEqual(row.calculated_flow, 50),
        '전일 대비 증분 계산 규칙이 깨졌습니다.', 'FLOW_CALC_RULE_BROKEN', { row });
    });

    await ctx.step('flow-reject-decreasing', async () => {
      // 전일(150.5)보다 작은 검침은 초기화 플래그 없이는 거부되어야 한다.
      const response = await ctx.request('POST', '/api/flows', {
        body: { date: nextDate(day2, 1), type: flowType, raw_value: 100, reading_unit: 'KWH', input_status: 'manual' },
      });
      ctx.assert(response.status === 400,
        '감소한 검침값이 거부되지 않았습니다.', 'FLOW_DECREASE_NOT_REJECTED', { status: response.status, body: response.json });
    });

    await ctx.step('flow-db-invariant', async () => {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      try {
        const rows = db.prepare('SELECT date, raw_value, site_id, is_synced FROM flow_readings WHERE type = ? ORDER BY date').all(flowType);
        ctx.assert(rows.length === 2, `flow_readings 행 수가 예상(2)과 다릅니다: ${rows.length}`, 'DB_ROW_COUNT_MISMATCH', rows);
        for (const row of rows) {
          ctx.assert(row.site_id === expected.siteId, 'flow_readings.site_id 가 seed 현장과 다릅니다.', 'DB_SITE_ISOLATION_BROKEN', row);
          ctx.assert(Number(row.is_synced) === 0, '임시 DB 행이 동기화 완료로 표시되어 있습니다.', 'DB_SYNC_FLAG_UNEXPECTED', row);
        }
        const rowIds = rows.map((row) => `${row.date}:${row.raw_value}`).join(', ');
        return { rows: rowIds, probe: deterministicUuid('dailylog-invariant') };
      } finally {
        db.close();
      }
    });
  },
};
