'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const TEMP_ROOT = path.join(PROJECT_ROOT, '.tmp-validation', 'settings-persistence');
const APP_ROOT = path.join(TEMP_ROOT, 'Osoo_Handle_App');

async function run() {
  assert.ok(TEMP_ROOT.startsWith(path.join(PROJECT_ROOT, '.tmp-validation')), 'unsafe temporary path');
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(APP_ROOT, { recursive: true });

  process.env.APPDATA = TEMP_ROOT;
  process.env.OSOO_APP_DATA_PATH = APP_ROOT;
  process.env.OSOO_PACKAGED = '1';
  process.env.GOOGLE_DRIVE_FOLDER_ID = '';

  const { db } = require('../server/database.cjs');
  const { saveSettings } = require('../server/services/settings/appSettingsService.cjs');
  const storageRoot = path.join(APP_ROOT, 'storage-sites');
  const payload = {
    settings: {
      siteId: 'settings-test-site',
      siteName: '설정검증현장',
      managerName: '검증관리자',
      method: 'A2O',
      series: '2계열',
    },
    configItems: [
      { category: 'flow', name: '유입유량계', checked: true },
      { category: 'medicine', name: '포도당', checked: true },
      { category: 'location', name: '유량조정조', checked: true },
    ],
  };

  const result = await saveSettings(db, payload, storageRoot);
  assert.strictEqual(result.savedSettings.site_name, '설정검증현장');
  assert.strictEqual(result.savedSettings.flow_option, 'combined');

  let rollbackRaised = false;
  try {
    await saveSettings(db, {
      settings: { ...payload.settings, siteName: '롤백되면안되는이름' },
      configItems: [{ category: null, name: null, checked: true }],
    }, storageRoot);
  } catch (_) {
    rollbackRaised = true;
  }
  assert.strictEqual(rollbackRaised, true, 'invalid settings must fail');
  assert.strictEqual(
    db.prepare('SELECT site_name FROM app_settings WHERE id = 1').get().site_name,
    '설정검증현장',
    'failed settings transaction must roll back all changes'
  );
  db.close();

  const sqlite3 = require('better-sqlite3');
  const reopened = new sqlite3(path.join(APP_ROOT, 'osoo.db'), { readonly: true });
  try {
    const saved = reopened.prepare(`
      SELECT site_id, site_name, manager_name, method, series, flow_option
      FROM app_settings WHERE id = 1
    `).get();
    assert.deepStrictEqual(saved, {
      site_id: 'settings-test-site',
      site_name: '설정검증현장',
      manager_name: '검증관리자',
      method: 'A2O',
      series: '2계열',
      flow_option: 'combined',
    });
    for (const [index, item] of payload.configItems.entries()) {
      const row = reopened.prepare(`
        SELECT is_active, display_order FROM config_items
        WHERE category = ? AND item_name = ?
      `).get(item.category, item.name);
      assert.strictEqual(Number(row?.is_active), 1);
      assert.strictEqual(Number(row?.display_order), index);
    }
    assert.strictEqual(reopened.pragma('quick_check', { simple: true }), 'ok');
  } finally {
    reopened.close();
  }

  console.log('[SETTINGS PASS] atomic save, rollback, close/reopen persistence, SQLite integrity');
}

run()
  .catch((error) => {
    console.error('[SETTINGS FAIL]', error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
  });
