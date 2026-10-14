'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { sanitize } = require('../server/services/diagnosticLogService.cjs');
const intervals = require('../server/services/loginInputIntervalService.cjs');
const originalRead = fs.readFileSync;
let snapshot = {
  checkedAt: new Date().toISOString(), inputMonitorId: 'monitor-a',
  keyboardHookReady: true, mouseHookReady: true,
  cumulative: { keyboardInjected: 10, keyboardNonInjected: 20, mouseInjected: 30, mouseNonInjected: 40 },
};
fs.readFileSync = () => JSON.stringify(snapshot);
try {
  const start = intervals.begin('isolated-test');
  snapshot.cumulative = { keyboardInjected: 18, keyboardNonInjected: 20, mouseInjected: 33, mouseNonInjected: 40 };
  const result = intervals.finish('isolated-test', start.intervalId);
  assert.equal(result.status, 'observed');
  assert.equal(result.keyboardInjected, 8);
  assert.equal(result.keyboardNonInjected, 0);
  assert.equal(result.mouseInjected, 3);
  assert.equal(intervals.finish('isolated-test', start.intervalId).status, 'baseline-unavailable');
  const restart = intervals.begin('isolated-test');
  snapshot.inputMonitorId = 'monitor-b';
  assert.equal(intervals.finish('isolated-test', restart.intervalId).status, 'monitor-restarted');
  snapshot.checkedAt = new Date(Date.now() - 20000).toISOString();
  assert.equal(intervals.begin('isolated-test').status, 'monitor-unavailable');
  snapshot.checkedAt = new Date().toISOString();
  delete snapshot.cumulative;
  assert.equal(intervals.begin('isolated-test').status, 'monitor-unavailable');
} finally { fs.readFileSync = originalRead; }
const safe = sanitize({ keyboardInjected: 8, keyboardNonInjected: 0, keyboardHookReady: true,
  keyboardInjectedLast5Seconds: 3, keyboardInjectedUnsafe: 'secret', keyboardInjectedText: 'secret',
  password: 'secret', privateKey: 'secret', keyboardInjectedString: 'secret' });
assert.equal(safe.keyboardInjected, 8);
assert.equal(safe.keyboardNonInjected, 0);
assert.equal(safe.keyboardHookReady, true);
assert.equal(safe.keyboardInjectedLast5Seconds, 3);
for (const field of ['password', 'privateKey']) {
  assert.equal(safe[field], '<redacted>');
}
assert.equal(sanitize({ keyboardInjected: 'secret' }).keyboardInjected, '<redacted>');
console.log('PASS login input interval: counter difference, restart/stale/legacy fallback, one-use baseline, statistics-only redaction exceptions');
