'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const {
  getActiveLocations,
  getConfiguredSampleMappings,
} = require('../server/services/qntechWaterValueImportService.cjs');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE config_items (
    id INTEGER PRIMARY KEY,
    category TEXT,
    item_name TEXT,
    is_active INTEGER,
    display_order INTEGER
  );
  CREATE TABLE site_config_items (
    id INTEGER PRIMARY KEY,
    site_id TEXT,
    category TEXT,
    item_name TEXT,
    is_active INTEGER,
    display_order INTEGER
  );
  CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY,
    qntech_sample_mappings TEXT
  );
  CREATE TABLE site_settings (
    site_id TEXT PRIMARY KEY,
    qntech_sample_mappings TEXT
  );

  INSERT INTO config_items VALUES (1, 'location', '전역장소', 1, 1);
  INSERT INTO site_config_items VALUES
    (1, 'site-a', 'location', '혐기조', 1, 1),
    (2, 'site-a', 'location', '방류조', 1, 2),
    (3, 'site-b', 'location', 'MBR조', 1, 1),
    (4, 'site-b', 'location', '방류조', 1, 2);
  INSERT INTO app_settings VALUES (1, '[{"source":"전역","target":"전역"}]');
  INSERT INTO site_settings VALUES
    ('site-a', '[{"source":"A혐기","target":"혐기조"}]'),
    ('site-b', '[{"source":"B막","target":"MBR조"}]');
`);

assert.deepStrictEqual(getActiveLocations(db, 'site-a'), ['혐기조', '방류조']);
assert.deepStrictEqual(getActiveLocations(db, 'site-b'), ['MBR조', '방류조']);
assert.deepStrictEqual(getActiveLocations(db), ['전역장소']);
assert.deepStrictEqual(getConfiguredSampleMappings(db, 'site-a'), [{ source: 'A혐기', target: '혐기조' }]);
assert.deepStrictEqual(getConfiguredSampleMappings(db, 'site-b'), [{ source: 'B막', target: 'MBR조' }]);

db.close();
console.log('✓ QnTECH 분석장소·샘플 매칭 설정이 공유 DB에서 site_id별로 분리됨');
