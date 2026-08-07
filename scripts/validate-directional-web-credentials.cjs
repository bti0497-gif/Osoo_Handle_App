'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const credentialService = require('../server/services/settings/externalCredentialService.cjs');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

assert.match(read('server/database.cjs'), /CREATE TABLE IF NOT EXISTS site_web_app_credentials/);
assert.match(read('server/database.cjs'), /PRIMARY KEY\s*\(site_id, service_key\)/);
assert.match(read('server/services/settings/externalCredentialService.cjs'), /WHERE site_id = \? AND service_key = \?/);
assert.match(read('electron/roadworkDumpHelper.cjs'), /getSiteIdFromRoadworkPartition/);
assert.match(read('electron/roadworkDumpHelper.cjs'), /getScopedCredential\(db, 'road_web', getSiteIdFromSender\(event\)\)/);
assert.match(read('src/features/settings/historyRestore/HistoryRestoreModal.jsx'), /SettingsModel\.getSettings\(\{ force: true \}\)/);

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE app_settings (id INTEGER PRIMARY KEY, site_id TEXT, qntech_site_id TEXT);
  INSERT INTO app_settings VALUES (1, 'chuncheon', '');
  CREATE TABLE web_app_credentials (
    id INTEGER PRIMARY KEY,
    service_key TEXT UNIQUE,
    service_name TEXT,
    service_url TEXT,
    user_id TEXT,
    password TEXT,
    updated_at TEXT
  );
  CREATE TABLE site_web_app_credentials (
    site_id TEXT NOT NULL,
    service_key TEXT NOT NULL,
    user_id TEXT NOT NULL DEFAULT '',
    password TEXT NOT NULL DEFAULT '',
    updated_at TEXT,
    PRIMARY KEY (site_id, service_key)
  );
  INSERT INTO web_app_credentials VALUES
    (1, 'road_web', 'road', 'https://nwpo.ex.co.kr:5002/security/login.do', 'legacy', 'legacy', ''),
    (2, 'water_analysis_app', 'water', 'https://water.example', 'legacy', 'legacy', '');
`);

credentialService.syncSiteCredentialsToLocal(db, {
  id: 'chuncheon',
  road_web_user_id: 'dms0325',
  road_web_password: 'chuncheon-password',
  water_analysis_user_id: 'water-chuncheon',
  water_analysis_password: 'water-password',
});
credentialService.syncSiteCredentialsToLocal(db, {
  id: 'busan',
  road_web_user_id: 'dms1346',
  road_web_password: 'busan-password',
  water_analysis_user_id: '',
  water_analysis_password: '',
}, { syncQntechSite: false });

assert.equal(credentialService.getCredential(db, 'road_web', 'chuncheon').user_id, 'dms0325');
assert.equal(credentialService.getCredential(db, 'road_web', 'busan').user_id, 'dms1346');
assert.equal(credentialService.getCredential(db, 'road_web', 'chuncheon').password, 'chuncheon-password');
assert.equal(credentialService.getCredential(db, 'road_web', 'busan').password, 'busan-password');
assert.equal(credentialService.getCredential(db, 'water_analysis_app', 'busan').user_id, '');
assert.equal(credentialService.getCredential(db, 'water_analysis_app', 'busan').password, '');

db.close();
console.log('PASS directional web credentials are isolated by site_id');
