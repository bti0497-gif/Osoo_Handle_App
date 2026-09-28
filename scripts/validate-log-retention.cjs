const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createBoundedServerLog, MAX_LOG_BYTES } = require('../server/services/boundedServerLogService.cjs');
const { cleanupLocalDiagnosticRetention, scrubUploadedDiagnosticRows } = require('../server/services/diagnosticLogService.cjs');
const { createWorkActivityLogService } = require('../server/services/workActivityLogService.cjs');
const { EventEmitter } = require('node:events');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osoo-log-retention-'));
try {
  const logDir = path.join(root, 'logs');
  fs.mkdirSync(logDir);
  const logPath = path.join(logDir, 'electron-server.log');
  const fd = fs.openSync(logPath, 'w');
  fs.writeSync(fd, Buffer.from('old-log\n'));
  fs.writeSync(fd, Buffer.from('last-error\n'), 0, 11, 100 * 1024 * 1024);
  fs.closeSync(fd);

  const log = createBoundedServerLog(root);
  assert.ok(fs.statSync(logPath).size <= MAX_LOG_BYTES);
  assert.ok(fs.readFileSync(logPath).toString('utf8').includes('last-error'));
  for (let i = 0; i < 2000; i += 1) log.append('x'.repeat(1000) + '\n');
  assert.ok(fs.statSync(logPath).size <= MAX_LOG_BYTES);
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE app_diagnostic_logs (id INTEGER PRIMARY KEY, created_at TEXT, uploaded_at TEXT, message TEXT, details_json TEXT, upload_error TEXT)');
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    const recent = new Date().toISOString();
    db.prepare('INSERT INTO app_diagnostic_logs (created_at, uploaded_at, message, details_json, upload_error) VALUES (?, ?, ?, ?, ?)').run(old, old, 'private error', '{"stack":"private"}', null);
    db.prepare('INSERT INTO app_diagnostic_logs (created_at, uploaded_at, message, details_json, upload_error) VALUES (?, ?, ?, ?, ?)').run(old, null, 'pending', '{"stack":"pending"}', 'upload failed');
    db.prepare('INSERT INTO app_diagnostic_logs (created_at, uploaded_at, message, details_json, upload_error) VALUES (?, ?, ?, ?, ?)').run(recent, null, 'recent', '{"detail":true}', null);
    const diagnosticDir = path.join(logDir, 'diagnostics');
    fs.mkdirSync(diagnosticDir);
    fs.writeFileSync(path.join(diagnosticDir, '2020-01-01_test_diagnostics.jsonl'), 'old');
    fs.writeFileSync(path.join(diagnosticDir, '2099-01-01_test_diagnostics.jsonl'), 'recent');
    const cleaned = cleanupLocalDiagnosticRetention(db, root);
    assert.deepEqual(cleaned, { uploadedRows: 1, pendingRows: 1, files: 1 });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM app_diagnostic_logs').get().count, 1);
    const localError = db.prepare('SELECT id FROM app_diagnostic_logs WHERE message = ?').get('recent');
    scrubUploadedDiagnosticRows(db, [{ id: localError.id }]);
    assert.deepEqual(db.prepare('SELECT message, details_json, upload_error FROM app_diagnostic_logs WHERE id = ?').get(localError.id), {
      message: '', details_json: '{}', upload_error: null,
    });
    assert.ok(fs.existsSync(path.join(diagnosticDir, '2099-01-01_test_diagnostics.jsonl')));
  } finally {
    db.close();
  }
  const activity = createWorkActivityLogService(root);
  const response = new EventEmitter();
  response.statusCode = 200;
  let nextCalled = false;
  activity.middleware({ method: 'POST', originalUrl: '/api/flows?date=2026-09-28&siteId=secret' }, response, () => { nextCalled = true; });
  response.emit('finish');
  assert.ok(nextCalled);
  const activityFile = path.join(logDir, 'activity', `activity-${new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)}.jsonl`);
  const event = JSON.parse(fs.readFileSync(activityFile, 'utf8').trim());
  assert.deepEqual(Object.keys(event).sort(), ['result', 'time', 'title']);
  assert.equal(event.title, '유량·검침 관리');
  assert.equal(event.result, 'success');
  assert.ok(!fs.readFileSync(activityFile, 'utf8').includes('secret'));
  const activityFd = fs.openSync(activityFile, 'r+');
  fs.writeSync(activityFd, Buffer.from('\n'), 0, 1, 500 * 1024 * 1024 + 1);
  fs.closeSync(activityFd);
  activity.prune();
  assert.ok(fs.statSync(activityFile).size <= 1024 * 1024);
  console.log('PASS: server stderr is bounded; diagnostic retention and title/time/result-only activity logging enforced');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
