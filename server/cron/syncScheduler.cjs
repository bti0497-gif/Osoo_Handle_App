const bigQuerySyncService = require('../services/bigQuerySyncService.cjs');

// 설정: 동기화 주기 (밀리초 단위)
// 기본값: 10분 (10 * 60 * 1000)
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
    // console.log('[Scheduler] BigQuery 동기화 시작...');
    const results = await bigQuerySyncService.syncAll();
    
    // 전송된 데이터가 있을 때만 로그 출력
    const totalCount = Object.values(results).reduce((sum, res) => sum + (res.count || 0), 0);
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
  
  console.log(`[Scheduler] 백그라운드 동기화 스케줄러 시작 (주기: ${SYNC_INTERVAL_MS / 1000 / 60}분)`);
  // 서버 시작 직후 10초 뒤에 한 번 실행 (초기 데이터 적재)
  setTimeout(runSync, 10000);
  // 이후 주기적으로 실행
  intervalId = setInterval(runSync, SYNC_INTERVAL_MS);
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[Scheduler] 스케줄러 중지됨');
  }
}

module.exports = { start, stop, runSync };