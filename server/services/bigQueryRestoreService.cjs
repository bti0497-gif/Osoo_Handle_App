/**
 * Disaster-recovery service only.
 *
 * Normal field workflows are local-DB-first and must never call this service.
 * Keep it dormant until an admin-only restore command is added under Settings.
 */
const { getBigQueryClient, DATASET_ID } = require('./bigQueryClientService.cjs');

function getDefaultScope(db) {
  const row = db.prepare('SELECT site_id, site_name FROM app_settings WHERE id = 1').get() || {};
  return {
    siteId: String(row.site_id || '').trim(),
    siteName: String(row.site_name || '').trim(),
  };
}

function buildSiteFilter(scope, params) {
  if (scope.siteId) {
    params.siteId = scope.siteId;
    return ' AND site_id = @siteId';
  }
  if (scope.siteName) {
    params.siteName = scope.siteName;
    return ' AND site_name = @siteName';
  }
  return '';
}

async function queryRows(tableName, startDate, endDate, scope) {
  const bq = getBigQueryClient();
  if (!bq) return [];

  const params = { startDate, endDate };
  const siteFilter = buildSiteFilter(scope, params);
  const [rows] = await bq.query({
    query: `
      SELECT *
      FROM \`${DATASET_ID}.${tableName}\`
      WHERE date BETWEEN @startDate AND @endDate
      ${siteFilter}
      ORDER BY uploaded_at ASC
    `,
    params,
  });
  return rows || [];
}

async function querySiteRows(tableName, scope) {
  const bq = getBigQueryClient();
  if (!bq) return [];
  const params = {};
  const siteFilter = buildSiteFilter(scope, params).replace(/^\s+AND\s+/, ' WHERE ');
  const [rows] = await bq.query({
    query: `SELECT * FROM \`${DATASET_ID}.${tableName}\`${siteFilter} ORDER BY uploaded_at ASC`,
    params,
  });
  return rows || [];
}

async function inspectOperationalData(db, { startDate, endDate, tables = [], siteId = '', siteName = '' } = {}) {
  const normalizedStart = String(startDate || '').slice(0, 10);
  const normalizedEnd = String(endDate || startDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedStart) || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedEnd)) {
    return { success: false, skipped: true, reason: 'invalid-date' };
  }
  const defaults = getDefaultScope(db);
  const scope = {
    siteId: String(siteId || defaults.siteId || '').trim(),
    siteName: String(siteName || defaults.siteName || '').trim(),
  };
  if (!scope.siteId) throw new Error('현재 현장의 site_id가 없어 BigQuery 자료를 조회할 수 없습니다.');

  const targetTables = tables.length
    ? tables
    : ['flow_readings', 'medicine_logs', 'kit_logs', 'qntech_water_quality', 'operation_status_logs'];
  const result = {};
  for (const tableName of targetTables) {
    try {
      const rows = await queryRows(tableName, normalizedStart, normalizedEnd, scope);
      result[tableName] = { success: true, count: rows.length };
    } catch (error) {
      result[tableName] = { success: false, count: 0, error: error.message };
    }
  }
  return { success: true, startDate: normalizedStart, endDate: normalizedEnd, ...scope, result };
}

function restoreFlowRows(db, rows) {
  const stmt = db.prepare(`
    INSERT INTO flow_readings (
      date, type, raw_value, calculated_flow, reading_unit, is_reset, is_manual, sludge_export,
      input_status, site_id, site_name, author, created_at, last_modified, is_synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(site_id, date, type) DO UPDATE SET
      raw_value = excluded.raw_value,
      calculated_flow = excluded.calculated_flow,
      reading_unit = excluded.reading_unit,
      is_reset = excluded.is_reset,
      is_manual = excluded.is_manual,
      sludge_export = excluded.sludge_export,
      input_status = excluded.input_status,
      site_id = excluded.site_id,
      site_name = excluded.site_name,
      author = excluded.author,
      last_modified = excluded.last_modified,
      is_synced = 1
    WHERE flow_readings.is_synced = 1
  `);
  db.transaction(() => {
    rows.forEach((row) => {
      stmt.run(
        row.date?.value || row.date,
        row.type,
        row.raw_value ?? null,
        row.calculated_flow ?? null,
        row.reading_unit || null,
        row.is_reset ? 1 : 0,
        row.is_manual ? 1 : 0,
        row.sludge_export ?? null,
        row.input_status || 'manual',
        row.site_id || null,
        row.site_name || null,
        row.author || null,
        row.created_at?.value || row.created_at || new Date().toISOString(),
        row.updated_at?.value || row.updated_at || new Date().toISOString()
      );
    });
  })();
}

function restoreMedicineRows(db, tableName, nameColumn, rows) {
  const localTable = tableName === 'medicine_logs' ? 'medicine_logs' : 'kit_logs';
  const localNameColumn = tableName === 'medicine_logs' ? 'medicine_name' : 'kit_name';
  const stmt = db.prepare(`
    INSERT INTO ${localTable} (
      ${localNameColumn}, date, purchase_amount, usage_amount, current_inventory, photo_url,
      input_status, site_id, site_name, author, created_at, last_modified, is_synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(site_id, ${localNameColumn}, date) DO UPDATE SET
      purchase_amount = excluded.purchase_amount,
      usage_amount = excluded.usage_amount,
      current_inventory = excluded.current_inventory,
      photo_url = COALESCE(excluded.photo_url, ${localTable}.photo_url),
      input_status = excluded.input_status,
      site_id = excluded.site_id,
      site_name = excluded.site_name,
      author = excluded.author,
      last_modified = excluded.last_modified,
      is_synced = 1
    WHERE ${localTable}.is_synced = 1
  `);
  db.transaction(() => {
    rows.forEach((row) => {
      stmt.run(
        row[nameColumn],
        row.date?.value || row.date,
        row.purchase_amount ?? null,
        row.usage_amount ?? null,
        row.current_inventory ?? null,
        row.photo_url || null,
        row.input_status || 'manual',
        row.site_id || null,
        row.site_name || null,
        row.author || null,
        row.created_at?.value || row.created_at || new Date().toISOString(),
        row.updated_at?.value || row.updated_at || new Date().toISOString()
      );
    });
  })();
}

function restoreQntechWaterRows(db, rows) {
  const stmt = db.prepare(`
    INSERT INTO qntech_water_quality (
      date, measurement_group, measurement_order, source_type, source_label, qntech_project_id,
      location, item_name, item_code, result_value, result_numeric, unit,
      input_status, site_id, site_name, author, created_at, last_modified, is_synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(site_id, date, measurement_group, location, item_code) DO UPDATE SET
      measurement_order = excluded.measurement_order,
      source_type = excluded.source_type,
      input_status = excluded.input_status,
      source_label = excluded.source_label,
      qntech_project_id = excluded.qntech_project_id,
      item_name = excluded.item_name,
      result_value = excluded.result_value,
      result_numeric = excluded.result_numeric,
      unit = excluded.unit,
      site_id = excluded.site_id,
      site_name = excluded.site_name,
      author = excluded.author,
      last_modified = excluded.last_modified,
      is_synced = 1
    WHERE qntech_water_quality.is_synced = 1
  `);
  db.transaction(() => {
    rows.forEach((row) => {
      stmt.run(
        row.date?.value || row.date,
        row.measurement_group || '',
        row.measurement_order || 1,
        row.source_type || 'manual',
        row.source_label || null,
        row.qntech_project_id || null,
        row.location || '',
        row.item_name || row.item_code || '',
        row.item_code || '',
        row.result_value ?? null,
        row.result_numeric ?? null,
        row.unit || null,
        row.input_status || 'manual',
        row.site_id || null,
        row.site_name || null,
        row.author || null,
        row.created_at?.value || row.created_at || new Date().toISOString(),
        row.updated_at?.value || row.updated_at || new Date().toISOString()
      );
    });
  })();
}

function restoreOperationStatusRows(db, rows) {
  const stmt = db.prepare(`
    INSERT INTO operation_status_logs (
      date, site_id, site_name, ph, do_value, svi, author,
      created_at, last_modified, is_synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(date, site_id) DO UPDATE SET
      site_name = excluded.site_name,
      ph = excluded.ph,
      do_value = excluded.do_value,
      svi = excluded.svi,
      author = excluded.author,
      last_modified = excluded.last_modified,
      is_synced = 1
    WHERE operation_status_logs.is_synced = 1
  `);
  db.transaction(() => {
    rows.forEach((row) => {
      stmt.run(
        row.date?.value || row.date,
        row.site_id || null,
        row.site_name || null,
        row.ph ?? null,
        row.do_value ?? null,
        row.svi ?? null,
        row.author || null,
        row.created_at?.value || row.created_at || new Date().toISOString(),
        row.updated_at?.value || row.updated_at || new Date().toISOString()
      );
    });
  })();
}

async function restoreOperationalData(db, { startDate, endDate, tables = [], siteId = '', siteName = '' } = {}) {
  const normalizedStart = String(startDate || '').slice(0, 10);
  const normalizedEnd = String(endDate || startDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedStart) || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedEnd)) {
    return { success: false, skipped: true, reason: 'invalid-date' };
  }

  const defaults = getDefaultScope(db);
  const scope = {
    siteId: String(siteId || defaults.siteId || '').trim(),
    siteName: String(siteName || defaults.siteName || '').trim(),
  };

  const targetTables = tables.length ? tables : ['flow_readings', 'medicine_logs', 'kit_logs', 'qntech_water_quality', 'operation_status_logs'];
  const result = {};

  for (const tableName of targetTables) {
    try {
      const queriedRows = await queryRows(tableName, normalizedStart, normalizedEnd, scope);
      const rows = queriedRows.map((row) => ({
        ...row,
        site_id: String(row.site_id || scope.siteId || '').trim(),
        site_name: String(row.site_name || scope.siteName || '').trim(),
      }));
      if (tableName === 'flow_readings') restoreFlowRows(db, rows);
      if (tableName === 'medicine_logs') restoreMedicineRows(db, tableName, 'medicine_name', rows);
      if (tableName === 'kit_logs') restoreMedicineRows(db, tableName, 'kit_name', rows);
      if (tableName === 'qntech_water_quality') restoreQntechWaterRows(db, rows);
      if (tableName === 'operation_status_logs') restoreOperationStatusRows(db, rows);
      result[tableName] = { success: true, count: rows.length };
    } catch (err) {
      result[tableName] = { success: false, error: err.message };
      console.warn(`[BigQuery Restore] ${tableName} 복구 실패:`, err.message);
    }
  }

  return { success: true, startDate: normalizedStart, endDate: normalizedEnd, result };
}

// --- 장비 마스터 복구 (§4-4-4): 날짜 무관, id 기준 upsert. 사진 파일은 로컬/Drive 원본 우선. ---
function valueOr(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object' && value.value !== undefined) return value.value;
  return value;
}

async function restoreEquipmentMaster(db, { siteId = '', siteName = '' } = {}) {
  const defaults = getDefaultScope(db);
  const scope = {
    siteId: String(siteId || defaults.siteId || '').trim(),
    siteName: String(siteName || defaults.siteName || '').trim(),
  };
  if (!scope.siteId) throw new Error('현재 현장의 site_id가 없어 장비 마스터를 복구할 수 없습니다.');
  const counts = {};

  const upsertAsset = db.prepare(`
    INSERT INTO equipment_assets (
      id, site_id, site_name, management_no, category_1, category_2, category_3, category_4,
      equipment_name, model, specification, unit, quantity, power, installed_at, vendor,
      location, accessory, status, is_visible, notes, author, created_at, last_modified, is_synced
    ) VALUES (
      @id, @site_id, @site_name, @management_no, @category_1, @category_2, @category_3, @category_4,
      @equipment_name, @model, @specification, @unit, @quantity, @power, @installed_at, @vendor,
      @location, @accessory, @status, @is_visible, @notes, @author, @created_at, @updated_at, 0
    )
    ON CONFLICT(id) DO UPDATE SET
      site_name = excluded.site_name,
      management_no = excluded.management_no,
      category_1 = excluded.category_1,
      category_2 = excluded.category_2,
      category_3 = excluded.category_3,
      category_4 = excluded.category_4,
      equipment_name = excluded.equipment_name,
      model = excluded.model,
      specification = excluded.specification,
      unit = excluded.unit,
      quantity = excluded.quantity,
      power = excluded.power,
      installed_at = excluded.installed_at,
      vendor = excluded.vendor,
      location = excluded.location,
      accessory = excluded.accessory,
      status = excluded.status,
      is_visible = excluded.is_visible,
      notes = excluded.notes,
      author = excluded.author,
      last_modified = excluded.last_modified,
      is_synced = 1
    -- 미동기화 로컬 수정은 보존한다(§4-4-4 복원 원칙)
    WHERE equipment_assets.is_synced = 1
  `);
  const insertAssetPhoto = db.prepare(`
    INSERT INTO equipment_asset_photos (
      equipment_id, site_id, photo_type, original_name, stored_name, relative_path, sort_order, created_at, is_synced
    ) VALUES (@equipment_id, @site_id, @photo_type, @original_name, @stored_name, @relative_path, @sort_order, @created_at, 1)
  `);
  const upsertHistory = db.prepare(`
    INSERT INTO facility_logs (
      id, date, location, facility_name, content, company, price, notes, site_id, site_name,
      author, equipment_id, type, contact, completed_at, created_at, last_modified, is_synced
    ) VALUES (
      @id, @date, @location, @facility_name, @content, @company, @price, @notes, @site_id, @site_name,
      @author, @equipment_id, @type, @contact, @completed_at, @created_at, @updated_at, 1
    )
    ON CONFLICT(id) DO UPDATE SET
      date = excluded.date, location = excluded.location, facility_name = excluded.facility_name,
      content = excluded.content, company = excluded.company, price = excluded.price,
      notes = excluded.notes, site_name = excluded.site_name, author = excluded.author,
      equipment_id = excluded.equipment_id, type = excluded.type, contact = excluded.contact,
      completed_at = excluded.completed_at, last_modified = excluded.last_modified, is_synced = 1
    WHERE facility_logs.site_id = excluded.site_id
      -- 미동기화 로컬 수정은 보존한다(원격 값으로 덮어쓰지 않음)
      AND facility_logs.is_synced = 1
  `);
  // 업무기록 연결 복원: 부모 업무기록이 존재할 때만 넣는다(고아 링크 방지).
  const upsertLink = db.prepare(`
    INSERT INTO work_record_equipment_links (
      work_record_id, equipment_id, site_id, created_at, is_synced
    ) SELECT @work_record_id, @equipment_id, @site_id, @created_at, 1
    WHERE EXISTS (SELECT 1 FROM work_records WHERE id = @work_record_id)
    ON CONFLICT(work_record_id, equipment_id) DO NOTHING
  `);
  const insertLogPhoto = db.prepare(`
    INSERT INTO facility_log_photos (
      facility_log_id, site_id, original_name, stored_name, relative_path, sort_order, created_at, is_synced
    ) VALUES (@facility_log_id, @site_id, @original_name, @stored_name, @relative_path, @sort_order, @created_at, 1)
  `);

  const tables = [
    {
      name: 'equipment_assets',
      apply: (rows) => rows.forEach((row) => upsertAsset.run({
        id: String(valueOr(row.id)),
        site_id: String(valueOr(row.site_id) || scope.siteId),
        site_name: valueOr(row.site_name) || scope.siteName,
        management_no: valueOr(row.management_no),
        category_1: valueOr(row.category_1),
        category_2: valueOr(row.category_2),
        category_3: valueOr(row.category_3),
        category_4: valueOr(row.category_4),
        equipment_name: valueOr(row.equipment_name),
        model: valueOr(row.model),
        specification: valueOr(row.specification),
        unit: valueOr(row.unit),
        quantity: valueOr(row.quantity),
        power: valueOr(row.power),
        installed_at: valueOr(row.installed_at),
        vendor: valueOr(row.vendor),
        location: valueOr(row.location),
        accessory: valueOr(row.accessory),
        status: valueOr(row.status) || '사용 중',
        is_visible: valueOr(row.is_visible) === 0 || valueOr(row.is_visible) === false ? 0 : 1,
        notes: valueOr(row.notes),
        author: valueOr(row.author),
        created_at: valueOr(row.created_at) || new Date().toISOString(),
        updated_at: valueOr(row.updated_at) || new Date().toISOString(),
      })),
    },
    {
      name: 'equipment_asset_photos',
      apply: (rows) => rows.forEach((row) => {
        const relativePath = valueOr(row.relative_path) || '';
        const exists = db.prepare('SELECT id FROM equipment_asset_photos WHERE equipment_id = ? AND relative_path = ?')
          .get(String(valueOr(row.equipment_id)), relativePath);
        if (exists) return;
        insertAssetPhoto.run({
        equipment_id: String(valueOr(row.equipment_id)),
        site_id: String(valueOr(row.site_id) || scope.siteId),
        photo_type: valueOr(row.photo_type) || 'main',
        original_name: valueOr(row.original_name),
        stored_name: valueOr(row.stored_name) || `restore-${valueOr(row.id)}.jpg`,
        relative_path: relativePath,
        sort_order: valueOr(row.sort_order) || 0,
        created_at: valueOr(row.created_at) || new Date().toISOString(),
        });
      }),
    },
    {
      name: 'facility_logs',
      apply: (rows) => rows
        .filter((row) => valueOr(row.equipment_id))
        .forEach((row) => upsertHistory.run({
          id: Number(valueOr(row.local_id)),
          date: valueOr(row.date),
          location: valueOr(row.location),
          facility_name: valueOr(row.facility_name),
          content: valueOr(row.content),
          company: valueOr(row.company),
          price: valueOr(row.price) || 0,
          notes: valueOr(row.notes),
          site_id: String(valueOr(row.site_id) || scope.siteId),
          site_name: valueOr(row.site_name) || scope.siteName,
          author: valueOr(row.author),
          equipment_id: String(valueOr(row.equipment_id)),
          type: valueOr(row.type),
          contact: valueOr(row.contact),
          completed_at: valueOr(row.completed_at),
          created_at: valueOr(row.created_at) || new Date().toISOString(),
          updated_at: valueOr(row.updated_at) || new Date().toISOString(),
        })),
    },
    {
      name: 'work_record_equipment_links',
      apply: (rows) => rows.forEach((row) => upsertLink.run({
        work_record_id: valueOr(row.work_record_id),
        equipment_id: String(valueOr(row.equipment_id)),
        site_id: String(valueOr(row.site_id) || scope.siteId),
        created_at: valueOr(row.created_at) || new Date().toISOString(),
      })),
    },
    {
      name: 'facility_log_photos',
      apply: (rows) => rows.forEach((row) => {
        const relativePath = valueOr(row.relative_path) || '';
        const exists = db.prepare('SELECT id FROM facility_log_photos WHERE facility_log_id = ? AND relative_path = ?')
          .get(valueOr(row.facility_log_id), relativePath);
        if (exists) return;
        insertLogPhoto.run({
        facility_log_id: valueOr(row.facility_log_id),
        site_id: String(valueOr(row.site_id) || scope.siteId),
        original_name: valueOr(row.original_name),
        stored_name: valueOr(row.stored_name) || `restore-${valueOr(row.id)}.jpg`,
        relative_path: relativePath,
        sort_order: valueOr(row.sort_order) || 0,
        created_at: valueOr(row.created_at) || new Date().toISOString(),
        });
      }),
    },
  ];

  for (const { name, apply } of tables) {
    try {
      const rows = await querySiteRows(name, scope);
      db.transaction(() => apply(rows))();
      counts[name] = { success: true, count: rows.length };
    } catch (err) {
      counts[name] = { success: false, error: err.message };
      console.warn(`[BigQuery Restore] ${name} 복구 실패:`, err.message);
    }
  }

  return { scope, tables: counts };
}

module.exports = {
  inspectOperationalData,
  restoreOperationalData,
  restoreEquipmentMaster,
};
