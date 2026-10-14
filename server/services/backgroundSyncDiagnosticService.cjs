'use strict';

function classifyDataSync(result = {}) {
  const failedTables = Object.entries(result.results || {})
    .filter(([, row]) => row?.success === false).map(([name]) => name);
  const paused = Boolean(result.results?.paused || result.reason === 'waiting-for-idle');
  const outcome = result.error || failedTables.length ? 'failed' : paused ? 'deferred' : result.skipped ? 'skipped' : 'completed';
  return { outcome, reason: paused ? 'user-activity' : result.skipped ? result.reason : undefined, failedTables };
}

function classifyFileSync(summary = {}) {
  return {
    outcome: Number(summary.failed || 0) > 0 ? 'failed' : summary.paused ? 'deferred' : 'completed',
    reason: summary.paused ? 'user-activity' : undefined,
    total: Number(summary.total || 0), completed: Number(summary.completed || 0), failed: Number(summary.failed || 0),
    paused: Boolean(summary.paused),
    taskTimings: Array.isArray(summary.taskTimings) ? summary.taskTimings.slice(0, 50) : [],
  };
}

module.exports = { classifyDataSync, classifyFileSync };
