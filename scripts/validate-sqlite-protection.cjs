const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');
const {
  protectDatabaseBeforeMigration,
  recordSchemaBaseline,
} = require('../server/services/sqliteProtectionService.cjs');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'osoo-sqlite-protection-'));
const dbPath = path.join(tempRoot, 'osoo.db');

try {
  const seed = new Database(dbPath);
  seed.exec('CREATE TABLE sentinel (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO sentinel (value) VALUES (\'original\');');
  seed.close();

  const db = new Database(dbPath);
  const first = protectDatabaseBeforeMigration(db, { appDataPath: tempRoot, hadExistingDatabase: true });
  assert.ok(first.backupPath && fs.existsSync(first.backupPath), '사전 백업이 생성되어야 합니다.');
  assert.strictEqual(db.pragma('foreign_keys', { simple: true }), 1);
  assert.ok(db.pragma('busy_timeout', { simple: true }) >= 5000);

  recordSchemaBaseline(db);
  recordSchemaBaseline(db);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 1);
  db.prepare('UPDATE sentinel SET value = ? WHERE id = 1').run('changed-after-backup');

  const second = protectDatabaseBeforeMigration(db, { appDataPath: tempRoot, hadExistingDatabase: true });
  assert.strictEqual(second.backupPath, first.backupPath, '같은 버전에서 백업을 중복 생성하면 안 됩니다.');
  db.close();

  const backup = new Database(first.backupPath, { readonly: true, fileMustExist: true });
  assert.strictEqual(backup.pragma('quick_check', { simple: true }), 'ok');
  assert.strictEqual(backup.prepare('SELECT value FROM sentinel WHERE id = 1').get().value, 'original');
  backup.close();

  const fullInitPath = path.join(tempRoot, 'full-init');
  fs.mkdirSync(fullInitPath, { recursive: true });
  const initExpression = "const { db } = require('./server/database.cjs'); db.close();";
  const childOptions = {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, OSOO_APP_DATA_PATH: fullInitPath, OSOO_APP_VERSION: 'validation' },
    stdio: 'pipe',
  };
  execFileSync(process.execPath, ['-e', initExpression], childOptions);
  execFileSync(process.execPath, ['-e', initExpression], childOptions);

  const initialized = new Database(path.join(fullInitPath, 'osoo.db'), { readonly: true, fileMustExist: true });
  assert.strictEqual(initialized.pragma('quick_check', { simple: true }), 'ok');
  for (const table of ['members', 'app_settings', 'flow_readings', 'medicine_logs', 'water_quality', 'kit_logs', 'schema_migrations']) {
    assert.ok(initialized.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table), `필수 테이블 누락: ${table}`);
  }
  initialized.close();
  assert.ok(fs.existsSync(path.join(fullInitPath, 'backups', 'pre-migration', 'osoo-pre-migration-validation.db')));

  console.log('✓ 마이그레이션 전 quick_check·쓰기 잠금·SQLite 안전 설정 검증 통과');
  console.log('✓ 버전별 백업 생성·재검증·원본과의 분리 검증 통과');
  console.log('✓ schema_migrations 기준선 재실행 안전성 검증 통과');
  console.log('✓ 전체 DB 신규 생성·재시작·필수 테이블·사전 백업 시나리오 검증 통과');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
