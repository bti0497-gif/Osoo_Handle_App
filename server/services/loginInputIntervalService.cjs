'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const baselines = new Map();
const fields = ['keyboardInjected', 'keyboardNonInjected', 'mouseInjected', 'mouseNonInjected'];
const ttlMs = 10 * 60 * 1000;

function readSnapshot(appDataPath) {
  try {
    const snapshot = JSON.parse(fs.readFileSync(path.join(appDataPath, 'runtime', 'remote-input-state.json'), 'utf8'));
    const ageMs = Date.now() - Date.parse(snapshot.checkedAt);
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 3000) return null;
    if (!snapshot.keyboardHookReady || !snapshot.mouseHookReady || !snapshot.inputMonitorId
      || !fields.every((field) => Number.isSafeInteger(snapshot.cumulative?.[field]) && snapshot.cumulative[field] >= 0)) return null;
    return snapshot;
  } catch { return null; }
}

function begin(appDataPath) {
  const now = Date.now();
  for (const [id, row] of baselines) if (now - row.startedAt > ttlMs) baselines.delete(id);
  const snapshot = readSnapshot(appDataPath);
  if (!snapshot) return { success: true, status: 'monitor-unavailable', intervalId: null };
  if (baselines.size >= 100) baselines.delete(baselines.keys().next().value);
  const intervalId = crypto.randomUUID();
  baselines.set(intervalId, { appDataPath, startedAt: now, snapshot });
  return { success: true, status: 'started', intervalId };
}

function finish(appDataPath, intervalId) {
  const row = baselines.get(intervalId);
  baselines.delete(intervalId);
  if (!row || row.appDataPath !== appDataPath || Date.now() - row.startedAt > ttlMs) return { status: 'baseline-unavailable' };
  const snapshot = readSnapshot(appDataPath);
  if (!snapshot) return { status: 'monitor-unavailable' };
  if (snapshot.inputMonitorId !== row.snapshot.inputMonitorId) return { status: 'monitor-restarted' };
  const counts = Object.fromEntries(fields.map((field) => [field, snapshot.cumulative[field] - row.snapshot.cumulative[field]]));
  if (Object.values(counts).some((count) => count < 0)) return { status: 'counter-reset' };
  return {
    status: 'observed', ...counts,
    baselineCheckedAt: row.snapshot.checkedAt, submitCheckedAt: snapshot.checkedAt,
    durationMs: Date.now() - row.startedAt, snapshotIntervalMs: 1000,
    inputOrigin: 'unverified', captureScope: 'foreground-app-only',
    interpretation: 'Focus-to-submit cumulative snapshot difference; boundaries are sampled, not exact. Counts include all app input in this interval, not password characters.',
  };
}
module.exports = { begin, finish };
