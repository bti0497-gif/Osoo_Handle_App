const crypto = require('crypto');
const { db } = require('../database.cjs');
const { getBigQueryClient, DATASET_ID } = require('./bigQueryClientService.cjs');

// 3. 현장 정보(현장명, 관리자명) 가져오기
function getSiteInfo() {
  try {
    const row = db.prepare('SELECT site_name, manager_name FROM app_settings WHERE id = 1').get();
    return {
      siteName: row ? row.site_name : 'Unknown Site',
      authorName: row ? row.manager_name : 'Unknown Author'
    };
  } catch (e) {
    console.error('[BigQuery] Failed to get site info:', e.message);
    return {
      siteName: 'Unknown Site',
      authorName: 'Unknown Author'
    };
  }
}

function getRowSiteInfo(row, defaults) {
  return {
    siteName: row.site_name || defaults.siteName,
    authorName: row.author || defaults.authorName
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
  flow_readings: (row, siteName, authorName) => ({
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
  medicine_logs: (row, siteName, authorName) => ({
    site_name: siteName,
    author: authorName,
    local_id: row.id,
    created_at: row.created_at,
    medicine_name: row.medicine_name,
    date: row.date,
    purchase_amount: row.purchase_amount,
    usage_amount: row.usage_amount,
    current_inventory: row.current_inventory,
    updated_at: row.last_modified,
    uploaded_at: new Date().toISOString()
  }),
  water_quality: (row, siteName, authorName) => ({
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
  kit_logs: (row, siteName, authorName) => ({
    site_name: siteName,
    author: authorName,
    local_id: row.id,
    created_at: row.created_at,
    kit_name: row.kit_name,
    date: row.date,
    purchase_amount: row.purchase_amount,
    usage_amount: row.usage_amount,
    current_inventory: row.current_inventory,
    updated_at: row.last_modified,
    uploaded_at: new Date().toISOString()
  }),
  facility_logs: (row, siteName, authorName) => ({
    site_name: siteName,
    author: authorName,
    local_id: row.id,
    created_at: row.created_at,
    date: row.date,
    location: row.location,
    facility_name: row.facility_name,
    content: row.content,
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

  const { siteName, authorName } = getSiteInfo();
  
  // 5-3. 데이터 변환
  const bqRows = rows.map(row => {
    const rowSiteInfo = getRowSiteInfo(row, { siteName, authorName });

    return {
      insertId: buildInsertId(tableName, row, { siteName, authorName }),
      json: mapper(row, rowSiteInfo.siteName, rowSiteInfo.authorName)
    };
  });
  const rowIds = rows.map(r => r.id);

  try {
    // 5-4. BigQuery 전송 (insertAll)
    await bq.dataset(DATASET_ID).table(tableName).insert(bqRows);

    // 5-5. 로컬 상태 '완료' (is_synced = 1)로 업데이트
    const updateStmt = db.prepare(`UPDATE ${tableName} SET is_synced = 1 WHERE id = ?`);
    db.transaction(() => {
      for (const id of rowIds) updateStmt.run(id);
    })();

    console.log(`[BigQuery] ${tableName}: ${rows.length} rows synced.`);
    return { success: true, count: rows.length };

  } catch (err) {
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