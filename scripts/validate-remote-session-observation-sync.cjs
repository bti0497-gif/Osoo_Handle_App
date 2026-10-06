'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  appendRemoteLoginAttemptObservation,
  readPendingObservations,
  syncRemoteSessionObservations,
} = require('../server/services/remoteSessionObservationSyncService.cjs');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osoo-remote-observations-'));
  const observationFile = path.join(root, 'remote-session-observations.jsonl');
  const cursorFile = path.join(root, 'remote-session-observations.bq-cursor.json');
  const loginAttemptFile = path.join(root, 'remote-login-attempts.jsonl');
  const loginAttemptCursorFile = path.join(root, 'remote-login-attempts.bq-cursor.json');
  const event = {
    observation_id: 'obs-001',
    createdAt: '2026-10-01T01:00:00.000Z',
    version: '1.0.10',
    detector_version: '2',
    action: 'remote-session-detection',
    result: 'unknown',
    overall_state: 'unknown',
    decision_reason: 'no-active-source-and-one-or-more-source-unknown',
    rustdesk_state: 'clear',
    rustdesk_evidence: 'no-active-session-window',
    rustdesk_process_count: 1,
    rustdesk_window_detected: false,
    chrome_state: 'unknown',
    chrome_evidence: 'no-session-event-in-recent-history',
    chrome_event_state: 'unknown',
    chrome_event_id: null,
    chrome_event_at: null,
    chrome_signal_age_seconds: null,
    raw_signals: { probe: 'test' },
  };
  const completeLine = `${JSON.stringify(event)}\n`;
  const inputEvent = {
    observation_id: 'input-001',
    createdAt: '2026-10-01T01:00:30.000Z',
    version: '1.0.13',
    watchdog_version: '1.0.13',
    detector_version: '4',
    action: 'remote-input-observation',
    result: 'active',
    overall_state: 'active',
    decision_reason: 'foreground-app-input-aggregate;origin-unverified',
    rustdesk_state: 'clear',
    chrome_state: 'active',
    raw_signals: { inputObservation: { captureScope: 'foreground-app-only', inputOrigin: 'unverified', windowSeconds: 30, keyboardInjected: 7, keyboardNonInjected: 3, mouseInjected: 2, mouseNonInjected: 1 } },
  };
  const inputLine = `${JSON.stringify(inputEvent)}\n`;
  fs.writeFileSync(observationFile, `${completeLine}${inputLine}{"partial":`, 'utf8');
  appendRemoteLoginAttemptObservation({
    observation_id: 'attempt-001',
    createdAt: '2026-10-01T01:02:00.000Z',
    version: '1.1.52-test',
    watchdog_version: '1.0.10',
    detector_version: '2',
    action: 'remote-login-attempt',
    result: 'attempt-observed',
    overall_state: 'active',
    decision_reason: 'login-submit;remote-session-active;input-origin-unverified;policy-observe-only',
    rustdesk_state: 'clear',
    chrome_state: 'active',
    chrome_event_state: 'not-captured-at-login-submit',
    raw_signals: {
      loginAttempt: { attemptedName: '테스트 사용자', credentialProvided: true, inputOrigin: 'unverified', passwordValueCaptured: false },
      remoteSession: { state: 'active', sessionType: 'Chrome Remote Desktop' },
    },
  }, { loginAttemptFile });

  try {
    const firstRead = readPendingObservations(observationFile, cursorFile);
    assert.equal(firstRead.rows.length, 2, 'only complete JSONL records should be read');
    assert.equal(firstRead.rows[0].observation_id, 'obs-001');
    assert.equal(firstRead.rows[1].action, 'remote-input-observation');
    assert.equal(firstRead.nextOffset, Buffer.byteLength(completeLine + inputLine));
    const pendingAttempts = readPendingObservations(loginAttemptFile, loginAttemptCursorFile);
    assert.equal(pendingAttempts.rows.length, 1, 'remote login submissions must use the existing observation contract');
    assert.equal(pendingAttempts.rows[0].action, 'remote-login-attempt');

    let captured;
    const fakeBigQuery = {
      async query(options) {
        captured = options;
        return [{}];
      },
    };
    const fakeDb = { prepare: () => ({ get: () => ({ site_id: 'site-1', site_name: '테스트현장' }) }) };
    const result = await syncRemoteSessionObservations({
      observationFile,
      cursorFile,
      loginAttemptFile,
      loginAttemptCursorFile,
      db: fakeDb,
      getBigQueryClient: () => fakeBigQuery,
      appVersion: '1.1.52-test',
    });
    assert.deepEqual(result, { success: true, count: 3 });
    assert.match(captured.query, /MERGE `daily_log_system\.remote_session_observations`/);
    assert.match(captured.query, /target\.observation_id = source\.observation_id/);
    const sentRows = JSON.parse(captured.params.rows_json);
    const attemptRow = sentRows.find((row) => row.observation_id === 'attempt-001');
    assert.ok(attemptRow, 'login attempts must be merged into the existing BigQuery table');
    assert.match(attemptRow.decision_reason, /remote-login-attempt\|login-submit/);
    assert.equal(JSON.parse(attemptRow.raw_signals).loginAttempt.passwordValueCaptured, false);
    assert.equal(JSON.parse(attemptRow.raw_signals).loginAttempt.inputOrigin, 'unverified');
    assert.equal(JSON.parse(attemptRow.raw_signals).loginAttempt.attemptedName, '테스트 사용자');
    const inputRow = sentRows.find((row) => row.observation_id === 'input-001');
    assert.ok(inputRow, 'foreground input summaries must be included in the existing BigQuery observation sync');
    assert.match(inputRow.decision_reason, /^remote-input-observation\|foreground-app-input-aggregate/);
    assert.equal(inputRow.watchdog_version, '1.0.13');
    assert.equal(JSON.parse(inputRow.raw_signals).inputObservation.keyboardInjected, 7);
    assert.equal(JSON.parse(inputRow.raw_signals).inputObservation.keyboardNonInjected, 3);
    assert.equal(sentRows[0].site_id, 'site-1');
    assert.equal(sentRows[0].site_name, '테스트현장');
    assert.equal(sentRows[0].watchdog_version, '1.0.10');
    assert.equal(sentRows[0].chrome_signal_age_seconds, null);
    assert.deepEqual(JSON.parse(sentRows[0].raw_signals), { probe: 'test' });
    assert.equal(JSON.parse(fs.readFileSync(cursorFile, 'utf8')).offset, Buffer.byteLength(completeLine + inputLine));

    const failingCursor = path.join(root, 'failed-cursor.json');
    const failed = await syncRemoteSessionObservations({
      observationFile,
      cursorFile: failingCursor,
      loginAttemptFile,
      loginAttemptCursorFile: path.join(root, 'failed-attempt-cursor.json'),
      db: fakeDb,
      getBigQueryClient: () => ({ query: async () => { throw new Error('simulated-offline'); } }),
      appVersion: 'test',
    });
    assert.equal(failed.success, false);
    assert.equal(fs.existsSync(failingCursor), false, 'failed BigQuery writes must leave the local cursor unchanged for retry');
    assert.equal(fs.existsSync(path.join(root, 'failed-attempt-cursor.json')), false, 'failed login-attempt writes must remain queued for retry');

    console.log('PASS remote session and non-blocking login-attempt batching, schema mapping, dedupe MERGE, and retry cursors');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
