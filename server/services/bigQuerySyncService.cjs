const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { db } = require('../database.cjs');
const { getBigQueryClient, DATASET_ID } = require('./bigQueryClientService.cjs');

// 3. ?꾩옣 ?뺣낫(?꾩옣紐? 愿由ъ옄紐? 媛?몄삤湲?
function getSiteInfo() {
  try {
    const row = db.prepare('SELECT site_name, manager_name, site_id FROM app_settings WHERE id = 1').get();
    return {
      siteName: row ? row.site_name : 'Unknown Site',
      authorName: row ? row.manager_name : 'Unknown Author',
      siteId: row ? row.site_id : null,
    };
  } catch (e) {
    console.error('[BigQuery] Failed to get site info:', e.message);
    return {
      siteName: 'Unknown Site',
      authorName: 'Unknown Author',
      siteId: null,
    };
  }
}

function getRowSiteInfo(row, defaults) {
  // TODO(site-id): 李④린 ?ㅼ쨷?꾩옣 ?꾪솚 ??activeSiteId 而⑦뀓?ㅽ듃瑜?諛쏆븘
  // row.site_id媛 鍮꾩뼱?덈뒗 legacy ?곗씠?곕룄 site ?⑥쐞濡?媛뺤젣 遺꾨━ ?꾩넚?쒕떎.
  return {
    siteName: row.site_name || defaults.siteName,
    authorName: row.author || defaults.authorName,
    siteId: row.site_id || defaults.siteId,
  };
}

function buildInsertId(tableName, row, defaults) {
  const { siteName } = getRowSiteInfo(row, defaults);
  const basis = [
    tableName,
    siteName,
    row.id,
    row.last_modified || row.created_at || 'unknown'
  ].join('|');

  return crypto.createHash('sha1').update(basis).digest('hex');
}

function parseJsonObject(text) {
  if (!text) return {};
  try {
    const parsed = JSON.parse(String(text));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function extractCertificateFileMeta(row) {
  const payload = parseJsonObject(row.source_payload_json);
  const fileMeta = payload && typeof payload.certificate_file === 'object'
    ? payload.certificate_file
    : {};
  return {
    certificate_category: fileMeta.category || null,
    certificate_file_name: fileMeta.file_name || null,
    certificate_original_file_name: fileMeta.original_file_name || null,
    drive_file_id: fileMeta.drive_file_id || null,
    drive_web_view_link: fileMeta.drive_web_view_link || null,
  };
}

// 4. ?뚯씠釉붾퀎 留ㅽ븨 ?뺤쓽 (Local DB Row -> BigQuery Row)
const TABLE_MAPPINGS = {
  flow_readings: (row, siteName, authorName, siteId) => ({
    site_id: siteId,
    site_name: siteName,
    author: authorName,
    local_id: row.id,
    created_at: row.created_at,
    date: row.date,
    type: row.type,
    raw_value: row.raw_value,
    calculated_flow: row.calculated_flow,
    is_reset: Boolean(row.is_reset),
    is_manual: Boolean(row.is_manual),
    sludge_export: row.sludge_export,
    updated_at: row.last_modified,
    uploaded_at: new Date().toISOString()
  }),
  medicine_logs: (row, siteName, authorName, siteId) => ({
    site_id: siteId,
    site_name: siteName,
    author: authorName,
    local_id: row.id,
    created_at: row.created_at,
    medicine_name: row.medicine_name,
    date: row.date,
    purchase_amount: row.purchase_amount,
    usage_amount: row.usage_amount,
    current_inventory: row.current_inventory,
    photo_url: row.photo_url || null,
    updated_at: row.last_modified,
    uploaded_at: new Date().toISOString()
  }),
  water_quality: (row, siteName, authorName, siteId) => ({
    site_id: siteId,
    site_name: siteName,
    author: authorName,
    local_id: row.id,
    created_at: row.created_at,
    date: row.date,
    measurement_group: row.measurement_group,
    measurement_order: row.measurement_order,
    source_type: row.source_type,
    source_label: row.source_label,
    qntech_project_id: row.qntech_project_id,
    location: row.location,
    nh3_n: row.nh3_n,
    no3_n: row.no3_n,
    po4_p: row.po4_p,
    alkalinity: row.alkalinity,
    tn: row.tn,
    tp: row.tp,
    cod: row.cod,
    ss: row.ss,
    updated_at: row.last_modified,
    uploaded_at: new Date().toISOString()
  }),
  kit_logs: (row, siteName, authorName, siteId) => ({
    site_id: siteId,
    site_name: siteName,
    author: authorName,
    local_id: row.id,
    created_at: row.created_at,
    kit_name: row.kit_name,
    date: row.date,
    purchase_amount: row.purchase_amount,
    usage_amount: row.usage_amount,
    current_inventory: row.current_inventory,
    photo_url: row.photo_url || null,
    updated_at: row.last_modified,
    uploaded_at: new Date().toISOString()
  }),
  facility_logs: (row, siteName, authorName, siteId) => ({
    site_id: siteId,
    site_name: siteName,
    author: authorName,
    local_id: row.id,
    created_at: row.created_at,
    date: row.date,
    location: row.location,
    facility_name: row.facility_name,
    content: row.content,
    company: row.company,
    price: row.price,
    notes: row.notes,
    updated_at: row.last_modified,
    uploaded_at: new Date().toISOString()
  }),
  certificate_water_quality: (row, siteName, _authorName, siteId) => ({
    ...extractCertificateFileMeta(row),
    site_id: row.site_id || siteId,
    site_name: row.site_name || siteName,
    site_name_raw: row.site_name_raw || null,
    local_id: row.id,
    report_date: row.report_date,
    ss: row.ss,
    bod: row.bod,
    tn: row.tn,
    tp: row.tp,
    total_coliform: row.total_coliform,
    mlss: row.mlss,
    do: row.do,
    ph: row.ph,
    source_pdf_name: row.source_pdf_name || null,
    source_page_index: row.source_page_index ?? null,
    ai_confidence: row.ai_confidence ?? null,
    site_match_confidence: row.site_match_confidence ?? null,
    manual_review_required: Boolean(row.manual_review_required),
    warnings_json: row.warnings_json || null,
    source_payload_json: row.source_payload_json || null,
    created_at: row.created_at,
    updated_at: row.last_modified,
    uploaded_at: new Date().toISOString()
  })
};

// 5. ?⑥씪 ?뚯씠釉??숆린???⑥닔
async function syncTable(tableName) {
  const bq = getBigQueryClient();
  if (!bq) return { success: false, message: 'BigQuery client not ready' };

  const mapper = TABLE_MAPPINGS[tableName];
  if (!mapper) {
    console.warn(`[BigQuery] No mapping for table: ${tableName}`);
    return { success: false, count: 0 };
  }

  // 5-1. ?숆린??'吏꾪뻾 以? (is_synced = 2)?쇰줈 ?곹깭 蹂寃?
  const markAsSyncing = db.prepare(`UPDATE ${tableName} SET is_synced = 2 WHERE is_synced = 0`);
  const changes = markAsSyncing.run();
  if (changes.changes === 0) {
    return { success: true, count: 0 };
  }
  
  // 5-2. '吏꾪뻾 以? ?곹깭???곗씠??議고쉶
  const rows = db.prepare(`SELECT * FROM ${tableName} WHERE is_synced = 2`).all();
  if (rows.length === 0) return { success: true, count: 0 };

  const { siteName, authorName, siteId } = getSiteInfo();
  
  // 5-3. ?곗씠??蹂??
  const bqRows = rows.map(row => {
    const rowSiteInfo = getRowSiteInfo(row, { siteName, authorName, siteId });
    return mapper(row, rowSiteInfo.siteName, rowSiteInfo.authorName, rowSiteInfo.siteId);
  });
  const rowIds = rows.map(r => r.id);

  // NDJSON ?꾩떆 ?뚯씪 ?앹꽦
  const tmpFile = path.join(os.tmpdir(), `bq_sync_${tableName}_${Date.now()}.ndjson`);
  try {
    fs.writeFileSync(tmpFile, bqRows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  } catch (writeErr) {
    console.error(`[BigQuery] ${tableName} ?꾩떆 ?뚯씪 ?곌린 ?ㅽ뙣:`, writeErr.message);
    const rollbackStmt = db.prepare(`UPDATE ${tableName} SET is_synced = 0 WHERE id = ?`);
    db.transaction(() => { for (const id of rowIds) rollbackStmt.run(id); })();
    return { success: false, error: writeErr.message };
  }

  try {
    // 5-4. BigQuery ?꾩넚 (Load Job - 濡쒖뺄 ?뚯씪 ?낅줈??
    const [job] = await bq.dataset(DATASET_ID).table(tableName).load(
      tmpFile,
      { sourceFormat: 'NEWLINE_DELIMITED_JSON', writeDisposition: 'WRITE_APPEND' }
    );

    // ?꾩떆 ?뚯씪 ??젣
    try { fs.unlinkSync(tmpFile); } catch (_) {}

    // job ?ㅻ쪟 ?뺤씤 (job? ?꾨즺??job metadata 媛앹껜)
    const jobError = job && job.status && job.status.errorResult;
    if (jobError) {
      throw new Error(jobError.message || JSON.stringify(jobError));
    }

    // 5-5. 濡쒖뺄 ?곹깭 '?꾨즺' (is_synced = 1)濡??낅뜲?댄듃
    const updateStmt = db.prepare(`UPDATE ${tableName} SET is_synced = 1 WHERE id = ?`);
    db.transaction(() => {
      for (const id of rowIds) updateStmt.run(id);
    })();

    console.log(`[BigQuery] ${tableName}: ${rows.length} rows synced.`);
    return { success: true, count: rows.length };

  } catch (err) {
    // ?꾩떆 ?뚯씪 ?뺣━
    try { fs.unlinkSync(tmpFile); } catch (_) {}

    // 5-6. ?ㅽ뙣 ??濡쒖뺄 ?곹깭 '?湲? (is_synced = 0)濡?濡ㅻ갚
    const rollbackStmt = db.prepare(`UPDATE ${tableName} SET is_synced = 0 WHERE id = ?`);
    db.transaction(() => {
      for (const id of rowIds) rollbackStmt.run(id);
    })();

    let errorMsg = err.message;
    if (err.errors) errorMsg = JSON.stringify(err.errors);
    console.error(`[BigQuery] ${tableName} sync failed, rolling back local state:`, errorMsg);
    return { success: false, error: errorMsg };
  }
}

// 6. ?꾩껜 ?뚯씠釉??숆린???⑥닔 (?ㅼ?以꾨윭?먯꽌 ?몄텧)
async function syncAll() {
  const results = {};
  for (const tableName of Object.keys(TABLE_MAPPINGS)) {
    // ?쒕쾭 ?쒖옉 ??'吏꾪뻾 以? ?곹깭(is_synced=2)濡??⑥븘?덈뒗 ?덉퐫?쒓? ?덈떎硫?
    // ?댁쟾 ?숆린?붽? 鍮꾩젙??醫낅즺??寃껋씠誘濡? ?ㅼ떆 '?湲? ?곹깭(is_synced=0)濡??섎룎???ъ떆???좊룄
    db.prepare(`UPDATE ${tableName} SET is_synced = 0 WHERE is_synced = 2`).run();
    results[tableName] = await syncTable(tableName);
  }
  return results;
}

module.exports = {
  syncTable,
  syncAll
};