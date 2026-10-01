'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readPendingObservations, syncRemoteSessionObservations } = require('../server/services/remoteSessionObservationSyncService.cjs');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osoo-remote-observations-'));
  const observationFile = path.join(root, 'remote-session-observations.jsonl');
  const cursorFile = path.join(root, 'remote-session-observations.bq-cursor.json');
  const event = {
    observation_id: 'obs-001',
    createdAt: '2026-10-01T01:00:00.000Z',
    version: '1.0.9',
    detector_version: '1',
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
  fs.writeFileSync(observationFile, `${completeLine}{"partial":`, 'utf8');

  try {
    const firstRead = readPendingObservations(observationFile, cursorFile);
    assert.equal(firstRead.rows.length, 1, 'only complete JSONL records should be read');
    assert.equal(firstRead.rows[0].observation_id, 'obs-001');
    assert.equal(firstRead.nextOffset, Buffer.byteLength(completeLine));

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
      db: fakeDb,
      getBigQueryClient: () => fakeBigQuery,
      appVersion: '1.1.52-test',
    });
    assert.deepEqual(result, { success: true, count: 1 });
    assert.match(captured.query, /MERGE `daily_log_system\.remote_session_observations`/);
    assert.match(captured.query, /target\.observation_id = source\.observation_id/);
    const sentRows = JSON.parse(captured.params.rows_json);
    assert.equal(sentRows[0].site_id, 'site-1');
    assert.equal(sentRows[0].site_name, '테스트현장');
    assert.equal(sentRows[0].watchdog_version, '1.0.9');
    assert.equal(sentRows[0].chrome_signal_age_seconds, null);
    assert.deepEqual(JSON.parse(sentRows[0].raw_signals), { probe: 'test' });
    assert.equal(JSON.parse(fs.readFileSync(cursorFile, 'utf8')).offset, Buffer.byteLength(completeLine));

    const failingCursor = path.join(root, 'failed-cursor.json');
    const failed = await syncRemoteSessionObservations({
      observationFile,
      cursorFile: failingCursor,
      db: fakeDb,
      getBigQueryClient: () => ({ query: async () => { throw new Error('simulated-offline'); } }),
      appVersion: 'test',
    });
    assert.equal(failed.success, false);
    assert.equal(fs.existsSync(failingCursor), false, 'failed BigQuery writes must leave the local cursor unchanged for retry');

    console.log('PASS remote session observation batching, schema mapping, dedupe MERGE, and retry cursor');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
