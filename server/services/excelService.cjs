const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

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
  const limit = Math.max(52, Math.min(Number(maxColumn) || 52, 702));
  return Array.from({ length: limit }, (_, index) => columnNumberToName(index + 1));
}

const COLUMNS = buildColumnNames(52);

function decodeXml(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function normalizeColumnName(col) {
  return String(col || '').trim().toUpperCase();
}

function normalizeRowNumber(rowNum) {
  const parsed = Number(rowNum);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function columnNameToNumber(name) {
  return normalizeColumnName(name).split('').reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0);
}

function excelSerialToDate(serial) {
  return new Date(Math.round((serial - 25569) * 864e5));
}

function formatDate(date) {
  if (date === null || date === undefined || date === '') return null;
  let d;
  if (date instanceof Date) {
    d = date;
  } else if (typeof date === 'number') {
    d = excelSerialToDate(date);
  } else {
    const text = String(date).trim();
    const maybeSerial = Number(text);
    if (Number.isFinite(maybeSerial) && maybeSerial > 25569 && maybeSerial < 100000) {
      d = excelSerialToDate(maybeSerial);
    } else {
      d = new Date(text);
    }
  }
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function roundIfNumeric(val) {
  if (val === null || val === undefined || val === '') return val;
  const num = Number(val);
  if (Number.isNaN(num)) return val;
  if (Number.isInteger(num)) return String(num);
  return String(Math.round(num * 10) / 10);
}

function getExcelOriginalPath(db, appDataPath) {
  const row = db.prepare('SELECT excel_template_path FROM app_settings WHERE id = 1').get();
  const storedPath = String(row?.excel_template_path || '').trim();
  if (!storedPath) return null;

  if (storedPath.startsWith('appdata/')) {
    return path.join(appDataPath, ...storedPath.replace(/^appdata\//, '').split('/'));
  }

  if (path.isAbsolute(storedPath)) {
    return storedPath;
  }

  return path.join(appDataPath, storedPath);
}

async function loadZip(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('기존 운영 엑셀 원본 파일을 찾을 수 없습니다. 설정에서 파일을 다시 선택해주세요.');
  }
  return JSZip.loadAsync(fs.readFileSync(filePath));
}

async function getText(zip, entryName) {
  const entry = zip.file(entryName);
  return entry ? entry.async('string') : '';
}

function parseAttributes(tagText) {
  const attrs = {};
  const regex = /([\w:]+)="([^"]*)"/g;
  let match;
  while ((match = regex.exec(tagText))) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

async function getSheetEntries(zip) {
  const workbookXml = await getText(zip, 'xl/workbook.xml');
  const relsXml = await getText(zip, 'xl/_rels/workbook.xml.rels');
  const rels = new Map();
  const relRegex = /<Relationship\b([^>]*)\/>/g;
  let relMatch;
  while ((relMatch = relRegex.exec(relsXml))) {
    const attrs = parseAttributes(relMatch[1]);
    if (attrs.Id && attrs.Target) {
      const target = attrs.Target.startsWith('/') ? attrs.Target.replace(/^\//, '') : `xl/${attrs.Target}`;
      rels.set(attrs.Id, target.replace(/\\/g, '/'));
    }
  }

  const sheets = [];
  const sheetRegex = /<sheet\b([^>]*)\/>/g;
  let sheetMatch;
  while ((sheetMatch = sheetRegex.exec(workbookXml))) {
    const attrs = parseAttributes(sheetMatch[1]);
    const relId = attrs['r:id'];
    sheets.push({
      name: attrs.name,
      sheetId: attrs.sheetId,
      relId,
      path: rels.get(relId),
    });
  }
  return sheets;
}

async function getSheetPath(zip, sheetName) {
  const sheets = await getSheetEntries(zip);
  const found = sheets.find((sheet) => sheet.name === sheetName);
  if (!found?.path) {
    throw new Error(`엑셀 시트를 찾을 수 없습니다: ${sheetName}`);
  }
  return found.path;
}

function extractTextFromSi(siXml) {
  const parts = [];
  const textRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let match;
  while ((match = textRegex.exec(siXml))) {
    parts.push(decodeXml(match[1]));
  }
  return parts.join('');
}

async function readSharedStrings(zip) {
  const xml = await getText(zip, 'xl/sharedStrings.xml');
  if (!xml) return [];
  const values = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match;
  while ((match = siRegex.exec(xml))) {
    values.push(extractTextFromSi(match[1]));
  }
  return values;
}

function getCellValueFromXml(cellAttrs, cellXml, sharedStrings) {
  const type = cellAttrs.t || '';
  if (type === 'inlineStr') {
    const inlineMatch = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(cellXml);
    return inlineMatch ? extractTextFromSi(inlineMatch[1]) : null;
  }

  const valueMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cellXml);
  if (!valueMatch) return null;
  const raw = decodeXml(valueMatch[1]);

  if (type === 's') {
    return sharedStrings[Number(raw)] ?? '';
  }

  if (type === 'str') {
    return raw;
  }

  return roundIfNumeric(raw);
}

function readRowsFromSheetXml(sheetXml, sharedStrings, startRow, endRow, columns) {
  const from = normalizeRowNumber(startRow);
  const to = Math.max(from, normalizeRowNumber(endRow));
  const wanted = new Set(columns.map(normalizeColumnName).filter(Boolean));
  const rows = new Map();
  const rowRegex = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(sheetXml))) {
    const rowAttrs = parseAttributes(rowMatch[1]);
    const rowNum = Number(rowAttrs.r);
    if (!Number.isFinite(rowNum) || rowNum < from) continue;
    if (rowNum > to) break;

    const rowValues = {};
    const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[2]))) {
      const cellAttrs = parseAttributes(cellMatch[1]);
      const address = cellAttrs.r || '';
      const addressMatch = /^([A-Z]+)(\d+)$/i.exec(address);
      if (!addressMatch) continue;
      const col = normalizeColumnName(addressMatch[1]);
      if (wanted.size > 0 && !wanted.has(col)) continue;
      rowValues[col] = getCellValueFromXml(cellAttrs, cellMatch[2], sharedStrings);
    }
    rows.set(rowNum, rowValues);
  }

  return rows;
}

async function parseAndStoreExcel(db, filePath) {
  const startMs = Date.now();
  const fileName = path.basename(filePath);
  console.log(`[Excel] 원본 시트 목록 읽기 시작: ${fileName}`);

  const zip = await loadZip(filePath);
  const sheets = await getSheetEntries(zip);

  db.prepare('DELETE FROM excel_raw_data').run();
  db.prepare('DELETE FROM excel_sheets').run();

  const insertSheet = db.prepare('INSERT INTO excel_sheets (sheet_name, max_row, imported_at) VALUES (?, ?, ?)');
  const now = new Date().toISOString();
  for (const sheet of sheets) {
    insertSheet.run(sheet.name, 0, now);
  }

  console.log(`[Excel] 시트 목록 저장 완료: ${sheets.length}개, ${Date.now() - startMs}ms`);
  return sheets.map((sheet) => sheet.name);
}

function getStoredSheets(db) {
  return db.prepare('SELECT sheet_name, max_row, imported_at FROM excel_sheets ORDER BY id').all();
}

async function readExcelRange(db, appDataPath, sheetName, startRow, endRow, columns = []) {
  const filePath = getExcelOriginalPath(db, appDataPath);
  const zip = await loadZip(filePath);
  const [sheetPath, sharedStrings] = await Promise.all([
    getSheetPath(zip, sheetName),
    readSharedStrings(zip),
  ]);
  const sheetXml = await getText(zip, sheetPath);
  return readRowsFromSheetXml(sheetXml, sharedStrings, startRow, endRow, columns);
}

async function readExcelRow(db, appDataPath, sheetName, rowNum, maxColumn = 52) {
  const columns = buildColumnNames(maxColumn);
  const rows = await readExcelRange(db, appDataPath, sheetName, rowNum, rowNum, columns);
  const values = rows.get(normalizeRowNumber(rowNum)) || {};
  const result = {};
  for (const col of columns) {
    let value = values[col];
    if (col === 'A') {
      value = formatDate(value) || value;
    }
    result[col] = roundIfNumeric(value) || '';
  }
  return result;
}

function getRangeCell(rangeRows, rowNum, col) {
  const row = rangeRows.get(Number(rowNum));
  if (!row) return null;
  const value = row[normalizeColumnName(col)];
  return value === undefined || value === '' ? null : value;
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

module.exports = {
  COLUMNS,
  buildColumnNames,
  cellToString: getCellValueFromXml,
  formatDate,
  getCellValue,
  getExcelOriginalPath,
  getRangeCell,
  getStoredRow,
  getStoredSheets,
  hasStoredData,
  parseAndStoreExcel,
  readExcelRange,
  readExcelRow,
};
