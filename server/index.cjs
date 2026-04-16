const express = require('express');
const path = require('path');
const fs = require('fs');
const net = require('net');
const cors = require('cors');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const { db, appDataPath } = require('./database.cjs');
const { warmUpExcelPdfConverter } = require('./services/excelPdfService.cjs');
const { triggerSync: triggerBigQuerySync } = require('./services/bigQueryTriggerService.cjs');

const BASE_DIR = path.join(__dirname, '..');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(path.join(BASE_DIR, 'uploads')));
app.use('/사진관리', express.static(path.join(appDataPath, '사진관리')));

process.on('uncaughtException', (err) => {
  console.error('[UncaughtException]', err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection]', reason instanceof Error ? reason.message : reason);
});

app.get('/', (req, res) => {
  res.send(`
    <div style="font-family: sans-serif; padding: 2rem; line-height: 1.6;">
      <h1 style="color: #1e293b;">Osoo Handle App - Local Bridge Server</h1>
      <p>백엔드 API 서버가 정상적으로 작동 중입니다.</p>
      <p><strong>참고:</strong> 사용자 인터페이스(UI)를 보려면 프론트엔드 개발 서버(포트 8900)를 실행해야 합니다.</p>
      <div style="background: #f1f5f9; padding: 1rem; border-radius: 8px; display: inline-block;">
        <code>npm run dev</code> 를 터미널에서 실행하세요.
      </div>
    </div>
  `);
});

app.get('/api/ping', (req, res) => res.json({ ok: true }));

const BIGQUERY_IMMEDIATE_SYNC_PREFIXES = [
  '/api/flows',
  '/api/medicines',
  '/api/kits',
  '/api/water-quality',
  '/api/facility',
  '/api/sludge-photos',
  '/api/medicine-in',
];

app.use((req, res, next) => {
  const method = String(req.method || '').toUpperCase();
  const shouldWatchMethod = method === 'POST' || method === 'PUT' || method === 'DELETE';
  const shouldWatchPath = BIGQUERY_IMMEDIATE_SYNC_PREFIXES.some((prefix) => req.path.startsWith(prefix));
  if (!shouldWatchMethod || !shouldWatchPath) {
    return next();
  }

  const originalEnd = res.end;
  res.end = function wrappedEnd(...args) {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      triggerBigQuerySync(`after-save:${method}:${req.path}`);
    }
    return originalEnd.apply(this, args);
  };
  return next();
});

app.use(require('./routes/flowRoutes.cjs')(db));
app.use(require('./routes/medicineRoutes.cjs')(db));
app.use(require('./routes/medicineRegisterRoutes.cjs')(db, BASE_DIR, appDataPath));
app.use(require('./routes/medicineInRoutes.cjs')(db, BASE_DIR, appDataPath));
app.use(require('./routes/waterQualityRoutes.cjs')(db, BASE_DIR));
app.use(require('./routes/kitRoutes.cjs')(db));
app.use(require('./routes/facilityRoutes.cjs')(db));
app.use(require('./routes/settingsRoutes.cjs')(db, BASE_DIR, appDataPath));
app.use(require('./routes/boardRoutes.cjs')());
app.use(require('./routes/uploadRoutes.cjs')(BASE_DIR));
app.use(require('./routes/locationRoutes.cjs')(BASE_DIR));
app.use(require('./routes/excelRoutes.cjs')(db, BASE_DIR, appDataPath));
app.use(require('./routes/dailyWorkLogRoutes.cjs')(db, BASE_DIR, appDataPath));
app.use(require('./routes/hwpRoutes.cjs')(db, BASE_DIR, appDataPath));
app.use(require('./routes/sludgePhotoRoutes.cjs')(db, BASE_DIR, appDataPath));
app.use(require('./routes/certificateRoutes.cjs')());
app.use('/api/auth', require('./routes/authRoutes.cjs')(db));

// --- BigQuery 동기화 정책 ---
// BIGQUERY_SYNC_ENABLED: 미설정 시 true(안전 기본값)
// BIGQUERY_SYNC_SCHEDULER: true 일 때만 주기 스케줄러 사용 (기본 false)
const isBigQuerySyncEnabled = String(process.env.BIGQUERY_SYNC_ENABLED || 'true') === 'true';
const isBigQuerySchedulerEnabled = String(process.env.BIGQUERY_SYNC_SCHEDULER || 'false') === 'true';
if (isBigQuerySyncEnabled && isBigQuerySchedulerEnabled) {
  const syncScheduler = require('./cron/syncScheduler.cjs');
  syncScheduler.start();
  console.log('[Scheduler] BigQuery 백그라운드 동기화 시작');
} else {
  if (!isBigQuerySyncEnabled) {
    console.log('[Scheduler] BigQuery 동기화 비활성화 (BIGQUERY_SYNC_ENABLED=false)');
  } else {
    console.log('[Scheduler] 주기 동기화 비활성화 (BIGQUERY_SYNC_SCHEDULER != true) - 1회 트리거 모드 사용');
  }
}
// 앱(백엔드) 시작 시 1회 동기화 시도
if (isBigQuerySyncEnabled) {
  triggerBigQuerySync('app-startup');
}

async function findFreePort(startPort, endPort) {
  for (let p = startPort; p <= endPort; p++) {
    const free = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.once('listening', () => { srv.close(); resolve(true); });
      srv.listen(p, '127.0.0.1');
    });
    if (free) return p;
  }
  return startPort;
}

const API_PORT_MIN = (Number(process.env.VITE_PORT) || 8900) + 1;
const API_PORT_MAX = API_PORT_MIN + 50;

function writePortFile(port) {
  const portFilePath = path.join(appDataPath, 'server.port');
  try { fs.writeFileSync(portFilePath, String(port), 'utf8'); } catch (_) { }
}

function startListening(actualPort) {
  writePortFile(actualPort);

  const server = app.listen(actualPort, '127.0.0.1', () => {
    console.log(`Local Bridge Server running at http://localhost:${actualPort}`);
    if (actualPort !== API_PORT_MIN) {
      console.warn(`[주의] 기본 포트(${API_PORT_MIN})가 이미 사용 중이어서 포트 ${actualPort}로 시작했습니다.`);
    }

    warmUpExcelPdfConverter(appDataPath).catch((error) => {
      console.warn(`[Excel PDF Warmup Error] ${error.message}`);
    });
  });
  server.on('error', (err) => { console.error('[Server Error]', err.message); });
}

if (process.env.ELECTRON === '1') {
  findFreePort(API_PORT_MIN, API_PORT_MAX).then((actualPort) => {
    startListening(actualPort);
  });
} else {
  const fixedPort = API_PORT_MIN;
  const server = app.listen(fixedPort, '127.0.0.1', () => {
    writePortFile(fixedPort);
    console.log(`Local Bridge Server running at http://localhost:${fixedPort}`);
    warmUpExcelPdfConverter(appDataPath).catch((error) => {
      console.warn(`[Excel PDF Warmup Error] ${error.message}`);
    });
  });

  server.on('error', (err) => {
    console.error('[Server Error]', err.message);
    if (err.code === 'EADDRINUSE') {
      console.error(`[Server Error] 개발 환경에서는 백엔드 포트 ${fixedPort}를 고정 사용합니다. 기존 프로세스를 종료한 뒤 다시 시작해 주세요.`);
    }
    process.exit(1);
  });
}
