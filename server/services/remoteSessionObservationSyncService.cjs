'use strict';

const fs = require('fs');
const path = require('path');
const { getBigQueryClient, DATASET_ID } = require('./bigQueryClientService.cjs');

const TABLE_NAME = 'remote_session_observations';

function getDefaultPaths() {
  const { appDataPath } = require('../database.cjs');
  const runtimePath = path.join(appDataPath, 'runtime');
  return {
    observationFile: path.join(runtimePath, 'remote-session-observations.jsonl'),
    cursorFile: path.join(runtimePath, 'remote-session-observations.bq-cursor.json'),
  };
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getAppVersion() {
  const fromEnvironment = String(process.env.OSOO_APP_VERSION || '').trim();
  if (fromEnvironment) return fromEnvironment;
  try { return String(require('../../package.json').version || ''); } catch (_) { return ''; }
}

function readCursor(cursorFile, fileSize) {
  try {
    const value = JSON.parse(fs.readFileSync(cursorFile, 'utf8'));
    const offset = Number(value.offset);
    return Number.isSafeInteger(offset) && offset >= 0 && offset <= fileSize ? offset : 0;
  } catch (_) {
    return 0;
  }
}

function writeCursor(cursorFile, offset) {
  const temporaryPath = `${cursorFile}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify({ offset, updatedAt: new Date().toISOString() }), 'utf8');
  fs.renameSync(temporaryPath, cursorFile);
}

function readPendingObservations(observationFile, cursorFile) {
  if (!observationFile || !cursorFile) {
    const defaults = getDefaultPaths();
    observationFile = observationFile || defaults.observationFile;
    cursorFile = cursorFile || defaults.cursorFile;
  }
  if (!fs.existsSync(observationFile)) return { rows: [], offset: 0, nextOffset: 0 };
  const stat = fs.statSync(observationFile);
  const offset = readCursor(cursorFile, stat.size);
  if (offset === stat.size) return { rows: [], offset, nextOffset: offset };

  const buffer = Buffer.alloc(stat.size - offset);
  const fd = fs.openSync(observationFile, 'r');
  try {
    fs.readSync(fd, buffer, 0, buffer.length, offset);
  } finally {
    fs.closeSync(fd);
  }
  const lastNewline = buffer.lastIndexOf(0x0a);
  if (lastNewline < 0) return { rows: [], offset, nextOffset: offset };

  const completeText = buffer.subarray(0, lastNewline).toString('utf8');
  const rows = completeText.split(/\r?\n/).filter(Boolean).map((line) => {
    const event = JSON.parse(line);
    if (event.action !== 'remote-session-detection' || !event.observation_id || !event.createdAt) {
      throw new Error('remote-session-observation-invalid-record');
    }
    return event;
  });
  return { rows, offset, nextOffset: offset + lastNewline + 1 };
}

async function syncRemoteSessionObservations(options = {}) {
  const defaults = options.observationFile && options.cursorFile ? null : getDefaultPaths();
  const observationFile = options.observationFile || defaults.observationFile;
  const cursorFile = options.cursorFile || defaults.cursorFile;
  const localDb = options.db || require('../database.cjs').db;
  const getClient = options.getBigQueryClient || getBigQueryClient;
  let pending;
  try {
    pending = readPendingObservations(observationFile, cursorFile);
  } catch (error) {
    return { success: false, count: 0, error: error.message };
  }
  if (pending.rows.length === 0) {
    if (pending.nextOffset > pending.offset) writeCursor(cursorFile, pending.nextOffset);
    return { success: true, count: 0 };
  }

  const bq = getClient();
  if (!bq) return { success: false, count: 0, error: 'bigquery-client-unavailable' };

  const site = options.siteInfo || (() => {
    const row = localDb.prepare('SELECT site_id, site_name FROM app_settings WHERE id = 1').get() || {};
    return { siteId: row.site_id || null, siteName: row.site_name || null };
  })();
  const rows = pending.rows.map((event) => ({
    observation_id: String(event.observation_id),
    site_id: site.siteId,
    site_name: site.siteName,
    observed_at: event.createdAt,
    uploaded_at: new Date().toISOString(),
    app_version: options.appVersion || getAppVersion(),
    watchdog_version: String(event.version || ''),
    detector_version: String(event.detector_version || ''),
    overall_state: String(event.overall_state || event.result || 'unknown'),
    decision_reason: String(event.decision_reason || ''),
    rustdesk_state: String(event.rustdesk_state || 'unknown'),
    rustdesk_evidence: String(event.rustdesk_evidence || ''),
    rustdesk_signal_at: event.rustdesk_signal_at || null,
    rustdesk_process_count: nullableNumber(event.rustdesk_process_count),
    rustdesk_window_detected: typeof event.rustdesk_window_detected === 'boolean' ? event.rustdesk_window_detected : null,
    chrome_state: String(event.chrome_state || 'unknown'),
    chrome_evidence: String(event.chrome_evidence || ''),
    chrome_event_state: String(event.chrome_event_state || 'unknown'),
    chrome_event_id: nullableNumber(event.chrome_event_id),
    chrome_event_at: event.chrome_event_at || null,
    chrome_signal_age_seconds: nullableNumber(event.chrome_signal_age_seconds),
    raw_signals: JSON.stringify(event.raw_signals || {}),
  }));

  try {
    await bq.query({
      query: `
        CREATE TEMP TABLE source_rows AS
        SELECT
          JSON_VALUE(item, '$.observation_id') AS observation_id,
          NULLIF(JSON_VALUE(item, '$.site_id'), '') AS site_id,
          JSON_VALUE(item, '$.site_name') AS site_name,
          SAFE_CAST(JSON_VALUE(item, '$.observed_at') AS TIMESTAMP) AS observed_at,
          SAFE_CAST(JSON_VALUE(item, '$.uploaded_at') AS TIMESTAMP) AS uploaded_at,
          JSON_VALUE(item, '$.app_version') AS app_version,
          JSON_VALUE(item, '$.watchdog_version') AS watchdog_version,
          JSON_VALUE(item, '$.detector_version') AS detector_version,
          JSON_VALUE(item, '$.overall_state') AS overall_state,
          JSON_VALUE(item, '$.decision_reason') AS decision_reason,
          JSON_VALUE(item, '$.rustdesk_state') AS rustdesk_state,
          JSON_VALUE(item, '$.rustdesk_evidence') AS rustdesk_evidence,
          SAFE_CAST(JSON_VALUE(item, '$.rustdesk_signal_at') AS TIMESTAMP) AS rustdesk_signal_at,
          SAFE_CAST(JSON_VALUE(item, '$.rustdesk_process_count') AS INT64) AS rustdesk_process_count,
          SAFE_CAST(JSON_VALUE(item, '$.rustdesk_window_detected') AS BOOL) AS rustdesk_window_detected,
          JSON_VALUE(item, '$.chrome_state') AS chrome_state,
          JSON_VALUE(item, '$.chrome_evidence') AS chrome_evidence,
          JSON_VALUE(item, '$.chrome_event_state') AS chrome_event_state,
          SAFE_CAST(JSON_VALUE(item, '$.chrome_event_id') AS INT64) AS chrome_event_id,
          SAFE_CAST(JSON_VALUE(item, '$.chrome_event_at') AS TIMESTAMP) AS chrome_event_at,
          SAFE_CAST(JSON_VALUE(item, '$.chrome_signal_age_seconds') AS INT64) AS chrome_signal_age_seconds,
          PARSE_JSON(JSON_VALUE(item, '$.raw_signals')) AS raw_signals
        FROM UNNEST(JSON_QUERY_ARRAY(@rows_json)) AS item;

        MERGE \`${DATASET_ID}.${TABLE_NAME}\` AS target
        USING source_rows AS source
        ON target.observation_id = source.observation_id
        WHEN MATCHED THEN UPDATE SET
          site_id = source.site_id,
          site_name = source.site_name,
          observed_at = source.observed_at,
          uploaded_at = source.uploaded_at,
          app_version = source.app_version,
          watchdog_version = source.watchdog_version,
          detector_version = source.detector_version,
          overall_state = source.overall_state,
          decision_reason = source.decision_reason,
          rustdesk_state = source.rustdesk_state,
          rustdesk_evidence = source.rustdesk_evidence,
          rustdesk_signal_at = source.rustdesk_signal_at,
          rustdesk_process_count = source.rustdesk_process_count,
          rustdesk_window_detected = source.rustdesk_window_detected,
          chrome_state = source.chrome_state,
          chrome_evidence = source.chrome_evidence,
          chrome_event_state = source.chrome_event_state,
          chrome_event_id = source.chrome_event_id,
          chrome_event_at = source.chrome_event_at,
          chrome_signal_age_seconds = source.chrome_signal_age_seconds,
          raw_signals = source.raw_signals
        WHEN NOT MATCHED THEN INSERT (
          observation_id, site_id, site_name, observed_at, uploaded_at, app_version,
          watchdog_version, detector_version, overall_state, decision_reason,
          rustdesk_state, rustdesk_evidence, rustdesk_signal_at, rustdesk_process_count,
          rustdesk_window_detected, chrome_state, chrome_evidence, chrome_event_state,
          chrome_event_id, chrome_event_at, chrome_signal_age_seconds, raw_signals
        ) VALUES (
          source.observation_id, source.site_id, source.site_name, source.observed_at,
          source.uploaded_at, source.app_version, source.watchdog_version, source.detector_version,
          source.overall_state, source.decision_reason, source.rustdesk_state,
          source.rustdesk_evidence, source.rustdesk_signal_at, source.rustdesk_process_count,
          source.rustdesk_window_detected, source.chrome_state, source.chrome_evidence,
          source.chrome_event_state, source.chrome_event_id, source.chrome_event_at,
          source.chrome_signal_age_seconds, source.raw_signals
        );
      `,
      params: { rows_json: JSON.stringify(rows) },
    });
    writeCursor(cursorFile, pending.nextOffset);
    return { success: true, count: rows.length };
  } catch (error) {
    return { success: false, count: 0, error: error.message };
  }
}

module.exports = { readPendingObservations, syncRemoteSessionObservations };
