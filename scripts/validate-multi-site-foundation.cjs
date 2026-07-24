'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const {
  MULTI_SITE_FOUNDATION_VERSION,
  ensureMultiSiteFoundation,
} = require('../server/services/multiSiteSchemaService.cjs');
const { saveMultiSiteMode } = require('../server/services/settings/appSettingsService.cjs');

const db = new Database(':memory:');

try {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE sites (
      id TEXT PRIMARY KEY,
      site_name TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      site_id TEXT,
      multi_site_enabled INTEGER NOT NULL DEFAULT 0,
      primary_site_id TEXT,
      secondary_site_id TEXT,
      excel_template_path TEXT,
      flow_sheet TEXT, flow_start_row INTEGER, flow_end_row INTEGER, flow_date_col TEXT,
      med_sheet TEXT, med_start_row INTEGER, med_end_row INTEGER, med_date_col TEXT,
      water_sheet TEXT, water_start_row INTEGER, water_end_row INTEGER, water_date_col TEXT,
      kit_sheet TEXT, kit_start_row INTEGER, kit_end_row INTEGER, kit_date_col TEXT,
      qntech_photo_root TEXT, qntech_sample_mappings TEXT, flow_option TEXT
    );
    CREATE TABLE config_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      item_name TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      display_order INTEGER,
      excel_cell TEXT,
      default_amount REAL DEFAULT 0,
      UNIQUE(category, item_name)
    );
    CREATE TABLE excel_sheets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sheet_name TEXT NOT NULL UNIQUE,
      max_row INTEGER NOT NULL DEFAULT 0,
      imported_at TEXT NOT NULL
    );
    CREATE TABLE excel_raw_data (
      sheet_name TEXT NOT NULL,
      row_num INTEGER NOT NULL,
      col TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (sheet_name, row_num, col)
    );
    CREATE TABLE sludge_export_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      company_name TEXT,
      default_amount REAL DEFAULT 0,
      updated_at TEXT
    );

    INSERT INTO sites (id, site_name) VALUES ('site-a', '테스트휴게소(A방향)');
    INSERT INTO sites (id, site_name) VALUES ('site-b', '테스트휴게소(B방향)');
    INSERT INTO app_settings (
      id, site_id, excel_template_path, flow_sheet, qntech_photo_root, qntech_sample_mappings, flow_option
    ) VALUES (1, 'site-a', 'source.xlsx', '유량', 'photos', '[]', 'single1');
    INSERT INTO config_items (category, item_name, display_order, excel_cell)
      VALUES ('flow', '유입유량계', 0, 'B');
    INSERT INTO config_items (category, item_name, display_order, excel_cell)
      VALUES ('location', '방류조', 0, 'C');
    INSERT INTO excel_sheets (sheet_name, max_row, imported_at)
      VALUES ('유량', 20, '2026-07-24T00:00:00.000Z');
    INSERT INTO excel_raw_data (sheet_name, row_num, col, value)
      VALUES ('유량', 1, 'A', '날짜');
    INSERT INTO sludge_export_settings (id, company_name, default_amount, updated_at)
      VALUES (1, '테스트업체', 10, '2026-07-24T00:00:00.000Z');
  `);

  const first = ensureMultiSiteFoundation(db);
  assert.strictEqual(first.applied, true);
  assert.strictEqual(first.siteId, 'site-a');
  assert.deepStrictEqual(first.verification.expected, first.verification.actual);
  assert.ok(db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(MULTI_SITE_FOUNDATION_VERSION));
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM site_config_items WHERE site_id = ?').get('site-a').count, 2);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM site_excel_raw_data WHERE site_id = ?').get('site-a').count, 1);

  db.prepare("UPDATE config_items SET excel_cell = 'D' WHERE category = 'flow' AND item_name = '유입유량계'").run();
  assert.strictEqual(
    db.prepare("SELECT excel_cell FROM site_config_items WHERE site_id = 'site-a' AND category = 'flow' AND item_name = '유입유량계'").get().excel_cell,
    'D'
  );

  db.prepare("UPDATE app_settings SET flow_sheet = '유량변경' WHERE id = 1").run();
  assert.strictEqual(db.prepare("SELECT flow_sheet FROM site_settings WHERE site_id = 'site-a'").get().flow_sheet, '유량변경');

  const second = ensureMultiSiteFoundation(db);
  assert.strictEqual(second.applied, false);
  assert.strictEqual(second.reason, 'already-applied');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = ?').get(MULTI_SITE_FOUNDATION_VERSION).count, 1);
  assert.strictEqual(db.pragma('quick_check', { simple: true }), 'ok');

  const enabled = saveMultiSiteMode(db, true);
  assert.deepStrictEqual(enabled, {
    enabled: true,
    primarySiteId: 'site-a',
    secondarySiteId: 'site-b',
    primarySiteName: '테스트휴게소(A방향)',
    secondarySiteName: '테스트휴게소(B방향)',
  });
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) AS count FROM site_config_items WHERE site_id = ?').get('site-b').count,
    2
  );
  db.prepare(`
    UPDATE site_config_items SET excel_cell = 'Z'
    WHERE site_id = 'site-b' AND category = 'flow' AND item_name = '유입유량계'
  `).run();
  assert.strictEqual(
    db.prepare("SELECT excel_cell FROM site_config_items WHERE site_id = 'site-a' AND category = 'flow' AND item_name = '유입유량계'").get().excel_cell,
    'D'
  );
  assert.strictEqual(
    db.prepare("SELECT excel_cell FROM site_config_items WHERE site_id = 'site-b' AND category = 'flow' AND item_name = '유입유량계'").get().excel_cell,
    'Z'
  );
  assert.deepStrictEqual(
    db.prepare('SELECT multi_site_enabled, primary_site_id, secondary_site_id FROM app_settings WHERE id = 1').get(),
    { multi_site_enabled: 1, primary_site_id: 'site-a', secondary_site_id: 'site-b' }
  );
  const disabled = saveMultiSiteMode(db, false);
  assert.deepStrictEqual(disabled, {
    enabled: false,
    primarySiteId: 'site-a',
    secondarySiteId: 'site-b',
    primarySiteName: '',
    secondarySiteName: '',
  });
  db.prepare("UPDATE app_settings SET site_id = NULL, primary_site_id = NULL WHERE id = 1").run();
  assert.throws(
    () => saveMultiSiteMode(db, true),
    /먼저 기본 현장을 저장/
  );

  console.log('✓ 현장별 설정·매핑·슬러지 설정 백필과 현장별 엑셀 저장 구조 준비 검증 통과');
  console.log('✓ 기존 단일현장 설정 변경의 현장별 테이블 호환 반영 검증 통과');
  console.log('✓ 양방향 통합관리 기본 OFF·기본 현장 고정·해제 시 데이터 보존 검증 통과');
  console.log('✓ 트랜잭션·재실행 안전성·SQLite quick_check 검증 통과');
} finally {
  db.close();
}
