'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { runRequest, measurePhase } = require('../server/services/requestPhaseService.cjs');
const { summarizeMemoryTrend } = require('../server/services/serverPerformanceDiagnosticService.cjs');

(async () => {
  const { inspectRoadworkResponse } = await import(pathToFileURL(path.join(__dirname, '../src/features/roadwork-helper/roadworkSessionEvidence.js')));
  const evidence = await inspectRoadworkResponse(new Response('<input type="password" value="DO-NOT-LOG"><script>location="/security/login.do"</script>session expired', { headers: { 'content-type': 'text/html' } }));
  assert.equal(evidence.loginFormMarker, true);
  assert.equal(evidence.loginRedirectMarker, true);
  assert.equal(evidence.sessionExpiryMarker, true);
  assert.equal(JSON.stringify(evidence).includes('DO-NOT-LOG'), false);
  const large = await inspectRoadworkResponse(new Response('x'.repeat(40000), { headers: { 'content-type': 'text/html' } }));
  assert.equal(large.bodySampleBytes, 32768);
  assert.equal(large.bodySampleLimited, true);
  const json = await inspectRoadworkResponse(new Response('{}', { headers: { 'content-type': 'application/json' } }));
  assert.equal(json.bodyInspected, false);
  const source = fs.readFileSync(path.join(__dirname, '../src/features/roadwork-helper/RoadworkHelperView.jsx'), 'utf8');
  const literal = source.match(/const ROADWORK_KEEP_ALIVE_SCRIPT = (`[\s\S]*?`);/)[1];
  const script = vm.runInNewContext(literal, { inspectRoadworkResponse });
  const probe = await vm.runInNewContext(script, {
    location: { origin: 'https://example.invalid' }, URL, TextDecoder, Date, setTimeout, clearTimeout,
    fetch: async () => new Response('<input type="password">', { headers: { 'content-type': 'text/html' } }),
  });
  assert.equal(probe.success, true);
  assert.equal(probe.loginFormMarker, true);
  assert.equal(probe.finalPath, '/websquare/websquare.jsp');
  const req = {};
  await runRequest(req, async () => measurePhase('outer', async () => {
    assert.equal(measurePhase('inner', () => 7), 7);
    assert.equal(req.currentPhase, 'outer');
    await measurePhase('async-inner', async () => 8);
    assert.equal(req.currentPhase, 'outer');
  }));
  assert.equal(req.currentPhase, null);
  assert.equal(req.phases.length, 3);
  const trend = summarizeMemoryTrend([
    { at: 0, rssBytes: 10, heapUsedBytes: 5, externalBytes: 1 },
    { at: 1800000, rssBytes: 30, heapUsedBytes: 9, externalBytes: 3 },
  ]);
  assert.equal(trend[2].rssDeltaBytes, 20);
  assert.equal(trend[2].externalDeltaBytes, 2);
  assert.equal(summarizeMemoryTrend([{ at: 1, rssBytes: 1 }])[0].available, false);
  console.log('PASS bounded response markers, no raw text, nested phase restoration, process memory trend');
})().catch((error) => { console.error(error); process.exitCode = 1; });
