'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const createService = require('../server/services/equipment/equipmentAssetService.cjs');
for (const [history, links] of [[1,0],[0,1],[1,1]]) {
  const writes = [];
  let visible = 1;
  const db = { prepare(sql) { return {
    get: () => /COUNT.*facility_logs/.test(sql) ? {count:history}
      : /COUNT.*work_record_equipment_links/.test(sql) ? {count:links}
        : {id:'test',equipment_name:'test',is_visible:visible},
    run: (...args) => { writes.push(sql); if(sql.includes('SET is_visible')) visible=args[0]; return {changes:1}; },
  }; } };
  const service = createService(db);
  assert.throws(() => service.remove('test','site'), (error) => {
    assert.equal(error.code,'EQUIPMENT_IN_USE');
    assert.ok(error.message.includes(history ? '정비이력' : '장비 연결을 먼저 해제'));
    for (const text of ['장비목록에 표시','수정 적용','보존','다시 켜면']) assert.ok(error.message.includes(text));
    return true;
  });
  assert.equal(writes.length,0,'blocked delete must not alter any record');
  service.updateVisibility('test','site',false);
  assert.equal(visible,0);
  service.updateVisibility('test','site',true);
  assert.equal(visible,1);
  assert.equal(writes.length,2);
  assert.ok(writes.every(sql=>sql.startsWith('UPDATE equipment_assets SET is_visible')),'hide/restore must never delete histories/photos/links');
}
const editor=fs.readFileSync('src/features/equipment/EquipmentEditorModal.jsx','utf8');
assert.ok(editor.includes("onChangeField('is_visible', event.target.checked)"));
console.log('PASS deletion guidance by reason, no blocked-delete writes, visibility-only hide/restore and editor checkbox binding');
