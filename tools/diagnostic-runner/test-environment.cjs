'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const { resolveFreePort, waitForReady } = require('./lib/app-process.cjs');
const { prepareSqlite } = require('./lib/validation-environment.cjs');
(async () => {
  assert.equal(prepareSqlite().reused, true);
  const port = await resolveFreePort();
  const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ app: 'osoo-handle-app', ready: true }));
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  try { assert.equal((await waitForReady({ port, token: 'test', timeoutMs: 3000 })).ready, true); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await assert.rejects(waitForReady({ port, child: { exitCode: 1 }, timeoutMs: 90000 }), /SERVER_EXIT_BEFORE_READY/);
  await assert.rejects(waitForReady({ port: 6666, timeoutMs: 90000 }), /UNUSABLE_HTTP_PORT/);
  console.log('PASS: SQLite reuse, HTTP-ready port, early child exit, blocked port fail-fast');
})().catch(error => { console.error(error); process.exitCode = 1; });
