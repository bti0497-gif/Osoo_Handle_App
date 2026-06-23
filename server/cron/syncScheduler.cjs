const { runSyncIfIdle } = require('../services/bigQueryTriggerService.cjs');

// 유휴 상태 점검 주기. 실제 전송은 마지막 저장 후 설정된 유휴시간이 지난 경우에만 실행한다.
const SYNC_INTERVAL_MS = 10 * 60 * 1000;

let intervalId = null;
let isSyncing = false;

async function runSync() {
  if (isSyncing) {
    console.log('[Scheduler] 이전 동기화 작업이 아직 진행 중입니다. 건너뜁니다.');
    return;
  }

  isSyncing = true;
  try {
    const result = await runSyncIfIdle('scheduler');
    if (result?.skipped) return;

    const results = result?.results || {};
    const totalCount = Object.values(results).reduce((sum, row) => sum + (row.count || 0), 0);
    if (totalCount > 0) {
      console.log(`[Scheduler] 총 ${totalCount}건의 데이터가 BigQuery로 전송되었습니다.`);
    }
  } catch (err) {
    console.error('[Scheduler] 동기화 중 오류 발생:', err);
  } finally {
    isSyncing = false;
  }
}

function start() {
  if (intervalId) return;

  console.log(`[Scheduler] BigQuery 유휴 동기화 점검 시작 (점검 주기: ${SYNC_INTERVAL_MS / 1000 / 60}분)`);
  setTimeout(runSync, 10000);
  intervalId = setInterval(runSync, SYNC_INTERVAL_MS);
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[Scheduler] 스케줄러 중지');
  }
}

module.exports = { start, stop, runSync };
