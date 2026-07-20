#!/usr/bin/env node
'use strict';

/**
 * Google Drive diagnostic log analyzer.
 *
 * Important for Windows PowerShell:
 * Do not paste Korean text into ad-hoc regexes in shell snippets. PowerShell
 * code page conversion can corrupt literals before Node sees them. Keep Korean
 * folder/site names as Unicode escape constants in this script.
 */

const path = require('path');
const fs = require('fs');
const {
  drive,
  isDriveConfigured,
  getDriveRootFolderId,
  findFolderPath,
} = require('../server/services/driveService.cjs');

const TEXT = {
  diagnosticRoot: '\uC571\uC9C4\uB2E8\uB85C\uADF8',
  cheondeungsan: '\uCC9C\uB4F1\uC0B0',
};

const SITE_PRESETS = {
  cheondeungsan: TEXT.cheondeungsan,
  all: '',
};

function parseArgs(argv) {
  const out = {
    year: String(new Date().getFullYear()),
    month: String(new Date().getMonth() + 1).padStart(2, '0'),
    site: 'cheondeungsan',
    limitIssues: 80,
    listOnly: false,
    downloadDir: '',
    deleteAfterAnalysis: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--year' && next) out.year = next;
    if (arg === '--month' && next) out.month = String(next).padStart(2, '0');
    if (arg === '--site' && next) out.site = next;
    if (arg === '--limit-issues' && next) out.limitIssues = Number(next) || out.limitIssues;
    if (arg === '--list-only') out.listOnly = true;
    if (arg === '--download-dir' && next) out.downloadDir = next;
    if (arg === '--delete-after-analysis') out.deleteAfterAnalysis = true;
    if (arg.startsWith('--') && next && !['--list-only', '--delete-after-analysis'].includes(arg)) i += 1;
  }

  return out;
}

function escapeDriveQueryValue(value) {
  return String(value || '').replace(/'/g, "\\'");
}

function resolveSiteNeedle(siteArg) {
  return SITE_PRESETS[siteArg] !== undefined ? SITE_PRESETS[siteArg] : String(siteArg || '');
}

function safeParseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch (_) {
    return null;
  }
}

async function listDriveFiles(folderId, pageSize = 1000) {
  const files = [];
  let pageToken;
  do {
    const response = await drive.files.list({
      q: [
        `'${escapeDriveQueryValue(folderId)}' in parents`,
        'trashed=false',
      ].join(' and '),
      fields: 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink)',
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

async function downloadDriveText(fileId) {
  const response = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'text' }
  );
  return typeof response.data === 'string' ? response.data : String(response.data || '');
}

function summarizeEvents(events, limitIssues) {
  const byVersion = {};
  const byAction = {};
  const issues = [];

  for (const event of events) {
    const version = event.app_version || '?';
    byVersion[version] = (byVersion[version] || 0) + 1;

    const actionKey = `${event.area || ''}:${event.action || ''}:${event.result || ''}`;
    byAction[actionKey] = (byAction[actionKey] || 0) + 1;

    const status = event.details && (
      event.details.status ||
      event.details.statusCode ||
      event.details.responseStatus
    );
    const isIssue = ['error', 'warn'].includes(String(event.level || '').toLowerCase()) ||
      String(event.result || '').toLowerCase().includes('fail') ||
      Number(status) >= 400;

    if (isIssue) {
      issues.push({
        created_at: event.created_at,
        level: event.level,
        area: event.area,
        action: event.action,
        result: event.result,
        message: event.message,
        status,
        app_version: event.app_version,
        file: event.file,
        details: event.details,
      });
    }
  }

  return {
    eventCount: events.length,
    byVersion,
    issueCount: issues.length,
    byAction,
    issues: issues.slice(-limitIssues),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!isDriveConfigured()) {
    throw new Error('Google Drive is not configured. Check runtime config and GOOGLE_DRIVE_FOLDER_ID.');
  }

  const folder = await findFolderPath(getDriveRootFolderId(), [
    TEXT.diagnosticRoot,
    options.year,
    options.month,
  ]);
  if (!folder) {
    throw new Error(`Diagnostic folder not found: ${options.year}/${options.month}`);
  }

  const files = await listDriveFiles(folder.id);
  const siteNeedle = resolveSiteNeedle(options.site);
  const selectedFiles = siteNeedle
    ? files.filter((file) => String(file.name || '').includes(siteNeedle))
    : files;
  const diagnosticFiles = selectedFiles.filter((file) =>
    file.mimeType !== 'application/vnd.google-apps.folder' &&
    String(file.name || '').endsWith('_diagnostics.jsonl')
  );

  const fileSummary = diagnosticFiles.map((file) => ({
    name: file.name,
    size: file.size,
    createdTime: file.createdTime,
    modifiedTime: file.modifiedTime,
  }));

  console.log(JSON.stringify({
    folder: path.posix.join(TEXT.diagnosticRoot, options.year, options.month),
    totalFiles: files.length,
    selectedFiles: fileSummary,
  }, null, 2));

  if (options.listOnly) return;

  const events = [];
  const downloadedFiles = [];
  const downloadRoot = options.downloadDir ? path.resolve(options.downloadDir) : '';
  if (downloadRoot) fs.mkdirSync(downloadRoot, { recursive: true });
  for (const file of diagnosticFiles) {
    const text = await downloadDriveText(file.id);
    if (downloadRoot) {
      const safeName = path.basename(file.name);
      fs.writeFileSync(path.join(downloadRoot, safeName), text, 'utf8');
    }
    downloadedFiles.push(file);
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      const parsed = safeParseJsonLine(line);
      if (parsed) {
        events.push({ file: file.name, line: index + 1, ...parsed });
      } else {
        events.push({
          file: file.name,
          line: index + 1,
          level: 'parse-error',
          message: line.slice(0, 300),
        });
      }
    });
  }

  const summary = summarizeEvents(events, options.limitIssues);
  console.log('---SUMMARY---');
  const resultSummary = {
    selectedFileCount: diagnosticFiles.length,
    downloadedFileCount: downloadedFiles.length,
    eventCount: summary.eventCount,
    byVersion: summary.byVersion,
    issueCount: summary.issueCount,
    byAction: summary.byAction,
  };
  console.log(JSON.stringify(resultSummary, null, 2));
  console.log('---ISSUES---');
  console.log(JSON.stringify(summary.issues, null, 2));

  if (downloadRoot) {
    fs.writeFileSync(path.join(downloadRoot, 'analysis-summary.json'), JSON.stringify({
      generatedAt: new Date().toISOString(),
      folder: path.posix.join(TEXT.diagnosticRoot, options.year, options.month),
      ...resultSummary,
      issues: summary.issues,
    }, null, 2), 'utf8');
  }

  if (options.deleteAfterAnalysis) {
    if (downloadedFiles.length !== diagnosticFiles.length) {
      throw new Error(`Download count mismatch; refusing Drive deletion (${downloadedFiles.length}/${diagnosticFiles.length}).`);
    }
    for (const file of downloadedFiles) {
      await drive.files.delete({ fileId: file.id, supportsAllDrives: true });
    }
    const remaining = (await listDriveFiles(folder.id)).filter((file) =>
      file.mimeType !== 'application/vnd.google-apps.folder' &&
      String(file.name || '').endsWith('_diagnostics.jsonl')
    );
    console.log('---DELETE---');
    console.log(JSON.stringify({ deletedFileCount: downloadedFiles.length, remainingDiagnosticFileCount: remaining.length }, null, 2));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
