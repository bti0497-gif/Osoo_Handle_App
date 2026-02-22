const sqlite3 = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.env.APPDATA, 'Osoo_Handle_App', 'osoo.db');
const db = new sqlite3(dbPath, { readonly: true });

// 2025-06-06의 flow_readings 확인
console.log("=== flow_readings for 2025-06-06 (재임포트 후) ===");
const fr = db.prepare("SELECT type, raw_value, calculated_flow FROM flow_readings WHERE date = '2025-06-06' ORDER BY type").all();
fr.forEach(r => {
    console.log(`  ${r.type.padEnd(20)} raw: ${String(r.raw_value ?? 'NULL').padStart(12)}, flow: ${String(r.calculated_flow ?? 'NULL').padStart(8)}`);
});

// 총 레코드 수
const count = db.prepare("SELECT COUNT(*) as cnt FROM flow_readings").get();
console.log(`\n총 flow_readings: ${count.cnt}행`);

// type 종류 확인 (이상한 _flow/_raw 타입이 아직 있는지)
console.log("\n=== 모든 type 종류 ===");
const types = db.prepare("SELECT DISTINCT type FROM flow_readings ORDER BY type").all();
types.forEach(t => console.log(`  ${t.type}`));

db.close();
