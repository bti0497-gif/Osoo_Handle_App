'use strict';

/**
 * recovery 시나리오: 서버 재시작 후 데이터 보존과 readiness 회복을 검증한다(§Phase 3 우선순위 9).
 * 이 시나리오는 반드시 마지막에 실행한다(자식 프로세스를 재시작하기 때문).
 */

function nextDate(dateText, offsetDays) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

module.exports = {
  id: 'recovery',
    covers: [],
  version: '0.1.0',
  status: 'implemented',
  async run({ ctx, fixtures, dbPath, expected, runtime }) {
    if (!runtime || typeof runtime.restartServer !== 'function') {
      throw new Error('recovery 시나리오에는 restartServer 런타임 헬퍼가 필요합니다.');
    }
    const { inspectDatabase } = require('../lib/fixture-seeder.cjs');
    const recoveryDate = nextDate(fixtures.dataset.fixedDate, 3);
    const flowType = '여과지유입량';

    await ctx.step('write-before-restart', async () => {
      const response = await ctx.request('POST', '/api/flows', {
        body: { date: recoveryDate, type: flowType, raw_value: 500, reading_unit: 'KWH', input_status: 'manual' },
      });
      ctx.assert(response.ok, `재시작 전 데이터 저장 실패: HTTP ${response.status}`, 'FLOW_SAVE_FAILED', response.json);
    });

    await ctx.step('server-restart', async () => {
      const result = await runtime.restartServer();
      ctx.assert(result.exited && !result.orphaned, '이전 서버 프로세스가 정상 종료되지 않았습니다.', 'STOP_FAILED', result);
      ctx.assert(result.ready === true, '재시작한 서버가 ready 상태로 회복하지 않았습니다.', 'RESTART_NOT_READY', result);
      return { pid: result.pid, port: result.port };
    });

    await ctx.step('data-preserved-after-restart', async () => {
      const response = await ctx.request('GET', '/api/flows', { query: { date: recoveryDate } });
      ctx.assert(response.ok, `재시작 후 재조회 실패: HTTP ${response.status}`, 'FLOW_RELOAD_FAILED');
      const rows = response.json && Array.isArray(response.json.flows) ? response.json.flows : response.json;
      const row = rows.find((item) => item.type === flowType);
      ctx.assert(row && Number(row.raw_value) === 500,
        '서버 재시작 후 저장된 데이터가 보존되지 않았습니다.', 'DATA_LOSS_AFTER_RESTART', rows);
    });

    await ctx.step('integrity-after-restart', async () => {
      const inspection = inspectDatabase({ dbPath, expected });
      ctx.assert(inspection.integrityCheck === 'passed', `재시작 후 quick_check 실패: ${JSON.stringify(inspection.quickCheck)}`, 'DB_INTEGRITY_FAILED');
    });
  },
};
