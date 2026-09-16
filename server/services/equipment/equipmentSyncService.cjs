/**
 * server/services/equipment/equipmentSyncService.cjs
 * 장비 테이블 4종(equipment_assets / equipment_asset_photos /
 * work_record_equipment_links / facility_log_photos / work_record_photos)의 전용 동기화(§4-4-4).
 *
 * 범용 동기화기(bigQuerySyncService)와 다른 점:
 *  - 날짜 축이 없다: is_synced = 0인 미전송 행 전체를 대상으로 한다.
 *  - 사진 바이너리는 전송하지 않는다: 원본은 Drive 미러, BigQuery에는 메타데이터만.
 *  - 식별 계약: site_id + id(링크 테이블은 work_record_id + equipment_id).
 *  - 각 테이블이 자신의 site_id / is_synced 컬럼을 소유한다(database.cjs 마이그레이션 보장).
 *  - 행 수가 현장 규모에서 수백 건 수준이므로 행 단위 MERGE로 전송한다.
 */
const { getBigQueryClient, DATASET_ID } = require('../bigQueryClientService.cjs');

const toTimestamp = (value) => {
  const raw = typeof value === 'object' && value?.value ? value.value : value;
  if (!raw) return null;
  const date = new Date(String(raw).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const TABLE_CONTRACTS = {
  equipment_assets: {
    naturalKeys: ['site_id', 'id'],
    columns: [
      { name: 'site_id', source: (row, ctx) => row.site_id || ctx.siteId },
      { name: 'site_name', source: (row, ctx) => row.site_name || ctx.siteName },
      { name: 'id', source: (row) => row.id },
      { name: 'management_no', source: (row) => row.management_no },
      { name: 'category_1', source: (row) => row.category_1 },
      { name: 'category_2', source: (row) => row.category_2 },
      { name: 'category_3', source: (row) => row.category_3 },
      { name: 'category_4', source: (row) => row.category_4 },
      { name: 'equipment_name', source: (row) => row.equipment_name },
      { name: 'model', source: (row) => row.model },
      { name: 'specification', source: (row) => row.specification },
      { name: 'unit', source: (row) => row.unit },
      { name: 'quantity', source: (row) => row.quantity, type: 'FLOAT' },
      { name: 'power', source: (row) => row.power },
      { name: 'installed_at', source: (row) => row.installed_at },
      { name: 'vendor', source: (row) => row.vendor },
      { name: 'location', source: (row) => row.location },
      { name: 'accessory', source: (row) => row.accessory },
      { name: 'status', source: (row) => row.status },
      { name: 'is_visible', source: (row) => Boolean(Number(row.is_visible === undefined ? 1 : row.is_visible)), type: 'BOOLEAN' },
      { name: 'notes', source: (row) => row.notes },
      { name: 'author', source: (row, ctx) => row.author || ctx.authorName },
      { name: 'created_at', source: (row) => toTimestamp(row.created_at), type: 'TIMESTAMP' },
      { name: 'updated_at', source: (row) => toTimestamp(row.last_modified), type: 'TIMESTAMP' },
      { name: 'uploaded_at', source: () => new Date().toISOString(), type: 'TIMESTAMP' },
    ],
  },
  equipment_asset_photos: {
    naturalKeys: ['site_id', 'id'],
    columns: [
      { name: 'site_id', source: (row, ctx) => row.site_id || ctx.siteId },
      { name: 'id', source: (row) => row.id, type: 'INTEGER' },
      { name: 'equipment_id', source: (row) => row.equipment_id },
      { name: 'photo_type', source: (row) => row.photo_type || 'main' },
      { name: 'original_name', source: (row) => row.original_name },
      { name: 'stored_name', source: (row) => row.stored_name },
      { name: 'relative_path', source: (row) => row.relative_path },
      { name: 'sort_order', source: (row) => row.sort_order || 0, type: 'INTEGER' },
      { name: 'created_at', source: (row) => toTimestamp(row.created_at), type: 'TIMESTAMP' },
      { name: 'uploaded_at', source: () => new Date().toISOString(), type: 'TIMESTAMP' },
    ],
  },
  work_record_equipment_links: {
    naturalKeys: ['site_id', 'work_record_id', 'equipment_id'],
    columns: [
      { name: 'site_id', source: (row, ctx) => row.site_id || ctx.siteId },
      { name: 'id', source: (row) => row.id, type: 'INTEGER' },
      { name: 'work_record_id', source: (row) => row.work_record_id, type: 'INTEGER' },
      { name: 'equipment_id', source: (row) => row.equipment_id },
      { name: 'created_at', source: (row) => toTimestamp(row.created_at), type: 'TIMESTAMP' },
      { name: 'uploaded_at', source: () => new Date().toISOString(), type: 'TIMESTAMP' },
    ],
  },
  facility_log_photos: {
    naturalKeys: ['site_id', 'id'],
    columns: [
      { name: 'site_id', source: (row, ctx) => row.site_id || ctx.siteId },
      { name: 'id', source: (row) => row.id, type: 'INTEGER' },
      { name: 'facility_log_id', source: (row) => row.facility_log_id, type: 'INTEGER' },
      { name: 'original_name', source: (row) => row.original_name },
      { name: 'stored_name', source: (row) => row.stored_name },
      { name: 'relative_path', source: (row) => row.relative_path },
      { name: 'sort_order', source: (row) => row.sort_order || 0, type: 'INTEGER' },
      { name: 'created_at', source: (row) => toTimestamp(row.created_at), type: 'TIMESTAMP' },
      { name: 'uploaded_at', source: () => new Date().toISOString(), type: 'TIMESTAMP' },
    ],
  },
  work_record_photos: {
    naturalKeys: ['site_id', 'id'],
    columns: [
      { name: 'site_id', source: (row, ctx) => row.site_id || ctx.siteId },
      { name: 'id', source: (row) => row.id, type: 'INTEGER' },
      { name: 'work_record_id', source: (row) => row.work_record_id, type: 'INTEGER' },
      { name: 'original_name', source: (row) => row.original_name },
      { name: 'stored_name', source: (row) => row.stored_name },
      { name: 'relative_path', source: (row) => row.relative_path },
      { name: 'created_at', source: (row) => toTimestamp(row.created_at), type: 'TIMESTAMP' },
      { name: 'uploaded_at', source: () => new Date().toISOString(), type: 'TIMESTAMP' },
    ],
  },
};

const TABLE_NAMES = Object.keys(TABLE_CONTRACTS);

function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/g, '')}\``;
}

function getSiteInfo(db) {
  try {
    const row = db.prepare('SELECT site_id, site_name, manager_name FROM app_settings WHERE id = 1').get() || {};
    return {
      siteId: String(row.site_id || '').trim(),
      siteName: row.site_name || 'Unknown Site',
      authorName: row.manager_name || 'Unknown Author',
    };
  } catch (error) {
    return { siteId: null, siteName: 'Unknown Site', authorName: 'Unknown Author' };
  }
}

async function ensureRemoteColumns(table, contract) {
  const [metadata] = await table.getMetadata();
  const existing = new Set((metadata.schema?.fields || []).map((field) => field.name));
  const missing = contract.columns
    .filter((column) => !existing.has(column.name))
    .map((column) => ({ name: column.name, type: column.type || 'STRING' }));
  if (!missing.length) return;
  await table.setMetadata({ schema: { fields: [...(metadata.schema?.fields || []), ...missing] } });
}

async function ensureRemoteTable(dataset, tableName, contract) {
  const table = dataset.table(tableName);
  const [exists] = await table.exists();
  if (!exists) {
    await dataset.createTable(tableName, {
      schema: contract.columns.map((column) => ({ name: column.name, type: column.type || 'STRING' })),
    });
  } else {
    await ensureRemoteColumns(table, contract);
  }
  return dataset.table(tableName);
}

async function mergeRow(bq, tableName, contract, row, ctx) {
  const values = {};
  const types = {};
  contract.columns.forEach((column) => {
    values[column.name] = column.source(row, ctx);
    // NULL 파라미터는 타입 추론이 불가능하므로 모든 파라미터에 타입을 선언한다.
    types[column.name] = column.type || 'STRING';
  });
  contract.naturalKeys.forEach((key) => {
    values[`nk_${key}`] = values[key];
    types[`nk_${key}`] = types[key];
  });

  const keyMatch = contract.naturalKeys
    .map((key) => `T.${quoteIdentifier(key)} = @nk_${key}`)
    .join(' AND ');
  const updateAssignments = contract.columns
    .filter((column) => !contract.naturalKeys.includes(column.name))
    .map((column) => `${quoteIdentifier(column.name)} = @${column.name}`)
    .join(', ');
  const insertColumns = contract.columns.map((column) => quoteIdentifier(column.name)).join(', ');
  const insertValues = contract.columns.map((column) => `@${column.name}`).join(', ');

  await bq.query({
    query: `
      MERGE ${quoteIdentifier(`${DATASET_ID}.${tableName}`)} T
      USING (SELECT ${contract.naturalKeys.map((key) => `@nk_${key} AS ${quoteIdentifier(key)}`).join(', ')}) S
      ON ${keyMatch}
      WHEN MATCHED THEN UPDATE SET ${updateAssignments}
      WHEN NOT MATCHED THEN INSERT (${insertColumns}) VALUES (${insertValues})
    `,
    params: values,
    types,
  });
}

function createEquipmentSyncService(db) {
  let syncInFlight = null;

  async function runSyncEquipmentData() {
    // 동기화 활성화 플래그: 범용 동기화기(bigQueryTriggerService)와 동일한 게이트를 따른다.
    if (String(process.env.BIGQUERY_SYNC_ENABLED || 'true') !== 'true') {
      return { success: false, skipped: 'BIGQUERY_SYNC_ENABLED=false', tables: {} };
    }
    const bq = getBigQueryClient();
    if (!bq) return { success: false, skipped: 'client-not-ready', tables: {} };
    const siteInfo = getSiteInfo(db);
    const tables = {};

    for (const tableName of TABLE_NAMES) {
      const contract = TABLE_CONTRACTS[tableName];
      try {
        // 서버 재시작/크래시로 is_synced=2에 잔류한 행을 전송 대기 상태로 복구한다.
        db.prepare(`UPDATE ${tableName} SET is_synced = 0 WHERE is_synced = 2`).run();
        const rows = db.prepare(`SELECT * FROM ${tableName} WHERE is_synced = 0`).all();
        if (!rows.length) {
          tables[tableName] = { success: true, count: 0 };
          continue;
        }
        db.prepare(`UPDATE ${tableName} SET is_synced = 2 WHERE is_synced = 0`).run();

        const dataset = bq.dataset(DATASET_ID);
        await ensureRemoteTable(dataset, tableName, contract);

        const succeededIds = [];
        let failures = 0;
        let firstFailure = null;
        for (const row of rows) {
          try {
            await mergeRow(bq, tableName, contract, row, siteInfo);
            succeededIds.push(row.id);
          } catch (rowError) {
            failures += 1;
            if (!firstFailure) {
              firstFailure = {
                errorName: rowError?.name || 'Error',
                errorCode: rowError?.code || null,
                message: String(rowError?.message || 'unknown error').slice(0, 500),
              };
            }
            console.warn(`[equipment-sync] ${tableName} 행 전송 실패:`, rowError.message);
          }
        }

        // 성공 행만 완료 처리하고, 실패 행은 전송 대기 상태로 되돌린다.
        const markDone = db.prepare(`UPDATE ${tableName} SET is_synced = 1 WHERE is_synced = 2 AND id = ?`);
        const markPending = db.prepare(`UPDATE ${tableName} SET is_synced = 0 WHERE is_synced = 2`);
        succeededIds.forEach((id) => markDone.run(id));
        if (failures > 0) markPending.run();

        tables[tableName] = { success: failures === 0, count: succeededIds.length, failures, firstFailure };
      } catch (error) {
        tables[tableName] = { success: false, error: error.message };
        console.warn(`[equipment-sync] ${tableName} 동기화 실패:`, error.message);
        try {
          db.prepare(`UPDATE ${tableName} SET is_synced = 0 WHERE is_synced = 2`).run();
        } catch (_) { /* 무시: 다음 주기에 재전송 */ }
      }
    }

    const allOk = Object.values(tables).every((item) => item.success);
    return { success: allOk, tables };
  }

  function syncEquipmentData() {
    if (syncInFlight) return syncInFlight;
    syncInFlight = runSyncEquipmentData().finally(() => { syncInFlight = null; });
    return syncInFlight;
  }

  return { syncEquipmentData };
}

module.exports = createEquipmentSyncService;
