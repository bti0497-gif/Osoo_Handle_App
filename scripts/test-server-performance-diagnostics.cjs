'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createServerPerformanceDiagnosticService } = require('../server/services/serverPerformanceDiagnosticService.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const { runRequest, measurePhase } = require('../server/services/requestPhaseService.cjs');

(async () => {
  const first = {}, second = {};
  await Promise.all([
    runRequest(first, () => measurePhase('local-list', () => sleep(5))),
    runRequest(second, () => measurePhase('remote-list', () => sleep(8))),
  ]);
  assert.equal(first.phases[0].name, 'local-list');
  assert.equal(second.phases[0].name, 'remote-list');
  assert.equal(first.currentPhase, null);
  assert.throws(() => runRequest(first, () => measurePhase('failed', () => { throw new Error('expected'); })));
  assert.equal(first.currentPhase, null);
  console.log('PASS: request phase isolation and failure cleanup');
  const events = [];
  const service = createServerPerformanceDiagnosticService({
    recordDiagnostic: (_db, _path, event) => events.push(event),
    sampleIntervalMs: 10, eventLoopWarnMs: 25, logCooldownMs: 0, slowApiMs: 1,
  });
  service.start();
  try {
    await sleep(40);
    const res = new EventEmitter(); res.statusCode = 200;
    let forwarded = false;
    service.middleware({ path: '/api/test', method: 'GET', get: () => '' }, res, () => { forwarded = true; });
    assert.equal(forwarded, true);
    // Finish before the delayed sampler runs: history must preserve the suspect request.
    const end = performance.now() + 65;
    while (performance.now() < end) { /* intentional diagnostic test stall */ }
    res.emit('finish'); res.emit('close');
    await sleep(30);
    const lag = events.find(event => event.action === 'event-loop-lag');
    assert.ok(lag, 'stall observed');
    assert.ok(lag.details.recentSamples.length > 0);
    assert.ok(lag.details.recentSamples.length <= 15);
    assert.ok(lag.details.recentCompletedRequests.some(req => req.path === '/api/test'));
    assert.equal(events.filter(event => event.action === 'slow-api-request').length, 1);
    assert.ok(lag.details.monotonicElapsedMs >= 25);
    assert.equal(lag.details.diagnosticRevision, 2);
    console.log('PASS: pre-stall history, completed request, bounded buffer, finish/close deduplication');
  } finally { service.stop(); }
  const failing = createServerPerformanceDiagnosticService({recordDiagnostic: () => { throw new Error('test writer unavailable'); }});
  assert.equal(failing.recordFatal('test', new Error('test')), false);
  console.log('PASS: diagnostic writer failure isolated');
})().catch(error => { console.error(error); process.exitCode = 1; });
