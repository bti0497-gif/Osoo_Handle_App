const sqlite3 = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

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
    nh3_n REAL,
    no3_n REAL,
    po4_p REAL,
    alkalinity REAL,
    tn REAL,
    tp REAL,
    cod REAL,
    ss REAL,
    UNIQUE(date, location)
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
    kit_sheet TEXT, kit_start_row INTEGER, kit_end_row INTEGER, kit_date_col TEXT
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
`);

// --- Migrations ---
const waterCols = db.prepare("PRAGMA table_info(water_quality)").all().map(c => c.name);
['tn', 'tp', 'cod', 'ss'].forEach(col => {
  if (!waterCols.includes(col)) db.prepare(`ALTER TABLE water_quality ADD COLUMN ${col} REAL`).run();
});

const settingsCols = db.prepare("PRAGMA table_info(app_settings)").all().map(c => c.name);
[
  'flow_sheet', 'flow_start_row', 'flow_end_row', 'flow_date_col',
  'med_sheet', 'med_start_row', 'med_end_row', 'med_date_col',
  'water_sheet', 'water_start_row', 'water_end_row', 'water_date_col',
  'kit_sheet', 'kit_start_row', 'kit_end_row', 'kit_date_col'
].forEach(col => {
  if (!settingsCols.includes(col)) {
    const type = col.includes('row') ? 'INTEGER' : 'TEXT';
    db.prepare(`ALTER TABLE app_settings ADD COLUMN ${col} ${type}`).run();
  }
});

// --- Seeds ---
db.prepare("INSERT OR IGNORE INTO app_settings (id, site_name) VALUES (1, '새 현장')").run();

const settingsExists = db.prepare('SELECT id FROM app_settings WHERE id = 1').get();
if (!settingsExists) {
  db.prepare(`INSERT INTO app_settings (id, site_name, manager_name, method, series) VALUES (1, '오수처리장', '관리자', 'A2O', '1계열')`).run();
}

if (db.prepare("SELECT count(*) as count FROM config_items WHERE category = 'kit'").get().count === 0) {
  const kitStmt = db.prepare('INSERT INTO config_items (category, item_name, is_active, display_order) VALUES (?, ?, ?, ?)');
  ['T-N (총질소)', 'T-P (총인)', 'COD (화학적산소요구량)', 'SS (부유물질)'].forEach((name, i) => kitStmt.run('kit', name, 1, i));
}

if (db.prepare('SELECT count(*) as count FROM config_items').get().count === 0) {
  const stmt = db.prepare('INSERT INTO config_items (category, item_name, is_active, display_order) VALUES (?, ?, ?, ?)');
  ['유입유량계', '방류유량계', '내부반송유량계', '외부반송유량계', '전력량계', '슬러지'].forEach((name, i) => stmt.run('flow', name, 1, i));
  ['중탄산나트륨', '포도당', '팩(PAC)', '차염산나트륨', '알민산나트륨'].forEach((name, i) => {
    stmt.run('medicine', name, ['중탄산나트륨', '포도당', '팩(PAC)'].includes(name) ? 1 : 0, i);
  });
  ['암모니아성질소', '질산성질소', '인산염인', '알칼리도'].forEach((name, i) => stmt.run('water', name, 1, i));
}

console.log('Database migration check complete.');

module.exports = { db, appDataPath };
