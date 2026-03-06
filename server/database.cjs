const sqlite3 = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DEFAULT_ROAD_WEB_URL = 'https://nwpo.ex.co.kr:5002//security/login.do';
const DEFAULT_WATER_ANALYSIS_URL = 'https://eco.qntech.co.kr';

const appDataPath = path.join(process.env.APPDATA, 'Osoo_Handle_App');
if (!fs.existsSync(appDataPath)) {
  fs.mkdirSync(appDataPath, { recursive: true });
}

const dbPath = path.join(appDataPath, 'osoo.db');
const db = new sqlite3(dbPath);
console.log(`Using database at: ${dbPath}`);

db.exec(`
  CREATE TABLE IF NOT EXISTS flow_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    type TEXT NOT NULL,
    raw_value REAL,
    calculated_flow REAL,
    is_reset BOOLEAN DEFAULT 0,
    is_manual BOOLEAN DEFAULT 0,
    sludge_export REAL,
    UNIQUE(date, type)
  );
  CREATE TABLE IF NOT EXISTS medicine_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    medicine_name TEXT NOT NULL,
    date DATE NOT NULL,
    purchase_amount REAL,
    usage_amount REAL,
    current_inventory REAL,
    UNIQUE(medicine_name, date)
  );
  CREATE TABLE IF NOT EXISTS water_quality (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    location TEXT,
    nh3_n TEXT,
    no3_n TEXT,
    po4_p TEXT,
    alkalinity TEXT,
    tn TEXT,
    tp TEXT,
    cod TEXT,
    ss TEXT,
    UNIQUE(date, location)
  );
  CREATE TABLE IF NOT EXISTS kit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kit_name TEXT NOT NULL,
    date DATE NOT NULL,
    purchase_amount REAL,
    usage_amount REAL,
    current_inventory REAL,
    UNIQUE(kit_name, date)
  );
  CREATE TABLE IF NOT EXISTS facility_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    facility_name TEXT,
    content TEXT,
    company TEXT,
    price INTEGER,
    notes TEXT
  );
  CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    site_name TEXT,
    manager_name TEXT,
    method TEXT,
    series TEXT,
    excel_template_path TEXT,
    flow_sheet TEXT, flow_start_row INTEGER, flow_end_row INTEGER, flow_date_col TEXT,
    med_sheet TEXT, med_start_row INTEGER, med_end_row INTEGER, med_date_col TEXT,
    water_sheet TEXT, water_start_row INTEGER, water_end_row INTEGER, water_date_col TEXT,
    kit_sheet TEXT, kit_start_row INTEGER, kit_end_row INTEGER, kit_date_col TEXT,
    qntech_photo_root TEXT,
    qntech_sample_mappings TEXT
  );
  CREATE TABLE IF NOT EXISTS web_app_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_key TEXT NOT NULL UNIQUE,
    service_name TEXT NOT NULL,
    service_url TEXT,
    user_id TEXT,
    password TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS config_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    item_name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT 1,
    display_order INTEGER,
    excel_cell TEXT,
    UNIQUE(category, item_name)
  );
  CREATE TABLE IF NOT EXISTS excel_raw_data (
    sheet_name TEXT NOT NULL,
    row_num INTEGER NOT NULL,
    col TEXT NOT NULL,
    value TEXT,
    PRIMARY KEY (sheet_name, row_num, col)
  );
  CREATE TABLE IF NOT EXISTS excel_sheets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sheet_name TEXT NOT NULL UNIQUE,
    max_row INTEGER NOT NULL DEFAULT 0,
    imported_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id TEXT NOT NULL,
    member_name TEXT NOT NULL,
    date DATE NOT NULL,
    login_time DATETIME,
    logout_time DATETIME,
    login_lat REAL,
    login_lng REAL,
    logout_lat REAL,
    logout_lng REAL,
    location_matched BOOLEAN DEFAULT 0,
    auto_logout BOOLEAN DEFAULT 0,
    is_synced BOOLEAN DEFAULT 0
  );
`);

// --- Migrations ---
const attendanceCols = db.prepare("PRAGMA table_info(attendance)").all().map(c => c.name);
if (!attendanceCols.includes('member_id')) {
  db.prepare('ALTER TABLE attendance ADD COLUMN member_id TEXT').run();
}
if (!attendanceCols.includes('member_name')) {
  db.prepare('ALTER TABLE attendance ADD COLUMN member_name TEXT').run();
}
if (!attendanceCols.includes('login_lat')) {
  db.prepare('ALTER TABLE attendance ADD COLUMN login_lat REAL').run();
}
if (!attendanceCols.includes('login_lng')) {
  db.prepare('ALTER TABLE attendance ADD COLUMN login_lng REAL').run();
}
if (!attendanceCols.includes('logout_lat')) {
  db.prepare('ALTER TABLE attendance ADD COLUMN logout_lat REAL').run();
}
if (!attendanceCols.includes('logout_lng')) {
  db.prepare('ALTER TABLE attendance ADD COLUMN logout_lng REAL').run();
}
if (!attendanceCols.includes('location_matched')) {
  db.prepare('ALTER TABLE attendance ADD COLUMN location_matched BOOLEAN DEFAULT 0').run();
}
if (!attendanceCols.includes('auto_logout')) {
  db.prepare('ALTER TABLE attendance ADD COLUMN auto_logout BOOLEAN DEFAULT 0').run();
}
if (!attendanceCols.includes('is_synced')) {
  db.prepare('ALTER TABLE attendance ADD COLUMN is_synced BOOLEAN DEFAULT 0').run();
}
const waterCols = db.prepare("PRAGMA table_info(water_quality)").all().map(c => c.name);
['tn', 'tp', 'cod', 'ss'].forEach(col => {
  if (!waterCols.includes(col)) db.prepare(`ALTER TABLE water_quality ADD COLUMN ${col} TEXT`).run();
});

const waterColumnInfo = db.prepare("PRAGMA table_info(water_quality)").all();
const requiredWaterTextColumns = ['nh3_n', 'no3_n', 'po4_p', 'alkalinity', 'tn', 'tp', 'cod', 'ss'];
const shouldRebuildWaterQuality = requiredWaterTextColumns.some((column) => {
  const info = waterColumnInfo.find((item) => item.name === column);
  return info && String(info.type || '').toUpperCase() !== 'TEXT';
});

if (shouldRebuildWaterQuality) {
  db.transaction(() => {
    db.prepare('ALTER TABLE water_quality RENAME TO water_quality_old').run();
    db.exec(`
      CREATE TABLE water_quality (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date DATE NOT NULL,
        location TEXT,
        nh3_n TEXT,
        no3_n TEXT,
        po4_p TEXT,
        alkalinity TEXT,
        tn TEXT,
        tp TEXT,
        cod TEXT,
        ss TEXT,
        UNIQUE(date, location)
      );
    `);
    db.prepare(`
      INSERT INTO water_quality (id, date, location, nh3_n, no3_n, po4_p, alkalinity, tn, tp, cod, ss)
      SELECT
        id,
        date,
        location,
        CAST(nh3_n AS TEXT),
        CAST(no3_n AS TEXT),
        CAST(po4_p AS TEXT),
        CAST(alkalinity AS TEXT),
        CAST(tn AS TEXT),
        CAST(tp AS TEXT),
        CAST(cod AS TEXT),
        CAST(ss AS TEXT)
      FROM water_quality_old
    `).run();
    db.prepare('DROP TABLE water_quality_old').run();
  })();
}

// QnTECH sentinel migration: -1 계열은 실제 화면 의미상 '초과'로 저장
['nh3_n', 'no3_n', 'po4_p', 'alkalinity', 'tn', 'tp', 'cod', 'ss'].forEach((column) => {
  db.prepare(`
    UPDATE water_quality
    SET ${column} = '초과'
    WHERE ${column} IN ('-1', '-1.0', '-1.00')
  `).run();
});

const settingsCols = db.prepare("PRAGMA table_info(app_settings)").all().map(c => c.name);
[
  'flow_sheet', 'flow_start_row', 'flow_end_row', 'flow_date_col',
  'med_sheet', 'med_start_row', 'med_end_row', 'med_date_col',
  'water_sheet', 'water_start_row', 'water_end_row', 'water_date_col',
  'kit_sheet', 'kit_start_row', 'kit_end_row', 'kit_date_col',
  'qntech_photo_root', 'qntech_sample_mappings'
].forEach(col => {
  if (!settingsCols.includes(col)) {
    const type = col.includes('row') ? 'INTEGER' : 'TEXT';
    db.prepare(`ALTER TABLE app_settings ADD COLUMN ${col} ${type}`).run();
  }
});

const webAppCredentialCols = db.prepare("PRAGMA table_info(web_app_credentials)").all().map(c => c.name);
if (!webAppCredentialCols.includes('service_url')) {
  db.prepare('ALTER TABLE web_app_credentials ADD COLUMN service_url TEXT').run();
}

// --- Seeds ---
db.prepare("INSERT OR IGNORE INTO app_settings (id, site_name) VALUES (1, '새 현장')").run();

const settingsExists = db.prepare('SELECT id FROM app_settings WHERE id = 1').get();
if (!settingsExists) {
  db.prepare(`INSERT INTO app_settings (id, site_name, manager_name, method, series) VALUES (1, '오수처리장', '관리자', 'A2O', '1계열')`).run();
}

db.prepare(`
  UPDATE app_settings
  SET qntech_photo_root = COALESCE(NULLIF(qntech_photo_root, ''), '사진관리/수질분석'),
      qntech_sample_mappings = COALESCE(NULLIF(qntech_sample_mappings, ''), '[]')
  WHERE id = 1
`).run();

db.prepare("INSERT OR IGNORE INTO web_app_credentials (service_key, service_name, service_url, user_id, password) VALUES ('road_web', '도로공사 웹페이지 설정', ?, '', '')").run(DEFAULT_ROAD_WEB_URL);
db.prepare("INSERT OR IGNORE INTO web_app_credentials (service_key, service_name, service_url, user_id, password) VALUES ('water_analysis_app', '수질분석 앱 설정', ?, '', '')").run(DEFAULT_WATER_ANALYSIS_URL);

db.prepare(`
  UPDATE web_app_credentials
  SET service_url = CASE service_key
    WHEN 'road_web' THEN ?
    WHEN 'water_analysis_app' THEN ?
    ELSE service_url
  END
  WHERE service_key IN ('road_web', 'water_analysis_app')
    AND (service_url IS NULL OR TRIM(service_url) = '')
`).run(DEFAULT_ROAD_WEB_URL, DEFAULT_WATER_ANALYSIS_URL);

if (db.prepare("SELECT count(*) as count FROM config_items WHERE category = 'kit'").get().count === 0) {
  const kitStmt = db.prepare('INSERT INTO config_items (category, item_name, is_active, display_order) VALUES (?, ?, ?, ?)');
  ['암모니아성질소(NH3-N)', '질산성질소(NO3-N)', '인산염인(PO4-P)', '알칼리도(ALK)'].forEach((name, i) => kitStmt.run('kit', name, 1, i));
}

// --- Kit name migration: 이전 이름 → 올바른 이름 ---
const kitNameMap = {
  'T-N (총질소)': '암모니아성질소(NH3-N)',
  '총질소(T-N)': '암모니아성질소(NH3-N)',
  '총질소': '암모니아성질소(NH3-N)',
  'T-P (총인)': '질산성질소(NO3-N)',
  '총인(T-P)': '질산성질소(NO3-N)',
  '총인': '질산성질소(NO3-N)',
  'COD (화학적산소요구량)': '인산염인(PO4-P)',
  'COD': '인산염인(PO4-P)',
  'SS (부유물질)': '알칼리도(ALK)',
  'SS': '알칼리도(ALK)'
};

const existingKits = db.prepare("SELECT item_name FROM config_items WHERE category = 'kit'").all();
existingKits.forEach(item => {
  for (const [oldBase, newBase] of Object.entries(kitNameMap)) {
    if (item.item_name === oldBase) {
      db.prepare("UPDATE config_items SET item_name = ? WHERE category = 'kit' AND item_name = ?").run(newBase, oldBase);
    } else if (item.item_name.startsWith(oldBase + '_')) {
      const suffix = item.item_name.substring(oldBase.length);
      const newName = newBase + suffix;
      db.prepare("UPDATE config_items SET item_name = ? WHERE category = 'kit' AND item_name = ?").run(newName, item.item_name);
    }
  }
});

for (const [oldBase, newBase] of Object.entries(kitNameMap)) {
  db.prepare('UPDATE kit_logs SET kit_name = ? WHERE kit_name = ?').run(newBase, oldBase);
}

// --- Water Quality Mapping Migration: water (legacy) -> water_mapping ---
const legacyWaterItems = db.prepare("SELECT * FROM config_items WHERE category = 'water' AND item_name LIKE '%\_%' ESCAPE '\\'").all();
if (legacyWaterItems.length > 0) {
  const moveStmt = db.prepare("INSERT INTO config_items (category, item_name, excel_cell, is_active, display_order) VALUES ('water_mapping', ?, ?, 1, 0) ON CONFLICT(category, item_name) DO UPDATE SET excel_cell = excluded.excel_cell");
  const deleteStmt = db.prepare("DELETE FROM config_items WHERE category = 'water' AND item_name = ?");
  db.transaction(() => {
    legacyWaterItems.forEach(item => {
      moveStmt.run(item.item_name, item.excel_cell);
      deleteStmt.run(item.item_name);
    });
  })();
  console.log(`Migrated ${legacyWaterItems.length} water mapping items to water_mapping category.`);
}

if (db.prepare('SELECT count(*) as count FROM config_items').get().count === 0) {
  const stmt = db.prepare('INSERT INTO config_items (category, item_name, is_active, display_order) VALUES (?, ?, ?, ?)');
  ['유입유량계', '방류유량계', '내부반송유량계', '외부반송유량계', '전력량계', '슬러지'].forEach((name, i) => stmt.run('flow', name, 1, i));
  ['중탄산나트륨', '포도당', '팩(PAC)'].forEach((name, i) => {
    stmt.run('medicine', name, 1, i);
  });
  ['암모니아성질소', '질산성질소', '인산염인', '알칼리도'].forEach((name, i) => stmt.run('water', name, 1, i));
}

console.log('Database migration check complete.');

module.exports = { db, appDataPath };
