'use strict';

/**
 * health 시나리오: 서버 readiness 형태와 임시 DB 무결성을 확인한다(§Phase 3 우선순위 1).
 */

module.exports = {
  id: 'health',
  version: '0.1.0',
  status: 'implemented',
  async run({ ctx, dbPath, expected }) {
    const { inspectDatabase } = require('../lib/fixture-seeder.cjs');

    await ctx.step('ping-ready-shape', async () => {
      const response = await ctx.request('GET', '/api/ping', { siteHeader: false });
      ctx.assert(response.ok, `/api/ping 응답이 실패했습니다: HTTP ${response.status}`, 'PING_FAILED');
      ctx.assert(response.json && response.json.app === 'osoo-handle-app', 'ping 응답에 app 식별자가 없습니다.', 'PING_APP_MISMATCH', response.json);
      ctx.assert(response.json.ready === true, 'ping 응답 ready가 true가 아닙니다.', 'PING_NOT_READY', response.json);
      ctx.assert(response.json.instanceVerified === true, '서버 토큰 계약이 검증되지 않았습니다(토큰 미적용 서버).', 'TOKEN_CONTRACT_UNVERIFIED', response.json);
      return { instanceVerified: response.json.instanceVerified };
    });

    await ctx.step('db-quick-check', async () => {
      const inspection = inspectDatabase({ dbPath, expected });
      ctx.assert(inspection.integrityCheck === 'passed', `SQLite quick_check 실패: ${JSON.stringify(inspection.quickCheck)}`, 'DB_INTEGRITY_FAILED', inspection.quickCheck);
      ctx.assert(inspection.fixtureIntegrity === 'passed', `seed 정합성 실패: ${inspection.fixtureMessages.join(', ')}`, 'DB_FIXTURE_MISMATCH', inspection.fixtureMessages);
      return inspection.counts;
    });
  },
};
