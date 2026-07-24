const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const multer = require('multer');
const { getCurrentRecordMetadata } = require('../services/syncMetadataService.cjs');
const {
  COMMON_MULTIPART_LIMITS,
  MAX_IMAGE_BYTES,
  imageFileFilter,
} = require('../middleware/uploadSecurity.cjs');

const router = express.Router();
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { ...COMMON_MULTIPART_LIMITS, fileSize: MAX_IMAGE_BYTES, files: 10 },
  fileFilter: imageFileFilter,
});

function normalizeRecordId(value) {
  const id = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function sanitizeFileName(value) {
  return String(value || 'photo')
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'photo';
}

function getPhotoRoot(appDataPath) {
  return path.resolve(appDataPath, '사진관리', '업무기록');
}

function getRecordPhotoDir(appDataPath, recordId) {
  const root = getPhotoRoot(appDataPath);
  const target = path.resolve(root, String(recordId));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error('사진 폴더 경로가 올바르지 않습니다.');
  }
  return target;
}

function openFolder(folderPath) {
  if (process.platform === 'win32') {
    const child = spawn('explorer.exe', [folderPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return;
  }
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(command, [folderPath], { detached: true, stdio: 'ignore' }).unref();
}

module.exports = function registerFacilityRoutes(db, appDataPath) {
  const selectWorkRecords = `
    SELECT wr.*,
           (SELECT COUNT(*) FROM work_record_photos p WHERE p.work_record_id = wr.id) AS photo_count
    FROM work_records wr
  `;

  router.get('/api/work-records', (req, res) => {
    const query = String(req.query?.q || '').trim();
    const siteId = String(req.siteContext?.siteId || '').trim();
    let sql = `${selectWorkRecords} WHERE wr.site_id = ?`;
    const params = [siteId];
    if (query) {
      sql += ' AND (wr.location LIKE ? OR wr.title LIKE ? OR wr.content LIKE ? OR wr.notes LIKE ?)';
      const like = `%${query}%`;
      params.push(like, like, like, like);
    }
    sql += ' ORDER BY wr.date DESC, wr.id DESC';
    res.json(db.prepare(sql).all(...params));
  });

  router.post('/api/work-records', (req, res) => {
    try {
      const { date, location, title, content, notes } = req.body || {};
      if (!date) return res.status(400).json({ success: false, message: '날짜가 필요합니다.' });
      const metadata = getCurrentRecordMetadata(db, req.body);
      const info = db.prepare(`
        INSERT INTO work_records
          (date, location, title, content, notes, site_id, site_name, author, created_at, last_modified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        date,
        String(location || '').trim(),
        String(title || '').trim(),
        String(content || '').trim(),
        String(notes || '').trim(),
        metadata.siteId,
        metadata.siteName || '',
        metadata.author || '',
        metadata.createdAt,
        metadata.lastModified
      );
      res.json({ success: true, id: info.lastInsertRowid });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  router.put('/api/work-records/:id', (req, res) => {
    try {
      const id = normalizeRecordId(req.params.id);
      if (!id) return res.status(400).json({ success: false, message: '기록 번호가 올바르지 않습니다.' });
      const siteId = String(req.siteContext?.siteId || '').trim();
      const { date, location, title, content, notes } = req.body || {};
      db.prepare(`
        UPDATE work_records
        SET date = ?, location = ?, title = ?, content = ?, notes = ?, last_modified = ?
        WHERE id = ? AND site_id = ?
      `).run(
        date,
        String(location || '').trim(),
        String(title || '').trim(),
        String(content || '').trim(),
        String(notes || '').trim(),
        new Date().toISOString(),
        id,
        siteId
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  router.delete('/api/work-records/:id', (req, res) => {
    try {
      const id = normalizeRecordId(req.params.id);
      if (!id) return res.status(400).json({ success: false, message: '기록 번호가 올바르지 않습니다.' });
      const siteId = String(req.siteContext?.siteId || '').trim();
      const record = db.prepare('SELECT id FROM work_records WHERE id = ? AND site_id = ?').get(id, siteId);
      if (!record) return res.status(404).json({ success: false, message: '현재 현장의 업무 기록을 찾을 수 없습니다.' });
      db.transaction(() => {
        db.prepare('DELETE FROM work_record_photos WHERE work_record_id = ?').run(id);
        db.prepare('DELETE FROM work_records WHERE id = ?').run(id);
      })();
      const photoDir = getRecordPhotoDir(appDataPath, id);
      if (fs.existsSync(photoDir)) fs.rmSync(photoDir, { recursive: true, force: true });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  router.post('/api/work-records/:id/photos', photoUpload.array('photos', 10), (req, res) => {
    try {
      const id = normalizeRecordId(req.params.id);
      const record = id ? db.prepare('SELECT id, date FROM work_records WHERE id = ? AND site_id = ?').get(id, req.siteContext?.siteId) : null;
      if (!record) return res.status(404).json({ success: false, message: '업무 기록을 찾을 수 없습니다.' });
      if (!req.files?.length) return res.status(400).json({ success: false, message: '선택한 사진이 없습니다.' });

      const photoDir = getRecordPhotoDir(appDataPath, id);
      fs.mkdirSync(photoDir, { recursive: true });
      const insert = db.prepare(`
        INSERT INTO work_record_photos (work_record_id, original_name, stored_name, relative_path, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const saved = [];
      db.transaction(() => {
        req.files.forEach((file, index) => {
          const originalExt = path.extname(file.originalname || '').toLowerCase();
          const extension = /^\.[a-z0-9]{1,8}$/.test(originalExt) ? originalExt : '.jpg';
          const baseName = sanitizeFileName(path.basename(file.originalname || 'photo', originalExt));
          const storedName = `${String(record.date || '').replace(/-/g, '')}_${Date.now()}_${index + 1}_${baseName}${extension}`;
          const absolutePath = path.join(photoDir, storedName);
          fs.writeFileSync(absolutePath, file.buffer);
          const relativePath = path.relative(appDataPath, absolutePath);
          insert.run(id, file.originalname || storedName, storedName, relativePath, new Date().toISOString());
          saved.push(storedName);
        });
      })();
      res.json({ success: true, count: saved.length, files: saved });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  router.post('/api/work-records/:id/open-photo-folder', (req, res) => {
    try {
      const id = normalizeRecordId(req.params.id);
      const record = id ? db.prepare('SELECT id FROM work_records WHERE id = ? AND site_id = ?').get(id, req.siteContext?.siteId) : null;
      if (!record) return res.status(404).json({ success: false, message: '업무 기록을 찾을 수 없습니다.' });
      const photoDir = getRecordPhotoDir(appDataPath, id);
      fs.mkdirSync(photoDir, { recursive: true });
      openFolder(photoDir);
      res.json({ success: true, path: photoDir });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  return router;
};
