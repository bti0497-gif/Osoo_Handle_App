'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const archive = path.join(process.env.APPDATA, 'Osoo_Handle_App', 'diagnostic-analysis');
const sqlite = path.join(archive, 'collector-runtime', `node-${process.versions.node}`, 'node_modules', 'better-sqlite3');
// Simulate the field-app module being unusable, without changing it.
const originalLoad = Module._load;
Module._load = function (request, ...args) {
  if (request === 'better-sqlite3') throw new Error('Simulated app ABI mismatch');
  return originalLoad.call(this, request, ...args);
};
const D = require(sqlite);
const importer = require('../import-drive-diagnostics.cjs');
const db = new D(':memory:');
const source = fs.readFileSync(path.join(__dirname, '../import-drive-diagnostics.cjs'), 'utf8');
db.exec(source.match(/db\.exec\(`([\s\S]*?)`\)/)[1]);
const records = importer.parseJsonl(JSON.stringify({created_at:'2026-10-21T00:00:00Z',area:'test',action:'save',result:'ok'}));
const batch = [{file:{id:'isolated-test',name:'test.jsonl'},records}];
assert.equal(importer.persistRecords(db,batch,'2026','10'),1);
assert.equal(importer.persistRecords(db,batch,'2026','10'),0);
assert.throws(db.transaction(() => { db.prepare('DELETE FROM drive_diagnostic_events').run(); throw Error('rollback'); }));
assert.equal(db.prepare('SELECT COUNT(*) n FROM drive_diagnostic_events').get().n,1);
assert.equal(db.pragma('quick_check',{simple:true}),'ok');
db.close();
const existing = path.join(archive,'diagnostics.db');
if(fs.existsSync(existing)) {
  const readOnly = new D(existing,{readonly:true});
  assert.equal(readOnly.pragma('quick_check',{simple:true}),'ok');
  console.log('Existing archive rows:',readOnly.prepare('SELECT COUNT(*) n FROM drive_diagnostic_events').get().n);
  readOnly.close();
}
console.log('PASS independent SQLite ABI, actual importer persistence, duplicate suppression, rollback and existing DB integrity');
