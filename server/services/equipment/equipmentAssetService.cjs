/**
 * server/services/equipment/equipmentAssetService.cjs
 * 장비 마스터(equipment_assets) 업무 로직. 라우트는 요청/응답만 담당한다.
 */
const { ServiceError, uuid, managementNoPrefix, nextManagementNo } = require('./equipmentShared.cjs');

const STATUSES = ['사용 중', '점검 필요', '수리 중', '예비', '철거', '폐기'];

function createEquipmentAssetService(db) {
  function list(siteId, keyword = '') {
    let rows = db.prepare(`
      SELECT e.*,
        (SELECT COUNT(*) FROM equipment_asset_photos p WHERE p.equipment_id = e.id) AS photo_count,
        (SELECT p2.relative_path FROM equipment_asset_photos p2
          WHERE p2.equipment_id = e.id AND p2.photo_type = 'main'
          ORDER BY p2.id DESC LIMIT 1) AS main_photo_url
      FROM equipment_assets e
      WHERE e.site_id = ?
      ORDER BY e.category_1, e.category_2, e.management_no
    `).all(siteId);
    const normalized = String(keyword || '').trim().toLowerCase();
    if (normalized) {
      rows = rows.filter((row) => [row.management_no, row.equipment_name, row.location, row.category1, row.category2]
        .some((field) => String(field || '').toLowerCase().includes(normalized)));
    }
    return rows.map((row) => ({
      ...row,
      main_photo_url: row.main_photo_url
        ? `/equipment-photos/${row.id}/${String(row.main_photo_url).split('/').pop()}`
        : null,
    }));
  }

  function countVisible(siteId) {
    return db.prepare('SELECT COUNT(*) AS count FROM equipment_assets WHERE site_id = ?').get(siteId).count;
  }

  function findById(siteId, id) {
    return db.prepare('SELECT * FROM equipment_assets WHERE id = ? AND site_id = ?').get(id, siteId) || null;
  }

  function methodOfSite(siteId) {
    const settings = db.prepare('SELECT method FROM app_settings WHERE id = 1').get() || {};
    return String(settings.method || 'A2O').toUpperCase();
  }

  function nextManagementNoFor(siteId, name, category1, category2, category3) {
    const prefix = managementNoPrefix(name, category2, category3);
    const rows = db.prepare('SELECT management_no FROM equipment_assets WHERE site_id = ?').all(siteId);
    return nextManagementNo(rows, prefix, category1);
  }

  function assertManagementNoFree(siteId, managementNo, exceptId = null) {
    const duplicate = db.prepare(
      'SELECT id FROM equipment_assets WHERE site_id = ? AND management_no = ? AND id != ?',
    ).get(siteId, managementNo, exceptId || '');
    if (duplicate) {
      throw new ServiceError('이미 등록된 관리번호입니다.', { status: 409, code: 'EQUIPMENT_DUPLICATE' });
    }
  }

  function normalizePayload(body = {}) {
    const managementNo = String(body.managementNo || '').trim();
    const name = String(body.name || '').trim();
    if (!managementNo) throw new ServiceError('관리번호가 필요합니다.');
    if (!name) throw new ServiceError('설비명이 필요합니다.');
    return {
      managementNo,
      name,
      category1: String(body.category1 || '').trim(),
      category2: String(body.category2 || '').trim(),
      category3: String(body.category3 || '').trim(),
      category4: String(body.category4 || '').trim(),
      model: String(body.model || '').trim(),
      specification: String(body.specification || '').trim(),
      unit: String(body.unit || '대').trim() || '대',
      quantity: Number(body.quantity) > 0 ? Number(body.quantity) : 1,
      power: String(body.power || '').trim(),
      installedAt: String(body.installedAt || '').trim(),
      vendor: String(body.vendor || '').trim(),
      location: String(body.location || '').trim(),
      accessory: String(body.accessory || '').trim(),
      status: String(body.status || '사용 중').trim(),
      is_visible: body.is_visible === undefined ? 1 : (body.is_visible ? 1 : 0),
      notes: String(body.notes || '').trim(),
    };
  }

  function create(siteId, siteName, body) {
    const payload = normalizePayload(body);
    assertManagementNoFree(siteId, payload.managementNo);
    const id = uuid();
    db.prepare(`
      INSERT INTO equipment_assets (
        id, site_id, site_name, management_no, category_1, category_2, category_3, category_4,
        equipment_name, model, specification, unit, quantity, power, installed_at, vendor,
        location, accessory, status, is_visible, notes, author, created_at, last_modified, is_synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)
    `).run(
      id, siteId, siteName, payload.managementNo, payload.category1, payload.category2,
      payload.category3, payload.category4, payload.name, payload.model, payload.specification,
      payload.unit, payload.quantity, payload.power, payload.installedAt, payload.vendor,
      payload.location, payload.accessory, payload.status, payload.is_visible, payload.notes,
    );
    return { id, ...payload };
  }

  function update(id, siteId, body) {
    const target = findById(siteId, id);
    if (!target) throw new ServiceError('장비를 찾을 수 없습니다.', { status: 404 });
    const payload = normalizePayload(body);
    assertManagementNoFree(siteId, payload.managementNo, id);
    db.prepare(`
      UPDATE equipment_assets SET
        management_no = ?, category_1 = ?, category_2 = ?, category_3 = ?, category_4 = ?,
        equipment_name = ?, model = ?, specification = ?, unit = ?, quantity = ?, power = ?,
        installed_at = ?, vendor = ?, location = ?, accessory = ?, status = ?,
        is_visible = ?, notes = ?, last_modified = CURRENT_TIMESTAMP, is_synced = 0
      WHERE id = ? AND site_id = ?
    `).run(
      payload.managementNo, payload.category1, payload.category2, payload.category3, payload.category4,
      payload.name, payload.model, payload.specification, payload.unit, payload.quantity, payload.power,
      payload.installedAt, payload.vendor, payload.location, payload.accessory, payload.status,
      payload.is_visible, payload.notes, id, siteId,
    );
    return { id, ...payload };
  }

  function updateStatus(id, siteId, status) {
    if (!STATUSES.includes(status)) {
      throw new ServiceError('허용되지 않은 상태입니다.');
    }
    const result = db.prepare(
      'UPDATE equipment_assets SET status = ?, last_modified = CURRENT_TIMESTAMP, is_synced = 0 WHERE id = ? AND site_id = ?',
    ).run(status, id, siteId);
    if (result.changes === 0) throw new ServiceError('장비를 찾을 수 없습니다.', { status: 404 });
    return { id, status };
  }

  function updateVisibility(id, siteId, isVisible) {
    const result = db.prepare(
      'UPDATE equipment_assets SET is_visible = ?, last_modified = CURRENT_TIMESTAMP, is_synced = 0 WHERE id = ? AND site_id = ?',
    ).run(isVisible ? 1 : 0, id, siteId);
    if (result.changes === 0) throw new ServiceError('장비를 찾을 수 없습니다.', { status: 404 });
    return { id, is_visible: isVisible ? 1 : 0 };
  }

  // §3 삭제 정책: 이력/업무 연결이 있는 장비는 삭제 차단(이력 보존)
  function remove(id, siteId) {
    const target = findById(siteId, id);
    if (!target) throw new ServiceError('장비를 찾을 수 없습니다.', { status: 404 });
    const historyCount = db.prepare('SELECT COUNT(*) AS count FROM facility_logs WHERE equipment_id = ?').get(id).count;
    const linkCount = db.prepare('SELECT COUNT(*) AS count FROM work_record_equipment_links WHERE equipment_id = ?').get(id).count;
    if (historyCount > 0 || linkCount > 0) {
      throw new ServiceError('이 장비에는 유지보수 이력 또는 업무 연결이 있어 삭제할 수 없습니다.', {
        status: 409,
        code: 'EQUIPMENT_IN_USE',
      });
    }
    const photoRows = db.prepare('SELECT relative_path FROM equipment_asset_photos WHERE equipment_id = ?').all(id);
    db.transaction(() => {
      db.prepare('DELETE FROM equipment_asset_photos WHERE equipment_id = ?').run(id);
      db.prepare('DELETE FROM equipment_assets WHERE id = ? AND site_id = ?').run(id, siteId);
    })();
    return { deletedPhotos: photoRows.map((row) => row.relative_path), equipmentName: target.equipment_name };
  }

  return {
    STATUSES,
    list,
    countVisible,
    findById,
    methodOfSite,
    nextManagementNoFor,
    create,
    update,
    updateStatus,
    updateVisibility,
    remove,
  };
}

module.exports = createEquipmentAssetService;
