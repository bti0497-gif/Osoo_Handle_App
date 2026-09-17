'use strict';

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { insertImageToCell, buildExcelTempPath, openExcelFile } = require('../excelOpenService.cjs');
const { resolveReportTemplatePath } = require('../reportTemplateService.cjs');

const TEMPLATE_NAME = '설비이력카드';
const FIRST_PAGE_ROWS = { start: 19, end: 29 };
const CONTINUATION_PAGE_ROWS = { start: 6, end: 29 };
const DATA_COLUMNS = { date: 'A', content: 'D', price: 'R', company: 'T' };
const MAX_SHEET_NAME_LENGTH = 31;

function sanitizeFileName(value) {
  return String(value || '장비이력카드')
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 90) || '장비이력카드';
}

function parseDefinedRange(workbook, name) {
  const entry = (Array.isArray(workbook.definedNames?.model) ? workbook.definedNames.model : [])
    .find((item) => item.name === name);
  const raw = Array.isArray(entry?.ranges) ? entry.ranges[0] : entry?.ranges;
  const match = String(raw || '').match(/^(?:'([^']+)'|([^'!][^!]*))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/);
  if (!match) return null;
  return {
    sheetName: (match[1] || match[2] || '').trim(),
    startCol: match[3],
    startRow: Number(match[4]),
    endCol: match[5] || match[3],
    endRow: Number(match[6] || match[4]),
  };
}

function cellAddress(column, row) {
  return `${column}${row}`;
}

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : text.slice(0, 10);
}

function formatHistoryContent(type, content) {
  const normalizedType = String(type || '').trim();
  const normalizedContent = String(content || '').trim();
  if (!normalizedType) return normalizedContent;
  if (!normalizedContent || normalizedContent === normalizedType) return normalizedType;
  return `${normalizedType}: ${normalizedContent}`;
}

function copyWorksheet(source, target) {
  for (let column = 1; column <= source.columnCount; column += 1) {
    const sourceColumn = source.getColumn(column);
    const targetColumn = target.getColumn(column);
    targetColumn.width = sourceColumn.width;
    targetColumn.hidden = sourceColumn.hidden;
    targetColumn.outlineLevel = sourceColumn.outlineLevel;
  }
  source.eachRow({ includeEmpty: true }, (sourceRow, rowNumber) => {
    const targetRow = target.getRow(rowNumber);
    targetRow.height = sourceRow.height;
    targetRow.hidden = sourceRow.hidden;
    targetRow.outlineLevel = sourceRow.outlineLevel;
    for (let column = 1; column <= source.columnCount; column += 1) {
      const sourceCell = sourceRow.getCell(column);
      const targetCell = targetRow.getCell(column);
      targetCell.value = sourceCell.value;
      targetCell.style = JSON.parse(JSON.stringify(sourceCell.style || {}));
      if (sourceCell.numFmt) targetCell.numFmt = sourceCell.numFmt;
      if (sourceCell.alignment) targetCell.alignment = { ...sourceCell.alignment };
      if (sourceCell.protection) targetCell.protection = { ...sourceCell.protection };
    }
  });
  for (const merge of source.model.merges || []) target.mergeCells(merge);
  target.pageSetup = { ...source.pageSetup };
  target.pageMargins = { ...source.pageMargins };
  target.views = JSON.parse(JSON.stringify(source.views || []));
  target.properties = { ...source.properties };
  target.headerFooter = { ...source.headerFooter };
}

function clearRange(ws, range) {
  if (!range) return;
  for (let row = range.startRow; row <= range.endRow; row += 1) {
    ws.getCell(cellAddress(range.startCol, row)).value = null;
  }
}

function writeMergedColumn(ws, column, row, value) {
  ws.getCell(cellAddress(column, row)).value = value ?? '';
}

function writeHistoryRows(ws, rows, layout) {
  const capacity = layout.end - layout.start + 1;
  for (let offset = 0; offset < capacity; offset += 1) {
    const rowNumber = layout.start + offset;
    const entry = rows[offset];
    writeMergedColumn(ws, DATA_COLUMNS.date, rowNumber, entry?.date || '');
    writeMergedColumn(ws, DATA_COLUMNS.content, rowNumber, entry?.content || '');
    writeMergedColumn(ws, DATA_COLUMNS.price, rowNumber, entry?.price === null || entry?.price === undefined ? '' : entry.price);
    writeMergedColumn(ws, DATA_COLUMNS.company, rowNumber, entry?.company || '');
  }
}

function readCombinedHistory(db, siteId, equipmentId) {
  const direct = db.prepare(`
    SELECT id, date, type, content, company, price
    FROM facility_logs
    WHERE site_id = ? AND equipment_id = ?
  `).all(siteId, equipmentId).map((row) => ({
    source: 'equipment-history',
    sourceId: Number(row.id),
    date: normalizeDate(row.date),
    content: formatHistoryContent(row.type, row.content),
    company: String(row.company || ''),
    price: row.price === null || row.price === undefined ? '' : Number(row.price) || 0,
  }));

  const linked = db.prepare(`
    SELECT wr.id, wr.date, wr.title, wr.content
    FROM work_records wr
    JOIN work_record_equipment_links link ON link.work_record_id = wr.id
    WHERE wr.site_id = ? AND link.site_id = ? AND link.equipment_id = ?
  `).all(siteId, siteId, equipmentId).map((row) => ({
    source: 'work-record',
    sourceId: Number(row.id),
    date: normalizeDate(row.date),
    content: formatHistoryContent(row.title, row.content),
    company: '',
    price: '',
  }));

  return [...direct, ...linked]
    .filter((row) => row.date)
    .sort((left, right) => left.date.localeCompare(right.date)
      || left.source.localeCompare(right.source)
      || left.sourceId - right.sourceId);
}

function countHistorySources(history) {
  return history.reduce((counts, entry) => {
    counts[entry.source] = (counts[entry.source] || 0) + 1;
    return counts;
  }, {});
}

function resolveTemplate(baseDir, appDataPath) {
  const resolved = resolveReportTemplatePath(baseDir, appDataPath, TEMPLATE_NAME, { hwpOnly: false });
  if (!resolved?.absolutePath || !fs.existsSync(resolved.absolutePath)) {
    const error = new Error('설비이력카드 Excel 양식을 찾을 수 없습니다.');
    error.status = 404;
    error.code = 'EQUIPMENT_CARD_TEMPLATE_MISSING';
    throw error;
  }
  return resolved.absolutePath;
}

async function buildEquipmentCardWorkbook({ db, appDataPath, baseDir, siteId, equipmentId }) {
  const equipment = db.prepare(`
    SELECT * FROM equipment_assets WHERE id = ? AND site_id = ?
  `).get(equipmentId, siteId);
  if (!equipment) {
    const error = new Error('장비를 찾을 수 없습니다.');
    error.status = 404;
    error.code = 'EQUIPMENT_NOT_FOUND';
    throw error;
  }

  const history = readCombinedHistory(db, siteId, equipmentId);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolveTemplate(baseDir, appDataPath));
  const firstSheet = workbook.getWorksheet('1') || workbook.worksheets[0];
  const continuationTemplate = workbook.getWorksheet('2') || firstSheet;
  if (!firstSheet || !continuationTemplate) throw new Error('설비이력카드 시트 구성이 올바르지 않습니다.');

  const firstLayout = {
    date: parseDefinedRange(workbook, '날짜') || { startRow: FIRST_PAGE_ROWS.start, endRow: FIRST_PAGE_ROWS.end },
    content: parseDefinedRange(workbook, '수리내역') || { startRow: FIRST_PAGE_ROWS.start, endRow: FIRST_PAGE_ROWS.end },
    price: parseDefinedRange(workbook, '금액') || { startRow: FIRST_PAGE_ROWS.start, endRow: FIRST_PAGE_ROWS.end },
    company: parseDefinedRange(workbook, '업체명') || { startRow: FIRST_PAGE_ROWS.start, endRow: FIRST_PAGE_ROWS.end },
  };
  const continuationLayout = {
    date: parseDefinedRange(workbook, '날짜2') || { startRow: CONTINUATION_PAGE_ROWS.start, endRow: CONTINUATION_PAGE_ROWS.end },
    content: parseDefinedRange(workbook, '수리내역2') || { startRow: CONTINUATION_PAGE_ROWS.start, endRow: CONTINUATION_PAGE_ROWS.end },
    price: parseDefinedRange(workbook, '금액2') || { startRow: CONTINUATION_PAGE_ROWS.start, endRow: CONTINUATION_PAGE_ROWS.end },
    company: parseDefinedRange(workbook, '업체명2') || { startRow: CONTINUATION_PAGE_ROWS.start, endRow: CONTINUATION_PAGE_ROWS.end },
  };
  const firstRows = { start: firstLayout.date.startRow, end: firstLayout.date.endRow };
  const continuationRows = { start: continuationLayout.date.startRow, end: continuationLayout.date.endRow };
  const continuationCoordinates = {
    date: { startCol: continuationLayout.date.startCol, endCol: continuationLayout.date.endCol, ...continuationRows },
    content: { startCol: continuationLayout.content.startCol, endCol: continuationLayout.content.endCol, ...continuationRows },
    price: { startCol: continuationLayout.price.startCol, endCol: continuationLayout.price.endCol, ...continuationRows },
    company: { startCol: continuationLayout.company.startCol, endCol: continuationLayout.company.endCol, ...continuationRows },
  };
  const pages = [history.slice(0, firstRows.end - firstRows.start + 1)];
  pages.push(...chunk(history.slice(pages[0].length), continuationRows.end - continuationRows.start + 1));

  const setFirstInfo = (name, value) => {
    const range = parseDefinedRange(workbook, name);
    if (range && range.sheetName === firstSheet.name) firstSheet.getCell(cellAddress(range.startCol, range.startRow)).value = value ?? '';
  };
  setFirstInfo('설비명', equipment.equipment_name);
  setFirstInfo('설비번호', equipment.management_no);
  setFirstInfo('제조사', equipment.vendor);
  setFirstInfo('모델명', equipment.model);
  setFirstInfo('설치일자', equipment.installed_at);
  setFirstInfo('공정명', equipment.category_1);
  setFirstInfo('구매가격', equipment.purchase_price ?? '');
  setFirstInfo('설비등급', equipment.equipment_grade ?? '');
  setFirstInfo('페이지', `1/${pages.length}`);
  clearRange(firstSheet, firstLayout.date);
  clearRange(firstSheet, firstLayout.content);
  clearRange(firstSheet, firstLayout.price);
  clearRange(firstSheet, firstLayout.company);
  writeHistoryRows(firstSheet, pages[0], firstRows);

  for (let pageIndex = 1; pageIndex < pages.length; pageIndex += 1) {
    const sheet = pageIndex === 1 ? continuationTemplate : workbook.addWorksheet(String(pageIndex + 1).slice(0, MAX_SHEET_NAME_LENGTH));
    if (pageIndex > 1) copyWorksheet(continuationTemplate, sheet);
    sheet.name = String(pageIndex + 1);
    const layout = pageIndex === 1 ? continuationLayout : {
      ...continuationCoordinates,
    };
    clearRange(sheet, layout.date);
    clearRange(sheet, layout.content);
    clearRange(sheet, layout.price);
    clearRange(sheet, layout.company);
    writeHistoryRows(sheet, pages[pageIndex], continuationRows);
    writeMergedColumn(sheet, 'T', 3, `${pageIndex + 1}/${pages.length}`);
  }

  const photo = db.prepare(`
    SELECT relative_path FROM equipment_asset_photos
    WHERE equipment_id = ? AND site_id = ? AND photo_type = 'main'
    ORDER BY id DESC LIMIT 1
  `).get(equipmentId, siteId);
  if (photo?.relative_path) {
    const photoPath = path.join(appDataPath, '사진관리', String(photo.relative_path).replace(/^\/+/, ''));
    if (fs.existsSync(photoPath)) {
      const photoRange = parseDefinedRange(workbook, '장비사진') || parseDefinedRange(workbook, '장비 사진');
      if (photoRange) {
        await insertImageToCell(workbook, firstSheet, photoRange, photoPath, { fitBy: 'height', pct: 0.9 });
      }
    }
  }

  return { workbook, equipment, history, pageCount: pages.length };
}

async function exportEquipmentCard({ db, appDataPath, baseDir, siteId, equipmentId, openFile = true }) {
  const { workbook, equipment, history, pageCount } = await buildEquipmentCardWorkbook({
    db, appDataPath, baseDir, siteId, equipmentId,
  });
  const baseName = sanitizeFileName(`설비이력카드_${equipment.management_no || equipment.equipment_name}_${new Date().toISOString().slice(0, 10)}`);
  let outputPath = buildExcelTempPath('osoo-equipment-card', `${baseName}.xlsx`);
  let suffix = 2;
  while (fs.existsSync(outputPath)) {
    outputPath = buildExcelTempPath('osoo-equipment-card', `${baseName}(${suffix}).xlsx`);
    suffix += 1;
  }
  await workbook.xlsx.writeFile(outputPath);
  if (openFile) await openExcelFile(outputPath);
  return {
    success: true,
    file: path.basename(outputPath),
    outputPath,
    historyCount: history.length,
    historySourceCounts: countHistorySources(history),
    pageCount,
  };
}

module.exports = {
  CONTINUATION_PAGE_ROWS,
  FIRST_PAGE_ROWS,
  buildEquipmentCardWorkbook,
  exportEquipmentCard,
  readCombinedHistory,
};
