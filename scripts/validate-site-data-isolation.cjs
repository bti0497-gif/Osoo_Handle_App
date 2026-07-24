'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const { ensureSiteDataIsolation } = require('../server/services/siteDataIsolationMigrationService.cjs');

const db = new Database(':memory:');
try {
  db.exec(`
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, site_id TEXT);
    INSERT INTO app_settings VALUES (1, 'site-a');
    CREATE TABLE flow_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, type TEXT NOT NULL,
      raw_value REAL, calculated_flow REAL, site_id TEXT, site_name TEXT,
      UNIQUE(date, type)
    );
    CREATE TABLE medicine_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, medicine_name TEXT NOT NULL, date TEXT NOT NULL,
      purchase_amount REAL, usage_amount REAL, current_inventory REAL, site_id TEXT,
      UNIQUE(medicine_name, date)
    );
    CREATE TABLE kit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kit_name TEXT NOT NULL, date TEXT NOT NULL,
      purchase_amount REAL, usage_amount REAL, current_inventory REAL, site_id TEXT,
      UNIQUE(kit_name, date)
    );
    CREATE TABLE qntech_water_quality (
      id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, site_id TEXT,
      measurement_group TEXT NOT NULL DEFAULT '', location TEXT, item_name TEXT NOT NULL,
      item_code TEXT NOT NULL, UNIQUE(date, measurement_group, location, item_code)
    );
    CREATE TABLE sludge_photo_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL UNIQUE, site_id TEXT
    );
    CREATE TABLE work_records (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL);
    INSERT INTO flow_readings (date, type, raw_value) VALUES ('2026-07-24', '유입유량계', 10);
  `);

  const result = ensureSiteDataIsolation(db);
  assert.strictEqual(result.applied, true);
  assert.strictEqual(db.prepare('SELECT site_id FROM flow_readings').get().site_id, 'site-a');

  const insertFlow = db.prepare(`
    INSERT INTO flow_readings (date, type, raw_value, site_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(site_id, date, type) DO UPDATE SET raw_value = excluded.raw_value
  `);
  insertFlow.run('2026-07-24', '유입유량계', 20, 'site-b');
  insertFlow.run('2026-07-24', '유입유량계', 11, 'site-a');
  const rows = db.prepare(`
    SELECT site_id, raw_value FROM flow_readings
    WHERE date = '2026-07-24' AND type = '유입유량계'
    ORDER BY site_id
  `).all();
  assert.deepStrictEqual(rows, [
    { site_id: 'site-a', raw_value: 11 },
    { site_id: 'site-b', raw_value: 20 },
  ]);
  assert.ok(db.prepare('PRAGMA table_info(work_records)').all().some((column) => column.name === 'site_id'));
  assert.strictEqual(db.pragma('quick_check', { simple: true }), 'ok');
  console.log('✓ 동일 날짜·동일 항목의 양방향 현장 독립 저장 검증 통과');
  console.log('✓ 기존 단일현장 데이터 site_id 백필 및 SQLite quick_check 통과');
} finally {
  db.close();
}
