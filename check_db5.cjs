const sqlite3 = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.env.APPDATA, 'Osoo_Handle_App', 'osoo.db');
const db = new sqlite3(dbPath, { readonly: true });

// row 1441 = 2025-06-06 의 전체 컬럼 데이터 정리
console.log("=== Excel row 1441 (2025-06-06) - Key columns ===");
const row = db.prepare("SELECT col, value FROM excel_raw_data WHERE sheet_name = '월간일지(노란부분입력)' AND row_num = 1441 ORDER BY col").all();

const data = {};
row.forEach(r => { data[r.col] = r.value; });

// 엑셀 이미지 기준 유량계 매핑 추정
console.log("날짜(A):", data['A']);
console.log("");
console.log("=== 유입유량 ===");
console.log("B (유입량 적산):", data['B']);  // 177511
console.log("C (유입량 누계):", data['C']);  // 132
console.log("");
console.log("=== 방류유량 ===");
console.log("N (방류수 적산):", data['N']);  // 260637
console.log("O (방류수 누계):", data['O']);  // 134
console.log("");
console.log("=== 내부반송(슬러지) ===");
console.log("F (내부반송1 적산):", data['F']);  // 1495877
console.log("G (내부반송1 누계):", data['G']);  // 778
console.log("I :", data['I']);
console.log("J (내부반송2 적산):", data['J']);
console.log("K (내부반송2 누계):", data['K']);  // 279
console.log("");
console.log("=== 외부반송(슬러지반송) ===");
console.log("R :", data['R']);
console.log("AN:", data['AN']);
console.log("");
console.log("=== 전력 ===");
console.log("Q :", data['Q']);
console.log("S :", data['S']);
console.log("");

// 모든 컬럼 출력
console.log("=== All columns ===");
const ordered = Object.keys(data).sort((a, b) => {
    if (a.length !== b.length) return a.length - b.length;
    return a.localeCompare(b);
});
ordered.forEach(col => {
    console.log(`  ${col.padEnd(3)}: ${data[col]}`);
});

db.close();
