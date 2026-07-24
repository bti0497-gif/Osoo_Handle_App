'use strict';

const SITE_DATA_ISOLATION_VERSION = 'site-data-isolation-v1';

const TABLES = [
  {
    name: 'flow_readings',
    unique: 'UNIQUE(site_id, date, type)',
    create: `CREATE TABLE flow_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, date DATE NOT NULL, type TEXT NOT NULL,
      raw_value REAL, calculated_flow REAL, is_reset BOOLEAN DEFAULT 0,
      is_manual BOOLEAN DEFAULT 0, sludge_export REAL, site_name TEXT, author TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
      is_synced INTEGER DEFAULT 0, site_id TEXT NOT NULL, input_status TEXT DEFAULT 'manual',
      reading_unit TEXT, UNIQUE(site_id, date, type)
    )`,
  },
  {
    name: 'medicine_logs',
    unique: 'UNIQUE(site_id, medicine_name, date)',
    create: `CREATE TABLE medicine_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, medicine_name TEXT NOT NULL, date DATE NOT NULL,
      purchase_amount REAL, usage_amount REAL, current_inventory REAL, site_name TEXT,
      author TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
      is_synced INTEGER DEFAULT 0, photo_url TEXT, site_id TEXT NOT NULL,
      input_status TEXT DEFAULT 'manual', UNIQUE(site_id, medicine_name, date)
    )`,
  },
  {
    name: 'kit_logs',
    unique: 'UNIQUE(site_id, kit_name, date)',
    create: `CREATE TABLE kit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kit_name TEXT NOT NULL, date DATE NOT NULL,
      purchase_amount REAL, usage_amount REAL, current_inventory REAL, site_name TEXT,
      author TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
      is_synced INTEGER DEFAULT 0, photo_url TEXT, site_id TEXT NOT NULL,
      input_status TEXT DEFAULT 'manual', UNIQUE(site_id, kit_name, date)
    )`,
  },
  {
    name: 'qntech_water_quality',
    unique: 'UNIQUE(site_id, date, measurement_group, location, item_code)',
    create: `CREATE TABLE qntech_water_quality (
      id INTEGER PRIMARY KEY AUTOINCREMENT, date DATE NOT NULL, site_id TEXT NOT NULL,
      site_name TEXT, measurement_group TEXT NOT NULL DEFAULT '', measurement_order INTEGER DEFAULT 1,
      source_type TEXT DEFAULT 'manual', source_label TEXT, qntech_project_id TEXT, location TEXT,
      item_name TEXT NOT NULL, item_code TEXT NOT NULL, result_value TEXT, result_numeric REAL,
      unit TEXT, author TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_modified TEXT DEFAULT CURRENT_TIMESTAMP, is_synced INTEGER DEFAULT 0,
      input_status TEXT DEFAULT 'manual',
      UNIQUE(site_id, date, measurement_group, location, item_code)
    )`,
  },
  {
    name: 'sludge_photo_logs',
    unique: 'UNIQUE(site_id, date)',
    create: `CREATE TABLE sludge_photo_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, sludge_amount REAL,
      sludge_photo_path TEXT, sludge_photo_taken_at TEXT, certificate_photo_path TEXT,
      note TEXT, site_name TEXT, author TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_modified TEXT DEFAULT CURRENT_TIMESTAMP, site_id TEXT NOT NULL,
      UNIQUE(site_id, date)
    )`,
  },
];

function normalizeSql(sql) {
  return String(sql || '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').toLowerCase();
}

function rebuildTable(db, definition, fallbackSiteId) {
  const existingColumns = db.prepare(`PRAGMA table_info(${definition.name})`).all().map((row) => row.name);
  if (existingColumns.length === 0) return false;
  const oldName = `${definition.name}__site_isolation_old`;
  db.exec(`ALTER TABLE ${definition.name} RENAME TO ${oldName}`);
  db.exec(definition.create);
  const newColumns = db.prepare(`PRAGMA table_info(${definition.name})`).all().map((row) => row.name);
  const commonColumns = newColumns.filter((column) => existingColumns.includes(column));
  const selectColumns = commonColumns.map((column) => {
    if (column === 'site_id') return `COALESCE(NULLIF(site_id, ''), '${String(fallbackSiteId).replace(/'/g, "''")}') AS site_id`;
    return column;
  });
  db.exec(`
    INSERT INTO ${definition.name} (${commonColumns.join(', ')})
    SELECT ${selectColumns.join(', ')} FROM ${oldName}
  `);
  db.exec(`DROP TABLE ${oldName}`);
  return true;
}

function ensureSiteDataIsolation(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  if (db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(SITE_DATA_ISOLATION_VERSION)) {
    return { applied: false, reason: 'already-applied' };
  }
  const fallbackSiteId = String(
    db.prepare('SELECT site_id FROM app_settings WHERE id = 1').get()?.site_id || ''
  ).trim();
  if (!fallbackSiteId) {
    return { applied: false, reason: 'site-not-configured' };
  }

  const rebuilt = [];
  db.transaction(() => {
    for (const definition of TABLES) {
      const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(definition.name)?.sql;
      if (!sql) continue;
      if (!normalizeSql(sql).includes(normalizeSql(definition.unique))) {
        if (rebuildTable(db, definition, fallbackSiteId)) rebuilt.push(definition.name);
      }
    }
    const workColumns = db.prepare('PRAGMA table_info(work_records)').all().map((row) => row.name);
    if (workColumns.length > 0 && !workColumns.includes('site_id')) {
      db.prepare('ALTER TABLE work_records ADD COLUMN site_id TEXT').run();
    }
    db.prepare("UPDATE work_records SET site_id = ? WHERE site_id IS NULL OR TRIM(site_id) = ''").run(fallbackSiteId);
    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(SITE_DATA_ISOLATION_VERSION);
  })();

  return { applied: true, siteId: fallbackSiteId, rebuilt };
}

module.exports = {
  SITE_DATA_ISOLATION_VERSION,
  ensureSiteDataIsolation,
};
