const express = require('express');
const path = require('path');
const fs = require('fs');
const net = require('net');
const cors = require('cors');
const { loadRuntimeEnv } = require('./config/runtimeConfig.cjs');
const dotenvResult = loadRuntimeEnv();
if (dotenvResult.error) {
  console.warn('[dotenv] 런타임 환경설정 로드 실패:', dotenvResult.envPath, dotenvResult.error.message);
} else {
  console.log('[dotenv] 런타임 환경설정 로드 성공:', dotenvResult.envPath);
}
const routeRegistry = require('./routeRegistry.cjs');

const BASE_DIR = path.join(__dirname, '..');
const IS_MINIMAL_BUILD = String(process.env.OSOO_MINIMAL_BUILD || '0') === '1';

function resolveAppDataPathForPort() {
  return path.join(process.env.APPDATA, 'Osoo_Handle_App');
}

function writePortFileEarly(port) {
  try {
    const dir = resolveAppDataPathForPort();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'server.port'), String(port), 'utf8');
  } catch (e) {
    console.warn('[Server] server.port 기록 실패:', e.message);
  }
}

// 로그 파일 기록 설정
const logDir = path.join(resolveAppDataPathForPort(), 'logs');
const logFile = path.join(logDir, 'electron-server.log');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const logStream = fs.createWriteStream(logFile, { flags: 'a', encoding: 'utf8' });

function logToBoth(...args) {
  const msg = args.map(String).join(' ');
  logStream.write(msg + '\n');
  console.log(...args);
}
function errorToBoth(...args) {
  const msg = args.map(String).join(' ');
  logStream.write('[ERROR] ' + msg + '\n');
  console.error(...args);
}

// stdout/stderr 리다이렉트 (console.log/console.error 유지)
process.stdout.write = ((orig) => function(chunk, encoding, cb) {
  logStream.write(chunk);
  return orig.call(process.stdout, chunk, encoding, cb);
})(process.stdout.write);
process.stderr.write = ((orig) => function(chunk, encoding, cb) {
  logStream.write('[STDERR] ' + chunk);
  return orig.call(process.stderr, chunk, encoding, cb);
})(process.stderr.write);

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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
      <p>로컬 API 서버가 정상적으로 동작 중입니다.</p>
      <p><strong>참고:</strong> 사용자 인터페이스(UI)를 사용하려면 프론트엔드 개발 서버(포트 18735)를 실행해야 합니다.</p>
      <div style="background: #f1f5f9; padding: 1rem; border-radius: 8px; display: inline-block;">
        <code>npm run dev</code> 를 터미널에서 실행하세요.
      </div>
    </div>
  `);
});

app.get('/api/ping', (req, res) => res.json({
  ok: true,
  app: 'osoo-handle-app',
  serverToken: process.env.OSOO_SERVER_TOKEN || null,
}));

const isBigQuerySyncEnabled = String(process.env.BIGQUERY_SYNC_ENABLED || 'true') === 'true';
const isBigQuerySchedulerEnabled = String(process.env.BIGQUERY_SYNC_SCHEDULER || 'true') === 'true';

let postStartupTasksScheduled = false;
let postStartupCtx = null;

/**
 * makeLazy 시 첫 HTTP 요청 시 모듈을 로드하는 Lazy Loader
 * 에러 발생 시 'error' 상태를 저장하여 무한 재시도를 방지합니다
 */
function makeLazy(modulePath, ...args) {
  let router = null;
  let loadError = null;
  return (req, res, next) => {
    if (loadError) {
      return res.status(500).json({ ok: false, error: `Module previously failed: ${modulePath}: ${loadError}` });
    }
    if (!router) {
      try {
        router = require(modulePath)(...args);
      } catch (e) {
        loadError = e.message;
        console.error(`[Lazy] Tier2 로드 실패 ${modulePath}:`, e.message);
        return res.status(500).json({ ok: false, error: `Module load failed: ${modulePath}: ${e.message}` });
      }
    }
    router(req, res, next);
  };
}

/**
 * resolveArgs는 routeRegistry의 args 문자열 배열을 실제 ctx 값으로 매핑합니다.
 */
function resolveArgs(argNames, ctx) {
  return argNames.map(name => {
    if (name === 'db') return ctx.db;
    if (name === 'appDataPath') return ctx.appDataPath;
    if (name === 'BASE_DIR') return ctx.BASE_DIR;
    return name;
  });
}

function getTier1EntryKey(entry) {
  return `${entry.path}::${entry.module}`;
}

function schedulePostStartupTasks() {
  if (postStartupTasksScheduled || !postStartupCtx) return;
  postStartupTasksScheduled = true;

  const { appDataPath, warmUpExcelPdfConverter, triggerBigQuerySync, normalizeLegacyPhotoFiles } = postStartupCtx;

  if (isBigQuerySyncEnabled) {
    setTimeout(() => {
      triggerBigQuerySync('app-startup-delayed');
    }, 20_000);
  }

  setTimeout(() => {
    warmUpExcelPdfConverter(appDataPath).catch((error) => {
      console.warn(`[Excel PDF Warmup Error] ${error.message}`);
    });
  }, 30_000);

  if (String(process.env.PHOTO_NORMALIZE_ON_STARTUP || 'false') === 'true') {
    setTimeout(() => {
      normalizeLegacyPhotoFiles(appDataPath)
        .then((result) => {
          if (result.totalConverted > 0) {
            console.log(`[Photo Normalize] 총 ${result.totalConverted}개 변환 완료 (약품: ${result.medicineConverted}, 슬러지: ${result.sludgeConverted})`);  
          }
        })
        .catch((error) => {
          console.warn(`[Photo Normalize Error] ${error.message}`);
        });
    }, 45_000);
  }
}

function registerLazyApplication() {
  const { db, appDataPath } = require('./database.cjs');
  const { warmUpExcelPdfConverter } = require('./services/excelPdfService.cjs');
  const { triggerSync: triggerBigQuerySync } = require('./services/bigQueryTriggerService.cjs');
  const { normalizeLegacyPhotoFiles } = require('./services/localPhotoNormalizationService.cjs');
  const {
    buildDatabaseDiagnosticDetails,
    cleanupOldDiagnosticsOnVersionStart,
    recordDiagnostic,
    uploadPendingDiagnostics,
    sanitize,
  } = require('./services/diagnosticLogService.cjs');
  const ctx = { db, appDataPath, BASE_DIR };
  const DIAGNOSTIC_VERBOSE_INITIAL = process.env.DIAGNOSTIC_VERBOSE_INITIAL !== 'false';
  recordDiagnostic(db, appDataPath, {
    level: 'info',
    area: 'server',
    action: 'startup',
    result: 'ok',
    message: 'local server initialized',
    details: buildDatabaseDiagnosticDetails(db, appDataPath),
  });
  cleanupOldDiagnosticsOnVersionStart(db, appDataPath)
    .then((result) => {
      if (!result?.skipped) {
        recordDiagnostic(db, appDataPath, {
          level: 'info',
          area: 'diagnostic',
          action: 'cleanup-on-version-start',
          result: 'ok',
          message: 'old diagnostic logs cleaned',
          details: result,
        });
      }
    })
    .catch((error) => {
      console.warn('[diagnostic] version-start cleanup failed:', error.message);
    });
  let diagnosticUploadTimer = null;
  const scheduleDiagnosticUpload = () => {
    if (diagnosticUploadTimer) return;
    diagnosticUploadTimer = setTimeout(() => {
      diagnosticUploadTimer = null;
      uploadPendingDiagnostics(db, appDataPath).catch((error) => {
        console.warn('[diagnostic] upload failed:', error.message);
      });
    }, 15_000);
  };

  // --- 초기 배포 진단 로그 ---
  // 1.0.x 현장 안정화 기간에는 /api/ping을 제외한 API 흐름을 넓게 기록한다.
  // 이후 운영 안정화 시 DIAGNOSTIC_VERBOSE_INITIAL=false 로 줄일 수 있다.
  const BIGQUERY_IMMEDIATE_SYNC_PREFIXES = routeRegistry
    .filter(r => r.watch)
    .map(r => r.path);

  app.use((req, res, next) => {
    const method = String(req.method || '').toUpperCase();
    const pathName = String(req.path || '');
    const isApiPath = pathName.startsWith('/api/');
    const shouldWatchMethod = method === 'POST' || method === 'PUT' || method === 'DELETE';
    const shouldWatchPath = BIGQUERY_IMMEDIATE_SYNC_PREFIXES.some((prefix) => pathName.startsWith(prefix));
    const shouldTriggerSync = shouldWatchMethod
      && shouldWatchPath
      && !pathName.startsWith('/api/auth')
      && pathName !== '/api/preload-trigger';
    const shouldLog = isApiPath
      && pathName !== '/api/ping'
      && (DIAGNOSTIC_VERBOSE_INITIAL || shouldTriggerSync);

    if (!shouldLog && !shouldTriggerSync) return next();

    const startedAt = Date.now();
    const requestBody = sanitize(req.body || {});
    const originalEnd = res.end;
    res.end = function wrappedEnd(...args) {
      if (res.statusCode >= 200 && res.statusCode < 400 && shouldTriggerSync) {
        triggerBigQuerySync(`after-save:${method}:${pathName}`);
      }

      if (shouldLog) {
        try {
          const rawResponseText = args?.[0] ? String(args[0]) : '';
          const responseText = pathName === '/api/settings/web-app-credentials'
            ? '<redacted credential response>'
            : rawResponseText.slice(0, 2000);
          let responseCount;
          try {
            const parsedResponse = rawResponseText ? JSON.parse(rawResponseText) : null;
            if (Array.isArray(parsedResponse)) {
              responseCount = parsedResponse.length;
            } else if (Array.isArray(parsedResponse?.history)) {
              responseCount = parsedResponse.history.length;
            } else if (Array.isArray(parsedResponse?.data)) {
              responseCount = parsedResponse.data.length;
            } else if (Array.isArray(parsedResponse?.items)) {
              responseCount = parsedResponse.items.length;
            }
          } catch (_) {
            responseCount = undefined;
          }
          recordDiagnostic(db, appDataPath, {
            level: res.statusCode >= 400 ? 'error' : 'info',
            area: 'api',
            action: `${method} ${pathName}`,
            result: res.statusCode >= 400 ? 'failed' : 'ok',
            message: `${method} ${pathName} -> ${res.statusCode}`,
            details: {
              statusCode: res.statusCode,
              durationMs: Date.now() - startedAt,
              responseCount,
              query: sanitize(req.query || {}),
              body: requestBody,
              response: DIAGNOSTIC_VERBOSE_INITIAL || res.statusCode >= 400 ? responseText : undefined,
            },
          });
          scheduleDiagnosticUpload();
        } catch (error) {
          console.warn('[diagnostic] request log failed:', error.message);
        }
      }
      return originalEnd.apply(this, args);
    };
    return next();
  });

  // --- Tier 0: 즉시 등록 (registry 기반) ---
  for (const entry of routeRegistry.filter(r => r.tier === 0)) {
    const router = require(entry.module)(...resolveArgs(entry.args, ctx));
    app.use(entry.path, router);
  }

  if (IS_MINIMAL_BUILD) {
    console.log('[Server] minimal build mode: auth routes only');
    return { appDataPath, warmUpExcelPdfConverter, triggerBigQuerySync, normalizeLegacyPhotoFiles };
  }

  // --- Static file serving ---
  app.use('/uploads', express.static(path.join(appDataPath, 'uploads')));
  app.use('/사진관리', express.static(path.join(appDataPath, '사진관리')));

  // --- Tier 1: registry 기반 lazy wrapper 등록 ---
  const tier1Entries = routeRegistry.filter(r => r.tier === 1);
  const tier1RouterRefs = {};
  for (const entry of tier1Entries) {
    const entryKey = getTier1EntryKey(entry);
    tier1RouterRefs[entryKey] = null;
    app.use(entry.path, (req, res, next) => {
      if (!tier1RouterRefs[entryKey]) {
        try {
          tier1RouterRefs[entryKey] = require(entry.module)(...resolveArgs(entry.args, ctx));
        } catch (e) {
          console.error(`[Lazy] Tier1 로드 실패 ${entry.path}:`, e.message);
          tier1RouterRefs[entryKey] = 'error';
          return res.status(500).json({ ok: false, error: `Module load failed: ${entry.path}` });
        }
      }
      if (tier1RouterRefs[entryKey] === 'error') {
        return res.status(500).json({ ok: false, error: `Module previously failed: ${entry.path}` });
      }
      tier1RouterRefs[entryKey](req, res, next);
    });
  }

  // --- Tier 2: registry 기반 makeLazy 등록 ---
  for (const entry of routeRegistry.filter(r => r.tier === 2)) {
    app.use(entry.path, makeLazy(entry.module, ...resolveArgs(entry.args, ctx)));
  }

  // --- BigQuery 스케줄러 ---
  function startBigQueryScheduler() {
    if (isBigQuerySyncEnabled && isBigQuerySchedulerEnabled) {
      const syncScheduler = require('./cron/syncScheduler.cjs');
      syncScheduler.start();
      console.log('[Scheduler] BigQuery 동기화 스케줄러 시작');
    } else if (!isBigQuerySyncEnabled) {
      console.log('[Scheduler] BigQuery 스케줄러 비활성화 (BIGQUERY_SYNC_ENABLED=false)');
    } else {
      console.log('[Scheduler] 즉시 스케줄러 비활성화 (BIGQUERY_SYNC_SCHEDULER=false) - 수동 시작/중지용 API 모듈 사용');
    }
  }

  // --- /api/preload-trigger: registry 기반 자동 로드 ---
  setInterval(() => {
    uploadPendingDiagnostics(db, appDataPath).catch((error) => {
      console.warn('[diagnostic] periodic upload failed:', error.message);
    });
  }, 10 * 60 * 1000);

  app.post('/api/preload-trigger', (req, res) => {
    res.json({ ok: true });
    setImmediate(() => {
      let i = 0;
      function loadNext() {
        if (i >= tier1Entries.length) { startBigQueryScheduler(); return; }
        const entry = tier1Entries[i++];
        const entryKey = getTier1EntryKey(entry);
        if (!tier1RouterRefs[entryKey]) {
          try {
            tier1RouterRefs[entryKey] = require(entry.module)(...resolveArgs(entry.args, ctx));
          } catch (e) {
            console.error(`[Preload] Tier1 로드 실패 ${entry.path}:`, e.message);
            tier1RouterRefs[entryKey] = 'error';
          }
        }
        setTimeout(loadNext, 200);
      }
      loadNext();
    });
  });

  return { appDataPath, warmUpExcelPdfConverter, triggerBigQuerySync, normalizeLegacyPhotoFiles };
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

const API_PORT_MIN = Number(process.env.OSOO_API_PORT_MIN) || 18731;
const API_PORT_MAX = Number(process.env.OSOO_API_PORT_MAX) || 18734;

function runDeferredFullStack() {
  try {
    console.time('[Server] full-stack-init');
    postStartupCtx = registerLazyApplication();
    console.timeEnd('[Server] full-stack-init');
    
    if (!IS_MINIMAL_BUILD) {
      schedulePostStartupTasks();
    }
  } catch (e) {
    console.error('[Server] full-stack-init 실패:', e);
    // ping만 살아 있는 반쪽 서버를 정상 서버로 오인하지 않도록 즉시 실패시킨다.
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 100);
  }
}

function startListening(actualPort) {
  writePortFileEarly(actualPort);

  const server = app.listen(actualPort, '127.0.0.1', () => {
    console.log(`Local Bridge Server running at http://localhost:${actualPort}`);
    if (actualPort !== API_PORT_MIN) {
      console.warn(`[주의] 기본 포트(${API_PORT_MIN})가 이미 사용 중이어서 포트 ${actualPort}로 시작했습니다.`);
    }
    setImmediate(runDeferredFullStack);
  });
  server.on('error', (err) => { console.error('[Server Error]', err.message); });
}

if (process.env.ELECTRON === '1') {
  findFreePort(API_PORT_MIN, API_PORT_MAX).then((actualPort) => {
    startListening(actualPort);
  });
} else {
  const fixedPort = API_PORT_MIN;
  writePortFileEarly(fixedPort);
  const devServer = app.listen(fixedPort, '127.0.0.1', () => {
    console.log(`Local Bridge Server running at http://localhost:${fixedPort}`);
    setImmediate(runDeferredFullStack);
  });
  devServer.on('error', (err) => {
    console.error('[Server Error]', err.message);
    if (err.code === 'EADDRINUSE') {
      console.error(`[Server Error] 현재 환경에서는 로컬 포트 ${fixedPort}를 고정 사용합니다. 기존 프로세스를 종료하고 다시 시작해 주세요.`);
    }
    process.exit(1);
  });
}
