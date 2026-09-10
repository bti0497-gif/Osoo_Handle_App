/**
 * server/services/equipment/equipmentCatalogService.cjs
 * 카탈로그 일괄 등록 (§3-5): 첫 1대는 호기 없이, 이후는 이어지는 호기(A, B, C...)로 생성.
 * 관리번호 충돌 시 서버가 최종 채번을 결정한다(클라이언트 추정치는 참고용).
 */
const { uuid, managementNoPrefix, nextManagementNo } = require('./equipmentShared.cjs');

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createEquipmentCatalogService(db) {
  function apply(siteId, siteName, selections = []) {
    if (!Array.isArray(selections) || !selections.length) {
      const error = new Error('선택된 항목이 없습니다.');
      error.status = 400;
      throw error;
    }
    const listAll = db.prepare(`
      SELECT management_no, equipment_name, category_1, category_3 FROM equipment_assets WHERE site_id = ?
    `).all(siteId);
    const insert = db.prepare(`
      INSERT INTO equipment_assets (
        id, site_id, site_name, management_no, category_1, category_2, category_3, category_4,
        equipment_name, unit, quantity, location, status, is_visible, author, created_at, last_modified, is_synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '대', 1, ?, '사용 중', 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)
    `);
    const created = [];

    selections.forEach(({ entry, count }) => {
      if (!entry || !entry.name || !entry.process) return;
      const wanted = Math.max(1, Math.min(26, Number(count) || 1));
      const category3 = entry.category3
        || ((entry.group === '계측기류' || entry.group === '유량계') ? '계측기' : '기계');
      const namePattern = new RegExp(`^${escapeRegExp(entry.name)}(?: ([A-Z]))?$`);
      const matched = listAll.filter((item) => (
        item.category_1 === entry.process && namePattern.test(item.equipment_name)
      ));
      const registered = matched.length;
      const unitRows = matched.filter((item) => / ([A-Z])$/.test(item.equipment_name));

      // 베이스 관리번호: 호기 카드가 있으면 그 번호에서, 단일 등록이면 그 번호에서 승계,
      // 없으면 규칙 기반 신규 채번한다.
      let baseNo = null;
      if (unitRows.length > 0) {
        baseNo = String(unitRows[0].management_no).replace(/[A-Z]$/i, '');
      } else if (registered > 0) {
        baseNo = matched[0].management_no;
      } else {
        baseNo = nextManagementNo(listAll, managementNoPrefix(entry.name, entry.group, category3));
      }

      for (let offset = 0; offset < wanted; offset += 1) {
        const isFirstSingle = registered === 0 && wanted === 1 && offset === 0;
        const letter = isFirstSingle ? null : String.fromCharCode(65 + (registered === 0 ? offset : registered + offset));
        const id = uuid();
        const managementNo = isFirstSingle ? baseNo : `${baseNo}${letter}`;
        const name = isFirstSingle ? entry.name : `${entry.name} ${letter}`;
        insert.run(
          id, siteId, siteName, managementNo,
          entry.process, entry.group, category3,
          `${entry.process}${category3 === '계측기' ? '계측기시설' : '기계시설'}`,
          name, entry.process,
        );
        listAll.push({ management_no: managementNo, equipment_name: name, category_1: entry.process, category_3: category3 });
        created.push({ id, managementNo, name });
      }
    });
    return { created };
  }

  return { apply };
}

module.exports = createEquipmentCatalogService;
