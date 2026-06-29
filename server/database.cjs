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
    input_status TEXT DEFAULT 'manual',
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
    input_status TEXT DEFAULT 'manual',
    site_name TEXT,
    author TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
    is_synced INTEGER DEFAULT 0,
    UNIQUE(medicine_name, date)
  );
  CREATE TABLE IF NOT EXISTS water_quality (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uploaded_at TEXT,
    report_date DATE NOT NULL,
    category TEXT,
    site_name TEXT,
    site_name_raw TEXT,
    bod REAL,
    ss REAL,
    tn REAL,
    tp REAL,
    mlss REAL,
    total_coliform REAL,
    drive_file_name TEXT,
    source_pdf_name TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
    is_synced INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS qntech_water_quality (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    site_id TEXT,
    site_name TEXT,
    measurement_group TEXT NOT NULL DEFAULT '',
    measurement_order INTEGER DEFAULT 1,
    source_type TEXT DEFAULT 'manual',
    input_status TEXT DEFAULT 'manual',
    source_label TEXT,
    qntech_project_id TEXT,
    location TEXT,
    item_name TEXT NOT NULL,
    item_code TEXT NOT NULL,
    result_value TEXT,
    result_numeric REAL,
    unit TEXT,
    author TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
    is_synced INTEGER DEFAULT 0,
    UNIQUE(date, measurement_group, location, item_code)
  );
  CREATE TABLE IF NOT EXISTS operation_status_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    site_id TEXT,
    site_name TEXT,
    ph REAL,
    do_value REAL,
    svi REAL,
    author TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date, site_id)
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
    input_status TEXT DEFAULT 'manual',
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
  CREATE TABLE IF NOT EXISTS app_diagnostic_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    level TEXT DEFAULT 'info',
    area TEXT,
    action TEXT,
    result TEXT,
    message TEXT,
    details_json TEXT,
    site_id TEXT,
    site_name TEXT,
    app_version TEXT,
    uploaded_at TEXT,
    drive_file_id TEXT,
    drive_web_view_link TEXT,
    upload_attempts INTEGER DEFAULT 0,
    upload_error TEXT
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
    qntech_sample_mappings TEXT,
    qntech_site_id TEXT
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
    site_name1 TEXT,
    phone TEXT,
    target_lat REAL,
    target_lng REAL,
    radius_m REAL DEFAULT 500,
    notes TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,
    site_name TEXT NOT NULL UNIQUE,
    manager_name TEXT,
    method TEXT,
    series TEXT,
    target_lat REAL,
    target_lng REAL,
    radius_m REAL DEFAULT 500,
    qntech_site_id TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS member_sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    is_primary INTEGER DEFAULT 0,
    can_manage INTEGER DEFAULT 1,
    is_bidirectional INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(member_id, site_id)
  );
  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id TEXT NOT NULL,
    member_name TEXT NOT NULL,
    site_id TEXT,
    site_name TEXT,
    date DATE NOT NULL,
    login_time TEXT,
    logout_time TEXT,
    location_matched BOOLEAN DEFAULT 0,
    remote_session_detected BOOLEAN DEFAULT 0,
    remote_session_type TEXT,
    remote_session_evidence TEXT,
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
if (!attendanceCols.includes('site_id')) {
  db.prepare('ALTER TABLE attendance ADD COLUMN site_id TEXT').run();
}
if (!attendanceCols.includes('site_name')) {
  db.prepare('ALTER TABLE attendance ADD COLUMN site_name TEXT').run();
}
if (!attendanceCols.includes('location_matched')) {
  db.prepare('ALTER TABLE attendance ADD COLUMN location_matched BOOLEAN DEFAULT 0').run();
}
if (!attendanceCols.includes('remote_session_detected')) {
  db.prepare('ALTER TABLE attendance ADD COLUMN remote_session_detected BOOLEAN DEFAULT 0').run();
}
if (!attendanceCols.includes('remote_session_type')) {
  db.prepare('ALTER TABLE attendance ADD COLUMN remote_session_type TEXT').run();
}
if (!attendanceCols.includes('remote_session_evidence')) {
  db.prepare('ALTER TABLE attendance ADD COLUMN remote_session_evidence TEXT').run();
}
if (!attendanceCols.includes('auto_logout')) {
  db.prepare('ALTER TABLE attendance ADD COLUMN auto_logout BOOLEAN DEFAULT 0').run();
}
if (!attendanceCols.includes('is_synced')) {
  db.prepare('ALTER TABLE attendance ADD COLUMN is_synced BOOLEAN DEFAULT 0').run();
}

const membersCols = db.prepare("PRAGMA table_info(members)").all().map(c => c.name);
if (!membersCols.includes('site_name1')) db.prepare('ALTER TABLE members ADD COLUMN site_name1 TEXT').run();
if (!membersCols.includes('phone')) db.prepare('ALTER TABLE members ADD COLUMN phone TEXT').run();
if (!membersCols.includes('target_lat')) db.prepare('ALTER TABLE members ADD COLUMN target_lat REAL').run();
if (!membersCols.includes('target_lng')) db.prepare('ALTER TABLE members ADD COLUMN target_lng REAL').run();
if (!membersCols.includes('radius_m')) db.prepare('ALTER TABLE members ADD COLUMN radius_m REAL DEFAULT 500').run();
if (!membersCols.includes('notes')) db.prepare('ALTER TABLE members ADD COLUMN notes TEXT').run();
if (!membersCols.includes('updated_at')) db.prepare('ALTER TABLE members ADD COLUMN updated_at TEXT').run();
db.prepare("UPDATE members SET radius_m = COALESCE(radius_m, 500), updated_at = COALESCE(updated_at, datetime('now', 'localtime'))").run();

const sitesCols = db.prepare("PRAGMA table_info(sites)").all().map(c => c.name);
if (!sitesCols.includes('target_lat')) db.prepare('ALTER TABLE sites ADD COLUMN target_lat REAL').run();
if (!sitesCols.includes('target_lng')) db.prepare('ALTER TABLE sites ADD COLUMN target_lng REAL').run();
if (!sitesCols.includes('radius_m')) db.prepare('ALTER TABLE sites ADD COLUMN radius_m REAL DEFAULT 500').run();
if (!sitesCols.includes('qntech_site_id')) db.prepare('ALTER TABLE sites ADD COLUMN qntech_site_id TEXT').run();
db.prepare("UPDATE sites SET radius_m = COALESCE(radius_m, 500)").run();

const sludgePhotoCols = db.prepare("PRAGMA table_info(sludge_photo_logs)").all().map(c => c.name);
if (!sludgePhotoCols.includes('site_id')) {
  db.prepare('ALTER TABLE sludge_photo_logs ADD COLUMN site_id TEXT').run();
}

function ensureColumn(tableName, columnName, definition) {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all().map((c) => c.name);
  if (!cols.includes(columnName)) {
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
  }
}

function createCertificateWaterQualityTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS water_quality (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uploaded_at TEXT,
      report_date DATE NOT NULL,
      category TEXT,
      site_name TEXT,
      site_name_raw TEXT,
      bod REAL,
      ss REAL,
      tn REAL,
      tp REAL,
      mlss REAL,
      total_coliform REAL,
      drive_file_name TEXT,
      source_pdf_name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
      is_synced INTEGER DEFAULT 0
    );
  `);
}

function normalizeLegacyQntechValueExpression(columnName) {
  return `CASE WHEN ${columnName} IN ('-1', '-1.0', '-1.00') THEN '초과' ELSE CAST(${columnName} AS TEXT) END`;
}

function migrateLegacyWaterQualitySchema() {
  const waterColumnInfo = db.prepare("PRAGMA table_info(water_quality)").all();
  const waterColumnNames = waterColumnInfo.map((item) => item.name);
  const needsLegacyMigration = waterColumnNames.some((name) => [
    'items', 'results', 'do', 'ph', 'source_page_index', 'ai_confidence', 'site_match_confidence',
    'manual_review_required', 'warnings_json', 'source_payload_json', 'certificate_category',
    'certificate_file_name', 'certificate_original_file_name', 'drive_file_id', 'drive_web_view_link'
  ].includes(name));

  if (!needsLegacyMigration) return;

  const backupTableName = `water_quality_legacy_backup_${Date.now()}`;
  db.exec(`ALTER TABLE water_quality RENAME TO ${backupTableName}`);
  createCertificateWaterQualityTable();
  db.exec(`
    INSERT INTO water_quality (
      id, uploaded_at, report_date, category, site_name, site_name_raw,
      bod, ss, tn, tp, mlss, total_coliform, drive_file_name, source_pdf_name,
      created_at, last_modified, is_synced
    )
    SELECT
      id,
      created_at AS uploaded_at,
      report_date,
      COALESCE(certificate_category, json_extract(source_payload_json, '$.certificate_file.category')) AS category,
      site_name,
      site_name_raw,
      bod,
      ss,
      tn,
      tp,
      mlss,
      total_coliform,
      COALESCE(certificate_file_name, json_extract(source_payload_json, '$.certificate_file.file_name')) AS drive_file_name,
      source_pdf_name,
      created_at,
      last_modified,
      is_synced
    FROM ${backupTableName}
  `);
  db.exec(`DROP TABLE ${backupTableName}`);
}

migrateLegacyWaterQualitySchema();

const waterColumnInfo = db.prepare("PRAGMA table_info(water_quality)").all();
const waterColumnNames = waterColumnInfo.map((item) => item.name);
const hasOperationalWaterColumns = waterColumnNames.includes('measurement_group') || waterColumnNames.includes('nh3_n');

if (hasOperationalWaterColumns) {
  db.transaction(() => {
    const selectOrNull = (columnName) => waterColumnNames.includes(columnName) ? columnName : 'NULL';
    const selectOrDefault = (columnName, fallback) => waterColumnNames.includes(columnName) ? columnName : fallback;
    const itemMappings = [
      ['암모니아성질소(NH3-N)', 'nh3_n', 'mg/L'],
      ['질산성질소(NO3-N)', 'no3_n', 'mg/L'],
      ['인산염인(PO4-P)', 'po4_p', 'mg/L'],
      ['알칼리도(ALK)', 'alkalinity', 'mg/L'],
      ['TN', 'tn', 'mg/L'],
      ['TP', 'tp', 'mg/L'],
      ['COD', 'cod', 'mg/L'],
      ['SS', 'ss', 'mg/L'],
    ].filter(([, columnName]) => waterColumnNames.includes(columnName));

    const insertLegacy = db.prepare(`
      INSERT INTO qntech_water_quality (
        date, site_id, site_name, measurement_group, measurement_order, source_type, source_label,
        qntech_project_id, location, item_name, item_code, result_value, result_numeric, unit,
        author, created_at, last_modified, is_synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date, measurement_group, location, item_code) DO UPDATE SET
        measurement_order = excluded.measurement_order,
        source_type = excluded.source_type,
        source_label = excluded.source_label,
        qntech_project_id = excluded.qntech_project_id,
        result_value = excluded.result_value,
        result_numeric = excluded.result_numeric,
        unit = excluded.unit,
        site_id = excluded.site_id,
        site_name = excluded.site_name,
        author = excluded.author,
        last_modified = excluded.last_modified,
        is_synced = excluded.is_synced
    `);

    const rows = db.prepare(`
      SELECT
        ${selectOrDefault('date', "''")} AS date,
        ${selectOrNull('site_id')} AS site_id,
        ${selectOrNull('site_name')} AS site_name,
        ${selectOrDefault('measurement_group', "''")} AS measurement_group,
        ${selectOrDefault('measurement_order', '1')} AS measurement_order,
        ${selectOrDefault('source_type', "'legacy'")} AS source_type,
        ${selectOrNull('source_label')} AS source_label,
        ${selectOrNull('qntech_project_id')} AS qntech_project_id,
        ${selectOrDefault('location', "'기본'")} AS location,
        ${itemMappings.map(([, columnName]) => `${normalizeLegacyQntechValueExpression(columnName)} AS ${columnName}`).join(', ')},
        ${selectOrNull('author')} AS author,
        ${selectOrDefault('created_at', "datetime('now', 'localtime')")} AS created_at,
        ${selectOrDefault('last_modified', "datetime('now', 'localtime')")} AS last_modified,
        ${selectOrDefault('is_synced', '0')} AS is_synced
      FROM water_quality
    `).all();

    for (const row of rows) {
      if (!row.date) continue;
      const measurementGroup = row.measurement_group || `legacy:${row.date}`;
      for (const [itemName, itemCode, unit] of itemMappings) {
        const value = row[itemCode];
        if (value === null || value === undefined || value === '') continue;
        const numeric = Number(value);
        insertLegacy.run(
          row.date,
          row.site_id || null,
          row.site_name || null,
          measurementGroup,
          Number(row.measurement_order) || 1,
          row.source_type || 'legacy',
          row.source_label || null,
          row.qntech_project_id || null,
          row.location || '기본',
          itemName,
          itemCode,
          String(value),
          Number.isFinite(numeric) ? numeric : null,
          unit,
          row.author || null,
          row.created_at || new Date().toISOString(),
          row.last_modified || new Date().toISOString(),
          0
        );
      }
    }

    db.prepare('DROP TABLE IF EXISTS water_quality_operational_legacy').run();
    db.prepare('ALTER TABLE water_quality RENAME TO water_quality_operational_legacy').run();
    createCertificateWaterQualityTable();
  })();
}

[
  ['uploaded_at', 'TEXT'],
  ['category', 'TEXT'],
  ['site_name', 'TEXT'],
  ['site_name_raw', 'TEXT'],
  ['bod', 'REAL'],
  ['ss', 'REAL'],
  ['tn', 'REAL'],
  ['tp', 'REAL'],
  ['mlss', 'REAL'],
  ['total_coliform', 'REAL'],
  ['drive_file_name', 'TEXT'],
  ['source_pdf_name', 'TEXT'],
  ['created_at', 'TEXT'],
  ['last_modified', 'TEXT'],
  ['is_synced', 'INTEGER DEFAULT 0'],
].forEach(([columnName, definition]) => ensureColumn('water_quality', columnName, definition));

const settingsCols = db.prepare("PRAGMA table_info(app_settings)").all().map(c => c.name);
[
  'flow_sheet', 'flow_start_row', 'flow_end_row', 'flow_date_col',
  'med_sheet', 'med_start_row', 'med_end_row', 'med_date_col',
  'water_sheet', 'water_start_row', 'water_end_row', 'water_date_col',
  'kit_sheet', 'kit_start_row', 'kit_end_row', 'kit_date_col',
  'qntech_photo_root', 'qntech_sample_mappings',
  'qntech_site_id',
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
// 신규 설치 시 현장 미확정 상태를 유지하기 위해 site_name을 빈 문자열로 시드한다.
db.prepare("INSERT OR IGNORE INTO app_settings (id, site_name) VALUES (1, '')").run();

const settingsExists = db.prepare('SELECT id FROM app_settings WHERE id = 1').get();
if (!settingsExists) {
  db.prepare(`INSERT INTO app_settings (id, site_name, manager_name, method, series) VALUES (1, '', '', 'A2O', '1계열')`).run();
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
db.prepare("INSERT OR IGNORE INTO web_app_credentials (service_key, service_name, service_url, user_id, password) VALUES ('gemini_api', 'Gemini API 설정', '', '', '')").run();

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

db.prepare(`
  UPDATE web_app_credentials
  SET user_id = COALESCE(user_id, ''),
      password = COALESCE(password, '')
  WHERE service_key IN ('road_web', 'water_analysis_app', 'gemini_api')
`).run();

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

// 각 설정 위젯의 기본항목은 신규 DB 생성 시 로컬 DB에 시드한다.
// 기존 DB에서는 누락된 기본항목만 보충하며 사용자 추가항목과 활성 상태는 보존한다.
const defaultConfigItems = {
  flow: ['유입유량계', '방류유량계', '내부반송유량계', '외부반송유량계', '전력량계', '슬러지'],
  medicine: ['중탄산나트륨', '포도당', '팩(PAC)'],
  water: ['암모니아성질소', '질산성질소', '인산염인', '알칼리도'],
  kit: ['암모니아성질소(NH3-N)', '질산성질소(NO3-N)', '인산염인(PO4-P)', '알칼리도(ALK)'],
  location: ['유량조정조', '무산소조', '포기조', '침전조', '방류조'],
};
const seedConfigItem = db.prepare(`
  INSERT OR IGNORE INTO config_items (category, item_name, is_active, display_order)
  VALUES (?, ?, 1, ?)
`);
db.transaction(() => {
  Object.entries(defaultConfigItems).forEach(([category, names]) => {
    names.forEach((name, index) => seedConfigItem.run(category, name, index));
  });
})();

// --- Sync Columns Migration (BigQuery Synchronization) ---
// 동기화 대상 테이블 목록
const syncTables = ['flow_readings', 'medicine_logs', 'water_quality', 'qntech_water_quality', 'kit_logs', 'facility_logs'];
const inputStatusTables = ['flow_readings', 'medicine_logs', 'qntech_water_quality', 'kit_logs'];
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
  }
  if (!cols.includes('last_modified')) {
    console.log(`Adding 'last_modified' column to ${tableName}`);
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN last_modified TEXT`).run();
  }
  if (!cols.includes('created_at')) {
    console.log(`Adding 'created_at' column to ${tableName}`);
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN created_at TEXT`).run();
  }

  const updatedCols = db.prepare(`PRAGMA table_info(${tableName})`).all().map(c => c.name);
  if (!updatedCols.includes('site_name') || !updatedCols.includes('author')) {
    return;
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

inputStatusTables.forEach(tableName => {
  ensureColumn(tableName, 'input_status', "TEXT DEFAULT 'manual'");
  db.prepare(`
    UPDATE ${tableName}
    SET input_status = COALESCE(NULLIF(input_status, ''), 'manual')
  `).run();
});

ensureColumn('app_diagnostic_logs', 'site_id', 'TEXT');
ensureColumn('app_diagnostic_logs', 'site_name', 'TEXT');
ensureColumn('app_diagnostic_logs', 'app_version', 'TEXT');
ensureColumn('app_diagnostic_logs', 'uploaded_at', 'TEXT');
ensureColumn('app_diagnostic_logs', 'drive_file_id', 'TEXT');
ensureColumn('app_diagnostic_logs', 'drive_web_view_link', 'TEXT');
ensureColumn('app_diagnostic_logs', 'upload_attempts', 'INTEGER DEFAULT 0');
ensureColumn('app_diagnostic_logs', 'upload_error', 'TEXT');
db.prepare('CREATE INDEX IF NOT EXISTS idx_app_diagnostic_logs_uploaded ON app_diagnostic_logs (uploaded_at, created_at)').run();

// attendance 테이블은 이미 is_synced가 있으므로 last_modified만 확인
const attendanceSyncCols = db.prepare("PRAGMA table_info(attendance)").all().map(c => c.name);
if (!attendanceSyncCols.includes('last_modified')) {
  db.prepare('ALTER TABLE attendance ADD COLUMN last_modified TEXT').run();
  db.prepare("UPDATE attendance SET last_modified = datetime('now', 'localtime') WHERE last_modified IS NULL").run();
}

const obsoleteAttendanceLocationCols = ['login_lat', 'login_lng', 'logout_lat', 'logout_lng'];
const currentAttendanceCols = db.prepare("PRAGMA table_info(attendance)").all().map(c => c.name);
if (obsoleteAttendanceLocationCols.some((column) => currentAttendanceCols.includes(column))) {
  db.exec(`
    DROP TABLE IF EXISTS attendance_compact;
    CREATE TABLE IF NOT EXISTS attendance_compact (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL,
      member_name TEXT NOT NULL,
      site_id TEXT,
      site_name TEXT,
      date DATE NOT NULL,
      login_time TEXT,
      logout_time TEXT,
      location_matched BOOLEAN DEFAULT 0,
      remote_session_detected BOOLEAN DEFAULT 0,
      remote_session_type TEXT,
      remote_session_evidence TEXT,
      auto_logout BOOLEAN DEFAULT 0,
      is_synced BOOLEAN DEFAULT 0,
      last_modified TEXT
    );
    INSERT INTO attendance_compact (
      id, member_id, member_name, site_id, site_name, date, login_time, logout_time,
      location_matched, remote_session_detected, remote_session_type, remote_session_evidence,
      auto_logout, is_synced, last_modified
    )
    SELECT
      id, COALESCE(member_id, ''), COALESCE(member_name, ''), site_id, site_name, date, login_time, logout_time,
      location_matched, remote_session_detected, remote_session_type, remote_session_evidence,
      auto_logout, is_synced, last_modified
    FROM attendance;
    DROP TABLE attendance;
    ALTER TABLE attendance_compact RENAME TO attendance;
  `);
}

// --- 현장/회원 기준 테이블 인덱스 및 백필 ---
db.prepare('CREATE INDEX IF NOT EXISTS idx_sites_active_name ON sites (is_active, site_name)').run();
db.prepare('CREATE INDEX IF NOT EXISTS idx_member_sites_member ON member_sites (member_id)').run();
db.prepare('CREATE INDEX IF NOT EXISTS idx_member_sites_site ON member_sites (site_id)').run();
db.prepare('CREATE INDEX IF NOT EXISTS idx_member_sites_primary ON member_sites (member_id, is_primary)').run();
db.prepare('CREATE INDEX IF NOT EXISTS idx_attendance_site_date ON attendance (site_id, date)').run();
db.prepare('CREATE INDEX IF NOT EXISTS idx_attendance_member_date ON attendance (member_id, date)').run();
db.prepare('CREATE INDEX IF NOT EXISTS idx_sludge_photo_logs_site_date ON sludge_photo_logs (site_id, date)').run();

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
// app_settings 에 site_id 컬럼 추가
const appSettingsCols = db.prepare("PRAGMA table_info(app_settings)").all().map(c => c.name);
if (!appSettingsCols.includes('site_id')) {
  db.prepare('ALTER TABLE app_settings ADD COLUMN site_id TEXT').run();
}
// 신규 설치 시 site_id는 빈 상태(NULL)로 유지한다.
// 실제 현장이 설정된 기존 DB에서만 빈 site_id에 UUID를 부여한다.
const siteNameForIdCheck = db.prepare('SELECT site_name FROM app_settings WHERE id = 1').get();
const hasRealSiteName = Boolean(
  siteNameForIdCheck?.site_name
  && String(siteNameForIdCheck.site_name).trim() !== ''
  && String(siteNameForIdCheck.site_name).trim() !== '새 현장'
);
if (hasRealSiteName) {
  db.prepare("UPDATE app_settings SET site_id = ? WHERE id = 1 AND (site_id IS NULL OR TRIM(site_id) = '')").run(crypto.randomUUID());
}

// app_settings의 기본 현장 정보 → sites 테이블 마이그레이션 (실제 현장 설정이 있는 경우만)
const settingsSeed = db.prepare('SELECT site_id, site_name, manager_name, method, series FROM app_settings WHERE id = 1').get();
const hasSeedSiteId = Boolean(settingsSeed?.site_id && String(settingsSeed.site_id).trim());
if (hasSeedSiteId && hasRealSiteName) {
  db.prepare(`
    INSERT INTO sites (id, site_name, manager_name, method, series, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, datetime('now', 'localtime'), datetime('now', 'localtime'))
    ON CONFLICT(id) DO UPDATE SET
      site_name = excluded.site_name,
      manager_name = excluded.manager_name,
      method = excluded.method,
      series = excluded.series,
      updated_at = datetime('now', 'localtime')
  `).run(settingsSeed.site_id, settingsSeed.site_name || '', settingsSeed.manager_name || '', settingsSeed.method || 'A2O', settingsSeed.series || '1계열');

  db.prepare('UPDATE attendance SET site_id = COALESCE(site_id, ?)').run(settingsSeed.site_id);
  db.prepare('UPDATE attendance SET site_name = COALESCE(NULLIF(site_name, \'\'), ?)').run(settingsSeed.site_name || '');
  db.prepare('UPDATE sludge_photo_logs SET site_id = COALESCE(site_id, ?)').run(settingsSeed.site_id);
}

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

// 로그성 테이블 site_id + date 조회 인덱스 (다중현장 전환 대비)
db.prepare('CREATE INDEX IF NOT EXISTS idx_flow_readings_site_date ON flow_readings (site_id, date)').run();
db.prepare('CREATE INDEX IF NOT EXISTS idx_medicine_logs_site_date ON medicine_logs (site_id, date)').run();
db.prepare('CREATE INDEX IF NOT EXISTS idx_water_quality_site_date ON water_quality (site_id, report_date)').run();
db.prepare('CREATE INDEX IF NOT EXISTS idx_qntech_water_quality_site_date ON qntech_water_quality (site_id, date)').run();
db.prepare('CREATE INDEX IF NOT EXISTS idx_kit_logs_site_date ON kit_logs (site_id, date)').run();
db.prepare('CREATE INDEX IF NOT EXISTS idx_facility_logs_site_date ON facility_logs (site_id, date)').run();
db.prepare('CREATE INDEX IF NOT EXISTS idx_operation_status_logs_site_date ON operation_status_logs (site_id, date)').run();

// site_id 백필: 기존 데이터가 있으면 app_settings.site_id로 채움
if (currentSiteId) {
  db.prepare('UPDATE flow_readings SET site_id = ? WHERE site_id IS NULL OR TRIM(site_id) = \'\'').run(currentSiteId);
  db.prepare('UPDATE medicine_logs SET site_id = ? WHERE site_id IS NULL OR TRIM(site_id) = \'\'').run(currentSiteId);
  db.prepare('UPDATE qntech_water_quality SET site_id = ? WHERE site_id IS NULL OR TRIM(site_id) = \'\'').run(currentSiteId);
  db.prepare('UPDATE kit_logs SET site_id = ? WHERE site_id IS NULL OR TRIM(site_id) = \'\'').run(currentSiteId);
  db.prepare('UPDATE facility_logs SET site_id = ? WHERE site_id IS NULL OR TRIM(site_id) = \'\'').run(currentSiteId);
  db.prepare('UPDATE operation_status_logs SET site_id = ? WHERE site_id IS NULL OR TRIM(site_id) = \'\'').run(currentSiteId);
  db.prepare('UPDATE sludge_photo_logs SET site_id = ? WHERE site_id IS NULL OR TRIM(site_id) = \'\'').run(currentSiteId);
  db.prepare('UPDATE attendance SET site_id = ? WHERE site_id IS NULL OR TRIM(site_id) = \'\'').run(currentSiteId);
}

console.log('Database migration check complete.');

module.exports = { db, appDataPath };
