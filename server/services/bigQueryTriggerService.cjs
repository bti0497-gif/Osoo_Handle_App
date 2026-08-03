const { syncAll } = require('./bigQuerySyncService.cjs');
const { isAdminSessionActive, getActiveUser } = require('./activeUserSessionService.cjs');

const DEFAULT_IDLE_DELAY_MS = 30 * 60 * 1000;
const configuredIdleMinutes = Number(process.env.BIGQUERY_SYNC_IDLE_MINUTES || 30);
const IDLE_DELAY_MS = Number.isFinite(configuredIdleMinutes) && configuredIdleMinutes > 0
  ? configuredIdleMinutes * 60 * 1000
  : DEFAULT_IDLE_DELAY_MS;

let isSyncing = false;
let lastWriteAt = Date.now();
let activityVersion = 0;

async function runSync(reason = 'manual') {
  const isEnabled = String(process.env.BIGQUERY_SYNC_ENABLED || 'true') === 'true';
  if (!isEnabled) {
    return { queued: false, skipped: true, reason: 'BIGQUERY_SYNC_ENABLED=false' };
  }

  if (isAdminSessionActive()) {
    const activeUser = getActiveUser();
    console.log(`[BigQuery Trigger] ${reason} 동기화 건너뜀: admin 세션 활성 (${activeUser?.name || 'admin'})`);
    return {
      queued: false,
      skipped: true,
      reason: 'admin-session-active',
      activeUser,
    };
  }

  if (isSyncing) {
    return { queued: true, skipped: true, reason: 'already-running' };
  }

  isSyncing = true;
  const startedAtActivityVersion = activityVersion;
  try {
    const results = await syncAll({
      shouldContinue: () => activityVersion === startedAtActivityVersion,
    });
    const failedTables = Object.entries(results || {})
      .filter(([, row]) => row?.success === false)
      .map(([tableName]) => tableName);
    if (failedTables.length > 0) {
      throw new Error(`BigQuery table sync failed: ${failedTables.join(', ')}`);
    }
    const totalCount = Object.values(results || {}).reduce((sum, row) => sum + (row?.count || 0), 0);
    if (totalCount > 0) {
      console.log(`[BigQuery Trigger] ${reason} 동기화 완료: ${totalCount}건 전송`);
    }
    return { queued: false, results };
  } catch (error) {
    console.error(`[BigQuery Trigger] ${reason} 동기화 실패:`, error.message);
    return { queued: false, error: error.message };
  } finally {
    isSyncing = false;
  }
}

function notifyUserActivity(reason = 'renderer-input') {
  activityVersion += 1;
  lastWriteAt = Date.now();
  return { activityVersion, idleDelayMs: IDLE_DELAY_MS, reason };
}

function createUserIdleGuard() {
  const version = activityVersion;
  return () => version === activityVersion;
}

async function runSyncIfIdle(reason = 'scheduler') {
  const elapsed = Date.now() - lastWriteAt;
  if (elapsed < IDLE_DELAY_MS) {
    return {
      queued: false,
      skipped: true,
      reason: 'waiting-for-idle',
      remainingMs: IDLE_DELAY_MS - elapsed,
    };
  }
  return runSync(reason);
}

module.exports = {
  runSync,
  runSyncIfIdle,
  notifyUserActivity,
  createUserIdleGuard,
  IDLE_DELAY_MS,
};
