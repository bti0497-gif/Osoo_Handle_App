const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { db } = require('../database.cjs');
const { getBigQueryClient, DATASET_ID } = require('./bigQueryClientService.cjs');

// 3. 현장 정보(현장명, 관리자명) 가져오기
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

// 4. 테이블별 매핑 정의 (Local DB Row -> BigQuery Row)
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
  })
};

// 5. 단일 테이블 동기화 함수
async function syncTable(tableName) {
  const bq = getBigQueryClient();
  if (!bq) return { success: false, message: 'BigQuery client not ready' };

  const mapper = TABLE_MAPPINGS[tableName];
  if (!mapper) {
    console.warn(`[BigQuery] No mapping for table: ${tableName}`);
    return { success: false, count: 0 };
  }

  // 5-1. 동기화 '진행 중' (is_synced = 2)으로 상태 변경
  const markAsSyncing = db.prepare(`UPDATE ${tableName} SET is_synced = 2 WHERE is_synced = 0`);
  const changes = markAsSyncing.run();
  if (changes.changes === 0) {
    return { success: true, count: 0 };
  }
  
  // 5-2. '진행 중' 상태의 데이터 조회
  const rows = db.prepare(`SELECT * FROM ${tableName} WHERE is_synced = 2`).all();
  if (rows.length === 0) return { success: true, count: 0 };

  const { siteName, authorName, siteId } = getSiteInfo();
  
  // 5-3. 데이터 변환
  const bqRows = rows.map(row => {
    const rowSiteInfo = getRowSiteInfo(row, { siteName, authorName, siteId });
    return mapper(row, rowSiteInfo.siteName, rowSiteInfo.authorName, rowSiteInfo.siteId);
  });
  const rowIds = rows.map(r => r.id);

  // NDJSON 임시 파일 생성
  const tmpFile = path.join(os.tmpdir(), `bq_sync_${tableName}_${Date.now()}.ndjson`);
  try {
    fs.writeFileSync(tmpFile, bqRows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  } catch (writeErr) {
    console.error(`[BigQuery] ${tableName} 임시 파일 쓰기 실패:`, writeErr.message);
    const rollbackStmt = db.prepare(`UPDATE ${tableName} SET is_synced = 0 WHERE id = ?`);
    db.transaction(() => { for (const id of rowIds) rollbackStmt.run(id); })();
    return { success: false, error: writeErr.message };
  }

  try {
    // 5-4. BigQuery 전송 (Load Job - 로컬 파일 업로드)
    const [job] = await bq.dataset(DATASET_ID).table(tableName).load(
      tmpFile,
      { sourceFormat: 'NEWLINE_DELIMITED_JSON', writeDisposition: 'WRITE_APPEND' }
    );

    // 임시 파일 삭제
    try { fs.unlinkSync(tmpFile); } catch (_) {}

    // job 오류 확인 (job은 완료된 job metadata 객체)
    const jobError = job && job.status && job.status.errorResult;
    if (jobError) {
      throw new Error(jobError.message || JSON.stringify(jobError));
    }

    // 5-5. 로컬 상태 '완료' (is_synced = 1)로 업데이트
    const updateStmt = db.prepare(`UPDATE ${tableName} SET is_synced = 1 WHERE id = ?`);
    db.transaction(() => {
      for (const id of rowIds) updateStmt.run(id);
    })();

    console.log(`[BigQuery] ${tableName}: ${rows.length} rows synced.`);
    return { success: true, count: rows.length };

  } catch (err) {
    // 임시 파일 정리
    try { fs.unlinkSync(tmpFile); } catch (_) {}

    // 5-6. 실패 시 로컬 상태 '대기' (is_synced = 0)로 롤백
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

// 6. 전체 테이블 동기화 함수 (스케줄러에서 호출)
async function syncAll() {
  const results = {};
  for (const tableName of Object.keys(TABLE_MAPPINGS)) {
    // 서버 시작 시 '진행 중' 상태(is_synced=2)로 남아있는 레코드가 있다면
    // 이전 동기화가 비정상 종료된 것이므로, 다시 '대기' 상태(is_synced=0)로 되돌려 재시도 유도
    db.prepare(`UPDATE ${tableName} SET is_synced = 0 WHERE is_synced = 2`).run();
    results[tableName] = await syncTable(tableName);
  }
  return results;
}

module.exports = {
  syncTable,
  syncAll
};