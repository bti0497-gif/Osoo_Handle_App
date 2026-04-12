const sqlite3 = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DEFAULT_ROAD_WEB_URL = 'https://nwpo.ex.co.kr:5002//security/login.do';
const DEFAULT_WATER_ANALYSIS_URL = 'https://eco.qntech.co.kr';

const appDataPath = path.join(process.env.APPDATA, 'Osoo_Handle_App');
if (!fs.existsSync(appDataPath)) {
  fs.mkdirSync(appDataPath, { recursive: true });
}

const LEGACY_QNTECH_PHOTO_ROOT = '사진관리/수질분석';
const DEFAULT_QNTECH_PHOTO_ROOT = path.join(appDataPath, '사진관리', '수질분석');

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function copyDirectoryRecursive(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  ensureDirectory(targetDir);

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, targetPath);
      continue;
    }

    if (!fs.existsSync(targetPath)) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function migrateLegacyQntechPhotoRoot(dbInstance) {
  const current = dbInstance.prepare('SELECT qntech_photo_root FROM app_settings WHERE id = 1').get();
  const normalized = String(current?.qntech_photo_root || '').trim();
  const normalizedSlash = normalized.replace(/\\/g, '/');

  if (normalized && normalizedSlash !== LEGACY_QNTECH_PHOTO_ROOT) {
    return;
  }

  const legacyPhotoRoot = path.join(__dirname, '..', '사진관리', '수질분석');
  if (fs.existsSync(legacyPhotoRoot)) {
    copyDirectoryRecursive(legacyPhotoRoot, DEFAULT_QNTECH_PHOTO_ROOT);
  } else {
    ensureDirectory(DEFAULT_QNTECH_PHOTO_ROOT);
  }

  dbInstance.prepare('UPDATE app_settings SET qntech_photo_root = ? WHERE id = 1').run(DEFAULT_QNTECH_PHOTO_ROOT);
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
    site_name TEXT,
    author TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
    is_synced INTEGER DEFAULT 0,
    UNIQUE(date, type)
  );
  CREATE TABLE IF NOT EXISTS medicine_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    medicine_name TEXT NOT NULL,
    date DATE NOT NULL,
    purchase_amount REAL,
    usage_amount REAL,
    current_inventory REAL,
    site_name TEXT,
    author TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
    is_synced INTEGER DEFAULT 0,
    UNIQUE(medicine_name, date)
  );
  CREATE TABLE IF NOT EXISTS water_quality (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    measurement_group TEXT NOT NULL DEFAULT '',
    measurement_order INTEGER DEFAULT 1,
    source_type TEXT DEFAULT 'manual',
    source_label TEXT,
    qntech_project_id TEXT,
    location TEXT,
    nh3_n TEXT,
    no3_n TEXT,
    po4_p TEXT,
    alkalinity TEXT,
    tn TEXT,
    tp TEXT,
    cod TEXT,
    ss TEXT,
    site_name TEXT,
    author TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
    is_synced INTEGER DEFAULT 0,
    UNIQUE(date, measurement_group, location)
  );
  CREATE TABLE IF NOT EXISTS sludge_photo_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    sludge_amount REAL,
    sludge_photo_path TEXT,
    sludge_photo_taken_at TEXT,
    certificate_photo_path TEXT,
    note TEXT,
    site_name TEXT,
    author TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_modified TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sludge_export_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    company_name TEXT,
    default_amount REAL DEFAULT 0,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS kit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kit_name TEXT NOT NULL,
    date DATE NOT NULL,
    purchase_amount REAL,
    usage_amount REAL,
    current_inventory REAL,
    site_name TEXT,
    author TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
    is_synced INTEGER DEFAULT 0,
    UNIQUE(kit_name, date)
  );
  CREATE TABLE IF NOT EXISTS facility_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    facility_name TEXT,
    content TEXT,
    company TEXT,
    price INTEGER,
    notes TEXT,
    site_name TEXT,
    author TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
    is_synced INTEGER DEFAULT 0
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
const requiredWaterIdentityColumns = ['measurement_group', 'measurement_order', 'source_type', 'source_label', 'qntech_project_id'];
const legacyWaterColumns = new Set(waterColumnInfo.map((item) => item.name));

const waterQualitySchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='water_quality'").get()?.sql || '';
const hasCorrectUniqueConstraint = waterQualitySchema.includes('UNIQUE(date, measurement_group, location)') || waterQualitySchema.includes('UNIQUE (date, measurement_group, location)');

const shouldRebuildWaterQuality = !hasCorrectUniqueConstraint || requiredWaterTextColumns.some((column) => {
  const info = waterColumnInfo.find((item) => item.name === column);
  return info && String(info.type || '').toUpperCase() !== 'TEXT';
}) || requiredWaterIdentityColumns.some((column) => !waterColumnInfo.some((item) => item.name === column));

if (shouldRebuildWaterQuality) {
  db.transaction(() => {
    const legacySelect = {
      site_name: legacyWaterColumns.has('site_name') ? 'site_name' : 'NULL',
      author: legacyWaterColumns.has('author') ? 'author' : 'NULL',
      created_at: legacyWaterColumns.has('created_at') ? 'created_at' : "datetime('now', 'localtime')",
      last_modified: legacyWaterColumns.has('last_modified') ? 'last_modified' : "datetime('now', 'localtime')",
      is_synced: legacyWaterColumns.has('is_synced') ? 'COALESCE(is_synced, 0)' : '0'
    };

    db.prepare('ALTER TABLE water_quality RENAME TO water_quality_old').run();
    db.exec(`
      CREATE TABLE water_quality (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date DATE NOT NULL,
        measurement_group TEXT NOT NULL DEFAULT '',
        measurement_order INTEGER DEFAULT 1,
        source_type TEXT DEFAULT 'manual',
        source_label TEXT,
        qntech_project_id TEXT,
        location TEXT,
        nh3_n TEXT,
        no3_n TEXT,
        po4_p TEXT,
        alkalinity TEXT,
        tn TEXT,
        tp TEXT,
        cod TEXT,
        ss TEXT,
        site_name TEXT,
        author TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
        is_synced INTEGER DEFAULT 0,
        UNIQUE(date, measurement_group, location)
      );
    `);
    db.prepare(`
      INSERT INTO water_quality (
        id, date, measurement_group, measurement_order, source_type, source_label, qntech_project_id,
        location, nh3_n, no3_n, po4_p, alkalinity, tn, tp, cod, ss,
        site_name, author, created_at, last_modified, is_synced
      )
      SELECT
        id,
        date,
        'legacy:' || date,
        1,
        'legacy',
        NULL,
        NULL,
        location,
        CAST(nh3_n AS TEXT),
        CAST(no3_n AS TEXT),
        CAST(po4_p AS TEXT),
        CAST(alkalinity AS TEXT),
        CAST(tn AS TEXT),
        CAST(tp AS TEXT),
        CAST(cod AS TEXT),
        CAST(ss AS TEXT),
        ${legacySelect.site_name},
        ${legacySelect.author},
        ${legacySelect.created_at},
        ${legacySelect.last_modified},
        ${legacySelect.is_synced}
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
  'qntech_photo_root', 'qntech_sample_mappings',
  'flow_option' // new column for flow mapping option
].forEach(col => {
  if (!settingsCols.includes(col)) {
    const type = col.includes('row') || col === 'flow_option' ? (col === 'flow_option' ? 'TEXT' : 'INTEGER') : 'TEXT';
    db.prepare(`ALTER TABLE app_settings ADD COLUMN ${col} ${type}`).run();
  }
});

const webAppCredentialCols = db.prepare("PRAGMA table_info(web_app_credentials)").all().map(c => c.name);
if (!webAppCredentialCols.includes('service_url')) {
  db.prepare('ALTER TABLE web_app_credentials ADD COLUMN service_url TEXT').run();
}

const sludgeCols = db.prepare("PRAGMA table_info(sludge_photo_logs)").all().map(c => c.name);
if (!sludgeCols.includes('sludge_photo_taken_at')) {
  db.prepare('ALTER TABLE sludge_photo_logs ADD COLUMN sludge_photo_taken_at TEXT').run();
}

// --- 슬러지 반출관리대장 기본설정 테이블 시드 ---
db.prepare(`
  INSERT OR IGNORE INTO sludge_export_settings (id, company_name, default_amount, updated_at)
  VALUES (1, '', 0, datetime('now', 'localtime'))
`).run();

// --- Seeds ---
db.prepare("INSERT OR IGNORE INTO app_settings (id, site_name) VALUES (1, '새 현장')").run();

const settingsExists = db.prepare('SELECT id FROM app_settings WHERE id = 1').get();
if (!settingsExists) {
  db.prepare(`INSERT INTO app_settings (id, site_name, manager_name, method, series) VALUES (1, '오수처리장', '관리자', 'A2O', '1계열')`).run();
}

db.prepare(`
  UPDATE app_settings
  SET qntech_photo_root = COALESCE(NULLIF(qntech_photo_root, ''), ?),
      qntech_sample_mappings = COALESCE(NULLIF(qntech_sample_mappings, ''), '[]')
  WHERE id = 1
`).run(DEFAULT_QNTECH_PHOTO_ROOT);

migrateLegacyQntechPhotoRoot(db);

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

// --- Sync Columns Migration (BigQuery Synchronization) ---
// 동기화 대상 테이블 목록
const syncTables = ['flow_readings', 'medicine_logs', 'water_quality', 'kit_logs', 'facility_logs'];
const syncDefaults = db.prepare('SELECT site_name, manager_name FROM app_settings WHERE id = 1').get() || {};
const defaultSiteName = syncDefaults.site_name || 'Unknown Site';
const defaultAuthor = syncDefaults.manager_name || 'Unknown Author';

syncTables.forEach(tableName => {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all().map(c => c.name);

  if (!cols.includes('site_name')) {
    console.log(`Adding 'site_name' column to ${tableName}`);
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN site_name TEXT`).run();
  }

  if (!cols.includes('author')) {
    console.log(`Adding 'author' column to ${tableName}`);
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN author TEXT`).run();
  }

  if (!cols.includes('is_synced')) {
    console.log(`Adding 'is_synced' column to ${tableName}`);
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN is_synced INTEGER DEFAULT 0`).run();
    // 기존 데이터는 모두 미동기화(0) 상태로 초기화하여 최초 동기화 유도
    db.prepare(`UPDATE ${tableName} SET is_synced = 0`).run();
  }

  if (!cols.includes('last_modified')) {
    console.log(`Adding 'last_modified' column to ${tableName}`);
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN last_modified TEXT`).run();
    // 기존 데이터의 수정 시각을 현재 시간으로 초기화
    db.prepare(`UPDATE ${tableName} SET last_modified = datetime('now', 'localtime') WHERE last_modified IS NULL`).run();
  }

  if (!cols.includes('created_at')) {
    console.log(`Adding 'created_at' column to ${tableName}`);
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN created_at TEXT`).run();
  }

  db.prepare(`
    UPDATE ${tableName}
    SET
      site_name = COALESCE(NULLIF(site_name, ''), ?),
      author = COALESCE(NULLIF(author, ''), ?),
      is_synced = COALESCE(is_synced, 0),
      last_modified = COALESCE(last_modified, datetime('now', 'localtime')),
      created_at = COALESCE(created_at, last_modified, datetime('now', 'localtime'))
  `).run(defaultSiteName, defaultAuthor);
});

// attendance 테이블은 이미 is_synced가 있으므로 last_modified만 확인
const attendanceSyncCols = db.prepare("PRAGMA table_info(attendance)").all().map(c => c.name);
if (!attendanceSyncCols.includes('last_modified')) {
  db.prepare('ALTER TABLE attendance ADD COLUMN last_modified TEXT').run();
  db.prepare("UPDATE attendance SET last_modified = datetime('now', 'localtime') WHERE last_modified IS NULL").run();
}

// --- Facility Logs: location 컬럼 추가 ---
const facilityCols = db.prepare("PRAGMA table_info(facility_logs)").all().map(c => c.name);
if (!facilityCols.includes('location')) {
  db.prepare('ALTER TABLE facility_logs ADD COLUMN location TEXT').run();
}

// --- Config Items: default_amount 컬럼 추가 ---
const configItemsCols = db.prepare("PRAGMA table_info(config_items)").all().map(c => c.name);
if (!configItemsCols.includes('default_amount')) {
  db.prepare('ALTER TABLE config_items ADD COLUMN default_amount REAL DEFAULT 0').run();
}

// --- photo_url 마이그레이션 (medicine_logs, kit_logs) ---
const photoTables = ['medicine_logs', 'kit_logs'];
photoTables.forEach(tableName => {
  const tCols = db.prepare(`PRAGMA table_info(${tableName})`).all().map(c => c.name);
  if (!tCols.includes('photo_url')) {
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN photo_url TEXT`).run();
  }
});

// --- site_id 마이그레이션 (휴게소별 고유 식별자) ---
// app_settings 에 site_id 컬럼 추가 및 UUID 시드
const appSettingsCols = db.prepare("PRAGMA table_info(app_settings)").all().map(c => c.name);
if (!appSettingsCols.includes('site_id')) {
  db.prepare('ALTER TABLE app_settings ADD COLUMN site_id TEXT').run();
}
db.prepare("UPDATE app_settings SET site_id = ? WHERE id = 1 AND (site_id IS NULL OR TRIM(site_id) = '')").run(crypto.randomUUID());

// 5개 동기화 테이블에 site_id 추가 및 기존 데이터 백필
const currentSiteId = db.prepare('SELECT site_id FROM app_settings WHERE id = 1').get()?.site_id || null;
syncTables.forEach(tableName => {
  const tCols = db.prepare(`PRAGMA table_info(${tableName})`).all().map(c => c.name);
  if (!tCols.includes('site_id')) {
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN site_id TEXT`).run();
    if (currentSiteId) {
      db.prepare(`UPDATE ${tableName} SET site_id = ? WHERE site_id IS NULL`).run(currentSiteId);
    }
  }
});

console.log('Database migration check complete.');

module.exports = { db, appDataPath };
