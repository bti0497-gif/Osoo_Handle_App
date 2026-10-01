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

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function importRuntimeDiagnostics(db, appDataPath, sourceFileName, fallbackArea) {
  const runtimeDirectory = path.join(appDataPath, 'runtime');
  const eventPath = path.join(runtimeDirectory, sourceFileName);
  const cursorPath = path.join(runtimeDirectory, `${sourceFileName}.import-state.json`);
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
      const remoteObservation = event.action === 'remote-session-detection';
      recordDiagnostic(db, appDataPath, {
        createdAt: event.createdAt,
        level: event.result === 'failed' ? 'error' : event.result === 'waiting' ? 'warn' : 'info',
        area: String(event.area || fallbackArea).slice(0, 80),
        action: String(event.action || 'unknown').slice(0, 100),
        result: String(event.result || '').slice(0, 50),
        message: `${fallbackArea} ${event.action || 'event'}: ${event.result || 'unknown'}`,
        details: remoteObservation ? {
          observationId: event.observation_id || null,
          detectorVersion: event.detector_version || null,
          overallState: event.overall_state || event.result || null,
          decisionReason: event.decision_reason || null,
          rustdesk: {
            state: event.rustdesk_state || null,
            evidence: event.rustdesk_evidence || null,
            processCount: nullableNumber(event.rustdesk_process_count),
            visibleWindow: typeof event.rustdesk_window_detected === 'boolean' ? event.rustdesk_window_detected : null,
          },
          chromeRemoteDesktop: {
            state: event.chrome_state || null,
            evidence: event.chrome_evidence || null,
            eventState: event.chrome_event_state || null,
            eventId: nullableNumber(event.chrome_event_id),
            eventAt: event.chrome_event_at || null,
            signalAgeSeconds: nullableNumber(event.chrome_signal_age_seconds),
          },
          rawSignals: event.raw_signals || {},
        } : {
          watchdogVersion: fallbackArea === 'watchdog' ? event.version || null : null,
          runtimeVersion: event.version || null,
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

function importWatchdogDiagnostics(db, appDataPath) {
  const watchdog = importRuntimeDiagnostics(db, appDataPath, 'watchdog-events.jsonl', 'watchdog');
  const electron = importRuntimeDiagnostics(db, appDataPath, 'electron-recovery-events.jsonl', 'electron');
  const remoteObservations = importRuntimeDiagnostics(db, appDataPath, 'remote-session-observations.jsonl', 'watchdog');
  return {
    success: Boolean(watchdog.success && electron.success && remoteObservations.success),
    imported: Number(watchdog.imported || 0) + Number(electron.imported || 0) + Number(remoteObservations.imported || 0),
    malformed: Number(watchdog.malformed || 0) + Number(electron.malformed || 0) + Number(remoteObservations.malformed || 0),
  };
}

module.exports = { importWatchdogDiagnostics };
