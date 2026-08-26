'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const credentialService = require('../server/services/settings/externalCredentialService.cjs');

const root = path.join(__dirname, '..');
// Normalize CRLF -> LF so regex contracts below don't depend on the CI
// runner's git core.autocrlf checkout setting (Windows runners can check
// out files with CRLF even though the repo stores LF).
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');

const roadworkView = read('src/features/roadwork-helper/RoadworkHelperView.jsx');
const roadworkRuntime = read('electron/roadworkDumpHelper.cjs');
const scopedCredentialSource = roadworkRuntime.match(
  /function getScopedCredential\(db, serviceKey, siteId\) \{[\s\S]*?\n\}\n\nfunction stopRoadworkKeepAlive/,
)?.[0].replace(/\n\nfunction stopRoadworkKeepAlive$/, '');
assert.ok(scopedCredentialSource, 'roadwork scoped credential resolver is missing');
const getRoadworkScopedCredential = new Function(
  `${scopedCredentialSource}; return getScopedCredential;`,
)();

// Opening the roadwork helper is a local-only operation. This is an explicit
// latency and availability contract: a Sheets/settings/server request must
// never be inserted into the page-open path again.
assert.doesNotMatch(roadworkView, /import\s+\{?\s*SettingsModel\b/);
assert.doesNotMatch(roadworkView, /SettingsModel\s*\./);
assert.match(roadworkView, /invokeRoadwork\('roadwork:getRoadworkUrl'\)/);
assert.match(roadworkRuntime, /ipcMain\.handle\('roadwork:getRoadworkUrl'[\s\S]*?withLocalDb\(/);
assert.match(roadworkRuntime, /getScopedCredential\(db, 'road_web', getSiteIdFromSender\(event\)\)/);

const fetchConfigStart = roadworkView.indexOf('const fetchConfig = React.useCallback');
const fetchConfigEnd = roadworkView.indexOf('const recordRoadworkDiagnostic', fetchConfigStart);
assert.ok(fetchConfigStart >= 0 && fetchConfigEnd > fetchConfigStart, 'roadwork fetchConfig contract block is missing');
const fetchConfigBlock = roadworkView.slice(fetchConfigStart, fetchConfigEnd);
assert.doesNotMatch(fetchConfigBlock, /SettingsModel|apiClient|fetch\s*\(|\/api\/settings|google\s*sheet/i);
assert.match(fetchConfigBlock, /roadwork:getPreloadPath/);
assert.match(fetchConfigBlock, /roadwork:getRoadworkUrl/);

assert.match(read('server/database.cjs'), /CREATE TABLE IF NOT EXISTS site_web_app_credentials/);
assert.match(read('server/database.cjs'), /PRIMARY KEY\s*\(site_id, service_key\)/);
assert.match(read('server/services/settings/externalCredentialService.cjs'), /WHERE site_id = \? AND service_key = \?/);
assert.match(roadworkRuntime, /getSiteIdFromRoadworkPartition/);
assert.match(roadworkRuntime, /getScopedCredential\(db, 'road_web', getSiteIdFromSender\(event\)\)/);
assert.match(roadworkView, /const activeSiteId = String\(windowSiteId \|\| currentUserSiteId\)\.trim\(\)/);
assert.match(roadworkView, /key={`\$\{roadworkPartition\}-\$\{webviewUrl\}-\$\{preloadPath\}-\$\{webviewGeneration\}`}/);
assert.match(roadworkView, /window-site-identity-mismatch-contained/);
assert.match(roadworkView, /credential-scope-checked/);
assert.match(roadworkRuntime, /credential_source: 'missing-site-scoped'/);
assert.match(roadworkRuntime, /isConfiguredDirectionalSite/);
assert.match(roadworkRuntime, /const check = await pingRoadworkSession\(partition, targetUrl\)/);
assert.match(roadworkRuntime, /finalPath/);
assert.match(roadworkRuntime, /redirectedToLogin/);
assert.match(roadworkView, /session-keepalive-checked/);
assert.match(roadworkView, /session-keepalive-failed/);
assert.match(roadworkView, /unexpected-login-probe/);
assert.match(roadworkView, /previousPagePath/);
assert.match(read('src/features/settings/historyRestore/HistoryRestoreModal.jsx'), /SettingsModel\.getSettings\(\{ force: true \}\)/);

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY,
    site_id TEXT,
    qntech_site_id TEXT,
    multi_site_enabled INTEGER NOT NULL DEFAULT 0,
    primary_site_id TEXT,
    secondary_site_id TEXT
  );
  INSERT INTO app_settings VALUES (1, 'chuncheon', '', 1, 'chuncheon', 'busan');
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

assert.equal(getRoadworkScopedCredential(db, 'road_web', 'chuncheon').credential_source, 'site-scoped');
assert.equal(getRoadworkScopedCredential(db, 'road_web', 'busan').credential_source, 'site-scoped');
db.prepare("DELETE FROM site_web_app_credentials WHERE site_id = 'busan' AND service_key = 'road_web'").run();
const missingDirectionalCredential = getRoadworkScopedCredential(db, 'road_web', 'busan');
assert.equal(missingDirectionalCredential.credential_source, 'missing-site-scoped');
assert.equal(missingDirectionalCredential.user_id, '');
assert.equal(missingDirectionalCredential.password, '');

db.prepare('UPDATE app_settings SET multi_site_enabled = 0').run();
const legacyFallbackCredential = getRoadworkScopedCredential(db, 'road_web', 'legacy-single-site');
assert.equal(legacyFallbackCredential.credential_source, 'legacy-fallback');
assert.equal(legacyFallbackCredential.user_id, 'legacy');
assert.equal(legacyFallbackCredential.password, 'legacy');

db.close();
console.log('PASS roadwork opens from local credentials only and directional web credentials are isolated by site_id');
