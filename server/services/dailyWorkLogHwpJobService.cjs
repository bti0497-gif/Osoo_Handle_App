'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { recordDiagnostic } = require('./diagnosticLogService.cjs');

const JOB_RETENTION_MS = 24 * 60 * 60 * 1000;

function createDailyWorkLogHwpJobService({ db, appDataPath }) {
  const jobs = new Map();
  const stateDir = path.join(appDataPath, 'jobs', 'daily-work-log-hwp');
  fs.mkdirSync(stateDir, { recursive: true });
  let queue = Promise.resolve();

  const publicJob = (job) => ({
    id: job.id,
    status: job.status,
    phase: job.phase,
    message: job.message,
    progress: job.progress,
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    completedAt: job.completedAt || null,
    result: job.result || null,
    error: job.error || null,
  });

  const persist = (job) => {
    try {
      fs.writeFileSync(
        path.join(stateDir, `${job.id}.json`),
        JSON.stringify(publicJob(job), null, 2),
        'utf8'
      );
    } catch (error) {
      console.warn('[Daily Work Log HWP Job] 상태 저장 실패:', error.message);
    }
  };

  const diagnose = (action, result, job, details = {}) => {
    try {
      recordDiagnostic(db, appDataPath, {
        level: result === 'failed' ? 'error' : 'info',
        area: 'daily-work-log-hwp-job',
        action,
        result,
        message: job.message,
        details: { jobId: job.id, ...details },
      });
    } catch (_) {
      // 진단 실패가 문서 출력을 막아서는 안 된다.
    }
  };

  const update = (job, patch) => {
    Object.assign(job, patch);
    persist(job);
  };

  const cleanup = () => {
    const cutoff = Date.now() - JOB_RETENTION_MS;
    for (const [id, job] of jobs.entries()) {
      if (job.completedAt && new Date(job.completedAt).getTime() < cutoff) jobs.delete(id);
    }
    try {
      for (const entry of fs.readdirSync(stateDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const absolutePath = path.join(stateDir, entry.name);
        if (fs.statSync(absolutePath).mtimeMs < cutoff) fs.rmSync(absolutePath, { force: true });
      }
    } catch (_) {
      // 정리는 best-effort이다.
    }
  };

  // 이전 서버 프로세스가 남긴 실행 중 상태는 재시작 후 완료로 오인하지 않는다.
  try {
    for (const entry of fs.readdirSync(stateDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const absolutePath = path.join(stateDir, entry.name);
      const saved = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
      if (!['queued', 'running'].includes(saved.status)) continue;
      saved.status = 'failed';
      saved.phase = 'interrupted';
      saved.message = '서버가 재시작되어 이전 HWP 작업이 중단되었습니다.';
      saved.error = saved.message;
      saved.completedAt = new Date().toISOString();
      fs.writeFileSync(absolutePath, JSON.stringify(saved, null, 2), 'utf8');
    }
  } catch (error) {
    console.warn('[Daily Work Log HWP Job] 이전 작업 상태 확인 실패:', error.message);
  }

  const createJob = ({ run, metadata = {} }) => {
    cleanup();
    const id = crypto.randomUUID();
    const job = {
      id,
      status: 'queued',
      phase: 'queued',
      message: 'HWP 출력 작업이 대기 중입니다.',
      progress: 5,
      createdAt: new Date().toISOString(),
      metadata,
    };
    jobs.set(id, job);
    persist(job);
    diagnose('queued', 'queued', job, metadata);

    const execute = async () => {
      update(job, {
        status: 'running',
        phase: 'preparing',
        message: '업무일지 데이터를 준비하고 있습니다.',
        progress: 10,
        startedAt: new Date().toISOString(),
      });
      diagnose('started', 'running', job, metadata);
      const reportProgress = (phase, message, progress) => update(job, {
        phase,
        message,
        progress: Math.max(job.progress, Math.min(99, Number(progress) || job.progress)),
      });

      try {
        const result = await run(reportProgress);
        update(job, {
          status: 'completed',
          phase: 'completed',
          message: result.message || 'HWP 업무일지 생성이 완료되었습니다.',
          progress: 100,
          completedAt: new Date().toISOString(),
          result,
        });
        diagnose('completed', 'success', job, {
          ...metadata,
          durationMs: new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime(),
          fileCount: Array.isArray(result.files) ? result.files.length : 0,
        });
      } catch (error) {
        update(job, {
          status: 'failed',
          phase: 'failed',
          message: `HWP 생성에 실패했습니다: ${error.message}`,
          progress: 100,
          completedAt: new Date().toISOString(),
          error: error.message,
        });
        diagnose('failed', 'failed', job, {
          ...metadata,
          durationMs: job.startedAt ? new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime() : 0,
          error: error.message,
        });
      }
    };

    queue = queue.catch(() => {}).then(execute);
    return publicJob(job);
  };

  const getJob = (id) => {
    const job = jobs.get(String(id || ''));
    if (job) return publicJob(job);
    const statePath = path.join(stateDir, `${String(id || '')}.json`);
    if (!/^[0-9a-f-]{36}$/i.test(String(id || '')) || !fs.existsSync(statePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch (_) {
      return null;
    }
  };

  return { createJob, getJob };
}

module.exports = { createDailyWorkLogHwpJobService };
