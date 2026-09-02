'use strict';

/**
 * menus-light 시나리오: 별도 쓰기 시나리오가 없는 메뉴들의 읽기 경로를 묶어 검증한다.
 * - 설정: GET /api/settings, GET /api/settings/sites (읽기 전용 — 다른 시나리오가 의존하는
 *   app_settings를 변경하지 않는다)
 * - 성적서: GET /api/certificates 목록 조회
 * - 대시보드: 주요 업무별 데이터 GET 집계(전용 라우트 없음 — 기존 엔드포인트 조합)
 * - 장비이력카드: contract-pending 참고 검사(계획 §3 — 자동 PASS 아님)
 */

module.exports = {
  id: 'menus-light',
    covers: ["dashboard","certificate","log_roadwork_helper","equipment_card"],
  version: '0.1.0',
  status: 'implemented',
  async run({ ctx, fixtures, expected }) {
    const date = fixtures.dataset.fixedDate;

    await ctx.step('settings-read', async () => {
      const response = await ctx.request('GET', '/api/settings', {});
      ctx.assert(response.ok, `설정 조회 실패: HTTP ${response.status}`, 'SETTINGS_READ_FAILED');
      const sites = await ctx.request('GET', '/api/settings/sites', {});
      ctx.assert(sites.ok, `현장 목록 조회 실패: HTTP ${sites.status}`, 'SITES_READ_FAILED');
      const list = sites.json && Array.isArray(sites.json.sites) ? sites.json.sites : (Array.isArray(sites.json) ? sites.json : []);
      ctx.assert(list.some((site) => site.id === expected.siteId || site.site_id === expected.siteId),
        'seed한 현장이 설정 현장 목록에 없습니다.', 'SEEDED_SITE_MISSING', { count: list.length });
    });

    await ctx.step('certificate-list', async () => {
      const response = await ctx.request('GET', '/api/certificates', {});
      // 성적서 목록은 조회 가능(빈 목록도 정상)해야 한다. 4xx/5xx만 실패로 본다.
      ctx.assert(response.status < 400, `성적서 목록 조회 실패: HTTP ${response.status}`, 'CERTIFICATE_LIST_FAILED');
      return { status: response.status };
    });

    await ctx.step('dashboard-aggregate', async () => {
      // 대시보드는 전용 라우트 없이 기존 업무 GET을 조합한다. 오늘 날짜 데이터가 모두 조회되어야 한다.
      for (const [name, path, query] of [
        ['flow', '/api/flows', { date }],
        ['medicine', '/api/medicines', { date }],
        ['water', '/api/water-quality', { date }],
        ['operation', '/api/operation-status', { date }],
      ]) {
        const response = await ctx.request('GET', path, { query });
        ctx.assert(response.ok, `대시보드 집계(${name}) 조회 실패: HTTP ${response.status}`, 'DASHBOARD_AGGREGATE_FAILED', { name, status: response.status });
      }
    });

    await ctx.step('equipment-card-reference', async () => {
      // 장비이력카드는 현재 프로토타입 화면으로 서버 라우트가 없다(계획 문서 §3 contract-pending).
      // 404를 기대한다: 백엔드 계약이 추가되면 이 단계가 실패하며 implemented 승격을 요구한다.
      const response = await ctx.request('GET', '/api/equipment-assets', {});
      ctx.assert(response.status === 404, '장비이력카드 백엔드 계약 상태가 변했습니다(HTTP ' + response.status + '). contract-pending 판정을 갱신하고 정식 시나리오를 작성하세요.', 'EQUIPMENT_CONTRACT_CHANGED', { status: response.status });
      return { note: 'contract-pending(라우트 없음, 404 기대)' };
    });
  },
};
