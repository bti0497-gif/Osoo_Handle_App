const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const COLUMNS = (() => {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const res = [...letters];
  letters.forEach(l => res.push('A' + l));
  return res;
})();

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
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function cellToString(cellValue) {
  if (cellValue === null || cellValue === undefined) return null;
  if (cellValue instanceof Date) return formatDate(cellValue);
  if (typeof cellValue === 'object') {
    if (cellValue.result !== undefined) return cellToString(cellValue.result);
    if (cellValue.text !== undefined) return String(cellValue.text);
    if (cellValue.richText) return cellValue.richText.map(r => r.text).join('');
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
  console.log(`[Excel] 파싱 시작: ${fileName}`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheetsToProcess = workbook.worksheets.slice(0, 3);
  console.log(`[Excel] 처리할 시트 ${sheetsToProcess.length}개: ${sheetsToProcess.map(s => s.name).join(', ')}`);

  db.prepare('DELETE FROM excel_raw_data').run();
  db.prepare('DELETE FROM excel_sheets').run();

  const insertCell = db.prepare('INSERT OR REPLACE INTO excel_raw_data (sheet_name, row_num, col, value) VALUES (?, ?, ?, ?)');
  const insertSheet = db.prepare('INSERT INTO excel_sheets (sheet_name, max_row, imported_at) VALUES (?, ?, ?)');
  const now = new Date().toISOString();

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = formatDate(yesterday);
  console.log(`[Excel] 기준 날짜 (어제): ${yesterdayStr}`);

  const START_ROW = 3;

  for (const ws of sheetsToProcess) {
    let maxDataRow = START_ROW - 1;

    for (let r = START_ROW; r <= ws.rowCount; r++) {
      const cellVal = ws.getRow(r).getCell('A').value;
      const dateStr = formatDate(cellVal);
      if (!dateStr) continue;
      if (dateStr > yesterdayStr) break;
      maxDataRow = r;
    }

    if (maxDataRow < START_ROW) {
      console.log('[Excel] sheet "' + ws.name + '": no valid date in column A, keeping header rows only (1~2)');
      maxDataRow = Math.min(ws.rowCount, 2);
    }

    const batchInsert = db.transaction((sheetName, rows) => {
      for (const { rowNum, col, value } of rows) {
        insertCell.run(sheetName, rowNum, col, value);
      }
    });

    const headerBatch = [];
    for (let r = 1; r < START_ROW; r++) {
      const row = ws.getRow(r);
      for (const col of COLUMNS) {
        const val = cellToString(row.getCell(col).value);
        if (val !== null) headerBatch.push({ rowNum: r, col, value: val });
      }
    }
    if (headerBatch.length > 0) batchInsert(ws.name, headerBatch);

    const batch = [];
    for (let r = START_ROW; r <= maxDataRow; r++) {
      const row = ws.getRow(r);
      for (const col of COLUMNS) {
        const val = cellToString(row.getCell(col).value);
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
    console.log('[Excel] sheet "' + ws.name + '": rows ' + START_ROW + '~' + maxDataRow + ' cleaned (through ' + yesterdayStr + ')');
  }

  console.log('[Excel] all sheets processed in ' + (Date.now() - startMs) + 'ms');

  return sheetsToProcess.map(ws => ws.name);
}

function getStoredSheets(db) {
  return db.prepare('SELECT sheet_name, max_row, imported_at FROM excel_sheets ORDER BY id').all();
}

function roundIfNumeric(val) {
  if (!val) return val;
  const num = Number(val);
  if (isNaN(num)) return val;
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
