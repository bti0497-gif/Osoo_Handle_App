'use strict';

const os = require('os');

const DEFAULT_SAMPLE_INTERVAL_MS = 1_000;
const DEFAULT_EVENT_LOOP_WARN_MS = 2_000;
const DEFAULT_EVENT_LOOP_CRITICAL_MS = 10_000;
const DEFAULT_SLOW_API_MS = 2_000;
const DEFAULT_LOG_COOLDOWN_MS = 30_000;
const SYSTEM_SUSPEND_GAP_MS = 5 * 60 * 1_000;

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
  let expectedTickAt = 0;
  let previousCpuUsage = process.cpuUsage();
  let previousCpuMeasuredAt = Date.now();
  let lastLagLogAt = 0;
  let lastResourcePressureLogAt = 0;
  let latestEventLoopLagMs = 0;
  let lastCompletedRequest = null;
  const activeRequests = new Map();

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
      }));
  };

  const start = () => {
    if (eventLoopTimer) return;
    expectedTickAt = Date.now() + sampleIntervalMs;
    previousCpuMeasuredAt = Date.now();
    previousCpuUsage = process.cpuUsage();
    eventLoopTimer = setInterval(() => {
      const now = Date.now();
      const wallElapsedMs = Math.max(1, now - previousCpuMeasuredAt);
      const cpuDelta = process.cpuUsage(previousCpuUsage);
      const cpuUsedMs = (cpuDelta.user + cpuDelta.system) / 1_000;
      const cpuPercent = round((cpuUsedMs / wallElapsedMs) * 100, 1);
      const lagMs = Math.max(0, now - expectedTickAt);
      latestEventLoopLagMs = lagMs;
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
          },
        });
      }

      const memory = memorySnapshot();
      if (memory.system.freePercent !== null
        && memory.system.freePercent < 10
        && now - lastResourcePressureLogAt >= 30 * 60 * 1_000) {
        lastResourcePressureLogAt = now;
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
          },
        });
      }
    }, sampleIntervalMs);
    eventLoopTimer.unref?.();
  };

  const middleware = (req, res, next) => {
    const pathName = String(req.path || '');
    if (!pathName.startsWith('/api/')) return next();

    const id = ++requestSequence;
    const startedAt = Date.now();
    const request = {
      id,
      startedAt,
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
      lastCompletedRequest = {
        method: request.method,
        path: request.path,
        statusCode: res.statusCode,
        durationMs,
        completion,
        completedAt: new Date().toISOString(),
      };
      if (durationMs < slowApiMs) return;

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
          activeRequestCount: activeRequests.size,
          memory: memorySnapshot(),
        },
      });
    };

    res.once('finish', () => complete('finish'));
    res.once('close', () => complete('close'));
    return next();
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
      ...details,
    },
  });

  return {
    middleware,
    recordFatal,
    start,
  };
}

module.exports = {
  createServerPerformanceDiagnosticService,
};
