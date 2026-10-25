#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { APP_DATA_ROOT } = require('../../server/config/runtimeConfig.cjs');
// Never load the app's native module: Electron builds replace its ABI.
const sqliteModulePath = path.join(APP_DATA_ROOT, 'diagnostic-analysis', 'collector-runtime',
  `node-${process.versions.node}`, 'node_modules', 'better-sqlite3');
function openIsolatedDatabase(file) {
  if (!fs.existsSync(sqliteModulePath)) {
    throw new Error('Collector runtime missing for Node ' + process.versions.node
      + '. Run tools/diagnostic-archive/launcher/build-collector.ps1; do not rebuild app dependencies.');
  }
  const Database = require(sqliteModulePath);
  return new Database(file);
}

const TEXT = {
  diagnosticRoot: '\uC571\uC9C4\uB2E8\uB85C\uADF8',
  cheondeungsan: '\uCC9C\uB4F1\uC0B0',
};

const SITE_PRESETS = {
  cheondeungsan: TEXT.cheondeungsan,
  all: '',
};

const DIAGNOSTIC_MIME_TYPE = 'application/vnd.google-apps.folder';
const DIAGNOSTIC_FILE_SUFFIX = '_diagnostics.jsonl';
const DEFAULT_ISSUE_LIMIT = 80;
const ARCHIVE_DB_PATH = path.join(APP_DATA_ROOT, 'diagnostic-analysis', 'diagnostics.db');

function openArchiveDatabase() {
  fs.mkdirSync(path.dirname(ARCHIVE_DB_PATH), { recursive: true });
  const db = openIsolatedDatabase(ARCHIVE_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS drive_diagnostic_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drive_file_id TEXT NOT NULL,
      source_file_name TEXT NOT NULL,
      source_year TEXT NOT NULL,
      source_month TEXT NOT NULL,
      line_number INTEGER NOT NULL,
      record_type TEXT NOT NULL DEFAULT 'event',
      logged_at TEXT,
      site_id TEXT,
      site_name TEXT,
      app_version TEXT,
      level TEXT,
      feature_name TEXT,
      action TEXT,
      result TEXT,
      message TEXT,
      details_json TEXT NOT NULL DEFAULT '{}',
      imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (drive_file_id, line_number)
    );
    CREATE INDEX IF NOT EXISTS idx_drive_diagnostic_events_history
      ON drive_diagnostic_events (source_year, source_month, site_name, logged_at);
    CREATE INDEX IF NOT EXISTS idx_drive_diagnostic_events_feature
      ON drive_diagnostic_events (feature_name, action, result);
  `);
  return db;
}

function parseArgs(argv) {
  const now = new Date();
  const options = {
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1).padStart(2, '0'),
    site: 'all',
    limitIssues: DEFAULT_ISSUE_LIMIT,
    keepDriveFiles: false,
    downloadDir: '',
    listOnly: false,
    clearLocalArchive: false,
    confirmClearLocalArchive: false,
    exitIfEmpty: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--list-only') {
      options.listOnly = true;
      continue;
    }
    if (arg === '--keep-drive-files') {
      options.keepDriveFiles = true;
      continue;
    }
    if (arg === '--clear-local-archive') {
      options.clearLocalArchive = true;
      continue;
    }
    if (arg === '--confirm-clear-local-archive') {
      options.confirmClearLocalArchive = true;
      continue;
    }
    if (arg === '--exit-if-empty') {
      options.exitIfEmpty = true;
      continue;
    }
    if (arg === '--delete-after-analysis') {
      options.keepDriveFiles = false;
      continue;
    }
    if (!['--year', '--month', '--site', '--limit-issues', '--download-dir'].includes(arg)) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === '--year') options.year = next;
    if (arg === '--month') options.month = String(next).padStart(2, '0');
    if (arg === '--site') options.site = next;
    if (arg === '--limit-issues') options.limitIssues = Number(next);
    if (arg === '--download-dir') options.downloadDir = next;
    index += 1;
  }

  if (!/^\d{4}$/.test(options.year)) {
    throw new Error(`Invalid year: ${options.year}`);
  }
  if (!/^(0[1-9]|1[0-2])$/.test(options.month)) {
    throw new Error(`Invalid month: ${options.month}`);
  }
  if (!Number.isInteger(options.limitIssues) || options.limitIssues < 1) {
    throw new Error('--limit-issues must be a positive integer.');
  }

  return options;
}

function resolveSiteNeedle(siteArg) {
  return SITE_PRESETS[siteArg] !== undefined ? SITE_PRESETS[siteArg] : String(siteArg || '');
}

function escapeDriveQueryValue(value) {
  return String(value || '').replace(/'/g, "\\'");
}

async function listDriveFiles(drive, folderId, pageSize = 1000) {
  const files = [];
  let pageToken;
  do {
    const response = await drive.files.list({
      q: [
        `'${escapeDriveQueryValue(folderId)}' in parents`,
        'trashed=false',
      ].join(' and '),
      fields: 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime)',
      orderBy: 'createdTime desc',
      pageSize,
      pageToken,
      spaces: 'drive',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    files.push(...(response.data.files || []));
    pageToken = response.data.nextPageToken;
  } while (pageToken);
  return files;
}

async function downloadDriveText(drive, fileId) {
  const response = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'text' }
  );
  return typeof response.data === 'string' ? response.data : String(response.data || '');
}

function parseJsonl(text) {
  const records = [];
  String(text).split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('JSON line must contain an object.');
      }
      records.push({ lineNumber: index + 1, recordType: 'event', event: parsed });
    } catch (error) {
      records.push({
        lineNumber: index + 1,
        recordType: 'parse-error',
        event: { message: line.slice(0, 3000), parse_error: error.message },
      });
    }
  });
  return records;
}

function nullableString(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function persistRecords(db, fileRecords, year, month) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO drive_diagnostic_events (
      drive_file_id, source_file_name, source_year, source_month, line_number,
      record_type, logged_at, site_id, site_name, app_version, level,
      feature_name, action, result, message, details_json
    ) VALUES (
      @driveFileId, @fileName, @year, @month, @lineNumber,
      @recordType, @loggedAt, @siteId, @siteName, @appVersion, @level,
      @featureName, @action, @result, @message, @detailsJson
    )
  `);

  const transaction = db.transaction(() => {
    let insertedCount = 0;
    for (const { file, records } of fileRecords) {
      for (const record of records) {
        const event = record.event;
        const result = insert.run({
          driveFileId: file.id,
          fileName: file.name,
          year,
          month,
          lineNumber: record.lineNumber,
          recordType: record.recordType,
          loggedAt: nullableString(event.created_at),
          siteId: nullableString(event.site_id),
          siteName: nullableString(event.site_name),
          appVersion: nullableString(event.app_version),
          level: record.recordType === 'parse-error' ? 'parse-error' : nullableString(event.level),
          featureName: nullableString(event.area),
          action: nullableString(event.action),
          result: nullableString(event.result),
          message: nullableString(event.message || event.parse_error),
          detailsJson: JSON.stringify(event.details === undefined ? {} : event.details),
        });
        insertedCount += result.changes;
      }
    }
    return insertedCount;
  });

  return transaction();
}

function parseDetails(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function isIssue(row) {
  const details = parseDetails(row.details_json);
  const status = details.status || details.statusCode || details.responseStatus;
  return row.record_type === 'parse-error' ||
    ['error', 'warn'].includes(String(row.level || '').toLowerCase()) ||
    String(row.result || '').toLowerCase().includes('fail') ||
    Number(status) >= 400;
}

function groupedCounts(rows, keyFactory) {
  const counts = new Map();
  for (const row of rows) {
    const key = keyFactory(row) || 'unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function summarizeRows(rows, limitIssues) {
  const issues = rows.filter(isIssue);
  return {
    eventCount: rows.length,
    bySite: groupedCounts(rows, (row) => row.site_name || 'unknown-site'),
    byVersion: groupedCounts(rows, (row) => row.app_version || 'unknown-version'),
    byFeature: groupedCounts(rows, (row) =>
      [row.feature_name || 'unknown-feature', row.action || 'unknown-action'].join(':')),
    byResult: groupedCounts(rows, (row) => row.result || 'no-result'),
    issueCount: issues.length,
    issues: issues.slice(-limitIssues).map((row) => ({
      sourceFile: row.source_file_name,
      lineNumber: row.line_number,
      loggedAt: row.logged_at,
      siteName: row.site_name,
      appVersion: row.app_version,
      level: row.level,
      featureName: row.feature_name,
      action: row.action,
      result: row.result,
      message: row.message,
      details: parseDetails(row.details_json),
    })),
  };
}

function readMonthlyRows(db, year, month) {
  return db.prepare(`
    SELECT source_file_name, line_number, record_type, logged_at, site_name,
           app_version, level, feature_name, action, result, message, details_json
    FROM drive_diagnostic_events
    WHERE source_year = ? AND source_month = ?
    ORDER BY COALESCE(logged_at, imported_at), source_file_name, line_number
  `).all(year, month);
}

function writeReport(appDataPath, year, month, report) {
  const reportDir = path.join(appDataPath, 'diagnostic-analysis', year, month);
  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(reportDir, `diagnostics-${stamp}.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return reportPath;
}

function printUsage() {
  console.log([
    'Usage: node tools/diagnostic-archive/import-drive-diagnostics.cjs [options]',
    '',
    'Options:',
    '  --year YYYY             Diagnostic folder year (default: current year)',
    '  --month MM              Diagnostic folder month (default: current month)',
    '  --site NAME             Match a site-name fragment in the Drive filename (default: all)',
    '  --limit-issues N        Maximum issue examples in the report (default: 80)',
    '  --list-only             List matching files without downloading or changing anything',
    '  --exit-if-empty         Do not open the archive DB or write a report when no files match',
    '  --keep-drive-files      Save to the database/report without deleting Drive files',
    '  --download-dir PATH     Also save downloaded JSONL files to this local directory',
    '  --clear-local-archive   Clear local analysis rows (requires the confirmation flag)',
    '  --confirm-clear-local-archive  Confirm clearing the local analysis rows',
    '  --help                  Show this help',
  ].join('\n'));
}

function clearLocalArchive(options) {
  if (!options.confirmClearLocalArchive) {
    throw new Error('Clearing local analysis data requires --confirm-clear-local-archive.');
  }
  if (!fs.existsSync(ARCHIVE_DB_PATH)) {
    return { archiveDatabasePath: ARCHIVE_DB_PATH, deletedRowCount: 0, databaseFound: false };
  }

  const db = openArchiveDatabase();
  try {
    const result = db.prepare('DELETE FROM drive_diagnostic_events').run();
    return {
      archiveDatabasePath: ARCHIVE_DB_PATH,
      deletedRowCount: result.changes,
      databaseFound: true,
      reportsChanged: false,
      driveFilesChanged: false,
    };
  } finally {
    db.close();
  }
}

async function run(options) {
  const driveService = require('../../server/services/driveService.cjs');
  if (!driveService.isDriveConfigured()) {
    throw new Error('Google Drive is not configured. Check runtime config and GOOGLE_DRIVE_FOLDER_ID.');
  }

  const drive = driveService.getDriveClient();
  const folder = await driveService.findFolderPath(driveService.getDriveRootFolderId(), [
    TEXT.diagnosticRoot,
    options.year,
    options.month,
  ]);
  if (!folder) throw new Error(`Diagnostic folder not found: ${options.year}/${options.month}`);

  const files = await listDriveFiles(drive, folder.id);
  const siteNeedle = resolveSiteNeedle(options.site);
  const diagnosticFiles = files.filter((file) =>
    file.mimeType !== DIAGNOSTIC_MIME_TYPE &&
    String(file.name || '').endsWith(DIAGNOSTIC_FILE_SUFFIX) &&
    (!siteNeedle || String(file.name || '').includes(siteNeedle))
  );

  if (options.listOnly) {
    return {
      folder: path.posix.join(TEXT.diagnosticRoot, options.year, options.month),
      selectedFileCount: diagnosticFiles.length,
      files: diagnosticFiles.map((file) => ({
        name: file.name,
        size: file.size || null,
        createdTime: file.createdTime || null,
        modifiedTime: file.modifiedTime || null,
      })),
    };
  }

  if (options.exitIfEmpty && diagnosticFiles.length === 0) {
    return {
      folder: path.posix.join(TEXT.diagnosticRoot, options.year, options.month),
      selectedFileCount: 0,
      skippedEmpty: true,
      driveFilesDeleted: 0,
    };
  }

  const downloadRoot = options.downloadDir ? path.resolve(options.downloadDir) : '';
  if (downloadRoot) fs.mkdirSync(downloadRoot, { recursive: true });
  const fileRecords = [];
  for (const file of diagnosticFiles) {
    const text = await downloadDriveText(drive, file.id);
    if (downloadRoot) fs.writeFileSync(path.join(downloadRoot, path.basename(file.name)), text, 'utf8');
    fileRecords.push({ file, records: parseJsonl(text) });
  }

  const db = openArchiveDatabase();
  let report;
  let reportPath;
  try {
    const insertedEventCount = persistRecords(db, fileRecords, options.year, options.month);
    const monthlyRows = readMonthlyRows(db, options.year, options.month);
    const summary = summarizeRows(monthlyRows, options.limitIssues);
    report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      period: { year: options.year, month: options.month },
      folder: path.posix.join(TEXT.diagnosticRoot, options.year, options.month),
      archiveDatabasePath: ARCHIVE_DB_PATH,
      selectedFileCount: diagnosticFiles.length,
      insertedEventCount,
      monthly: summary,
      files: fileRecords.map(({ file, records }) => ({
        name: file.name,
        size: file.size || null,
        createdTime: file.createdTime || null,
        modifiedTime: file.modifiedTime || null,
        parsedRecordCount: records.length,
      })),
    };
    reportPath = writeReport(APP_DATA_ROOT, options.year, options.month, report);
    if (downloadRoot) {
      fs.writeFileSync(path.join(downloadRoot, 'analysis-summary.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    }
  } finally {
    db.close();
  }

  let deletedFileCount = 0;
  if (!options.keepDriveFiles) {
    for (const file of diagnosticFiles) {
      await drive.files.delete({ fileId: file.id, supportsAllDrives: true });
      deletedFileCount += 1;
    }
    const remainingIds = new Set(
      (await listDriveFiles(drive, folder.id))
        .filter((file) => String(file.name || '').endsWith(DIAGNOSTIC_FILE_SUFFIX))
        .map((file) => file.id)
    );
    const remainingSelected = diagnosticFiles.filter((file) => remainingIds.has(file.id));
    if (remainingSelected.length) {
      throw new Error(
        `Analysis was saved to ${reportPath}, but ${remainingSelected.length} Drive file(s) remain undeleted.`
      );
    }
  }

  return {
    ...report,
    reportPath,
    driveFilesDeleted: deletedFileCount,
    driveFilesKept: options.keepDriveFiles,
  };
}

async function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printUsage();
    return;
  }
  if (options.clearLocalArchive) {
    if (argv.some((arg) => !['--clear-local-archive', '--confirm-clear-local-archive'].includes(arg))) {
      throw new Error('--clear-local-archive cannot be combined with Drive import/list options.');
    }
    console.log(JSON.stringify(clearLocalArchive(options), null, 2));
    return;
  }
  const report = await run(options);
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  ARCHIVE_DB_PATH,
  openArchiveDatabase,
  parseArgs,
  parseJsonl,
  persistRecords,
  summarizeRows,
  clearLocalArchive,
  run,
  runCli,
};
