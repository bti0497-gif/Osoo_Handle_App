'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { prepareRoadworkPhotos } = require('../server/services/roadworkPhotoResizeService.cjs');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'osoo-resize-test-'));
  try {
    const filePath = path.join(root, 'original.png');
    const original = await sharp({ create: { width: 3200, height: 2400, channels: 3,
      background: '#428abc' } }).png().toBuffer();
    await fs.writeFile(filePath, original);
    const args = { photoRoot: root, siteId: 'site-a', date: '2026-09-06',
      items: [{ key: 'alkalinity', filePath }] };
    const first = await prepareRoadworkPhotos(args);
    assert.equal(first.diagnostics[0].result, 'resized');
    assert.equal((await sharp(first.items[0].filePath).metadata()).width, 1600);
    assert.deepEqual(await fs.readFile(filePath), original);
    assert.equal((await prepareRoadworkPhotos(args)).items[0].filePath, first.items[0].filePath);
    assert.notEqual((await prepareRoadworkPhotos({ ...args, siteId: 'site-b' })).items[0].filePath, first.items[0].filePath);
    await fs.writeFile(filePath, 'invalid image');
    const fallback = await prepareRoadworkPhotos(args);
    assert.equal(fallback.diagnostics[0].result, 'original-fallback');
    assert.equal(fallback.items[0].filePath, filePath);
    console.log('PASS: resize, original preservation, reuse, site isolation, failure fallback');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
