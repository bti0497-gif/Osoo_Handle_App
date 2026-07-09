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
  const clauses = [];
  if (scope.siteId) {
    clauses.push('site_id = @siteId');
    params.siteId = scope.siteId;
  }
  if (scope.siteName) {
    clauses.push('site_name = @siteName');
    params.siteName = scope.siteName;
  }
  return clauses.length ? ` AND (${clauses.join(' OR ')})` : '';
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

function restoreFlowRows(db, rows) {
  const stmt = db.prepare(`
    INSERT INTO flow_readings (
      date, type, raw_value, calculated_flow, is_reset, is_manual, sludge_export,
      input_status, site_id, site_name, author, created_at, last_modified, is_synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(date, type) DO UPDATE SET
      raw_value = excluded.raw_value,
      calculated_flow = excluded.calculated_flow,
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
    ON CONFLICT(${localNameColumn}, date) DO UPDATE SET
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
    ON CONFLICT(date, measurement_group, location, item_code) DO UPDATE SET
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

  const targetTables = tables.length ? tables : ['flow_readings', 'medicine_logs', 'kit_logs', 'qntech_water_quality'];
  const result = {};

  for (const tableName of targetTables) {
    try {
      const rows = await queryRows(tableName, normalizedStart, normalizedEnd, scope);
      if (tableName === 'flow_readings') restoreFlowRows(db, rows);
      if (tableName === 'medicine_logs') restoreMedicineRows(db, tableName, 'medicine_name', rows);
      if (tableName === 'kit_logs') restoreMedicineRows(db, tableName, 'kit_name', rows);
      if (tableName === 'qntech_water_quality') restoreQntechWaterRows(db, rows);
      result[tableName] = { success: true, count: rows.length };
    } catch (err) {
      result[tableName] = { success: false, error: err.message };
      console.warn(`[BigQuery Restore] ${tableName} 복구 실패:`, err.message);
    }
  }

  return { success: true, startDate: normalizedStart, endDate: normalizedEnd, result };
}

module.exports = {
  restoreOperationalData,
};
