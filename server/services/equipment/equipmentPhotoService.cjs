/**
 * server/services/equipment/equipmentPhotoService.cjs
 * 장비 대표사진 / 이력 사진의 파일·메타데이터 처리 + Drive 미러(비차단, §4-4-4).
 * 원칙: 사진 바이너리는 Drive/로컬에, 메타데이터만 DB와 BigQuery에 둔다.
 */
const fs = require('fs');
const path = require('path');
const { ServiceError, uuid } = require('./equipmentShared.cjs');
const { report } = require('./operationDiagnosticService.cjs');

const EQUIPMENT_PHOTO_DIRNAME = '장비이력';

function createEquipmentPhotoService(db, appDataPath) {
  let driveServiceCache = null;

  function getDriveService() {
    if (!driveServiceCache) driveServiceCache = require('../driveService.cjs');
    return driveServiceCache;
  }

  function equipmentPhotoDir(equipmentId) {
    const safeId = String(equipmentId || '').replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(appDataPath, '사진관리', EQUIPMENT_PHOTO_DIRNAME, safeId);
  }

  function historyPhotoDir(localKey) {
    const safeKey = String(localKey || '').replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(appDataPath, '사진관리', EQUIPMENT_PHOTO_DIRNAME, `log-${safeKey}`);
  }

  function saveBufferToDir(dir, originalName, buffer) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ext = (path.extname(originalName || '') || '.jpg').toLowerCase().replace(/[^.a-z0-9]/g, '') || '.jpg';
    const storedName = `${Date.now()}-${uuid().slice(0, 8)}${ext}`;
    const absolutePath = path.join(dir, storedName);
    fs.writeFileSync(absolutePath, buffer);
    return { storedName, absolutePath };
  }

  function toAbsolute(relativePath) {
    return path.join(appDataPath, '사진관리', String(relativePath || '').replace(/^\//, ''));
  }

  function removeFileQuiet(absolutePath) {
    try {
      if (absolutePath && fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
    } catch (error) {
      console.warn('[equipment-photos] 파일 삭제 실패:', error.message);
    }
  }

  function removeDirQuiet(dir) {
    try {
      if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      console.warn('[equipment-photos] 폴더 삭제 실패:', error.message);
    }
  }

  function writeDriveReceipt(localPath, receipt) {
    try {
      fs.writeFileSync(`${localPath}.drive.json`, JSON.stringify(receipt), 'utf8');
    } catch (error) {
      console.warn('[equipment-photos] Drive 영수증 저장 실패:', error.message);
    }
  }

  async function mirrorPhotoToDrive({ localPath, fileName, mimeType, subfolders = [] }) {
    const started = Date.now();
    const details = () => ({ siteId: subfolders[0] || null, entityId: subfolders[1] || null, durationMs: Date.now() - started });
    try {
      const driveService = getDriveService();
      const {
        getDriveRootFolderId,
        getOrCreateFolderPath,
        isDriveConfigured,
        uploadBufferToFolder,
      } = driveService;
      if (!localPath || !fs.existsSync(localPath) || !isDriveConfigured()) {
        report(db, appDataPath, { area: 'equipment-card', action: 'photo-drive-mirror', result: 'skipped', details: details() });
        return null;
      }
      const folder = await getOrCreateFolderPath(
        getDriveRootFolderId(),
        ['사진관리', EQUIPMENT_PHOTO_DIRNAME, ...subfolders.map((value) => String(value || '').trim()).filter(Boolean)],
      );
      const buffer = fs.readFileSync(localPath);
      const result = await uploadBufferToFolder({ folderId: folder.id, fileName, buffer, mimeType });
      if (result?.id) writeDriveReceipt(localPath, { version: 1, driveFileId: result.id, fileName });
      report(db, appDataPath, { area: 'equipment-card', action: 'photo-drive-mirror', level: result?.id ? 'info' : 'warn', result: result?.id ? 'ok' : 'failed', details: details() });
      return result || null;
    } catch (error) {
      report(db, appDataPath, { area: 'equipment-card', action: 'photo-drive-mirror', level: 'warn', result: 'failed', details: { ...details(), errorName: error.name } });
      console.warn('[equipment-photos] Drive 미러 실패:', error.message);
      return null;
    }
  }

  // ---- 장비 대표사진 (equipment_asset_photos, photo_type = 'main') ----
  function saveEquipmentMainPhoto(equipmentId, file = null) {
    if (!file || !file.buffer) throw new ServiceError('사진 파일이 없습니다.');
    const equipment = db.prepare('SELECT site_id FROM equipment_assets WHERE id = ?').get(equipmentId);
    if (!equipment) throw new ServiceError('장비를 찾을 수 없습니다.', { status: 404 });
    const dir = equipmentPhotoDir(equipmentId);
    const { storedName, absolutePath } = saveBufferToDir(dir, file.originalname, file.buffer);
    const previous = db.prepare(`
      SELECT id, relative_path FROM equipment_asset_photos
      WHERE equipment_id = ? AND photo_type = 'main'
    `).all(equipmentId);
    const relativePath = `/${EQUIPMENT_PHOTO_DIRNAME}/${equipmentId}/${storedName}`;
    db.transaction(() => {
      previous.forEach((row) => db.prepare('DELETE FROM equipment_asset_photos WHERE id = ?').run(row.id));
      db.prepare(`
        INSERT INTO equipment_asset_photos (equipment_id, site_id, photo_type, original_name, stored_name, relative_path, sort_order)
        VALUES (?, ?, 'main', ?, ?, ?, 0)
      `).run(equipmentId, equipment.site_id, file.originalname || storedName, storedName, relativePath);
    })();
    previous.forEach((row) => removeFileQuiet(toAbsolute(row.relative_path)));
    mirrorPhotoToDrive({
      localPath: absolutePath,
      fileName: storedName,
      mimeType: file.mimetype,
      subfolders: [equipment.site_id, equipmentId],
    });
    // 렌더러는 정적 마운트(/사진관리)로 이미지를 직접 로드한다(토큰 불필요, 슬러지 사진과 동일).
    return { url: `/equipment-photos/${equipmentId}/${storedName}`, relativePath };
  }

  function getEquipmentMainPhotoPath(equipmentId) {
    const row = db.prepare(`
      SELECT p.relative_path FROM equipment_asset_photos p
      JOIN equipment_assets e ON e.id = p.equipment_id
      WHERE p.equipment_id = ? AND p.photo_type = 'main'
      ORDER BY p.id DESC LIMIT 1
    `).get(equipmentId);
    if (!row) return null;
    const absolutePath = toAbsolute(row.relative_path);
    return fs.existsSync(absolutePath) ? absolutePath : null;
  }

  function removeEquipmentPhotoFiles(equipmentId) {
    removeDirQuiet(equipmentPhotoDir(equipmentId));
  }

  // ---- 이력 사진 (facility_log_photos) ----
  function addHistoryPhotos(historyRow, files = []) {
    if (!files.length) throw new ServiceError('사진 파일이 없습니다.');
    const dir = historyPhotoDir(String(historyRow.id));
    const insert = db.prepare(`
      INSERT INTO facility_log_photos (facility_log_id, site_id, original_name, stored_name, relative_path, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    const saved = [];
    db.transaction(() => {
      const base = db.prepare(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM facility_log_photos WHERE facility_log_id = ?',
      ).get(historyRow.id).next;
      files.forEach((file, offset) => {
        const { storedName, absolutePath } = saveBufferToDir(dir, file.originalname, file.buffer);
        const relativePath = `/${EQUIPMENT_PHOTO_DIRNAME}/log-${historyRow.id}/${storedName}`;
        insert.run(historyRow.id, historyRow.site_id || null, file.originalname || storedName, storedName, relativePath, base + offset);
        saved.push({ storedName, absolutePath, mimeType: file.mimetype });
      });
    })();
    saved.forEach((item) => mirrorPhotoToDrive({
      localPath: item.absolutePath,
      fileName: item.storedName,
      mimeType: item.mimeType,
      subfolders: [historyRow.site_id, `log-${historyRow.id}`],
    }));
    return { added: files.length, total: countHistoryPhotos(historyRow.id) };
  }

  function listHistoryPhotos(historyRow) {
    return db.prepare(`
      SELECT id, original_name, relative_path FROM facility_log_photos
      WHERE facility_log_id = ? ORDER BY sort_order, id
    `).all(historyRow.id).map((photo) => ({
      id: photo.id,
      originalName: photo.original_name,
      url: `/equipment-photos/log-${historyRow.id}/${photo.relative_path.split('/').pop()}`,
    }));
  }

  function countHistoryPhotos(historyId) {
    return db.prepare('SELECT COUNT(*) AS count FROM facility_log_photos WHERE facility_log_id = ?').get(historyId).count;
  }

  function getHistoryPhotoPath(historyRow, photoId) {
    const photo = db.prepare(
      'SELECT relative_path FROM facility_log_photos WHERE id = ? AND facility_log_id = ?',
    ).get(Number(photoId), historyRow.id);
    if (!photo) throw new ServiceError('사진을 찾을 수 없습니다.', { status: 404 });
    const absolutePath = toAbsolute(photo.relative_path);
    if (!fs.existsSync(absolutePath)) throw new ServiceError('사진 파일이 없습니다.', { status: 404 });
    return absolutePath;
  }

  function removeHistoryPhoto(historyRow, photoId) {
    const photo = db.prepare(
      'SELECT id, relative_path FROM facility_log_photos WHERE id = ? AND facility_log_id = ?',
    ).get(Number(photoId), historyRow.id);
    if (!photo) throw new ServiceError('사진을 찾을 수 없습니다.', { status: 404 });
    db.transaction(() => {
      db.prepare('DELETE FROM facility_log_photos WHERE id = ?').run(photo.id);
    })();
    removeFileQuiet(toAbsolute(photo.relative_path));
    return { remaining: countHistoryPhotos(historyRow.id) };
  }

  // 이력 삭제/장비 삭제 시 남은 사진 파일 정리 (DB 행은 이미 삭제된 뒤 호출)
  function cleanupHistoryFiles(localKey, removedPhotoPaths = []) {
    removedPhotoPaths.forEach((relativePath) => removeFileQuiet(toAbsolute(relativePath)));
    removeDirQuiet(historyPhotoDir(localKey));
  }

  return {
    saveEquipmentMainPhoto,
    getEquipmentMainPhotoPath,
    removeEquipmentPhotoFiles,
    addHistoryPhotos,
    listHistoryPhotos,
    getHistoryPhotoPath,
    removeHistoryPhoto,
    cleanupHistoryFiles,
  };
}

module.exports = createEquipmentPhotoService;
