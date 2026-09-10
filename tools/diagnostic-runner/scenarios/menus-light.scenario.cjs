'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

/**
 * menus-light 시나리오: 별도 쓰기 시나리오가 없는 메뉴들의 읽기 경로를 묶어 검증한다.
 * - 설정: GET /api/settings, GET /api/settings/sites (읽기 전용 — 다른 시나리오가 의존하는
 *   app_settings를 변경하지 않는다)
 * - 성적서: GET /api/certificates 목록 조회
 * - 대시보드: 주요 업무별 데이터 GET 집계(전용 라우트 없음 — 기존 엔드포인트 조합)
 * 장비이력카드는 equipment-card 전용 시나리오가 검증한다.
 */

module.exports = {
  id: 'menus-light',
    covers: ["dashboard","certificate","log_roadwork_helper","equipment_card"],
  version: '0.3.0',
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

    await ctx.step('dashboard-inventory-last-purchase-reference', async () => {
      const modulePath = path.resolve(__dirname, '../../../src/features/dashboard/inventoryLevelUtils.js');
      const {
        getActiveConfiguredInventoryNames,
        normalizeLatestInventory,
      } = await import(pathToFileURL(modulePath).href);
      const configItems = [
        { category: 'medicine', item_name: '포도당', is_active: 1, display_order: 0 },
        { category: 'medicine', item_name: '중탄산나트륨', is_active: 1, display_order: 1 },
        { category: 'medicine', item_name: '팩(PAC)', is_active: 1, display_order: 2 },
        { category: 'medicine', item_name: '응집제', is_active: 0, display_order: 3 },
        { category: 'medicine', item_name: '메탄올', is_active: 0, display_order: 4 },
      ];
      const activeNames = getActiveConfiguredInventoryNames(configItems, 'medicine');
      const result = normalizeLatestInventory([
        { medicine_name: '포도당', date: '2026-08-01', purchase_amount: 100, current_inventory: 100 },
        { medicine_name: '포도당', date: '2026-08-02', purchase_amount: 0, current_inventory: 75 },
        { medicine_name: '포도당', date: '2026-08-10', purchase_amount: 60, current_inventory: 80 },
        { medicine_name: '포도당', date: '2026-08-11', purchase_amount: 0, current_inventory: 45 },
        { medicine_name: '중탄산나트륨', date: '2026-08-11', purchase_amount: 0, current_inventory: 0 },
        { medicine_name: '팩(PAC)', date: '2026-08-11', purchase_amount: 300, current_inventory: 208 },
        { medicine_name: '응집제', date: '2026-08-11', purchase_amount: 675, current_inventory: 643 },
        { medicine_name: '메탄올', date: '2026-08-11', purchase_amount: 0, current_inventory: 642 },
      ], 'medicine_name', activeNames);
      const glucose = result.find((item) => item.name === '포도당');
      ctx.assert(glucose?.inventory === 45, '대시보드 최신 약품 재고 선택이 잘못됐습니다.', 'DASHBOARD_LATEST_INVENTORY_BROKEN', glucose);
      ctx.assert(glucose?.referenceAmount === 60, '대시보드 재고 기준이 직전 실제 구매량과 다릅니다.', 'DASHBOARD_PURCHASE_REFERENCE_BROKEN', glucose);
      ctx.assert(result.map((item) => item.name).join('|') === '포도당|중탄산나트륨|팩(PAC)',
        '대시보드가 현장 설정의 활성 약품 목록·순서를 따르지 않습니다.', 'DASHBOARD_ACTIVE_INVENTORY_FILTER_BROKEN', result);
      ctx.assert(!result.some((item) => item.name === '응집제' || item.name === '메탄올'),
        '비활성 약품의 과거 재고가 대시보드에 노출됩니다.', 'DASHBOARD_INACTIVE_INVENTORY_VISIBLE', result);
      const pac = result.find((item) => item.name === '팩(PAC)');
      ctx.assert(pac?.inventory === 208 && pac?.referenceAmount === 300,
        '팩(PAC) 재고가 별도 응집제 이력과 섞였습니다.', 'DASHBOARD_PAC_ALIAS_MIXED', pac);
    });

  },
};
