'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osoo-photo-url-'));
  const name = '한글 사진 #1%.png';
  const dir = path.join(root, '1');
  fs.mkdirSync(dir);
  const bytes = Buffer.from('fixture');
  fs.writeFileSync(path.join(dir, name), bytes);
  const source = fs.readFileSync(path.join(__dirname, '../server/index.cjs'), 'utf8');
  assert.ok(source.includes("app.use('/work-record-photos', express.static("));
  const app = express();
  app.use('/work-record-photos', express.static(root));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/work-record-photos/1/${encodeURIComponent(name)}`);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    console.log('PASS: work photo URL serves Unicode, spaces, hash and percent filenames');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
