const bigQuerySyncService = require('../services/bigQuerySyncService.cjs');

// ?ㅼ젙: ?숆린??二쇨린 (諛由ъ큹 ?⑥쐞)
// 湲곕낯媛? 10遺?(10 * 60 * 1000)
const SYNC_INTERVAL_MS = 10 * 60 * 1000;

let intervalId = null;
let isSyncing = false;

async function runSync() {
  if (isSyncing) {
    console.log('[Scheduler] ?댁쟾 ?숆린???묒뾽???꾩쭅 吏꾪뻾 以묒엯?덈떎. 嫄대꼫?곷땲??');
    return;
  }

  isSyncing = true;
  try {
    // console.log('[Scheduler] BigQuery ?숆린???쒖옉...');
    const results = await bigQuerySyncService.syncAll();
    
    // ?꾩넚???곗씠?곌? ?덉쓣 ?뚮쭔 濡쒓렇 異쒕젰
    const totalCount = Object.values(results).reduce((sum, res) => sum + (res.count || 0), 0);
    if (totalCount > 0) {
      console.log(`[Scheduler] 珥?${totalCount}嫄댁쓽 ?곗씠?곌? BigQuery濡??꾩넚?섏뿀?듬땲??`);
    }
  } catch (err) {
    console.error('[Scheduler] ?숆린??以??ㅻ쪟 諛쒖깮:', err);
  } finally {
    isSyncing = false;
  }
}

function start() {
  if (intervalId) return;
  
  console.log(`[Scheduler] 諛깃렇?쇱슫???숆린???ㅼ?以꾨윭 ?쒖옉 (二쇨린: ${SYNC_INTERVAL_MS / 1000 / 60}遺?`);
  // ?쒕쾭 ?쒖옉 吏곹썑 10珥??ㅼ뿉 ??踰??ㅽ뻾 (珥덇린 ?곗씠???곸옱)
  setTimeout(runSync, 10000);
  // ?댄썑 二쇨린?곸쑝濡??ㅽ뻾
  intervalId = setInterval(runSync, SYNC_INTERVAL_MS);
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[Scheduler] ?ㅼ?以꾨윭 以묒???);
  }
}

module.exports = { start, stop, runSync };