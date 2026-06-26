const ExcelJS = require('exceljs');
const path = require('path');

function columnNumberToName(n) {
  let value = Number(n);
  let name = '';
  while (value > 0) {
    const mod = (value - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    value = Math.floor((value - mod) / 26);
  }
  return name;
}

function buildColumnNames(maxColumn) {
  // 기본 매핑 범위는 A~AZ이고, 현장 파일 확장에 대비해 ZZ까지 저장한다.
  const limit = Math.max(52, Math.min(Number(maxColumn) || 52, 702));
  return Array.from({ length: limit }, (_, index) => columnNumberToName(index + 1));
}

const COLUMNS = buildColumnNames(52);

function formatDate(date) {
  if (!date) return null;
  let d;
  if (date instanceof Date) {
    d = date;
  } else if (typeof date === 'number') {
    d = new Date(Math.round((date - 25569) * 864e5));
  } else {
    d = new Date(date);
  }
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function cellToString(cellValue, formulaResult) {
  if (cellValue === null || cellValue === undefined) return null;
  if (cellValue instanceof Date) return formatDate(cellValue);
  if (typeof cellValue === 'object') {
    if (cellValue.result !== undefined) return cellToString(cellValue.result);
    if (formulaResult !== undefined) return cellToString(formulaResult);
    if (cellValue.text !== undefined) return String(cellValue.text);
    if (cellValue.richText) return cellValue.richText.map((r) => r.text).join('');
    if (cellValue.hyperlink && cellValue.text) return String(cellValue.text);
    return String(cellValue);
  }
  if (typeof cellValue === 'number') {
    return Number.isInteger(cellValue) ? String(cellValue) : String(Math.round(cellValue * 10) / 10);
  }
  return String(cellValue);
}

async function parseAndStoreExcel(db, filePath) {
  const startMs = Date.now();
  const fileName = path.basename(filePath);
  console.log(`[Excel] 원본 파싱 시작: ${fileName}`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheetsToProcess = workbook.worksheets;
  console.log(`[Excel] 처리할 시트 ${sheetsToProcess.length}개: ${sheetsToProcess.map((s) => s.name).join(', ')}`);

  db.prepare('DELETE FROM excel_raw_data').run();
  db.prepare('DELETE FROM excel_sheets').run();

  const insertCell = db.prepare('INSERT OR REPLACE INTO excel_raw_data (sheet_name, row_num, col, value) VALUES (?, ?, ?, ?)');
  const insertSheet = db.prepare('INSERT INTO excel_sheets (sheet_name, max_row, imported_at) VALUES (?, ?, ?)');
  const now = new Date().toISOString();

  for (const ws of sheetsToProcess) {
    const maxDataRow = Math.max(ws.rowCount || 0, ws.actualRowCount || 0);
    const columns = buildColumnNames(Math.max(ws.columnCount || 0, ws.actualColumnCount || 0));

    const batchInsert = db.transaction((sheetName, rows) => {
      for (const { rowNum, col, value } of rows) {
        insertCell.run(sheetName, rowNum, col, value);
      }
    });

    const batch = [];
    for (let r = 1; r <= maxDataRow; r += 1) {
      const row = ws.getRow(r);
      for (const col of columns) {
        const cell = row.getCell(col);
        const val = cellToString(cell.value, cell.result);
        if (val !== null) {
          batch.push({ rowNum: r, col, value: val });
        }
      }
      if (batch.length >= 5000) {
        batchInsert(ws.name, [...batch]);
        batch.length = 0;
      }
    }
    if (batch.length > 0) {
      batchInsert(ws.name, batch);
    }

    insertSheet.run(ws.name, maxDataRow, now);
    console.log(`[Excel] sheet "${ws.name}": rows 1~${maxDataRow}, columns ${columns[0]}~${columns[columns.length - 1]} processed`);
  }

  console.log(`[Excel] 전체 시트 처리 완료: ${Date.now() - startMs}ms`);

  return sheetsToProcess.map((ws) => ws.name);
}

function getStoredSheets(db) {
  return db.prepare('SELECT sheet_name, max_row, imported_at FROM excel_sheets ORDER BY id').all();
}

function roundIfNumeric(val) {
  if (!val) return val;
  const num = Number(val);
  if (Number.isNaN(num)) return val;
  if (Number.isInteger(num)) return String(num);
  return String(Math.round(num * 10) / 10);
}

function getStoredRow(db, sheetName, rowNum) {
  const rows = db.prepare('SELECT col, value FROM excel_raw_data WHERE sheet_name = ? AND row_num = ?').all(sheetName, rowNum);
  const result = {};
  for (const { col, value } of rows) {
    result[col] = roundIfNumeric(value) || '';
  }
  return result;
}

function getCellValue(db, sheetName, rowNum, col) {
  const row = db.prepare('SELECT value FROM excel_raw_data WHERE sheet_name = ? AND row_num = ? AND col = ?').get(sheetName, rowNum, col);
  return row ? roundIfNumeric(row.value) : null;
}

function hasStoredData(db) {
  const count = db.prepare('SELECT COUNT(*) as cnt FROM excel_sheets').get();
  return count.cnt > 0;
}

module.exports = { parseAndStoreExcel, getStoredSheets, getStoredRow, getCellValue, hasStoredData, formatDate, COLUMNS };
