'use strict';

/**
 * dailylog 시나리오: 일일 검침(유량) 입력의 저장·재조회·검침 보정 규칙·거부 규칙·수정 경로를 검증한다.
 * 계약 출처: server/routes/flowRoutes.cjs (POST /api/flows 의 전일 대비 증감 계산과 감소 거부)
 * 단계 순서 주의: 수정(day1 값 상향)은 증분/감소 규칙 검증 뒤에 와야 한다(순서 의존).
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

    await ctx.step('flow-update-first-reading', async () => {
      // 수정 경로: 같은 날짜 재입력은 갱신이어야 하고 중복 행이 생기지 않아야 한다.
      // (증분/감소 규칙 검증 이후에 실행 — day1 상향이 day2 검증에 영향주지 않도록)
      const response = await ctx.request('POST', '/api/flows', {
        body: { date: day1, type: flowType, raw_value: 200, reading_unit: 'KWH', input_status: 'manual' },
      });
      ctx.assert(response.ok, `검침 수정 실패: HTTP ${response.status}`, 'FLOW_UPDATE_FAILED', response.json);
      const reload = await ctx.request('GET', '/api/flows', { query: { date: day1 } });
      const rows = reload.json && Array.isArray(reload.json.flows) ? reload.json.flows : reload.json;
      const matching = (rows || []).filter((item) => item.type === flowType);
      ctx.assert(matching.length === 1, '수정 재입력 후 행이 중복 생성되었습니다.', 'UPDATE_CREATED_DUPLICATE', matching.length);
      ctx.assert(approxEqual(matching[0].raw_value, 200), '수정한 값이 반영되지 않았습니다.', 'UPDATE_NOT_APPLIED', matching[0]);
      // 현재 계약(2026-09-01 실측): 과거 검침 수정은 이후 일자 증분을 재계산한다.
      // day1 200 > day2 150.5 이므로 day2 증분은 음수(-49.5)가 되고 앱은 0으로 기록한다.
      // 계약이 바뀌면(거부 또는 음수 보존) 이 단계가 실패하며 갱신을 요구한다.
      const day2Reload = await ctx.request('GET', '/api/flows', { query: { date: day2 } });
      const day2Row = (day2Reload.json && Array.isArray(day2Reload.json.flows) ? day2Reload.json.flows : day2Reload.json)
        .find((item) => item.type === flowType);
      ctx.assert(day2Row && approxEqual(day2Row.calculated_flow, 0),
        '과거 검침 수정의 재계산 계약이 변했습니다(기대: 음수 증분 0으로 기록).', 'HISTORICAL_RECOMPUTE_CONTRACT', day2Row);
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
