/**
 * Watchdog: server.cjs 자동 재시작 관리자
 * 배포 환경에서 이 파일을 node start.cjs 로 실행하세요.
 */
const { spawn } = require('child_process');
const path = require('path');

const SERVER_SCRIPT = path.join(__dirname, 'server.cjs');
const MAX_CONSECUTIVE_CRASHES = 5;
const BASE_DELAY_MS = 2000;
const STABLE_UPTIME_MS = 30000; // 30초 이상 정상 동작하면 크래시 카운트 리셋

let crashCount = 0;
let child = null;
let isShuttingDown = false;

function startServer() {
  if (isShuttingDown) return;

  console.log(`[워치독] 서버 시작 중... (시도 #${crashCount + 1})`);
  const startTime = Date.now();

  child = spawn('node', [SERVER_SCRIPT], {
    stdio: 'inherit',
    cwd: __dirname
  });

  child.on('error', (err) => {
    console.error('[워치독] 프로세스 시작 실패:', err.message);
    scheduleRestart(startTime);
  });

  child.on('exit', (code, signal) => {
    if (isShuttingDown) return;
    if (signal === 'SIGINT' || signal === 'SIGTERM' || code === 0) {
      console.log('[워치독] 서버가 정상 종료되었습니다.');
      process.exit(0);
    }
    console.warn(`[워치독] 서버가 비정상 종료됨 (코드: ${code}, 시그널: ${signal})`);
    scheduleRestart(startTime);
  });
}

function scheduleRestart(startTime) {
  const uptime = Date.now() - startTime;
  if (uptime > STABLE_UPTIME_MS) {
    crashCount = 0; // 안정적으로 실행됐으면 카운트 리셋
  }

  crashCount++;

  if (crashCount > MAX_CONSECUTIVE_CRASHES) {
    console.error(`[워치독] 서버가 ${MAX_CONSECUTIVE_CRASHES}회 연속 충돌했습니다. 워치독을 종료합니다.`);
    process.exit(1);
  }

  const delay = Math.min(BASE_DELAY_MS * crashCount, 30000);
  console.log(`[워치독] ${delay / 1000}초 후 재시작합니다... (${crashCount}/${MAX_CONSECUTIVE_CRASHES})`);
  setTimeout(startServer, delay);
}

// 워치독 자체 종료 처리
function shutdown() {
  isShuttingDown = true;
  console.log('\n[워치독] 종료 신호 수신. 서버를 중단합니다...');
  if (child) child.kill('SIGTERM');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startServer();
