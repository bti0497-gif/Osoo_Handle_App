const { syncAll } = require('./bigQuerySyncService.cjs');

let isSyncing = false;
let hasPending = false;
let lastReason = '';

async function runSync(reason = 'manual') {
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
      const pendingReason = lastReason || 'pending';
      lastReason = '';
      setTimeout(() => {
        runSync(`queued:${pendingReason}`).catch((err) => {
          console.error('[BigQuery Trigger] queued sync failed:', err.message);
        });
      }, 0);
    }
  }
}

function triggerSync(reason = 'manual') {
  setTimeout(() => {
    runSync(reason).catch((err) => {
      console.error('[BigQuery Trigger] async trigger failed:', err.message);
    });
  }, 0);
}

module.exports = {
  triggerSync,
  runSync,
};
