'use strict';

const assert = require('assert');
const express = require('express');
const Database = require('better-sqlite3');
const { ensureSiteDataIsolation } = require('../server/services/siteDataIsolationMigrationService.cjs');
const { createSiteContextMiddleware } = require('../server/middleware/siteContext.cjs');

async function main() {
  const db = new Database(':memory:');
  let server;
  try {
    db.exec(`
      CREATE TABLE sites (
        id TEXT PRIMARY KEY, site_name TEXT NOT NULL, manager_name TEXT,
        is_active INTEGER DEFAULT 1
      );
      INSERT INTO sites VALUES ('site-a', '테스트휴게소(동쪽방향)', '관리자', 1);
      INSERT INTO sites VALUES ('site-b', '테스트휴게소(서쪽방향)', '관리자', 1);
      CREATE TABLE app_settings (
        id INTEGER PRIMARY KEY, site_id TEXT, site_name TEXT, manager_name TEXT,
        multi_site_enabled INTEGER, primary_site_id TEXT, secondary_site_id TEXT
      );
      INSERT INTO app_settings VALUES (
        1, 'site-a', '테스트휴게소(동쪽방향)', '관리자', 1, 'site-a', 'site-b'
      );
      CREATE TABLE flow_readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, type TEXT NOT NULL,
        raw_value REAL, calculated_flow REAL, site_id TEXT, UNIQUE(date, type)
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
    `);
    ensureSiteDataIsolation(db);

    const app = express();
    app.use(express.json());
    app.use(createSiteContextMiddleware(db));
    app.use(require('../server/routes/flowRoutes.cjs')(db));
    app.use(require('../server/routes/medicineRoutes.cjs')(db));
    app.use(require('../server/routes/kitRoutes.cjs')(db));
    server = await new Promise((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const request = async (siteId, path, body) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          'content-type': 'application/json',
          'x-osoo-site-id': siteId,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json();
      assert.ok(response.ok, JSON.stringify(data));
      return data;
    };

    for (const [siteId, raw] of [['site-a', 100], ['site-b', 900]]) {
      await request(siteId, '/api/flows/bulk', {
        date: '2026-07-24',
        items: [{ type: '유입유량계', raw_value: raw, calculated_flow: raw }],
      });
      await request(siteId, '/api/medicines/bulk', {
        items: [{ medicine_name: '포도당', date: '2026-07-24', purchase_amount: raw, usage_amount: 0, current_inventory: raw }],
      });
      await request(siteId, '/api/kits/bulk', {
        items: [{ kit_name: '암모니아', date: '2026-07-24', purchase_amount: raw, usage_amount: 0, current_inventory: raw }],
      });
    }

    const flowA = await request('site-a', '/api/flows?date=2026-07-24');
    const flowB = await request('site-b', '/api/flows?date=2026-07-24');
    assert.strictEqual(flowA.length, 1);
    assert.strictEqual(flowB.length, 1);
    assert.strictEqual(flowA[0].raw_value, 100);
    assert.strictEqual(flowB[0].raw_value, 900);
    assert.strictEqual(db.prepare("SELECT COUNT(*) count FROM medicine_logs WHERE date='2026-07-24'").get().count, 2);
    assert.strictEqual(db.prepare("SELECT COUNT(*) count FROM kit_logs WHERE date='2026-07-24'").get().count, 2);

    const denied = await fetch(`${baseUrl}/api/flows?date=2026-07-24`, {
      headers: { 'x-osoo-site-id': 'site-c' },
    });
    assert.strictEqual(denied.status, 403);
    console.log('✓ 양방향 창별 유량·약품·키트 HTTP 저장 및 조회 분리 검증 통과');
    console.log('✓ 허용되지 않은 site_id 요청 차단 검증 통과');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
