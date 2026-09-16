'use strict';

const os = require('os');
const { performance } = require('perf_hooks');
const { runRequest } = require('./requestPhaseService.cjs');
const { collectProcessPressureSnapshot } = require('./processPressureSnapshotService.cjs');

const DEFAULT_SAMPLE_INTERVAL_MS = 1_000;
const DEFAULT_EVENT_LOOP_WARN_MS = 2_000;
const DEFAULT_EVENT_LOOP_CRITICAL_MS = 10_000;
const DEFAULT_SLOW_API_MS = 2_000;
const DEFAULT_LOG_COOLDOWN_MS = 30_000;
const SYSTEM_SUSPEND_GAP_MS = 5 * 60 * 1_000;
const ROUTINE_BACKGROUND_SLOW_API_MS = 30_000;
const DAILY_SUMMARY_HOUR_KST = 20;

function kstDateKey(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function kstHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false,
  }).format(now));
}

function shouldRecordSlowApiRequest(request, statusCode, durationMs, slowApiMs) {
  // 성공한 유휴 작업은 사용자의 업무를 기다리게 하지 않는다. 특히 진단 업로드가
  // 자기 자신의 느린 실행을 다시 기록하면 로그만 불어난다.
  if (request.path === '/api/auth/background-tasks/run-diagnostic-sync' && statusCode < 400) return false;
  if (request.path === '/api/auth/background-tasks/run-data-sync'
    || request.path === '/api/auth/background-tasks/run-file-sync') {
    return durationMs >= ROUTINE_BACKGROUND_SLOW_API_MS || statusCode >= 400;
  }
  // 조건부 요청(304)인 성적서 목록은 원격 Drive 응답 대기일 수 있으나, 짧은 지연을
  // 현장 장애로 오인하지 않도록 장기 지연만 남긴다.
  if (request.path === '/api/certificates' && statusCode === 304) {
    return durationMs >= ROUTINE_BACKGROUND_SLOW_API_MS;
  }
  return durationMs >= slowApiMs;
}

function round(value, digits = 1) {
  const scale = 10 ** digits;
  return Math.round(Number(value || 0) * scale) / scale;
}

function memorySnapshot() {
  const processMemory = process.memoryUsage();
  const totalSystemBytes = os.totalmem();
  const freeSystemBytes = os.freemem();
  return {
    process: {
      rssBytes: processMemory.rss,
      heapTotalBytes: processMemory.heapTotal,
      heapUsedBytes: processMemory.heapUsed,
      externalBytes: processMemory.external,
    },
    system: {
      totalBytes: totalSystemBytes,
      freeBytes: freeSystemBytes,
      freePercent: totalSystemBytes > 0 ? round((freeSystemBytes / totalSystemBytes) * 100, 1) : null,
    },
  };
}

function createServerPerformanceDiagnosticService({
  recordDiagnostic,
  db,
  appDataPath,
  scheduleDiagnosticUpload,
  sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS,
  eventLoopWarnMs = DEFAULT_EVENT_LOOP_WARN_MS,
  eventLoopCriticalMs = DEFAULT_EVENT_LOOP_CRITICAL_MS,
  slowApiMs = DEFAULT_SLOW_API_MS,
  logCooldownMs = DEFAULT_LOG_COOLDOWN_MS,
} = {}) {
  if (typeof recordDiagnostic !== 'function') {
    throw new Error('server performance diagnostics require recordDiagnostic');
  }

  let requestSequence = 0;
  let eventLoopTimer = null;
  let dailySummaryTimer = null;
  let expectedTickAt = 0;
  let previousCpuUsage = process.cpuUsage();
  let previousCpuMeasuredAt = Date.now();
  let lastLagLogAt = 0;
  let lastResourcePressureLogAt = 0;
  let latestEventLoopLagMs = 0;
  let lastCompletedRequest = null;
  let previousMonotonicAt = performance.now();
  let previousWallAt = Date.now();
  let latestLagObservedAt = null;
  let dailyMetrics = {
    date: kstDateKey(), startedAt: new Date().toISOString(),
    apiTotal: 0, apiSuccess: 0, apiFailure: 0, apiTimeout: 0, slowApiCount: 0,
    maxEventLoopLagMs: 0, maxProcessRssBytes: 0, minSystemFreePercent: null,
  };
  const recentSamples = [];
  const recentCompletedRequests = [];
  const activeRequests = new Map();
  const pushBounded = (list, value, limit) => {
    list.push(value);
    if (list.length > limit) list.shift();
  };
  const evidenceSnapshot = () => ({
    diagnosticRevision: 2,
    recentSamples: recentSamples.slice(),
    recentCompletedRequests: recentCompletedRequests.slice(),
    latestLagObservedAt,
    observationLimit: 'in-process sampling resumes after a stall; correlated requests are not proof of its cause',
  });

  const writeDiagnostic = (event) => {
    try {
      recordDiagnostic(db, appDataPath, event);
      scheduleDiagnosticUpload?.();
      return true;
    } catch (error) {
      console.warn('[server-performance] diagnostic write failed:', error.message);
      return false;
    }
  };

  const resetDailyMetricsIfNeeded = () => {
    const today = kstDateKey();
    if (dailyMetrics.date === today) return;
    dailyMetrics = {
      date: today, startedAt: new Date().toISOString(),
      apiTotal: 0, apiSuccess: 0, apiFailure: 0, apiTimeout: 0, slowApiCount: 0,
      maxEventLoopLagMs: 0, maxProcessRssBytes: 0, minSystemFreePercent: null,
    };
  };

  const writeDailyStabilitySummary = () => {
    resetDailyMetricsIfNeeded();
    if (kstHour() < DAILY_SUMMARY_HOUR_KST) return;
    const dayStart = new Date(`${dailyMetrics.date}T00:00:00+09:00`).toISOString();
    const alreadyWritten = db.prepare(`
      SELECT 1 FROM app_diagnostic_logs
      WHERE area = 'stability-summary' AND action = 'daily-summary' AND created_at >= ?
      LIMIT 1
    `).get(dayStart);
    if (alreadyWritten) return;
    const events = db.prepare(`
      SELECT level, area, action, result FROM app_diagnostic_logs
      WHERE created_at >= ?
    `).all(dayStart);
    const includes = (value, words) => words.some((word) => String(value || '').toLowerCase().includes(word));
    const failureEvents = events.filter((row) => (
      ['error', 'warn'].includes(String(row.level || '').toLowerCase())
      || ['failed', 'error', 'rejected', 'degraded'].includes(String(row.result || '').toLowerCase())
    ));
    const countAreaAction = (areaWords, actionWords = []) => events.filter((row) => (
      includes(row.area, areaWords) || includes(row.action, actionWords.length ? actionWords : areaWords)
    ));
    const photoEvents = countAreaAction(['photo', '사진']);
    const syncEvents = countAreaAction(['sync', '동기화']);
    const recoveryEvents = countAreaAction(['recovery', 'watchdog'], ['recovery', 'restart', 'emergency']);
    const failed = (rows) => rows.filter((row) => (
      ['error', 'warn'].includes(String(row.level || '').toLowerCase())
      || ['failed', 'error', 'rejected', 'degraded'].includes(String(row.result || '').toLowerCase())
    )).length;
    writeDiagnostic({
      level: failureEvents.length ? 'warn' : 'info',
      area: 'stability-summary',
      action: 'daily-summary',
      result: failureEvents.length ? 'attention' : 'stable',
      message: 'daily field stability summary',
      details: {
        date: dailyMetrics.date,
        observationStartedAt: dailyMetrics.startedAt,
        summarizedAt: new Date().toISOString(),
        api: {
          total: dailyMetrics.apiTotal, success: dailyMetrics.apiSuccess,
          failed: dailyMetrics.apiFailure, timeout: dailyMetrics.apiTimeout,
          slow: dailyMetrics.slowApiCount,
        },
        diagnostics: { total: events.length, warningOrError: failureEvents.length },
        server: {
          startupCount: events.filter((row) => row.area === 'server' && row.action === 'startup').length,
          recoveryCount: recoveryEvents.length,
          maxEventLoopLagMs: Math.round(dailyMetrics.maxEventLoopLagMs),
          maxProcessRssBytes: dailyMetrics.maxProcessRssBytes,
          minSystemFreePercent: dailyMetrics.minSystemFreePercent,
        },
        photos: { events: photoEvents.length, failed: failed(photoEvents) },
        sync: { events: syncEvents.length, failed: failed(syncEvents) },
        note: 'API counts cover the current server process observation window; diagnostic counts cover retained rows for the KST date.',
      },
    });
  };

  const activeRequestSnapshot = () => {
    const now = Date.now();
    return Array.from(activeRequests.values())
      .sort((left, right) => left.startedAt - right.startedAt)
      .slice(0, 8)
      .map((request) => ({
        method: request.method,
        path: request.path,
        elapsedMs: now - request.startedAt,
        siteId: request.siteId,
        currentPhase: request.currentPhase || null,
        phases: request.phases || [],
      }));
  };

  const start = () => {
    if (eventLoopTimer) return;
    expectedTickAt = Date.now() + sampleIntervalMs;
    previousCpuMeasuredAt = Date.now();
    previousCpuUsage = process.cpuUsage();
    previousMonotonicAt = performance.now();
    previousWallAt = Date.now();
    eventLoopTimer = setInterval(() => {
      try {
      const now = Date.now();
      const monotonicNow = performance.now();
      const monotonicElapsedMs = Math.max(1, monotonicNow - previousMonotonicAt);
      const clockDeltaMs = round((now - previousWallAt) - monotonicElapsedMs);
      previousMonotonicAt = monotonicNow;
      previousWallAt = now;
      const wallElapsedMs = Math.max(1, now - previousCpuMeasuredAt);
      const cpuDelta = process.cpuUsage(previousCpuUsage);
      const cpuUsedMs = (cpuDelta.user + cpuDelta.system) / 1_000;
      const cpuPercent = round((cpuUsedMs / wallElapsedMs) * 100, 1);
      const lagMs = Math.max(0, now - expectedTickAt);
      resetDailyMetricsIfNeeded();
      dailyMetrics.maxEventLoopLagMs = Math.max(dailyMetrics.maxEventLoopLagMs, lagMs);
      latestEventLoopLagMs = lagMs;
      latestLagObservedAt = new Date(now).toISOString();
      for (const request of activeRequests.values()) {
        request.maxObservedEventLoopLagMs = Math.max(request.maxObservedEventLoopLagMs, lagMs);
      }
      expectedTickAt = now + sampleIntervalMs;
      previousCpuMeasuredAt = now;
      previousCpuUsage = process.cpuUsage();

      if (lagMs >= eventLoopWarnMs && now - lastLagLogAt >= logCooldownMs) {
        lastLagLogAt = now;
        const likelySystemSuspend = lagMs >= SYSTEM_SUSPEND_GAP_MS;
        writeDiagnostic({
          level: likelySystemSuspend ? 'info' : (lagMs >= eventLoopCriticalMs ? 'error' : 'warn'),
          area: 'server-performance',
          action: likelySystemSuspend ? 'runtime-clock-gap' : 'event-loop-lag',
          result: likelySystemSuspend ? 'observed' : 'degraded',
          message: likelySystemSuspend
            ? 'server runtime clock gap observed'
            : 'server event loop response delayed',
          details: {
            pid: process.pid,
            lagMs,
            sampleIntervalMs,
            cpuUsedMs: round(cpuUsedMs, 1),
            cpuPercent,
            serverUptimeSeconds: Math.round(process.uptime()),
            activeRequestCount: activeRequests.size,
            activeRequests: activeRequestSnapshot(),
            lastCompletedRequest,
            memory: memorySnapshot(),
            monotonicElapsedMs: round(monotonicElapsedMs),
            wallClockDeltaMs: clockDeltaMs,
            ...evidenceSnapshot(),
          },
        });
      }

      const memory = memorySnapshot();
      dailyMetrics.maxProcessRssBytes = Math.max(dailyMetrics.maxProcessRssBytes, memory.process.rssBytes);
      if (memory.system.freePercent !== null) {
        dailyMetrics.minSystemFreePercent = dailyMetrics.minSystemFreePercent === null
          ? memory.system.freePercent
          : Math.min(dailyMetrics.minSystemFreePercent, memory.system.freePercent);
      }
      const oldestRequest = activeRequestSnapshot()[0];
      pushBounded(recentSamples, {
        at: new Date(now).toISOString(), lagMs, cpuPercent,
        monotonicElapsedMs: round(monotonicElapsedMs), wallClockDeltaMs: clockDeltaMs,
        rssBytes: memory.process.rssBytes, heapUsedBytes: memory.process.heapUsedBytes,
        systemFreeBytes: memory.system.freeBytes, systemFreePercent: memory.system.freePercent,
        activeRequestCount: activeRequests.size,
        oldestRequest: oldestRequest ? {
          method: oldestRequest.method,
          path: oldestRequest.path.slice(0, 160),
          elapsedMs: oldestRequest.elapsedMs,
        } : null,
      }, 15);
      if (memory.system.freePercent !== null
        && memory.system.freePercent < 10
        && now - lastResourcePressureLogAt >= 30 * 60 * 1_000) {
        lastResourcePressureLogAt = now;
        collectProcessPressureSnapshot((snapshot) => writeDiagnostic({
          area: 'server-performance', action: 'memory-pressure-processes', result: 'observed',
          details: { pressureObservedAt: new Date(now).toISOString(), ...snapshot },
        }));
        writeDiagnostic({
          level: 'warn',
          area: 'server-performance',
          action: 'memory-pressure',
          result: 'degraded',
          message: 'low system memory may delay local server responses',
          details: {
            pid: process.pid,
            serverUptimeSeconds: Math.round(process.uptime()),
            activeRequestCount: activeRequests.size,
            memory,
            ...evidenceSnapshot(),
          },
        });
      }
      } catch (error) {
        // Diagnostics must never interrupt business processing.
        console.warn('[server-performance] sampling failed:', error.message);
      }
    }, sampleIntervalMs);
    eventLoopTimer.unref?.();
    dailySummaryTimer = setInterval(() => {
      try { writeDailyStabilitySummary(); } catch (error) {
        console.warn('[server-performance] daily summary failed:', error.message);
      }
    }, 60 * 1000);
    dailySummaryTimer.unref?.();
    try { writeDailyStabilitySummary(); } catch (_) { /* 다음 주기에 재시도 */ }
  };

  const middleware = (req, res, next) => {
    const pathName = String(req.path || '');
    if (!pathName.startsWith('/api/')) return next();

    const id = ++requestSequence;
    const startedAt = Date.now();
    const request = {
      id,
      startedAt,
      startedMonotonicAt: performance.now(),
      maxObservedEventLoopLagMs: 0,
      method: String(req.method || '').toUpperCase(),
      path: pathName,
      siteId: String(req.get('x-osoo-site-id') || req.get('x-user-site') || '').slice(0, 80) || null,
    };
    activeRequests.set(id, request);
    let completed = false;

    const complete = (completion) => {
      if (completed) return;
      completed = true;
      activeRequests.delete(id);
      const durationMs = Date.now() - startedAt;
      resetDailyMetricsIfNeeded();
      dailyMetrics.apiTotal += 1;
      if (res.statusCode >= 200 && res.statusCode < 400) dailyMetrics.apiSuccess += 1;
      else dailyMetrics.apiFailure += 1;
      if ([408, 504].includes(res.statusCode)) dailyMetrics.apiTimeout += 1;
      lastCompletedRequest = {
        method: request.method,
        path: request.path,
        statusCode: res.statusCode,
        durationMs,
        completion,
        completedAt: new Date().toISOString(),
        siteId: request.siteId,
        monotonicDurationMs: round(performance.now() - request.startedMonotonicAt),
        phases: (request.phases || []).slice(),
      };
      pushBounded(recentCompletedRequests, { ...lastCompletedRequest }, 8);
      if (!shouldRecordSlowApiRequest(request, res.statusCode, durationMs, slowApiMs)) return;
      dailyMetrics.slowApiCount += 1;

      writeDiagnostic({
        level: durationMs >= eventLoopCriticalMs ? 'error' : 'warn',
        area: 'server-performance',
        action: 'slow-api-request',
        result: 'degraded',
        message: `${request.method} ${request.path} completed slowly`,
        details: {
          pid: process.pid,
          method: request.method,
          path: request.path,
          statusCode: res.statusCode,
          durationMs,
          completion,
          siteId: request.siteId,
          serverUptimeSeconds: Math.round(process.uptime()),
          eventLoopLagMs: latestEventLoopLagMs,
          maxObservedEventLoopLagMs: request.maxObservedEventLoopLagMs,
          phases: request.phases || [],
          monotonicDurationMs: lastCompletedRequest.monotonicDurationMs,
          ...evidenceSnapshot(),
          activeRequestCount: activeRequests.size,
          memory: memorySnapshot(),
        },
      });
    };

    res.once('finish', () => complete('finish'));
    res.once('close', () => complete('close'));
    return runRequest(request, next);
  };

  const recordFatal = (action, error, details = {}) => writeDiagnostic({
    level: 'error',
    area: 'server-lifecycle',
    action,
    result: 'failed',
    message: String(error?.message || error || action).slice(0, 240),
    details: {
      pid: process.pid,
      errorName: error?.name || null,
      errorMessage: String(error?.message || error || '').slice(0, 500),
      stack: String(error?.stack || '').slice(0, 4_000) || null,
      serverUptimeSeconds: Math.round(process.uptime()),
      activeRequestCount: activeRequests.size,
      activeRequests: activeRequestSnapshot(),
      lastCompletedRequest,
      eventLoopLagMs: latestEventLoopLagMs,
      memory: memorySnapshot(),
      ...evidenceSnapshot(),
      ...details,
    },
  });

  return {
    middleware,
    recordFatal,
    start,
    stop: () => {
      if (eventLoopTimer) clearInterval(eventLoopTimer);
      if (dailySummaryTimer) clearInterval(dailySummaryTimer);
      eventLoopTimer = null;
      dailySummaryTimer = null;
    },
  };
}

module.exports = {
  createServerPerformanceDiagnosticService,
};
