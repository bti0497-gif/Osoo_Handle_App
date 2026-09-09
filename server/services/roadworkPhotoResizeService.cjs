'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

// Only derived helper attachments are resized. Drive tasks keep the original paths.
async function prepareRoadworkPhotos({ photoRoot, siteId, date, items }) {
  const prepared = [];
  const diagnostics = [];
  for (const item of items) {
    const started = Date.now();
    const detail = { key: item.key, policy: 'jpeg-1600-q80-v1' };
    try {
      const sharp = require('sharp');
      const original = await fs.readFile(item.filePath);
      detail.originalBytes = original.length;
      const metadata = await sharp(original).metadata();
      detail.originalWidth = metadata.width;
      detail.originalHeight = metadata.height;
      const { data, info } = await sharp(original).rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 }).toBuffer({ resolveWithObject: true });
      if (data.length >= original.length) {
        prepared.push(item);
        Object.assign(detail, { result: 'original-smaller', preparedBytes: original.length });
      } else {
        const identity = crypto.createHash('sha256').update(String(siteId)).digest('hex');
        const hash = crypto.createHash('sha256').update(original).update(detail.policy).digest('hex');
        const directory = path.join(photoRoot, '.osoo-roadwork-prepared', identity);
        const filePath = path.join(directory, `${String(date).replace(/[^0-9]/g, '')}-${item.key}-${hash}.jpg`);
        await fs.mkdir(directory, { recursive: true });
        // Immutable content-addressed files avoid readers observing partial replacements.
        const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
        try {
          await fs.writeFile(temporary, data);
          await fs.rename(temporary, filePath);
        } finally {
          await fs.rm(temporary, { force: true });
        }
        prepared.push({ ...item, filePath });
        Object.assign(detail, { result: 'resized', preparedBytes: data.length,
          preparedWidth: info.width, preparedHeight: info.height });
      }
    } catch (error) {
      // A failed optimization must not make an existing photo unavailable.
      prepared.push(item);
      Object.assign(detail, { result: 'original-fallback', errorCode: error.code || 'RESIZE_FAILED' });
    }
    detail.elapsedMs = Date.now() - started;
    diagnostics.push(detail);
  }
  return { items: prepared, diagnostics };
}

module.exports = { prepareRoadworkPhotos };
