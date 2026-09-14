'use strict';
const { AsyncLocalStorage } = require('async_hooks');
const { performance } = require('perf_hooks');
const storage = new AsyncLocalStorage();

function runRequest(request, next) {
  request.phases = [];
  return storage.run(request, next);
}

// No request body, credentials or filenames are retained in timing evidence.
function measurePhase(name, action) {
  const request = storage.getStore();
  const started = performance.now();
  const finish = () => {
    if (!request) return;
    request.phases.push({ name, durationMs: Math.round(performance.now() - started) });
    if (request.phases.length > 16) request.phases.shift();
    request.currentPhase = null;
  };
  if (request) request.currentPhase = name;
  try {
    const result = action();
    if (result && typeof result.then === 'function') return result.finally(finish);
    finish();
    return result;
  } catch (error) {
    finish();
    throw error;
  }
}
module.exports = { runRequest, measurePhase };
