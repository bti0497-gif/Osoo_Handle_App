'use strict';

/** 장비이력카드 Phase 2: 프로비저닝·CRUD·이력·업무기록 연결·현장 격리 계약. */
module.exports = {
  id: 'equipment-card',
  covers: ['equipment_card', 'equipment_history'],
  version: '1.0.0',
  status: 'implemented',
  async run({ ctx, dbPath, expected, fixtures }) {
    let equipmentId;
    let historyId;
    const historyDate = `${fixtures.dataset.fixedDate.slice(0, 8)}18`;
    const workDate = `${fixtures.dataset.fixedDate.slice(0, 8)}19`;

    await ctx.step('equipment-provisioning', async () => {
      const response = await ctx.request('GET', '/api/equipment', {});
      ctx.assert(response.ok && Array.isArray(response.json) && response.json.length > 20,
        '공법별 기본 장비 프로비저닝에 실패했습니다.', 'EQUIPMENT_PROVISIONING_FAILED', response.json);
      ctx.assert(response.json.some((row) => row.management_no === 'M-103A'),
        '호기별 기본 장비가 없습니다.', 'EQUIPMENT_UNIT_SEED_MISSING');
    });

    await ctx.step('equipment-create-and-status', async () => {
      const next = await ctx.request('GET', '/api/equipment/next-management-no', {
        query: { name: '진단유량계', category2: '유량계' },
      });
      ctx.assert(next.ok && next.json?.managementNo, '관리번호 채번에 실패했습니다.', 'EQUIPMENT_NUMBER_FAILED', next.json);
      const created = await ctx.request('POST', '/api/equipment', {
        body: { managementNo: next.json.managementNo, name: '진단유량계', category1: '방류조', category2: '유량계' },
      });
      ctx.assert(created.ok && created.json?.id, '장비 생성에 실패했습니다.', 'EQUIPMENT_CREATE_FAILED', created.json);
      equipmentId = created.json.id;
      const status = await ctx.request('PUT', `/api/equipment/${equipmentId}/status`, { body: { status: '점검 필요' } });
      ctx.assert(status.ok && status.json?.status === '점검 필요', '장비 상태 변경에 실패했습니다.', 'EQUIPMENT_STATUS_FAILED', status.json);
    });

    await ctx.step('equipment-history-create', async () => {
      const response = await ctx.request('POST', '/api/equipment/history', {
        body: { equipmentId, date: historyDate, type: '정기점검', content: '진단 점검 완료', company: '진단업체' },
      });
      ctx.assert(response.ok && response.json?.id, '장비 이력 생성에 실패했습니다.', 'EQUIPMENT_HISTORY_CREATE_FAILED', response.json);
      historyId = response.json.id;
      const list = await ctx.request('GET', '/api/equipment/history', { query: { equipmentId } });
      ctx.assert(list.ok && Array.isArray(list.json) && list.json.some((row) => row.id === historyId),
        '생성한 장비 이력을 재조회하지 못했습니다.', 'EQUIPMENT_HISTORY_RELOAD_FAILED', list.json);
    });

    await ctx.step('equipment-work-record-link', async () => {
      const saved = await ctx.request('POST', '/api/work-records', {
        body: { date: workDate, title: '장비 연결 진단', content: '', equipmentIds: [equipmentId] },
      });
      ctx.assert(saved.ok, '업무기록과 장비 연결 저장에 실패했습니다.', 'EQUIPMENT_LINK_SAVE_FAILED', saved.json);
      const linked = await ctx.request('GET', '/api/equipment/work-records', { query: { equipmentId } });
      ctx.assert(linked.ok && Array.isArray(linked.json) && linked.json.length === 1,
        '장비에서 연결 업무기록을 조회하지 못했습니다.', 'EQUIPMENT_LINK_RELOAD_FAILED', linked.json);
    });

    await ctx.step('equipment-site-and-db-invariants', async () => {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      try {
        const asset = db.prepare('SELECT site_id, is_visible FROM equipment_assets WHERE id = ?').get(equipmentId);
        const history = db.prepare('SELECT site_id, equipment_id FROM facility_logs WHERE id = ?').get(historyId);
        ctx.assert(asset?.site_id === expected.siteId && Number(asset.is_visible) === 1,
          '장비 현장 격리 또는 표시 상태가 손상됐습니다.', 'EQUIPMENT_DB_SCOPE_BROKEN', asset);
        ctx.assert(history?.site_id === expected.siteId && history.equipment_id === equipmentId,
          '장비 이력 FK/현장 범위가 손상됐습니다.', 'EQUIPMENT_HISTORY_DB_SCOPE_BROKEN', history);
      } finally {
        db.close();
      }
    });
  },
};
