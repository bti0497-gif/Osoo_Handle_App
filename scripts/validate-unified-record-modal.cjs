#!/usr/bin/env node

const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { recalculateInventoryCascade } = require('../server/services/inventoryCascadeService.cjs');

const TABLE_CONTRACTS = [
  { tableName: 'medicine_logs', nameColumn: 'medicine_name', itemName: 'medicine-a' },
  { tableName: 'kit_logs', nameColumn: 'kit_name', itemName: 'kit-a' },
];

const metadata = {
  siteId: 'contract-site',
  siteName: 'contract-site-name',
  author: 'contract-test',
  lastModified: '2026-07-10T00:00:00.000Z',
  isSynced: 0,
};

function createInventoryTable(db, tableName, nameColumn) {
  db.exec(`
    CREATE TABLE ${tableName} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ${nameColumn} TEXT NOT NULL,
      date TEXT NOT NULL,
      purchase_amount REAL DEFAULT 0,
      usage_amount REAL DEFAULT 0,
      current_inventory REAL,
      site_id TEXT,
      site_name TEXT,
      author TEXT,
      last_modified TEXT,
      is_synced INTEGER DEFAULT 0,
      UNIQUE(${nameColumn}, date)
    )
  `);
}

function seedInventoryRows(db, { tableName, nameColumn, itemName }) {
  const insert = db.prepare(`
    INSERT INTO ${tableName} (
      ${nameColumn}, date, purchase_amount, usage_amount, current_inventory,
      site_id, site_name, author, last_modified, is_synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(itemName, '2026-06-30', 10, 0, 10, metadata.siteId, metadata.siteName, metadata.author, '', 1);
  insert.run(itemName, '2026-07-01', 0, 12, -2, metadata.siteId, metadata.siteName, metadata.author, '', 1);
  insert.run(itemName, '2026-07-02', 5, 2, 3, metadata.siteId, metadata.siteName, metadata.author, '', 1);
  insert.run(itemName, '2026-07-03', 0, 1, 2, metadata.siteId, metadata.siteName, metadata.author, '', 1);
}

function readInventory(db, { tableName, nameColumn, itemName }) {
  return db.prepare(`
    SELECT date, current_inventory, site_id, site_name, author, is_synced
    FROM ${tableName}
    WHERE ${nameColumn} = ?
    ORDER BY date ASC
  `).all(itemName);
}

function verifyInventoryCascade(contract) {
  const db = new Database(':memory:');
  try {
    createInventoryTable(db, contract.tableName, contract.nameColumn);
    seedInventoryRows(db, contract);

    recalculateInventoryCascade(db, {
      ...contract,
      metadata,
      startDate: '2026-07-01',
      explicitDates: new Set(),
    });

    let rows = readInventory(db, contract);
    assert.deepEqual(
      rows.map((row) => row.current_inventory),
      [10, 0, 3, 2],
      `${contract.tableName}: 음수 재고 하한 또는 이후 재고 연쇄 계산이 깨졌습니다.`
    );
    assert.equal(rows[1].site_id, metadata.siteId);
    assert.equal(rows[1].site_name, metadata.siteName);
    assert.equal(rows[1].author, metadata.author);
    assert.equal(rows[1].is_synced, 0);

    db.prepare(`
      UPDATE ${contract.tableName}
      SET current_inventory = -9
      WHERE ${contract.nameColumn} = ? AND date = ?
    `).run(contract.itemName, '2026-07-02');

    recalculateInventoryCascade(db, {
      ...contract,
      metadata,
      startDate: '2026-07-02',
      explicitDates: new Set(['2026-07-02']),
    });

    rows = readInventory(db, contract);
    assert.deepEqual(
      rows.map((row) => row.current_inventory),
      [10, 0, 0, 0],
      `${contract.tableName}: 수동 재고 기준점의 0 하한 또는 이후 재계산이 깨졌습니다.`
    );

    db.prepare(`
      UPDATE ${contract.tableName}
      SET current_inventory = 7
      WHERE ${contract.nameColumn} = ? AND date = ?
    `).run(contract.itemName, '2026-07-02');

    recalculateInventoryCascade(db, {
      ...contract,
      metadata,
      startDate: '2026-07-02',
      explicitDates: new Set(['2026-07-02']),
    });

    rows = readInventory(db, contract);
    assert.deepEqual(
      rows.map((row) => row.current_inventory),
      [10, 0, 7, 6],
      `${contract.tableName}: 수동 재고 기준점 이후 재고 계산이 깨졌습니다.`
    );
  } finally {
    db.close();
  }
}

function runUnifiedRecordModalRegressionTests() {
  TABLE_CONTRACTS.forEach(verifyInventoryCascade);
  return {
    scenarios: TABLE_CONTRACTS.length * 3,
    tables: TABLE_CONTRACTS.map(({ tableName }) => tableName),
  };
}

if (require.main === module) {
  try {
    const result = runUnifiedRecordModalRegressionTests();
    console.log(`Unified record modal regression tests passed (${result.scenarios} scenarios).`);
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
}

module.exports = {
  runUnifiedRecordModalRegressionTests,
};
