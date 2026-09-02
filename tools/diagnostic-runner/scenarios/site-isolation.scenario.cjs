'use strict';

/**
 * site-isolation 시나리오: 양방향 두 site_id의 조회·저장 격리를 검증한다(계획 §11-7).
 * 계약 출처: server/middleware/siteContext.cjs
 * - multi_site_enabled=1 이면 허용 현장은 [primary, secondary] 뿐이다.
 * - 각 현장 헤더로 저장한 데이터는 다른 현장 헤더의 조회에 노출되지 않는다.
 * - 허용 밖 현장 헤더는 403, 헤더와 query site_id 불일치는 409로 거부된다.
 */

function approxEqual(a, b, epsilon = 1e-6) {
  return Math.abs(Number(a) - Number(b)) < epsilon;
}

module.exports = {
  id: 'site-isolation',
    covers: [],
  version: '0.1.0',
  status: 'implemented',
  async run({ ctx, fixtures, dbPath, expected }) {
    const date = fixtures.dataset.fixedDate;
    const type = '하수유입량';
    const siteA = expected.siteId;
    const siteB = 'd1a6b2f0-2222-4222-8222-000000000002';
    const withSite = (siteId) => ({ siteHeader: false, headers: { 'x-osoo-site-id': siteId } });

    await ctx.step('setup-multi-site', async () => {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath);
      db.pragma('busy_timeout = 10000');
      try {
        const seed = db.transaction(() => {
          db.prepare(`
            INSERT INTO sites (id, site_name, manager_name, method, series, is_active)
            VALUES (?, '진단제2정수센터', '진단관리자2', 'MBR', '2계열', 1)
            ON CONFLICT(id) DO UPDATE SET is_active = 1
          `).run(siteB);
          db.prepare(`
            UPDATE app_settings
            SET multi_site_enabled = 1, primary_site_id = ?, secondary_site_id = ?
            WHERE id = 1
          `).run(siteA, siteB);
        });
        seed();
        return { primary: siteA, secondary: siteB };
      } finally {
        db.close();
      }
    });

    await ctx.step('both-sites-write', async () => {
      const postA = await ctx.request('POST', '/api/flows', {
        ...withSite(siteA),
        body: { date, type, raw_value: 500, reading_unit: 'KWH', input_status: 'manual' },
      });
      ctx.assert(postA.ok, `1현장 저장 실패: HTTP ${postA.status}`, 'SITE_A_SAVE_FAILED', postA.json);
      const postB = await ctx.request('POST', '/api/flows', {
        ...withSite(siteB),
        body: { date, type, raw_value: 900, reading_unit: 'KWH', input_status: 'manual' },
      });
      ctx.assert(postB.ok, `2현장 저장 실패: HTTP ${postB.status}`, 'SITE_B_SAVE_FAILED', postB.json);
    });

    await ctx.step('read-isolation-both-directions', async () => {
      const readA = await ctx.request('GET', '/api/flows', { ...withSite(siteA), query: { date } });
      ctx.assert(readA.ok, `1현장 조회 실패: HTTP ${readA.status}`, 'SITE_A_READ_FAILED');
      const rowsA = readA.json && Array.isArray(readA.json.flows) ? readA.json.flows : readA.json;
      const aRows = (rowsA || []).filter((item) => item.type === type);
      ctx.assert(aRows.length === 1 && approxEqual(aRows[0].raw_value, 500),
        '1현장 조회가 자기 데이터만 보지 못했습니다(누락 또는 타 현장 유출).', 'SITE_A_LEAK_OR_MISSING', aRows);

      const readB = await ctx.request('GET', '/api/flows', { ...withSite(siteB), query: { date } });
      ctx.assert(readB.ok, `2현장 조회 실패: HTTP ${readB.status}`, 'SITE_B_READ_FAILED');
      const rowsB = readB.json && Array.isArray(readB.json.flows) ? readB.json.flows : readB.json;
      const bRows = (rowsB || []).filter((item) => item.type === type);
      ctx.assert(bRows.length === 1 && approxEqual(bRows[0].raw_value, 900),
        '2현장 조회가 자기 데이터만 보지 못했습니다(누락 또는 타 현장 유출).', 'SITE_B_LEAK_OR_MISSING', bRows);
    });

    await ctx.step('forbidden-site-rejected', async () => {
      const unknown = 'd1a6b2f0-9999-4999-8999-000000000099';
      const response = await ctx.request('GET', '/api/flows', { ...withSite(unknown), query: { date } });
      ctx.assert(response.status === 403, `허용 밖 현장 헤더가 403으로 거부되지 않았습니다: HTTP ${response.status}`, 'SITE_FORBIDDEN_NOT_ENFORCED', response.json);
      ctx.assert(response.json && response.json.code === 'SITE_CONTEXT_FORBIDDEN', '거부 코드가 SITE_CONTEXT_FORBIDDEN이 아닙니다.', 'SITE_FORBIDDEN_CODE_MISMATCH', response.json);
    });

    await ctx.step('site-mismatch-rejected', async () => {
      // 헤더(1현장)와 query site_id(2현장) 불일치는 409로 차단된다.
      const response = await ctx.request('GET', '/api/flows', { ...withSite(siteA), query: { date, site_id: siteB } });
      ctx.assert(response.status === 409, `헤더/query 현장 불일치가 409로 거부되지 않았습니다: HTTP ${response.status}`, 'SITE_MISMATCH_NOT_ENFORCED', response.json);
      ctx.assert(response.json && response.json.code === 'SITE_CONTEXT_MISMATCH', '거부 코드가 SITE_CONTEXT_MISMATCH가 아닙니다.', 'SITE_MISMATCH_CODE_MISMATCH', response.json);
    });

    await ctx.step('site-db-invariant', async () => {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      db.pragma('busy_timeout = 10000');
      try {
        const rows = db.prepare('SELECT site_id, raw_value FROM flow_readings WHERE type = ? AND date = ? ORDER BY site_id').all(type, date);
        ctx.assert(rows.length === 2, `현장별 행 수가 예상(2)과 다릅니다: ${rows.length}`, 'DB_ROW_COUNT_MISMATCH', rows);
        const bySite = Object.fromEntries(rows.map((row) => [row.site_id, row.raw_value]));
        ctx.assert(approxEqual(bySite[siteA], 500) && approxEqual(bySite[siteB], 900), '현장별 값이 저장 내용과 다릅니다.', 'DB_VALUE_MISMATCH', bySite);
        return { sites: Object.keys(bySite).length };
      } finally {
        db.close();
      }
    });
  },
};
