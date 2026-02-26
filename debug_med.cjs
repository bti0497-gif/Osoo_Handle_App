const path = require('path');
const appDataPath = path.join(process.env.APPDATA, 'Osoo_Handle_App');
const dbPath = path.join(appDataPath, 'osoo.db');
const db = require('better-sqlite3')(dbPath);

console.log('Cleaning up database at:', dbPath);

// 1. 버그로 인해 생긴 잘못된 매핑 키들 삭제
db.prepare("DELETE FROM config_items WHERE category='medicine' AND (item_name LIKE '%\\_purchase' ESCAPE '\\' OR item_name LIKE '%\\_usage' ESCAPE '\\' OR item_name LIKE '%\\_inventory' ESCAPE '\\')").run();

// 2. 초기 리스트 중 제외하기로 한 항목들 삭제 (사용자 요청: 3가지만 기본)
db.prepare("DELETE FROM config_items WHERE category='medicine' AND item_name IN ('차염산나트륨', '알민산나트륨')").run();

console.log('Cleanup complete.');
console.log('Remaining medicines:');
console.log(db.prepare("SELECT * FROM config_items WHERE category='medicine'").all());
