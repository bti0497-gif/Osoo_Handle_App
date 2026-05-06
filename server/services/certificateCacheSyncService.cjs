const { getBigQueryClient, DATASET_ID } = require('./bigQueryClientService.cjs');

function normalizeMonth(value) {
  const m = String(value || '').trim();
  return /^(0[1-9]|1[0-2])$/.test(m) ? m : '';
}

function normalizeYear(value) {
  const y = String(value || '').trim();
  return /^\d{4}$/.test(y) ? y : '';
}

function normalizeDate(value) {
  if (!value) return '';
  if (typeof value === 'object') {
    if (typeof value.value === 'string') return normalizeDate(value.value);
    if (typeof value.valueOf === 'function') return normalizeDate(value.valueOf());
  }
  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return '';
}

function monthRange(year, month) {
  const y = normalizeYear(year);
  const m = normalizeMonth(month);
  if (!y || !m) return null;
  const monthStart = `${y}-${m}-01`;
  const d = new Date(`${monthStart}T00:00:00`);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  const monthEnd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { monthStart, monthEnd };
}

async function syncCertificateCacheForSiteMonth({ db, siteName, year, month }) {
  const bq = getBigQueryClient();
  if (!bq) return { synced: false, reason: 'bigquery_unavailable', count: 0 };

  const trimmedSite = String(siteName || '').trim();
  if (!trimmedSite) return { synced: false, reason: 'site_name_missing', count: 0 };

  const range = monthRange(year, month);
  if (!range) return { synced: false, reason: 'invalid_year_or_month', count: 0 };

  const [rows] = await bq.query({
    query: `
      SELECT
        report_date,
        site_id,
        site_name,
        site_name_raw,
        ss, bod, tn, tp, total_coliform, mlss, do, ph,
        source_pdf_name,
        source_page_index,
        ai_confidence,
        site_match_confidence,
        manual_review_required,
        warnings_json,
        source_payload_json
      FROM \`${DATASET_ID}.certificate_water_quality\`
      WHERE report_date BETWEEN @monthStart AND @monthEnd
        AND REPLACE(COALESCE(site_name, ''), ' ', '') = REPLACE(@siteName, ' ', '')
      ORDER BY report_date ASC
    `,
    params: {
      monthStart: range.monthStart,
      monthEnd: range.monthEnd,
      siteName: trimmedSite,
    },
    types: {
      monthStart: 'DATE',
      monthEnd: 'DATE',
      siteName: 'STRING',
    },
  });

  const tx = db.transaction((items) => {
    db.prepare(`
      DELETE FROM certificate_water_quality
      WHERE report_date BETWEEN ? AND ?
        AND REPLACE(COALESCE(site_name, ''), ' ', '') = REPLACE(?, ' ', '')
    `).run(range.monthStart, range.monthEnd, trimmedSite);

    const insertStmt = db.prepare(`
      INSERT INTO certificate_water_quality (
        report_date, site_id, site_name, site_name_raw,
        ss, bod, tn, tp, total_coliform, mlss, do, ph,
        source_pdf_name, source_page_index,
        ai_confidence, site_match_confidence, manual_review_required,
        warnings_json, source_payload_json,
        created_at, last_modified, is_synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const nowIso = new Date().toISOString();
    for (const r of items || []) {
      const reportDate = normalizeDate(r.report_date);
      if (!reportDate) continue;
      insertStmt.run(
        reportDate,
        r.site_id ? String(r.site_id) : null,
        r.site_name ? String(r.site_name) : null,
        r.site_name_raw ? String(r.site_name_raw) : null,
        r.ss ?? null,
        r.bod ?? null,
        r.tn ?? null,
        r.tp ?? null,
        r.total_coliform ?? null,
        r.mlss ?? null,
        r.do ?? null,
        r.ph ?? null,
        r.source_pdf_name ? String(r.source_pdf_name) : null,
        r.source_page_index != null ? Number(r.source_page_index) : null,
        r.ai_confidence ?? null,
        r.site_match_confidence ?? null,
        r.manual_review_required ? 1 : 0,
        r.warnings_json ? String(r.warnings_json) : '[]',
        r.source_payload_json ? String(r.source_payload_json) : '{}',
        nowIso,
        nowIso,
        1
      );
    }
  });
  tx(Array.isArray(rows) ? rows : []);

  return { synced: true, count: Array.isArray(rows) ? rows.length : 0 };
}

async function syncRecentCertificateCacheForSite({ db, siteName, months = 2 }) {
  const now = new Date();
  let total = 0;
  const count = Math.max(1, Number(months) || 1);
  for (let i = 0; i < count; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = String(d.getFullYear());
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const result = await syncCertificateCacheForSiteMonth({ db, siteName, year: y, month: m });
    total += Number(result.count || 0);
  }
  return { synced: true, count: total };
}

module.exports = {
  syncCertificateCacheForSiteMonth,
  syncRecentCertificateCacheForSite,
};
