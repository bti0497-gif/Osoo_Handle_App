const sqlite3 = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.env.APPDATA, 'Osoo_Handle_App', 'osoo.db');
const db = new sqlite3(dbPath, { readonly: true });

// 1. config_items에서 flow 카테고리 매핑 현황
console.log("=== config_items (flow category) ===");
const flowItems = db.prepare("SELECT * FROM config_items WHERE category = 'flow' ORDER BY item_name").all();
flowItems.forEach(item => {
    console.log(`  ${item.item_name.padEnd(25)} -> excel_cell: ${item.excel_cell || 'NULL'} (active: ${item.is_active})`);
});

// 2. 2025-06-06의 flow_readings
console.log("\n=== flow_readings for 2025-06-06 ===");
const readings = db.prepare("SELECT * FROM flow_readings WHERE date = '2025-06-06' ORDER BY type").all();
readings.forEach(r => {
    console.log(`  type: ${r.type.padEnd(25)}, raw: ${String(r.raw_value).padStart(10)}, calc_flow: ${String(r.calculated_flow).padStart(10)}`);
});

// 3. 엑셀 원본 데이터에서 2025-06-06에 해당하는 행 찾기
console.log("\n=== excel_raw_data: finding 2025-06-06 in sheet '월간일지(노란부분입력)' ===");
// 먼저 날짜 컬럼(A)에서 6월 6일 찾기
const dateRows = db.prepare("SELECT row_num, value FROM excel_raw_data WHERE sheet_name = '월간일지(노란부분입력)' AND col = 'A' AND (value LIKE '%06-06%' OR value LIKE '%6월6일%' OR value LIKE '%6/6%') LIMIT 5").all();
console.log("  Date matches:", dateRows);

// 찾은 행 번호로 전체 컬럼 확인
if (dateRows.length > 0) {
    const rowNum = dateRows[0].row_num;
    console.log(`\n=== Row ${rowNum} full data ===`);
    const rowData = db.prepare("SELECT col, value FROM excel_raw_data WHERE sheet_name = '월간일지(노란부분입력)' AND row_num = ? ORDER BY col").all(rowNum);
    rowData.forEach(d => console.log(`  ${d.col}: ${d.value}`));
}

db.close();
