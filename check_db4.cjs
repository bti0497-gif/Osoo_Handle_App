const sqlite3 = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.env.APPDATA, 'Osoo_Handle_App', 'osoo.db');
const db = new sqlite3(dbPath, { readonly: true });

// 1. config_items flow 매핑 전체 출력 (정렬된 형태)
console.log("=== config_items (flow) ===");
const flowItems = db.prepare("SELECT item_name, excel_cell, is_active FROM config_items WHERE category = 'flow' ORDER BY item_name").all();
flowItems.forEach(item => {
    console.log(`  ${item.item_name.padEnd(28)} -> col: ${(item.excel_cell || 'NULL').padEnd(4)} active: ${item.is_active}`);
});

// 2. 엑셀 원본 - 2025-06-06이 있는 행 (row 1441) 의 주요 컬럼 데이터
console.log("\n=== Excel raw data for row 1441 (2025-06-06) ===");
const row1441 = db.prepare("SELECT col, value FROM excel_raw_data WHERE sheet_name = '월간일지(노란부분입력)' AND row_num = 1441 ORDER BY col").all();
row1441.forEach(d => {
    console.log(`  col ${d.col.padEnd(3)}: ${d.value}`);
});

// 3. flow_readings for 2025-06-06 정리
console.log("\n=== flow_readings for 2025-06-06 ===");
const fr = db.prepare("SELECT type, raw_value, calculated_flow FROM flow_readings WHERE date = '2025-06-06' ORDER BY id").all();
fr.forEach(r => {
    console.log(`  ${r.type.padEnd(25)} raw: ${String(r.raw_value ?? 'NULL').padStart(10)}, flow: ${String(r.calculated_flow ?? 'NULL').padStart(10)}`);
});

// 4. 유량설정 app_settings
console.log("\n=== app_settings flow config ===");
const s = db.prepare("SELECT flow_sheet, flow_start_row, flow_end_row, flow_date_col FROM app_settings WHERE id = 1").get();
console.log(`  sheet: ${s.flow_sheet}, rows: ${s.flow_start_row}-${s.flow_end_row}, dateCol: ${s.flow_date_col}`);

db.close();
