const express = require('express');
const { operationDiagnostics, report } = require('../services/equipment/operationDiagnosticService.cjs');
const fs = require('fs');
const path = require('path');
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

module.exports = function registerFacilityRoutes(db, appDataPath) {
  router.use('/api/work-records', operationDiagnostics(db, appDataPath, 'work-photos'));
  const selectWorkRecords = `
    SELECT wr.*,
           (SELECT COUNT(*) FROM work_record_photos p WHERE p.work_record_id = wr.id) AS photo_count,
           (SELECT GROUP_CONCAT(l.equipment_id) FROM work_record_equipment_links l
             WHERE l.work_record_id = wr.id) AS linked_equipment_ids
    FROM work_records wr
  `;

  // 장비 연결(work_record_equipment_links) diff-upsert (계획서 §3-7).
  // 링크 행은 동기화 북키핑을 위해 숫자 id와 site_id를 직접 소유한다.
  function replaceWorkRecordLinks(recordId, siteId, equipmentIds) {
    if (!Array.isArray(equipmentIds)) return { changed: 0 };
    const desired = [...new Set(equipmentIds.map((value) => String(value || '').trim()).filter(Boolean))];
    const validIds = new Set(
      db.prepare('SELECT id FROM equipment_assets WHERE site_id = ?').all(siteId).map((row) => row.id),
    );
    const existing = db.prepare(
      'SELECT equipment_id FROM work_record_equipment_links WHERE work_record_id = ?',
    ).all(recordId).map((row) => row.equipment_id);
    const toDelete = existing.filter((equipmentId) => !desired.includes(equipmentId));
    const toInsert = desired.filter((equipmentId) => !existing.includes(equipmentId) && validIds.has(equipmentId));
    const deleteLink = db.prepare(
      'DELETE FROM work_record_equipment_links WHERE work_record_id = ? AND equipment_id = ?',
    );
    const insertLink = db.prepare(`
      INSERT INTO work_record_equipment_links (id, work_record_id, equipment_id, site_id, created_at)
      VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM work_record_equipment_links), ?, ?, ?, ?)
    `);
    toDelete.forEach((equipmentId) => deleteLink.run(recordId, equipmentId));
    toInsert.forEach((equipmentId) => insertLink.run(recordId, equipmentId, siteId, new Date().toISOString()));
    return { changed: toDelete.length + toInsert.length };
  }

  // 연결 변경이 있으면 장비 전용 동기화로 BigQuery 메타데이터를 맞춘다(비차단).
  function triggerEquipmentSync() {
    setImmediate(() => {
      try {
        const createSync = require('../services/equipment/equipmentSyncService.cjs');
        createSync(db).syncEquipmentData().catch(() => {});
      } catch (_) { /* 무시: 다음 변경 시 재전송 */ }
    });
  }

  function writeDriveReceipt(localPath, receipt) {
    try {
      fs.writeFileSync(`${localPath}.drive.json`, JSON.stringify(receipt), 'utf8');
    } catch (error) {
      console.warn('[work-photos] Drive 영수증 저장 실패:', error.message);
    }
  }

  async function mirrorWorkPhotosToDrive(record, photos) {
    const startedAt = Date.now();
    try {
      const driveService = require('../services/driveService.cjs');
      if (!photos.length || !driveService.isDriveConfigured()) {
        report(db, appDataPath, {
          area: 'work-photos', action: 'photo-drive-mirror-batch', result: 'skipped',
          details: { recordId: record.id, siteId: record.site_id, photoCount: photos.length },
        });
        return;
      }
      const folder = await driveService.getOrCreateFolderPath(
        driveService.getDriveRootFolderId(),
        ['사진관리', '업무기록', record.site_id, record.date, `record-${record.id}`],
      );
      let uploadedCount = 0;
      for (const photo of photos) {
        if (!fs.existsSync(photo.absolutePath)) continue;
        const uploaded = await driveService.uploadBufferToFolder({
          folderId: folder.id,
          fileName: photo.storedName,
          buffer: fs.readFileSync(photo.absolutePath),
          mimeType: photo.mimeType,
        });
        if (uploaded?.id) {
          uploadedCount += 1;
          writeDriveReceipt(photo.absolutePath, { version: 1, driveFileId: uploaded.id, fileName: photo.storedName });
        }
      }
      report(db, appDataPath, {
        area: 'work-photos', action: 'photo-drive-mirror-batch',
        level: uploadedCount === photos.length ? 'info' : 'warn',
        result: uploadedCount === photos.length ? 'ok' : 'partial',
        details: {
          recordId: record.id, siteId: record.site_id, photoCount: photos.length, uploadedCount,
          driveFolderId: folder.id, duplicateFoldersDetected: folder._pathDuplicates || [],
          durationMs: Date.now() - startedAt,
        },
      });
    } catch (error) {
      report(db, appDataPath, {
        area: 'work-photos', action: 'photo-drive-mirror-batch', level: 'warn', result: 'failed',
        details: { recordId: record.id, siteId: record.site_id, photoCount: photos.length, errorName: error.name },
      });
      console.warn('[work-photos] Drive 묶음 미러 실패:', error.message);
    }
  }

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
      const { date, location, title, content, notes, equipmentIds } = req.body || {};
      if (!date) return res.status(400).json({ success: false, message: '날짜가 필요합니다.' });
      const siteId = String(req.siteContext?.siteId || '').trim();
      // 하루 1건 계약(UNIQUE(site_id, date)): 중복 저장은 409로 안내한다.
      const duplicate = db.prepare(
        'SELECT id FROM work_records WHERE site_id = ? AND date = ?',
      ).get(siteId, date);
      if (duplicate) {
        return res.status(409).json({
          success: false,
          code: 'WORK_RECORD_DUPLICATE',
          message: '해당 날짜에 이미 작성한 업무 기록이 있습니다. 기존 기록을 수정해 주세요.',
        });
      }
      const metadata = getCurrentRecordMetadata(db, req.body);
      const insertRecord = db.prepare(`
        INSERT INTO work_records
          (date, location, title, content, notes, site_id, site_name, author, created_at, last_modified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      let recordId;
      db.transaction(() => {
        const info = insertRecord.run(
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
        recordId = info.lastInsertRowid;
        replaceWorkRecordLinks(recordId, metadata.siteId, equipmentIds);
      })();
      if (Array.isArray(equipmentIds) && equipmentIds.length) triggerEquipmentSync();
      res.json({ success: true, id: recordId });
    } catch (error) {
      console.error('[facility] 업무기록 저장 실패:', error.stack || error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  router.put('/api/work-records/:id', (req, res) => {
    try {
      const id = normalizeRecordId(req.params.id);
      if (!id) return res.status(400).json({ success: false, message: '기록 번호가 올바르지 않습니다.' });
      const siteId = String(req.siteContext?.siteId || '').trim();
      const { date, location, title, content, notes, equipmentIds } = req.body || {};
      // 소유권 확인 후 본문·연결 변경을 하나의 트랜잭션으로 처리한다(결함 6).
      // 다른 현장의 기록 ID면 아무 데이터도 변경하지 않는다.
      const record = db.prepare('SELECT id FROM work_records WHERE id = ? AND site_id = ?').get(id, siteId);
      if (!record) return res.status(404).json({ success: false, message: '현재 현장의 업무 기록을 찾을 수 없습니다.' });
      const update = db.prepare(`
        UPDATE work_records
        SET date = ?, location = ?, title = ?, content = ?, notes = ?, last_modified = ?
        WHERE id = ? AND site_id = ?
      `);
      db.transaction(() => {
        update.run(
          date,
          String(location || '').trim(),
          String(title || '').trim(),
          String(content || '').trim(),
          String(notes || '').trim(),
          new Date().toISOString(),
          id,
          siteId
        );
        replaceWorkRecordLinks(id, siteId, equipmentIds);
      })();
      if (equipmentIds !== undefined) triggerEquipmentSync();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // 업무기록 사진 목록(업무사진관리와 장비이력카드의 연결 사진이 같은 API를 사용)
  router.get('/api/work-records/:id/photos', (req, res) => {
    try {
      const id = normalizeRecordId(req.params.id);
      const siteId = String(req.siteContext?.siteId || '').trim();
      const record = db.prepare('SELECT id, date, title FROM work_records WHERE id = ? AND site_id = ?').get(id, siteId);
      if (!record) return res.status(404).json({ success: false, message: '업무 기록을 찾을 수 없습니다.' });
      const rows = db.prepare(
        'SELECT id, original_name, relative_path FROM work_record_photos WHERE work_record_id = ? ORDER BY id',
      ).all(id);
      res.json({
        success: true,
        date: record.date,
        title: record.title,
        photos: rows.map((row) => ({
          id: row.id,
          originalName: row.original_name,
          url: `/work-record-photos/${path.relative(getPhotoRoot(appDataPath), path.resolve(appDataPath, row.relative_path)).split(path.sep).map(encodeURIComponent).join('/')}`,
        })),
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  router.delete('/api/work-records/:id/photos/:photoId', (req, res) => {
    try {
      const id = normalizeRecordId(req.params.id);
      const photoId = normalizeRecordId(req.params.photoId);
      const siteId = String(req.siteContext?.siteId || '').trim();
      const photo = id && photoId ? db.prepare(`
        SELECT p.id, p.relative_path FROM work_record_photos p
        JOIN work_records wr ON wr.id = p.work_record_id
        WHERE p.id = ? AND p.work_record_id = ? AND wr.site_id = ?
      `).get(photoId, id, siteId) : null;
      if (!photo) return res.status(404).json({ success: false, message: '현재 현장의 사진을 찾을 수 없습니다.' });
      db.prepare('DELETE FROM work_record_photos WHERE id = ?').run(photo.id);
      const absolutePath = path.resolve(appDataPath, photo.relative_path);
      if (absolutePath.startsWith(`${path.resolve(appDataPath)}${path.sep}`)) {
        if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
        if (fs.existsSync(`${absolutePath}.drive.json`)) fs.unlinkSync(`${absolutePath}.drive.json`);
      }
      triggerEquipmentSync();
      const remaining = db.prepare('SELECT COUNT(*) AS count FROM work_record_photos WHERE work_record_id = ?').get(id).count;
      res.json({ success: true, remaining });
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
      const record = id ? db.prepare('SELECT id, date, site_id FROM work_records WHERE id = ? AND site_id = ?').get(id, req.siteContext?.siteId) : null;
      if (!record) return res.status(404).json({ success: false, message: '업무 기록을 찾을 수 없습니다.' });
      if (!req.files?.length) return res.status(400).json({ success: false, message: '선택한 사진이 없습니다.' });

      const photoDir = getRecordPhotoDir(appDataPath, id);
      fs.mkdirSync(photoDir, { recursive: true });
      const insert = db.prepare(`
        INSERT INTO work_record_photos (work_record_id, site_id, original_name, stored_name, relative_path, is_synced, created_at)
        VALUES (?, ?, ?, ?, ?, 0, ?)
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
          insert.run(id, record.site_id, file.originalname || storedName, storedName, relativePath, new Date().toISOString());
          saved.push({ storedName, absolutePath, mimeType: file.mimetype });
        });
      })();
      mirrorWorkPhotosToDrive(record, saved);
      triggerEquipmentSync();
      res.json({ success: true, count: saved.length, files: saved.map((item) => item.storedName) });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  return router;
};
