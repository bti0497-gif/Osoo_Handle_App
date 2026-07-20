const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function assertQuickCheck(db, label = 'SQLite DB') {
  const result = db.pragma('quick_check');
  const failures = Array.isArray(result)
    ? result.filter((row) => String(row.quick_check || '').toLowerCase() !== 'ok')
    : [{ quick_check: 'invalid-result' }];
  if (failures.length > 0) {
    throw new Error(`${label} quick_check 실패: ${JSON.stringify(failures)}`);
  }
}

function quoteSqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function resolveAppVersion() {
  const fromEnvironment = String(process.env.OSOO_APP_VERSION || '').trim();
  if (fromEnvironment) return fromEnvironment;
  try {
    return String(require('../../package.json').version || 'unknown');
  } catch (_) {
    return 'unknown';
  }
}

function verifyBackup(backupPath) {
  const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
  try {
    assertQuickCheck(backup, 'SQLite 백업');
    backup.prepare('SELECT name FROM sqlite_master LIMIT 1').get();
  } finally {
    backup.close();
  }
}

function ensurePreMigrationBackup(db, { appDataPath, hadExistingDatabase }) {
  if (!hadExistingDatabase) return { skipped: true, reason: 'new-database' };

  const safeVersion = resolveAppVersion().replace(/[^0-9A-Za-z._-]/g, '_');
  const backupDir = path.join(appDataPath, 'backups', 'pre-migration');
  const backupPath = path.join(backupDir, `osoo-pre-migration-${safeVersion}.db`);
  fs.mkdirSync(backupDir, { recursive: true });

  if (!fs.existsSync(backupPath)) {
    db.exec(`VACUUM INTO ${quoteSqlString(backupPath)}`);
  }
  verifyBackup(backupPath);
  return { skipped: false, backupPath };
}

function protectDatabaseBeforeMigration(db, options) {
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  assertQuickCheck(db, '운영 SQLite DB');
  db.exec('BEGIN IMMEDIATE; ROLLBACK;');
  return ensurePreMigrationBackup(db, options);
}

function recordSchemaBaseline(db, version = 'baseline-1.1.6') {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(version);
}

module.exports = {
  assertQuickCheck,
  protectDatabaseBeforeMigration,
  recordSchemaBaseline,
  verifyBackup,
};
