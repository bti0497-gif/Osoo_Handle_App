const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { db, appDataPath } = require('../database.cjs');
const { getBigQueryClient, DATASET_ID } = require('./bigQueryClientService.cjs');
const { recordDiagnostic } = require('./diagnosticLogService.cjs');

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
  // TODO(site-id): 차기 다중현장 전환 시 activeSiteId 컨텍스트를 받아
  // row.site_id가 비어있는 legacy 데이터도 site 단위로 강제 분리 전송한다.
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
    input_status: row.input_status || 'manual',
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
    input_status: row.input_status || 'manual',
    photo_url: row.photo_url || null,
    updated_at: row.last_modified,
    uploaded_at: new Date().toISOString()
  }),
  qntech_water_quality: (row, siteName, authorName, siteId) => ({
    site_id: siteId,
    site_name: siteName,
    author: authorName,
    local_id: row.id,
    created_at: row.created_at,
    date: row.date,
    measurement_group: row.measurement_group,
    measurement_order: row.measurement_order,
    source_type: row.source_type,
    input_status: row.input_status || 'manual',
    source_label: row.source_label,
    qntech_project_id: row.qntech_project_id,
    location: row.location,
    item_name: row.item_name,
    item_code: row.item_code,
    result_value: row.result_value,
    result_numeric: row.result_numeric,
    unit: row.unit,
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
    input_status: row.input_status || 'manual',
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

const TABLE_NATURAL_KEYS = {
  flow_readings: ['site_id', 'date', 'type'],
  medicine_logs: ['site_id', 'date', 'medicine_name'],
  qntech_water_quality: ['site_id', 'date', 'measurement_group', 'location', 'item_code'],
  kit_logs: ['site_id', 'date', 'kit_name'],
  facility_logs: ['site_id', 'date', 'location', 'facility_name'],
};

const BIGQUERY_FIELD_TYPES = {
  site_id: 'STRING',
  site_name: 'STRING',
  author: 'STRING',
  local_id: 'INTEGER',
  created_at: 'TIMESTAMP',
  date: 'DATE',
  type: 'STRING',
  raw_value: 'FLOAT',
  calculated_flow: 'FLOAT',
  is_reset: 'BOOLEAN',
  is_manual: 'BOOLEAN',
  input_status: 'STRING',
  sludge_export: 'FLOAT',
  updated_at: 'TIMESTAMP',
  uploaded_at: 'TIMESTAMP',
  medicine_name: 'STRING',
  purchase_amount: 'FLOAT',
  usage_amount: 'FLOAT',
  current_inventory: 'FLOAT',
  photo_url: 'STRING',
  measurement_group: 'STRING',
  measurement_order: 'INTEGER',
  source_type: 'STRING',
  source_label: 'STRING',
  qntech_project_id: 'STRING',
  location: 'STRING',
  item_name: 'STRING',
  item_code: 'STRING',
  result_value: 'STRING',
  result_numeric: 'FLOAT',
  unit: 'STRING',
  kit_name: 'STRING',
  facility_name: 'STRING',
  content: 'STRING',
  company: 'STRING',
  price: 'INTEGER',
  notes: 'STRING',
};

function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/g, '')}\``;
}

async function ensureTargetTableColumns(table, rows) {
  if (!rows.length) return;
  const [metadata] = await table.getMetadata();
  const schemaFields = metadata.schema?.fields || [];
  const existing = new Set(schemaFields.map((field) => field.name));
  const missing = Object.keys(rows[0])
    .filter((name) => !existing.has(name))
    .map((name) => ({ name, type: BIGQUERY_FIELD_TYPES[name] || 'STRING' }));
  if (missing.length === 0) return;
  await table.setMetadata({
    schema: {
      fields: [...schemaFields, ...missing],
    },
  });
}

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

  const dataset = bq.dataset(DATASET_ID);
  const targetTable = dataset.table(tableName);
  const stagingTableName = `_sync_stage_${tableName}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const stagingTable = dataset.table(stagingTableName);

  try {
    // 5-4. BigQuery 전송 (Load Job - 로컬 파일 업로드)
    await ensureTargetTableColumns(targetTable, bqRows);
    const [targetMetadata] = await targetTable.getMetadata();
    await stagingTable.create({ schema: targetMetadata.schema });

    const [job] = await stagingTable.load(
      tmpFile,
      { sourceFormat: 'NEWLINE_DELIMITED_JSON', writeDisposition: 'WRITE_TRUNCATE' }
    );

    // 임시 파일 삭제
    try { fs.unlinkSync(tmpFile); } catch (_) {}

    // job 오류 확인 (job은 완료된 job metadata 객체)
    const jobError = job && job.status && job.status.errorResult;
    if (jobError) {
      throw new Error(jobError.message || JSON.stringify(jobError));
    }

    const columns = Object.keys(bqRows[0]);
    const columnList = columns.map(quoteIdentifier).join(', ');
    const naturalKeys = TABLE_NATURAL_KEYS[tableName] || ['local_id'];
    const matchSql = naturalKeys
      .map((key) => `T.${quoteIdentifier(key)} = S.${quoteIdentifier(key)}`)
      .join(' AND ');

    await bq.query({
      query: `
        BEGIN TRANSACTION;
        DELETE FROM \`${DATASET_ID}.${tableName}\` T
        WHERE EXISTS (
          SELECT 1
          FROM \`${DATASET_ID}.${stagingTableName}\` S
          WHERE ${matchSql}
        );
        INSERT INTO \`${DATASET_ID}.${tableName}\` (${columnList})
        SELECT ${columnList}
        FROM \`${DATASET_ID}.${stagingTableName}\`;
        COMMIT TRANSACTION;
      `,
    });

    // 5-5. 로컬 상태 '완료' (is_synced = 1)로 업데이트
    // 전송 도중 같은 행이 다시 저장되면 라우트가 is_synced를 0으로 되돌린다.
    // 이때 이전 전송 작업이 최신 변경까지 완료 처리하지 않도록,
    // 여전히 '전송 중(2)'인 행만 완료 상태로 변경한다.
    const updateStmt = db.prepare(`
      UPDATE ${tableName}
      SET is_synced = 1
      WHERE id = ? AND is_synced = 2
    `);
    db.transaction(() => {
      for (const id of rowIds) updateStmt.run(id);
    })();

    try { await stagingTable.delete({ ignoreNotFound: true }); } catch (_) {}
    console.log(`[BigQuery] ${tableName}: ${rows.length} rows synced.`);
    recordDiagnostic(db, appDataPath, {
      level: 'info',
      area: 'bigquery',
      action: `sync:${tableName}`,
      result: 'ok',
      message: `${tableName} ${rows.length} rows synced`,
      details: { tableName, count: rows.length },
    });
    return { success: true, count: rows.length };

  } catch (err) {
    // 임시 파일 삭제
    try { fs.unlinkSync(tmpFile); } catch (_) {}
    try { await stagingTable.delete({ ignoreNotFound: true }); } catch (_) {}

    // 5-6. 실패 시 로컬 상태 '대기' (is_synced = 0)로 롤백
    const rollbackStmt = db.prepare(`UPDATE ${tableName} SET is_synced = 0 WHERE id = ?`);
    db.transaction(() => {
      for (const id of rowIds) rollbackStmt.run(id);
    })();

    let errorMsg = err.message;
    if (err.errors) errorMsg = JSON.stringify(err.errors);
    console.error(`[BigQuery] ${tableName} sync failed, rolling back local state:`, errorMsg);
    recordDiagnostic(db, appDataPath, {
      level: 'error',
      area: 'bigquery',
      action: `sync:${tableName}`,
      result: 'failed',
      message: errorMsg,
      details: { tableName, rowCount: rows.length, error: err },
    });
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
