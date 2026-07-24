'use strict';

const MULTI_SITE_FOUNDATION_VERSION = 'multi-site-foundation-v2-site-excel';

function ensureFoundationTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_settings (
      site_id TEXT PRIMARY KEY,
      excel_template_path TEXT,
      flow_sheet TEXT,
      flow_start_row INTEGER,
      flow_end_row INTEGER,
      flow_date_col TEXT,
      med_sheet TEXT,
      med_start_row INTEGER,
      med_end_row INTEGER,
      med_date_col TEXT,
      water_sheet TEXT,
      water_start_row INTEGER,
      water_end_row INTEGER,
      water_date_col TEXT,
      kit_sheet TEXT,
      kit_start_row INTEGER,
      kit_end_row INTEGER,
      kit_date_col TEXT,
      qntech_photo_root TEXT,
      qntech_sample_mappings TEXT,
      flow_option TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (site_id) REFERENCES sites(id)
    );

    CREATE TABLE IF NOT EXISTS site_config_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id TEXT NOT NULL,
      category TEXT NOT NULL,
      item_name TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      display_order INTEGER,
      excel_cell TEXT,
      default_amount REAL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(site_id, category, item_name),
      FOREIGN KEY (site_id) REFERENCES sites(id)
    );

    CREATE TABLE IF NOT EXISTS site_excel_sheets (
      site_id TEXT NOT NULL,
      sheet_name TEXT NOT NULL,
      max_row INTEGER NOT NULL DEFAULT 0,
      imported_at TEXT NOT NULL,
      PRIMARY KEY (site_id, sheet_name),
      FOREIGN KEY (site_id) REFERENCES sites(id)
    );

    CREATE TABLE IF NOT EXISTS site_excel_raw_data (
      site_id TEXT NOT NULL,
      sheet_name TEXT NOT NULL,
      row_num INTEGER NOT NULL,
      col TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (site_id, sheet_name, row_num, col),
      FOREIGN KEY (site_id) REFERENCES sites(id)
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS site_sludge_export_settings (
      site_id TEXT PRIMARY KEY,
      company_name TEXT,
      default_amount REAL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (site_id) REFERENCES sites(id)
    );

    CREATE INDEX IF NOT EXISTS idx_site_config_items_category_order
      ON site_config_items (site_id, category, display_order);
    CREATE INDEX IF NOT EXISTS idx_site_excel_raw_sheet_row
      ON site_excel_raw_data (site_id, sheet_name, row_num);
  `);
}

function ensureLegacyMirrorTriggers(db) {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_app_settings_site_settings_insert
    AFTER INSERT ON app_settings
    WHEN NEW.site_id IS NOT NULL AND TRIM(NEW.site_id) <> ''
    BEGIN
      INSERT INTO site_settings (
        site_id, excel_template_path,
        flow_sheet, flow_start_row, flow_end_row, flow_date_col,
        med_sheet, med_start_row, med_end_row, med_date_col,
        water_sheet, water_start_row, water_end_row, water_date_col,
        kit_sheet, kit_start_row, kit_end_row, kit_date_col,
        qntech_photo_root, qntech_sample_mappings, flow_option, updated_at
      ) VALUES (
        NEW.site_id, NEW.excel_template_path,
        NEW.flow_sheet, NEW.flow_start_row, NEW.flow_end_row, NEW.flow_date_col,
        NEW.med_sheet, NEW.med_start_row, NEW.med_end_row, NEW.med_date_col,
        NEW.water_sheet, NEW.water_start_row, NEW.water_end_row, NEW.water_date_col,
        NEW.kit_sheet, NEW.kit_start_row, NEW.kit_end_row, NEW.kit_date_col,
        NEW.qntech_photo_root, NEW.qntech_sample_mappings, NEW.flow_option,
        datetime('now', 'localtime')
      )
      ON CONFLICT(site_id) DO UPDATE SET
        excel_template_path = excluded.excel_template_path,
        flow_sheet = excluded.flow_sheet,
        flow_start_row = excluded.flow_start_row,
        flow_end_row = excluded.flow_end_row,
        flow_date_col = excluded.flow_date_col,
        med_sheet = excluded.med_sheet,
        med_start_row = excluded.med_start_row,
        med_end_row = excluded.med_end_row,
        med_date_col = excluded.med_date_col,
        water_sheet = excluded.water_sheet,
        water_start_row = excluded.water_start_row,
        water_end_row = excluded.water_end_row,
        water_date_col = excluded.water_date_col,
        kit_sheet = excluded.kit_sheet,
        kit_start_row = excluded.kit_start_row,
        kit_end_row = excluded.kit_end_row,
        kit_date_col = excluded.kit_date_col,
        qntech_photo_root = excluded.qntech_photo_root,
        qntech_sample_mappings = excluded.qntech_sample_mappings,
        flow_option = excluded.flow_option,
        updated_at = excluded.updated_at;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_app_settings_site_settings_update
    AFTER UPDATE ON app_settings
    WHEN NEW.site_id IS NOT NULL AND TRIM(NEW.site_id) <> ''
    BEGIN
      INSERT INTO site_settings (
        site_id, excel_template_path,
        flow_sheet, flow_start_row, flow_end_row, flow_date_col,
        med_sheet, med_start_row, med_end_row, med_date_col,
        water_sheet, water_start_row, water_end_row, water_date_col,
        kit_sheet, kit_start_row, kit_end_row, kit_date_col,
        qntech_photo_root, qntech_sample_mappings, flow_option, updated_at
      ) VALUES (
        NEW.site_id, NEW.excel_template_path,
        NEW.flow_sheet, NEW.flow_start_row, NEW.flow_end_row, NEW.flow_date_col,
        NEW.med_sheet, NEW.med_start_row, NEW.med_end_row, NEW.med_date_col,
        NEW.water_sheet, NEW.water_start_row, NEW.water_end_row, NEW.water_date_col,
        NEW.kit_sheet, NEW.kit_start_row, NEW.kit_end_row, NEW.kit_date_col,
        NEW.qntech_photo_root, NEW.qntech_sample_mappings, NEW.flow_option,
        datetime('now', 'localtime')
      )
      ON CONFLICT(site_id) DO UPDATE SET
        excel_template_path = excluded.excel_template_path,
        flow_sheet = excluded.flow_sheet,
        flow_start_row = excluded.flow_start_row,
        flow_end_row = excluded.flow_end_row,
        flow_date_col = excluded.flow_date_col,
        med_sheet = excluded.med_sheet,
        med_start_row = excluded.med_start_row,
        med_end_row = excluded.med_end_row,
        med_date_col = excluded.med_date_col,
        water_sheet = excluded.water_sheet,
        water_start_row = excluded.water_start_row,
        water_end_row = excluded.water_end_row,
        water_date_col = excluded.water_date_col,
        kit_sheet = excluded.kit_sheet,
        kit_start_row = excluded.kit_start_row,
        kit_end_row = excluded.kit_end_row,
        kit_date_col = excluded.kit_date_col,
        qntech_photo_root = excluded.qntech_photo_root,
        qntech_sample_mappings = excluded.qntech_sample_mappings,
        flow_option = excluded.flow_option,
        updated_at = excluded.updated_at;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_config_items_site_insert
    AFTER INSERT ON config_items
    WHEN (SELECT site_id FROM app_settings WHERE id = 1) IS NOT NULL
    BEGIN
      INSERT INTO site_config_items (
        site_id, category, item_name, is_active, display_order, excel_cell, default_amount, updated_at
      )
      SELECT site_id, NEW.category, NEW.item_name, NEW.is_active, NEW.display_order,
             NEW.excel_cell, NEW.default_amount, datetime('now', 'localtime')
      FROM app_settings WHERE id = 1 AND TRIM(COALESCE(site_id, '')) <> ''
      ON CONFLICT(site_id, category, item_name) DO UPDATE SET
        is_active = excluded.is_active,
        display_order = excluded.display_order,
        excel_cell = excluded.excel_cell,
        default_amount = excluded.default_amount,
        updated_at = excluded.updated_at;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_config_items_site_update
    AFTER UPDATE ON config_items
    WHEN (SELECT site_id FROM app_settings WHERE id = 1) IS NOT NULL
    BEGIN
      DELETE FROM site_config_items
      WHERE site_id = (SELECT site_id FROM app_settings WHERE id = 1)
        AND category = OLD.category
        AND item_name = OLD.item_name
        AND (OLD.category <> NEW.category OR OLD.item_name <> NEW.item_name);
      INSERT INTO site_config_items (
        site_id, category, item_name, is_active, display_order, excel_cell, default_amount, updated_at
      )
      SELECT site_id, NEW.category, NEW.item_name, NEW.is_active, NEW.display_order,
             NEW.excel_cell, NEW.default_amount, datetime('now', 'localtime')
      FROM app_settings WHERE id = 1 AND TRIM(COALESCE(site_id, '')) <> ''
      ON CONFLICT(site_id, category, item_name) DO UPDATE SET
        is_active = excluded.is_active,
        display_order = excluded.display_order,
        excel_cell = excluded.excel_cell,
        default_amount = excluded.default_amount,
        updated_at = excluded.updated_at;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_config_items_site_delete
    AFTER DELETE ON config_items
    WHEN (SELECT site_id FROM app_settings WHERE id = 1) IS NOT NULL
    BEGIN
      DELETE FROM site_config_items
      WHERE site_id = (SELECT site_id FROM app_settings WHERE id = 1)
        AND category = OLD.category
        AND item_name = OLD.item_name;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_sludge_export_site_insert
    AFTER INSERT ON sludge_export_settings
    WHEN (SELECT site_id FROM app_settings WHERE id = 1) IS NOT NULL
    BEGIN
      INSERT INTO site_sludge_export_settings (site_id, company_name, default_amount, updated_at)
      SELECT site_id, NEW.company_name, NEW.default_amount, NEW.updated_at
      FROM app_settings WHERE id = 1 AND TRIM(COALESCE(site_id, '')) <> ''
      ON CONFLICT(site_id) DO UPDATE SET
        company_name = excluded.company_name,
        default_amount = excluded.default_amount,
        updated_at = excluded.updated_at;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_sludge_export_site_update
    AFTER UPDATE ON sludge_export_settings
    WHEN (SELECT site_id FROM app_settings WHERE id = 1) IS NOT NULL
    BEGIN
      INSERT INTO site_sludge_export_settings (site_id, company_name, default_amount, updated_at)
      SELECT site_id, NEW.company_name, NEW.default_amount, NEW.updated_at
      FROM app_settings WHERE id = 1 AND TRIM(COALESCE(site_id, '')) <> ''
      ON CONFLICT(site_id) DO UPDATE SET
        company_name = excluded.company_name,
        default_amount = excluded.default_amount,
        updated_at = excluded.updated_at;
    END;
  `);
}

function countRows(db, tableName) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
}

function backfillDefaultSite(db, siteId) {
  db.prepare(`
    INSERT INTO site_settings (
      site_id, excel_template_path,
      flow_sheet, flow_start_row, flow_end_row, flow_date_col,
      med_sheet, med_start_row, med_end_row, med_date_col,
      water_sheet, water_start_row, water_end_row, water_date_col,
      kit_sheet, kit_start_row, kit_end_row, kit_date_col,
      qntech_photo_root, qntech_sample_mappings, flow_option, updated_at
    )
    SELECT
      site_id, excel_template_path,
      flow_sheet, flow_start_row, flow_end_row, flow_date_col,
      med_sheet, med_start_row, med_end_row, med_date_col,
      water_sheet, water_start_row, water_end_row, water_date_col,
      kit_sheet, kit_start_row, kit_end_row, kit_date_col,
      qntech_photo_root, qntech_sample_mappings, flow_option,
      datetime('now', 'localtime')
    FROM app_settings
    WHERE id = 1 AND site_id = ?
    ON CONFLICT(site_id) DO UPDATE SET
      excel_template_path = excluded.excel_template_path,
      flow_sheet = excluded.flow_sheet,
      flow_start_row = excluded.flow_start_row,
      flow_end_row = excluded.flow_end_row,
      flow_date_col = excluded.flow_date_col,
      med_sheet = excluded.med_sheet,
      med_start_row = excluded.med_start_row,
      med_end_row = excluded.med_end_row,
      med_date_col = excluded.med_date_col,
      water_sheet = excluded.water_sheet,
      water_start_row = excluded.water_start_row,
      water_end_row = excluded.water_end_row,
      water_date_col = excluded.water_date_col,
      kit_sheet = excluded.kit_sheet,
      kit_start_row = excluded.kit_start_row,
      kit_end_row = excluded.kit_end_row,
      kit_date_col = excluded.kit_date_col,
      qntech_photo_root = excluded.qntech_photo_root,
      qntech_sample_mappings = excluded.qntech_sample_mappings,
      flow_option = excluded.flow_option,
      updated_at = excluded.updated_at
  `).run(siteId);

  db.prepare(`
    INSERT INTO site_config_items (
      site_id, category, item_name, is_active, display_order, excel_cell, default_amount
    )
    SELECT ?, category, item_name, is_active, display_order, excel_cell, default_amount
    FROM config_items
    WHERE 1 = 1
    ON CONFLICT(site_id, category, item_name) DO UPDATE SET
      is_active = excluded.is_active,
      display_order = excluded.display_order,
      excel_cell = excluded.excel_cell,
      default_amount = excluded.default_amount,
      updated_at = datetime('now', 'localtime')
  `).run(siteId);

  db.prepare(`
    INSERT INTO site_sludge_export_settings (site_id, company_name, default_amount, updated_at)
    SELECT ?, company_name, default_amount, updated_at
    FROM sludge_export_settings WHERE id = 1
    ON CONFLICT(site_id) DO UPDATE SET
      company_name = excluded.company_name,
      default_amount = excluded.default_amount,
      updated_at = excluded.updated_at
  `).run(siteId);

  db.prepare(`
    INSERT INTO site_excel_sheets (site_id, sheet_name, max_row, imported_at)
    SELECT ?, sheet_name, max_row, imported_at
    FROM excel_sheets
    WHERE 1 = 1
    ON CONFLICT(site_id, sheet_name) DO UPDATE SET
      max_row = excluded.max_row,
      imported_at = excluded.imported_at
  `).run(siteId);

  db.prepare(`
    INSERT INTO site_excel_raw_data (site_id, sheet_name, row_num, col, value)
    SELECT ?, sheet_name, row_num, col, value
    FROM excel_raw_data
    WHERE 1 = 1
    ON CONFLICT(site_id, sheet_name, row_num, col) DO UPDATE SET
      value = excluded.value
  `).run(siteId);

  const expected = {
    settings: 1,
    configItems: countRows(db, 'config_items'),
    sludgeSettings: countRows(db, 'sludge_export_settings'),
    excelSheets: countRows(db, 'excel_sheets'),
    excelRawData: countRows(db, 'excel_raw_data'),
  };
  const actual = {
    settings: db.prepare('SELECT COUNT(*) AS count FROM site_settings WHERE site_id = ?').get(siteId).count,
    configItems: db.prepare('SELECT COUNT(*) AS count FROM site_config_items WHERE site_id = ?').get(siteId).count,
    sludgeSettings: db.prepare('SELECT COUNT(*) AS count FROM site_sludge_export_settings WHERE site_id = ?').get(siteId).count,
    excelSheets: db.prepare('SELECT COUNT(*) AS count FROM site_excel_sheets WHERE site_id = ?').get(siteId).count,
    excelRawData: db.prepare('SELECT COUNT(*) AS count FROM site_excel_raw_data WHERE site_id = ?').get(siteId).count,
  };

  for (const key of Object.keys(expected)) {
    if (actual[key] !== expected[key]) {
      throw new Error(`양방향 기반 백필 검증 실패(${key}): ${actual[key]}/${expected[key]}`);
    }
  }
  return { expected, actual };
}

function ensureMultiSiteFoundation(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const siteId = String(
    db.prepare('SELECT site_id FROM app_settings WHERE id = 1').get()?.site_id || ''
  ).trim();

  const migrate = db.transaction(() => {
    ensureFoundationTables(db);
    ensureLegacyMirrorTriggers(db);

    const alreadyApplied = Boolean(
      db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(MULTI_SITE_FOUNDATION_VERSION)
    );
    if (alreadyApplied || !siteId) {
      return { applied: false, reason: alreadyApplied ? 'already-applied' : 'site-id-missing', siteId };
    }

    const verification = backfillDefaultSite(db, siteId);
    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(MULTI_SITE_FOUNDATION_VERSION);
    return { applied: true, siteId, verification };
  });

  return migrate();
}

module.exports = {
  MULTI_SITE_FOUNDATION_VERSION,
  ensureMultiSiteFoundation,
};
