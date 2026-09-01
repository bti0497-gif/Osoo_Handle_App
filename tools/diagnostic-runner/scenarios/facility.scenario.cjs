'use strict';

/**
 * facility 시나리오: 시설관리(업무사진관리)의 업무기록 생성·재조회·DB 불변식을 검증한다.
 * 계약 출처: server/routes/facilityRoutes.cjs (POST/GET /api/work-records)
 * 사진 업로드/폴더 연계는 로컬 파일·Drive 계약과 얽혀 있어 1차에서는 기록 CRUD로 한정한다.
 */

module.exports = {
  id: 'facility',
  version: '0.1.0',
  status: 'implemented',
  async run({ ctx, fixtures, dbPath, expected }) {
    const date = `${fixtures.dataset.fixedDate.slice(0, 8)}05`;
    const title = '진단 여과지 점검';

    await ctx.step('work-record-save', async () => {
      const response = await ctx.request('POST', '/api/work-records', {
        body: { date, title, content: '여과지 상태 점검 완료', notes: '진단 시나리오', location: '여과지' },
      });
      ctx.assert(response.ok, `업무기록 저장 실패: HTTP ${response.status}`, 'WORKRECORD_SAVE_FAILED', { status: response.status, body: response.json });
    });

    await ctx.step('work-record-reload', async () => {
      const response = await ctx.request('GET', '/api/work-records', { query: { date } });
      ctx.assert(response.ok, `업무기록 재조회 실패: HTTP ${response.status}`, 'WORKRECORD_RELOAD_FAILED');
      const rows = response.json && Array.isArray(response.json.records) ? response.json.records : response.json;
      const row = (Array.isArray(rows) ? rows : []).find((item) => item.title === title);
      ctx.assert(row, '저장한 업무기록이 재조회에 없습니다.', 'DATA_NOT_PERSISTED', rows);
    });

    await ctx.step('work-record-update-put', async () => {
      // 수정 경로: facility는 POST가 순수 INSERT이므로 PUT /:id가 정식 수정 계약이다.
      const created = await ctx.request('GET', '/api/work-records', { query: { date } });
      const rows = created.json && Array.isArray(created.json.records) ? created.json.records : created.json;
      const row = (Array.isArray(rows) ? rows : []).find((item) => item.title === title);
      ctx.assert(row && row.id, '수정 대상 기록의 id를 찾지 못했습니다.', 'UPDATE_TARGET_MISSING', rows);
      const put = await ctx.request('PUT', `/api/work-records/${row.id}`, {
        body: { date, title: `${title}(수정)`, content: '여과지 상태 점검 완료 — 수정반영', notes: '진단 시나리오', location: '여과지' },
      });
      ctx.assert(put.ok, `업무기록 수정(PUT) 실패: HTTP ${put.status}`, 'WORKRECORD_UPDATE_FAILED', put.json);
      const verify = await ctx.request('GET', '/api/work-records', { query: { date } });
      const vrows = verify.json && Array.isArray(verify.json.records) ? verify.json.records : verify.json;
      const updated = (Array.isArray(vrows) ? vrows : []).find((item) => item.id === row.id);
      ctx.assert(updated && updated.title === `${title}(수정)`, '수정한 제목이 반영되지 않았습니다.', 'UPDATE_NOT_APPLIED', updated);
    });

    await ctx.step('work-record-duplicate-rejected', async () => {
      // 중복 날짜 POST는 현재 UNIQUE 위반 500으로 거부된다(계약 고정: 409 개선 여지 기록).
      const response = await ctx.request('POST', '/api/work-records', {
        body: { date, title: '중복 시도', content: 'x', notes: '', location: '' },
      });
      ctx.assert(response.status >= 400, '같은 날짜 중복 업무기록이 수용되었습니다.', 'DUPLICATE_ACCEPTED', { status: response.status });
      return { note: `현재 거부 상태: HTTP ${response.status} (409 개선 권장)`, status: response.status };
    });
    await ctx.step('work-record-db-invariant', async () => {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      try {
        const rows = db.prepare('SELECT title, site_id FROM work_records WHERE date = ?').all(date);
        ctx.assert(rows.length === 1, `work_records 행 수가 예상(1)과 다릅니다: ${rows.length}`, 'DB_ROW_COUNT_MISMATCH', rows);
        ctx.assert(rows[0].title === `${title}(수정)`, 'DB 제목이 PUT 수정 결과와 다릅니다.', 'DB_VALUE_MISMATCH', rows[0]);
        ctx.assert(rows[0].site_id === expected.siteId, 'work_records.site_id 가 seed 현장과 다릅니다.', 'DB_SITE_ISOLATION_BROKEN', rows[0]);
      } finally {
        db.close();
      }
    });
  },
};
