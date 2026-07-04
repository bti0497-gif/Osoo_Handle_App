const { syncAll } = require('./bigQuerySyncService.cjs');
const { isAdminSessionActive, getActiveUser } = require('./activeUserSessionService.cjs');

const DEFAULT_IDLE_DELAY_MS = 30 * 60 * 1000;
const configuredIdleMinutes = Number(process.env.BIGQUERY_SYNC_IDLE_MINUTES || 30);
const IDLE_DELAY_MS = Number.isFinite(configuredIdleMinutes) && configuredIdleMinutes > 0
  ? configuredIdleMinutes * 60 * 1000
  : DEFAULT_IDLE_DELAY_MS;

let isSyncing = false;
let hasPending = false;
let lastReason = '';
let lastWriteAt = Date.now();
let idleTimer = null;

function scheduleIdleSync(reason = 'after-save') {
  lastReason = reason;
  if (idleTimer) clearTimeout(idleTimer);

  const elapsed = Date.now() - lastWriteAt;
  const remaining = Math.max(0, IDLE_DELAY_MS - elapsed);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    runSyncIfIdle(`idle:${lastReason || reason}`).catch((err) => {
      console.error('[BigQuery Trigger] idle sync failed:', err.message);
    });
  }, remaining);
}

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
    hasPending = true;
    lastReason = reason;
    return { queued: true };
  }

  isSyncing = true;
  try {
    const results = await syncAll();
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
    if (hasPending) {
      hasPending = false;
      scheduleIdleSync(`queued:${lastReason || 'pending'}`);
    }
  }
}

function triggerSync(reason = 'after-save') {
  lastWriteAt = Date.now();
  scheduleIdleSync(reason);
}

async function runSyncIfIdle(reason = 'scheduler') {
  const elapsed = Date.now() - lastWriteAt;
  if (elapsed < IDLE_DELAY_MS) {
    scheduleIdleSync(reason);
    return {
      queued: true,
      skipped: true,
      reason: 'waiting-for-idle',
      remainingMs: IDLE_DELAY_MS - elapsed,
    };
  }
  return runSync(reason);
}

module.exports = {
  triggerSync,
  runSync,
  runSyncIfIdle,
  IDLE_DELAY_MS,
};
