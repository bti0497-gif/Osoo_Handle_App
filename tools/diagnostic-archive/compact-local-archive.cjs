'use strict';
// Central-PC archive only. No Drive access and no field-app database access.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const root = path.join(process.env.APPDATA, 'Osoo_Handle_App', 'diagnostic-analysis');
const dbPath = path.join(root, 'diagnostics.db');

function planRows(rows) {
  let before = 0;
  const unique = new Map();
  const duplicateIds = [];
  for (const row of rows) {
    before += 1;
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify([
      row.site_id, row.logged_at, row.feature_name, row.action, row.result, row.level, row.message, row.details_json,
    ])).digest('hex');
    if (unique.has(fingerprint)) duplicateIds.push(row.id);
    else unique.set(fingerprint, { ...row, details_json: undefined, message: undefined });
  }
  const records = [...unique.values()];
  const keep = new Set();
  const contexts = new Map();
  const representative = new Map();
  const grouped = new Map();
  const siteKey = (row) => row.site_id || row.site_name || '';
  for (const row of records) {
    const key = JSON.stringify([siteKey(row), row.app_version, String(row.logged_at || '').slice(0, 10), row.feature_name, row.action, row.result]);
    const group = grouped.get(key) || { siteId: row.site_id, siteName: row.site_name, version: row.app_version,
      utcDate: String(row.logged_at || '').slice(0, 10), feature: row.feature_name, action: row.action, result: row.result, count: 0 };
    group.count += 1;
    grouped.set(key, group);
    const sample = representative.get(key);
    const order = `${row.logged_at || ''}\u0000${String(row.id).padStart(20, '0')}`;
    if (!sample) representative.set(key, { first: row.id, last: row.id, firstOrder: order, lastOrder: order });
    else {
      if (order < sample.firstOrder) { sample.first = row.id; sample.firstOrder = order; }
      if (order > sample.lastOrder) { sample.last = row.id; sample.lastOrder = order; }
    }
    const issue = ['warn', 'error'].includes(row.level) || /failed|rejected|error/.test(row.result || '') || row.record_type === 'parse-error';
    const investigation = ['server-performance', 'stability-summary'].includes(row.feature_name)
      || /remote-login|remote-input|session-unexpected|session-keepalive-failed|data-query-empty/.test(row.action || '')
      || row.action === 'runtime-telemetry';
    if (issue || investigation) keep.add(row.id);
    if (issue || /remote-login/.test(row.action || '')) {
      const at = Date.parse(row.logged_at);
      if (Number.isFinite(at)) {
        const list = contexts.get(siteKey(row)) || [];
        list.push(at);
        contexts.set(siteKey(row), list);
      }
    }
  }
  for (const sample of representative.values()) { keep.add(sample.first); keep.add(sample.last); }
  // Keep same-site evidence two minutes either side of an issue or login observation.
  for (const row of records) {
    const at = Date.parse(row.logged_at);
    if ((contexts.get(siteKey(row)) || []).some((eventAt) => Math.abs(at - eventAt) <= 120000)) keep.add(row.id);
  }
  const normalIds = records.filter((row) => !keep.has(row.id)).map((row) => row.id);
  return { before, unique: records.length, duplicates: duplicateIds.length,
    normalDetails: normalIds.length, remaining: keep.size,
    deleteIds: [...duplicateIds, ...normalIds], groupedCounts: [...grouped.values()] };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply')) throw new Error('Only --apply is supported; default is read-only preview.');
  const apply = args.includes('--apply');
  const db = new Database(dbPath, { readonly: !apply, fileMustExist: true, timeout: 10000 });
  try {
    // Primary-key order streams rows without sorting large JSON payloads in memory.
    const read = () => db.prepare('SELECT * FROM drive_diagnostic_events ORDER BY id').iterate();
    if (!apply) {
      const plan = planRows(read());
      console.log(JSON.stringify({ ...plan, deleteIds: undefined, groupedCounts: undefined }, null, 2));
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const cleanupRoot = path.join(root, 'cleanup');
    fs.mkdirSync(cleanupRoot, { recursive: true });
    const backup = path.join(cleanupRoot, `before-compaction-${stamp}.db`);
    await db.backup(backup);
    const backupDb = new Database(backup, { readonly: true });
    try { if (backupDb.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Backup integrity failed'); }
    finally { backupDb.close(); }
    let report;
    const reportPath = path.join(cleanupRoot, `compaction-${stamp}.json`);
    db.transaction(() => {
      const plan = planRows(read());
      report = { createdAt: new Date().toISOString(), policy: 'keep issues, investigation evidence, same-site +/-120s context and first/last daily representatives',
        ...plan, deleteIds: undefined, backup, backupRetentionRecommendationDays: 7 };
      // Durable summary is written before any detail is removed.
      const fd = fs.openSync(reportPath, 'wx');
      try { fs.writeFileSync(fd, JSON.stringify(report, null, 2), 'utf8'); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      const remove = db.prepare('DELETE FROM drive_diagnostic_events WHERE id = ?');
      for (const id of plan.deleteIds) remove.run(id);
      if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Archive integrity failed; rolling back');
    }).immediate();
    // Keep the newest cumulative report for each month; older reports duplicate it.
    let deletedReports = 0;
    for (const year of fs.readdirSync(root).filter((name) => /^\d{4}$/.test(name))) {
      const yearDir = path.join(root, year);
      for (const month of fs.readdirSync(yearDir).filter((name) => /^\d{2}$/.test(name))) {
        const monthDir = path.join(yearDir, month);
        const reports = fs.readdirSync(monthDir).filter((name) => /^diagnostics-.*\.json$/.test(name)).sort();
        for (const name of reports.slice(0, -1)) { fs.unlinkSync(path.join(monthDir, name)); deletedReports += 1; }
      }
    }
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.exec('VACUUM');
    console.log(JSON.stringify({ before: report.before, removedDuplicates: report.duplicates,
      removedNormalDetails: report.normalDetails, remaining: report.remaining, deletedReports, reportPath, backup }, null, 2));
  } finally { db.close(); }
}
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { planRows };
