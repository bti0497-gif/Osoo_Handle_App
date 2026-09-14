'use strict';

/** 장비이력카드 Phase 2: 프로비저닝·CRUD·이력·업무기록 연결·현장 격리 계약. */
module.exports = {
  id: 'equipment-card',
  covers: ['equipment_card', 'equipment_history'],
  version: '1.1.0',
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
        body: {
          equipmentId, date: historyDate, completedAt: historyDate,
          type: '정기점검', content: '진단 점검 완료', company: '진단업체',
        },
      });
      ctx.assert(response.ok && response.json?.id, '장비 이력 생성에 실패했습니다.', 'EQUIPMENT_HISTORY_CREATE_FAILED', response.json);
      historyId = response.json.id;
      const list = await ctx.request('GET', '/api/equipment/history', { query: { equipmentId } });
      ctx.assert(list.ok && Array.isArray(list.json) && list.json.some((row) => row.id === historyId),
        '생성한 장비 이력을 재조회하지 못했습니다.', 'EQUIPMENT_HISTORY_RELOAD_FAILED', list.json);

      const updated = await ctx.request('PUT', `/api/equipment/history/${historyId}`, {
        body: { content: '진단 점검 내용 수정' },
      });
      const afterUpdate = await ctx.request('GET', '/api/equipment/history', { query: { equipmentId } });
      const preserved = Array.isArray(afterUpdate.json)
        ? afterUpdate.json.find((row) => row.id === historyId)
        : null;
      ctx.assert(updated.ok && preserved?.completed_at === historyDate,
        '이력 내용 수정 중 완료일이 소실됐습니다.', 'EQUIPMENT_COMPLETED_AT_LOST', preserved);
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

    await ctx.step('equipment-visibility-diagnostics', async () => {
      const hidden = await ctx.request('PUT', `/api/equipment/${equipmentId}/visibility`, { body: { is_visible: false } });
      ctx.assert(hidden.ok && hidden.json.is_visible === 0, '숨김 저장 실패', 'VISIBILITY_FAILED');
      const restored = await ctx.request('PUT', `/api/equipment/${equipmentId}/visibility`, { body: { is_visible: true } });
      ctx.assert(restored.ok, '표시 복원 실패', 'VISIBILITY_RESTORE_FAILED');
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      try {
        const rows = db.prepare("SELECT site_id, details_json FROM app_diagnostic_logs WHERE area = 'equipment-card' AND action = 'PUT /api/equipment/:id/visibility' AND result = 'ok'").all();
        ctx.assert(rows.some((row) => row.site_id === expected.siteId && JSON.parse(row.details_json).isVisible === false),
          '숨김 현장/결과 진단 누락', 'VISIBILITY_DIAGNOSTIC_MISSING');
        const work = db.prepare("SELECT COUNT(*) AS n FROM app_diagnostic_logs WHERE area = 'work-photos' AND result = 'ok'").get();
        ctx.assert(work.n > 0, '업무사진 연결 진단 누락', 'WORK_DIAGNOSTIC_MISSING');
      } finally { db.close(); }
    });

    await ctx.step('equipment-delete-and-work-record-site-guard', async () => {
      const disposable = await ctx.request('POST', '/api/equipment', {
        body: { managementNo: `DEL-${Date.now()}`, name: '삭제진단장비', category1: '진단', category2: '진단' },
      });
      ctx.assert(disposable.ok && disposable.json?.id,
        '삭제 검증용 장비 생성에 실패했습니다.', 'EQUIPMENT_DELETE_SETUP_FAILED', disposable.json);
      const removed = await ctx.request('DELETE', `/api/equipment/${disposable.json.id}`, {});
      ctx.assert(removed.ok,
        '이력 없는 장비의 정상 삭제 또는 사진 폴더 정리에 실패했습니다.', 'EQUIPMENT_DELETE_FAILED', removed.json);

      const Database = require('better-sqlite3');
      const db = new Database(dbPath);
      let foreignId;
      try {
        const inserted = db.prepare(`
          INSERT INTO work_records (date, title, site_id, site_name, created_at, last_modified)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(`${fixtures.dataset.fixedDate.slice(0, 8)}20`, '타 현장 보호 진단', 'foreign-site', '타 현장');
        foreignId = inserted.lastInsertRowid;
      } finally {
        db.close();
      }
      const foreignPut = await ctx.request('PUT', `/api/work-records/${foreignId}`, {
        body: { date: workDate, title: '변경 시도', equipmentIds: [equipmentId] },
      });
      ctx.assert(foreignPut.status === 404,
        '다른 현장 업무기록 수정이 차단되지 않았습니다.', 'WORK_RECORD_SITE_GUARD_FAILED', foreignPut.json);
      const verifyDb = new Database(dbPath, { readonly: true });
      try {
        const row = verifyDb.prepare('SELECT title FROM work_records WHERE id = ?').get(foreignId);
        const link = verifyDb.prepare('SELECT 1 FROM work_record_equipment_links WHERE work_record_id = ?').get(foreignId);
        ctx.assert(row?.title === '타 현장 보호 진단' && !link,
          '차단된 요청이 타 현장 업무기록 또는 장비 연결을 변경했습니다.', 'WORK_RECORD_SITE_MUTATED', { row, link });
      } finally {
        verifyDb.close();
      }
    });
  },
};
