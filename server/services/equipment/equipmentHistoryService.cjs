/**
 * server/services/equipment/equipmentHistoryService.cjs
 * 이력(facility_logs + equipment_id) 업무 로직. 사진 파일/폴더 처리는 equipmentPhotoService가 담당한다.
 */
const { ServiceError } = require('./equipmentShared.cjs');

function createEquipmentHistoryService(db) {
  function findById(siteId, id) {
    return db.prepare('SELECT * FROM facility_logs WHERE id = ? AND site_id = ?').get(id, siteId) || null;
  }

  function list(siteId, equipmentId = '') {
    const baseSelect = `
      SELECT f.*, e.equipment_name AS equipment_name_snapshot, e.management_no AS management_no_snapshot,
        (SELECT COUNT(*) FROM facility_log_photos p WHERE p.facility_log_id = f.id) AS photo_count
      FROM facility_logs f
      LEFT JOIN equipment_assets e ON e.id = f.equipment_id
      WHERE f.site_id = ? AND f.equipment_id IS NOT NULL
    `;
    if (equipmentId) {
      return db.prepare(`${baseSelect} AND f.equipment_id = ? ORDER BY f.date DESC, f.id DESC`).all(siteId, String(equipmentId));
    }
    return db.prepare(`${baseSelect} ORDER BY f.date DESC, f.id DESC`).all(siteId);
  }

  function assertEquipment(siteId, equipmentId) {
    const equipment = db.prepare('SELECT id, equipment_name FROM equipment_assets WHERE id = ? AND site_id = ?').get(equipmentId, siteId);
    if (!equipment) throw new ServiceError('장비를 찾을 수 없습니다.', { status: 404 });
    return equipment;
  }

  function create(siteId, siteName, author, body = {}) {
    const equipmentId = String(body.equipmentId || '').trim();
    const date = String(body.date || '').trim();
    const content = String(body.content || '').trim();
    if (!equipmentId) throw new ServiceError('장비가 선택되지 않았습니다.');
    if (!date) throw new ServiceError('발생일이 필요합니다.');
    if (!content) throw new ServiceError('수리·공사 내용이 필요합니다.');
    const equipment = assertEquipment(siteId, equipmentId);
    const info = db.prepare(`
      INSERT INTO facility_logs (
        date, facility_name, content, company, price, notes, site_id, site_name, author,
        equipment_id, type, contact, completed_at, created_at, last_modified, is_synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)
    `).run(
      date,
      equipment.equipment_name,
      content,
      String(body.company || '').trim(),
      Number(body.price) || 0,
      '',
      siteId,
      siteName,
      author,
      equipmentId,
      String(body.type || '정기점검').trim(),
      String(body.contact || '').trim(),
      String(body.completedAt || '').trim(),
    );
    return { id: info.lastInsertRowid };
  }

  function update(id, siteId, body = {}) {
    const row = findById(siteId, id);
    if (!row) throw new ServiceError('이력을 찾을 수 없습니다.', { status: 404 });
    db.prepare(`
      UPDATE facility_logs SET
        date = ?, completed_at = ?, type = ?, content = ?, company = ?, contact = ?,
        price = ?, notes = ?, last_modified = CURRENT_TIMESTAMP, is_synced = 0
      WHERE id = ? AND site_id = ?
    `).run(
      String(body.date ?? row.date).trim() || row.date,
      String(body.completedAt ?? row.completed_at ?? '').trim(),
      String(body.type ?? row.type ?? '기타').trim(),
      String(body.content ?? row.content).trim() || row.content,
      String(body.company ?? row.company ?? '').trim(),
      String(body.contact ?? row.contact ?? '').trim(),
      Number(body.price ?? row.price) || 0,
      String(body.notes ?? row.notes ?? '').trim(),
      id,
      siteId,
    );
    return { id };
  }

  // 사진 파일 삭제는 photoService.cleanupHistoryPhotos가 담당하므로
  // 여기서는 DB 행만 정리하고 정리 대상 경로를 반환한다.
  function remove(id, siteId) {
    const row = findById(siteId, id);
    if (!row) throw new ServiceError('이력을 찾을 수 없습니다.', { status: 404 });
    const photoRows = db.prepare('SELECT relative_path FROM facility_log_photos WHERE facility_log_id = ?').all(id);
    db.transaction(() => {
      db.prepare('DELETE FROM facility_log_photos WHERE facility_log_id = ?').run(id);
      db.prepare('DELETE FROM facility_logs WHERE id = ? AND site_id = ?').run(id, siteId);
    })();
    return { removedPhotoPaths: photoRows.map((photo) => photo.relative_path), localKey: String(row.id) };
  }

  return {
    list,
    findById,
    create,
    update,
    remove,
  };
}

module.exports = createEquipmentHistoryService;
