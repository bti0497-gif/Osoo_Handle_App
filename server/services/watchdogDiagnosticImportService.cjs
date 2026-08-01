'use strict';

const fs = require('fs');
const path = require('path');
const { recordDiagnostic } = require('./diagnosticLogService.cjs');

const MAX_EVENT_BYTES = 2 * 1024 * 1024;

function readCursor(cursorPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cursorPath, 'utf8'));
    return Number.isSafeInteger(parsed.offset) && parsed.offset >= 0 ? parsed.offset : 0;
  } catch (_) {
    return 0;
  }
}

function writeCursor(cursorPath, offset) {
  fs.writeFileSync(cursorPath, JSON.stringify({ offset, importedAt: new Date().toISOString() }, null, 2), 'utf8');
}

function importWatchdogDiagnostics(db, appDataPath) {
  const runtimeDirectory = path.join(appDataPath, 'runtime');
  const eventPath = path.join(runtimeDirectory, 'watchdog-events.jsonl');
  const cursorPath = path.join(runtimeDirectory, 'watchdog-import-state.json');
  if (!fs.existsSync(eventPath)) return { success: true, imported: 0, skipped: true };

  const fileSize = fs.statSync(eventPath).size;
  let offset = readCursor(cursorPath);
  if (offset > fileSize) offset = 0;
  if (fileSize === offset) return { success: true, imported: 0, offset };

  const readStart = Math.max(offset, fileSize - MAX_EVENT_BYTES);
  const buffer = Buffer.alloc(fileSize - readStart);
  const descriptor = fs.openSync(eventPath, 'r');
  try {
    fs.readSync(descriptor, buffer, 0, buffer.length, readStart);
  } finally {
    fs.closeSync(descriptor);
  }

  const text = buffer.toString('utf8');
  const lastNewline = text.lastIndexOf('\n');
  if (lastNewline < 0) return { success: true, imported: 0, offset };
  const completeText = text.slice(0, lastNewline);
  const lines = completeText.split(/\r?\n/).filter(Boolean);
  let imported = 0;
  let malformed = 0;
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      recordDiagnostic(db, appDataPath, {
        createdAt: event.createdAt,
        level: event.result === 'failed' ? 'error' : event.result === 'waiting' ? 'warn' : 'info',
        area: 'watchdog',
        action: String(event.action || 'unknown').slice(0, 100),
        result: String(event.result || '').slice(0, 50),
        message: `watchdog ${event.action || 'event'}: ${event.result || 'unknown'}`,
        details: {
          watchdogVersion: event.version || null,
          summary: event.details || null,
        },
      });
      imported += 1;
    } catch (_) {
      malformed += 1;
    }
  }

  const consumedBytes = Buffer.byteLength(text.slice(0, lastNewline + 1), 'utf8');
  const nextOffset = readStart + consumedBytes;
  writeCursor(cursorPath, nextOffset);
  return { success: true, imported, malformed, offset: nextOffset };
}

module.exports = { importWatchdogDiagnostics };
