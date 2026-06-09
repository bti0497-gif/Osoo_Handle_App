const crypto = require('crypto');
const ExcelJS = require('exceljs');
const fs = require('fs');
const JSZip = require('jszip');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');

const { convertExcelToPdf } = require('./excelPdfService.cjs');
const { getActiveLocations } = require('./qntechWaterValueImportService.cjs');
const { resolvePhotoRoot } = require('./qntechWaterPhotoImportService.cjs');

const PREVIEW_RENDER_VERSION = '2026-03-16-photo-anchor-lock-v10';

const ANALYTE_DEFINITIONS = [
  {
    key: 'ammonia',
    valuePrefixes: ['암모니아'],
    photoNames: ['암모니아사진', '암모니아 사진'],
    field: 'nh3_n',
    photoKeywords: ['암모니아성질소', '암모니아성 질소', '암모니아']
  },
  {
    key: 'nitrate',
    valuePrefixes: ['질산'],
    photoNames: ['질산사진', '질산성질소사진'],
    field: 'no3_n',
    photoKeywords: ['질산성질소', '질산성 질소', '질산']
  },
  {
    key: 'phosphorus',
    valuePrefixes: ['인'],
    photoNames: ['인사진'],
    field: 'po4_p',
    photoKeywords: ['오르토인산염', '오르토 인산염', '인산염', '인']
  },
  {
    key: 'alkalinity',
    valuePrefixes: ['알칼리'],
    photoNames: ['알칼리사진'],
    field: 'alkalinity',
    photoKeywords: ['알칼리도', '알칼리']
  }
];

const pendingPreviewJobs = new Map();
const DEFAULT_RENDER_LOCATIONS = ['유량조정조', '혐기조', '무산소조', '포기조', '침전조'];

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

function normalizeDate(value) {
  return String(value || '').trim().slice(0, 10);
}

function normalizeDateRange(startDate, endDate) {
  const normalizedStartDate = normalizeDate(startDate || endDate);
  const normalizedEndDate = normalizeDate(endDate || startDate || normalizedStartDate);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedStartDate) || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedEndDate)) {
    throw new Error('유효한 날짜 범위를 입력해 주세요.');
  }

  if (normalizedStartDate > normalizedEndDate) {
    throw new Error('시작일은 종료일보다 늦을 수 없습니다.');
  }

  return { startDate: normalizedStartDate, endDate: normalizedEndDate };
}

function normalizeKey(value) {
  return String(value || '').replace(/\s+/g, '').trim().toLowerCase();
}

function hashParts(parts) {
  return crypto.createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex');
}

function sanitizeFileNameSegment(value) {
  return String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, '_');
}

function buildPageKey(date, measurementGroup) {
  return Buffer.from(JSON.stringify({ date, measurementGroup }), 'utf8').toString('base64url');
}

function parsePageKey(pageKey) {
  try {
    const parsed = JSON.parse(Buffer.from(String(pageKey || ''), 'base64url').toString('utf8'));
    return {
      date: normalizeDate(parsed.date),
      measurementGroup: String(parsed.measurementGroup || '').trim()
    };
  } catch (_) {
    return null;
  }
}

function parseCellReference(range) {
  const match = String(range || '').match(/^(?:'((?:[^']|'')+)'|([^!]+))!\$?([A-Z]+)\$?(\d+)$/);
  if (!match) return null;

  const sheetName = (match[1] || match[2] || '').replace(/''/g, "'");
  return {
    sheetName,
    column: match[3],
    row: Number(match[4]),
    address: `${match[3]}${match[4]}`
  };
}

function columnToIndex(column) {
  return String(column || '').split('').reduce((acc, char) => acc * 26 + (char.charCodeAt(0) - 64), 0) - 1;
}

function parseCellAddress(address) {
  const match = String(address || '').match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;

  return {
    column: match[1],
    columnNumber: columnToIndex(match[1]) + 1,
    rowNumber: Number(match[2]),
  };
}

function parseCellRange(range) {
  const [startAddress, endAddress = startAddress] = String(range || '').split(':');
  const start = parseCellAddress(startAddress);
  const end = parseCellAddress(endAddress);
  if (!start || !end) return null;

  return {
    startColumn: Math.min(start.columnNumber, end.columnNumber),
    endColumn: Math.max(start.columnNumber, end.columnNumber),
    startRow: Math.min(start.rowNumber, end.rowNumber),
    endRow: Math.max(start.rowNumber, end.rowNumber),
  };
}


function parseNamedCellEntries(workbook) {
  const model = workbook.definedNames && Array.isArray(workbook.definedNames.model) ? workbook.definedNames.model : [];
  return model
    .map((entry) => {
      const range = Array.isArray(entry.ranges) ? entry.ranges[0] : null;
      const cell = parseCellReference(range);
      if (!cell) return null;
      return { name: entry.name, normalizedName: normalizeKey(entry.name), cell };
    })
    .filter(Boolean);
}

function buildAnalyteNameMap() {
  const map = new Map();
  ANALYTE_DEFINITIONS.forEach((definition) => {
    definition.valuePrefixes.forEach((prefix) => map.set(normalizeKey(prefix), definition));
    definition.photoNames.forEach((name) => map.set(normalizeKey(name), definition));
  });
  return map;
}

const ANALYTE_NAME_MAP = buildAnalyteNameMap();

function extractAnalyteValueBinding(namedEntry) {
  for (const definition of ANALYTE_DEFINITIONS) {
    for (const prefix of definition.valuePrefixes) {
      const match = namedEntry.normalizedName.match(new RegExp(`^${normalizeKey(prefix)}(\\d+)$`));
      if (match) {
        return {
          definition,
          position: Number(match[1]) - 1
        };
      }
    }
  }
  return null;
}

function getPreviewDirectories(appDataPath) {
  const rootDir = ensureDirectory(path.join(appDataPath, 'temp', 'report-previews'));
  return {
    rootDir,
    pagePdfDir: ensureDirectory(path.join(rootDir, 'pages')),
    batchPdfDir: ensureDirectory(path.join(rootDir, 'batches')),
    workbookDir: ensureDirectory(path.join(rootDir, 'workbooks'))
  };
}

function listPageGroups(db, startDate, endDate, siteName) {
  let query = `
    SELECT
      date,
      measurement_group AS measurementGroup,
      MIN(measurement_order) AS measurementOrder,
      MAX(COALESCE(source_label, '')) AS sourceLabel,
      COUNT(*) AS rowCount,
      COUNT(DISTINCT location) AS locationCount,
      MAX(COALESCE(last_modified, created_at, '')) AS lastModified
    FROM qntech_water_quality
    WHERE date BETWEEN ? AND ?
  `;
  let params = [startDate, endDate];

  if (siteName) {
    query += ' AND site_name = ?';
    params.push(siteName);
  }

  query += `
    GROUP BY date, measurement_group
    ORDER BY date ASC, measurementOrder ASC, measurementGroup ASC
  `;

  return db.prepare(query).all(...params);
}

function buildPreviewManifest(db, startDate, endDate, siteName) {
  console.log(`[Manifest] Building manifest for ${startDate} ~ ${endDate} (Site: ${siteName || 'null'})`);
  const groups = listPageGroups(db, startDate, endDate, siteName);
  console.log(`[Manifest] Groups found (database rows): ${groups.length}`);
  if (groups.length > 0) {
      console.log(`[Manifest] Database first group: ${groups[0].date}, last group: ${groups[groups.length - 1].date}`);
  }
  
  const perDateCounts = groups.reduce((acc, row) => {
    acc.set(row.date, (acc.get(row.date) || 0) + 1);
    return acc;
  }, new Map());
  const perDateIndices = new Map();

  const pages = groups.map((row, index) => {
    const pageNumberForDate = (perDateIndices.get(row.date) || 0) + 1;
    perDateIndices.set(row.date, pageNumberForDate);

    return {
      pageKey: buildPageKey(row.date, row.measurementGroup),
      absoluteIndex: index,
      date: row.date,
      measurementGroup: row.measurementGroup,
      measurementOrder: Number(row.measurementOrder) || 1,
      sourceLabel: row.sourceLabel || '',
      rowCount: Number(row.rowCount) || 0,
      locationCount: Number(row.locationCount) || 0,
      lastModified: row.lastModified || '',
      pageNumberForDate,
      totalPagesForDate: perDateCounts.get(row.date) || 1,
      isRange: startDate !== endDate
    };
  });

  console.log(`[Manifest] Result pages: ${pages.length}`);
  if (pages.length > 0) {
      console.log(`[Manifest] Result last page date: ${pages[pages.length-1].date}`);
  }
  return {
    startDate,
    endDate,
    totalPages: pages.length,
    pages
  };
}

function findPageInManifest(manifest, pageKey) {
  if (!pageKey) {
    return manifest.pages[0] || null;
  }
  return manifest.pages.find((page) => page.pageKey === pageKey) || null;
}

function getConfiguredPhotoRoot(db) {
  const row = db.prepare('SELECT qntech_photo_root FROM app_settings WHERE id = 1').get();
  return row?.qntech_photo_root || '';
}

function getDatePhotoDirectory(baseDir, configuredPhotoRoot, date) {
  const photoRoot = resolvePhotoRoot(baseDir, configuredPhotoRoot);
  return path.join(photoRoot, date.slice(0, 4), date.slice(5, 7), date);
}

function getImportPhotoDirectory(baseDir, configuredPhotoRoot, date) {
  const photoRoot = resolvePhotoRoot(baseDir, configuredPhotoRoot);
  return path.join(photoRoot, date.slice(0, 4), date.slice(5, 7), '데이타불러오기');
}

function buildImportDateStamp(date) {
  const y = String(date || '').slice(0, 4);
  const m = String(date || '').slice(5, 7);
  const d = String(date || '').slice(8, 10);
  return `${y}${d}${m}`;
}

function listPhotoFiles(baseDir, configuredPhotoRoot, date) {
  const legacyDir = getDatePhotoDirectory(baseDir, configuredPhotoRoot, date);
  const importDir = getImportPhotoDirectory(baseDir, configuredPhotoRoot, date);
  const importStamp = buildImportDateStamp(date);

  const candidates = [
    { dir: importDir, filterByStamp: true },
    { dir: legacyDir, filterByStamp: false },
  ];

  let files = [];
  for (const candidate of candidates) {
    console.log(`[Photo] Listing files in: ${candidate.dir}`);
    if (!fs.existsSync(candidate.dir)) {
      console.log(`[Photo] Directory does not exist: ${candidate.dir}`);
      continue;
    }

    files = fs.readdirSync(candidate.dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .filter((entry) => {
        if (!candidate.filterByStamp) return true;
        return String(entry.name).includes(`_${importStamp}_`);
      })
      .map((entry) => {
        const absolutePath = path.join(candidate.dir, entry.name);
        const stat = fs.statSync(absolutePath);
        return {
          fileName: entry.name,
          absolutePath,
          normalizedName: normalizeKey(entry.name),
          lastModifiedMs: stat.mtimeMs
        };
      });

    if (files.length > 0) break;
  }

  console.log(`[Photo] Found ${files.length} files for ${date}`);
  return files;
}

function sortRowsByLocation(rows, activeLocations) {
  const locationOrder = new Map(activeLocations.map((location, index) => [location, index]));
  return [...rows].sort((left, right) => {
    const leftOrder = locationOrder.has(left.location) ? locationOrder.get(left.location) : Number.MAX_SAFE_INTEGER;
    const rightOrder = locationOrder.has(right.location) ? locationOrder.get(right.location) : Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return String(left.location || '').localeCompare(String(right.location || ''), 'ko');
  });
}

function selectPhotoForAnalyte(photoFiles, page, analyteDefinition) {
  const normalizedSourceLabel = normalizeKey(page.sourceLabel);
  const candidates = photoFiles.filter((photoFile) => {
    return analyteDefinition.photoKeywords.some((keyword) => {
      const normKeyword = normalizeKey(keyword);
      const isMatch = photoFile.normalizedName.includes(normKeyword);
      if (isMatch) {
        console.log(`[Photo Match] SUCCESS: "${photoFile.fileName}" matches keyword "${keyword}" (norm: "${normKeyword}")`);
      }
      return isMatch;
    });
  });
  
  if (candidates.length > 0) {
      console.log(`[Photo] Final candidates for ${analyteDefinition.key}: ${candidates.map(c => c.fileName).join(', ')}`);
  } else {
      console.log(`[Photo] No candidates for ${analyteDefinition.key} among ${photoFiles.length} files. Keywords looked for: ${analyteDefinition.photoKeywords.join(', ')}`);
  }

  if (!candidates.length) return null;

  if (normalizedSourceLabel) {
    const exactSourceMatch = candidates.find((candidate) => candidate.normalizedName.includes(normalizedSourceLabel));
    if (exactSourceMatch) return exactSourceMatch;
  }

  const measurementOrderLabel = normalizeKey(`${page.measurementOrder}차`);
  const orderMatch = candidates.find((candidate) => candidate.normalizedName.includes(measurementOrderLabel));
  if (orderMatch) return orderMatch;

  return candidates[0];
}

function buildPhotoSelection(photoFiles, page) {
  const selectedPhotos = {};
  const signatureParts = [];

  ANALYTE_DEFINITIONS.forEach((definition) => {
    const selected = selectPhotoForAnalyte(photoFiles, page, definition);
    selectedPhotos[definition.key] = selected?.absolutePath || '';
    if (selected) {
      signatureParts.push(`${definition.key}:${selected.fileName}:${selected.lastModifiedMs}`);
    }
  });

  return {
    selectedPhotos,
    signature: signatureParts.join('|')
  };
}

function getPageRows(db, page) {
  const rows = db.prepare(`
    SELECT *
    FROM qntech_water_quality
    WHERE date = ? AND measurement_group = ?
    ORDER BY measurement_order ASC, created_at ASC, id ASC, location ASC, item_code ASC
  `).all(page.date, page.measurementGroup);
  return pivotQntechWaterRows(rows);
}

function getTemplateSignature(templatePath) {
  const stat = fs.statSync(templatePath);
  return `${path.basename(templatePath)}:${stat.mtimeMs}:${stat.size}`;
}

function buildPageContext(db, baseDir, page, siteName) {
  const activeLocations = getActiveLocations(db);
  
  // 1. 해당 측정 그룹의 모든 데이터 조회
  let query = 'SELECT * FROM qntech_water_quality WHERE date = ? AND measurement_group = ?';
  let params = [page.date, page.measurementGroup];

  if (siteName) {
    query += ' AND site_name = ?';
    params.push(siteName);
  }

  const baseRows = pivotQntechWaterRows(db.prepare(query).all(...params));
  const rows = sortRowsByLocation(baseRows, activeLocations);
  const photoFiles = listPhotoFiles(baseDir, getConfiguredPhotoRoot(db), page.date);
  const photoSelection = buildPhotoSelection(photoFiles, page);

  return {
    activeLocations,
    rows,
    photoSelection,
    contentSignature: hashParts([
      PREVIEW_RENDER_VERSION,
      page.pageKey,
      page.lastModified,
      rows.map((row) => [row.location, row.nh3_n, row.no3_n, row.po4_p, row.alkalinity, row.last_modified].join(':')).join('|'),
      photoSelection.signature
    ])
  };
}

function buildPageRenderData({ db, baseDir, page, siteName }) {
  const pageContext = buildPageContext(db, baseDir, page, siteName);

  return {
    pageKey: page.pageKey,
    date: page.date,
    sourceLabel: page.sourceLabel || '',
    pageNumberForDate: page.pageNumberForDate,
    totalPagesForDate: page.totalPagesForDate,
    locationLabels: (pageContext.activeLocations.length ? pageContext.activeLocations : DEFAULT_RENDER_LOCATIONS).slice(0, 5),
    rows: pageContext.rows.map((row) => ({
      location: row.location || '',
      nh3_n: row.nh3_n ?? '',
      no3_n: row.no3_n ?? '',
      po4_p: row.po4_p ?? '',
      alkalinity: row.alkalinity ?? '',
    })),
    selectedPhotos: pageContext.photoSelection.selectedPhotos,
  };
}

function setCellValue(worksheet, address, value) {
  worksheet.getCell(address).value = value === undefined || value === null ? '' : value;
}

// --- Image Sizing Helpers ---
const IMAGE_EDGE_INSET_PIXELS = 5; // 이미지와 셀 경계 사이의 여백 (픽셀)
const IMAGE_VERTICAL_OFFSET_PIXELS = 2; // 이미지의 세로 위치 조정 (픽셀)
const PIXELS_PER_INCH = 96;
const CENTIMETERS_PER_INCH = 2.54;
const FIXED_IMAGE_WIDTH_CM = 6.54;
const FIXED_IMAGE_HEIGHT_CM = 9.93;
const FIXED_IMAGE_WIDTH_PIXELS = Math.round((FIXED_IMAGE_WIDTH_CM / CENTIMETERS_PER_INCH) * PIXELS_PER_INCH);
const FIXED_IMAGE_HEIGHT_PIXELS = Math.round((FIXED_IMAGE_HEIGHT_CM / CENTIMETERS_PER_INCH) * PIXELS_PER_INCH);
const EMUS_PER_PIXEL = 9525;
// Calibrated from a user-adjusted workbook saved on 2026-03-16:
// C:\Users\ASUS\AppData\Local\Temp\수질분석일지-2026-03-01-1773641602782.xlsx
// Do not tweak these values casually. If the template layout changes, re-calibrate
// from a newly saved workbook and update all analyte anchors together.
const FIXED_PHOTO_ANCHORS = Object.freeze({
  ammonia: {
    tl: { nativeCol: 7, nativeColOff: 1, nativeRow: 3, nativeRowOff: 21810 },
    ext: { width: 3570866 / EMUS_PER_PIXEL, height: 2331425 / EMUS_PER_PIXEL },
  },
  nitrate: {
    tl: { nativeCol: 7, nativeColOff: 1, nativeRow: 16, nativeRowOff: 21810 },
    ext: { width: 3570866 / EMUS_PER_PIXEL, height: 2331425 / EMUS_PER_PIXEL },
  },
  phosphorus: {
    tl: { nativeCol: 7, nativeColOff: 0, nativeRow: 29, nativeRowOff: 21810 },
    ext: { width: 3574675 / EMUS_PER_PIXEL, height: 2331425 / EMUS_PER_PIXEL },
  },
  alkalinity: {
    tl: { nativeCol: 7, nativeColOff: 0, nativeRow: 42, nativeRowOff: 21810 },
    ext: { width: 3574675 / EMUS_PER_PIXEL, height: 2331425 / EMUS_PER_PIXEL },
  },
});

function validateFixedPhotoAnchors() {
  const analyteKeys = ANALYTE_DEFINITIONS.map((definition) => definition.key);

  for (const analyteKey of analyteKeys) {
    const anchor = FIXED_PHOTO_ANCHORS[analyteKey];
    if (!anchor) {
      throw new Error(`고정 사진 anchor가 누락되었습니다: ${analyteKey}`);
    }

    const { tl, ext } = anchor;
    const hasValidAnchor = tl
      && Number.isInteger(tl.nativeCol)
      && Number.isInteger(tl.nativeColOff)
      && Number.isInteger(tl.nativeRow)
      && Number.isInteger(tl.nativeRowOff)
      && ext
      && Number.isFinite(ext.width)
      && Number.isFinite(ext.height)
      && ext.width > 0
      && ext.height > 0;

    if (!hasValidAnchor) {
      throw new Error(`고정 사진 anchor 형식이 잘못되었습니다: ${analyteKey}`);
    }
  }
}

validateFixedPhotoAnchors();

function getColumnWidthPixels(worksheet, colNumber) {
  const column = worksheet.getColumn(colNumber);
  // ExcelJS의 column.width는 'character width' 단위이므로 픽셀로 변환 필요
  // 기본 폰트 (Calibri 11pt) 기준 1 character width = 약 7 픽셀
  // 정확한 값은 폰트, DPI 등에 따라 달라지므로 근사치 사용
  return (column.width || 8.43) * 7;
}

function getRowHeightPixels(worksheet, rowNumber) {
  const row = worksheet.getRow(rowNumber);
  // ExcelJS의 row.height는 'point' 단위이므로 픽셀로 변환 필요
  // 1 point = 1/72 inch, 1 inch = 96 pixels (standard DPI)
  return (row.height || 15) * (96 / 72);
}

function sumPixels(start, end, getDimension) {
  let total = 0;
  for (let i = start; i <= end; i++) {
    total += getDimension(i);
  }
  return total;
}

function pixelsToColumnPosition(worksheet, startColumnNumber, pixels) {
  let remainingPixels = Math.max(0, Number(pixels) || 0);
  let columnNumber = startColumnNumber;

  while (true) {
    const colWidthPixels = getColumnWidthPixels(worksheet, columnNumber);
    if (remainingPixels <= colWidthPixels) {
      return (columnNumber - 1) + (remainingPixels / colWidthPixels);
    }

    remainingPixels -= colWidthPixels;
    columnNumber += 1;
  }
}

function pixelsToRowPosition(worksheet, startRowNumber, pixels) {
  let remainingPixels = Math.max(0, Number(pixels) || 0);
  let rowNumber = startRowNumber;

  while (true) {
    const rowHeightPixels = getRowHeightPixels(worksheet, rowNumber);
    if (remainingPixels <= rowHeightPixels) {
      return (rowNumber - 1) + (remainingPixels / rowHeightPixels);
    }

    remainingPixels -= rowHeightPixels;
    rowNumber += 1;
  }
}

function getMergedRangeForCell(worksheet, address) {
  const parsedAddress = parseCellAddress(address);
  if (!parsedAddress) {
    return null;
  }

  const merges = Array.isArray(worksheet.model?.merges) ? worksheet.model.merges : [];
  for (const mergeRef of merges) {
    const range = parseCellRange(mergeRef);
    if (!range) continue;

    if (
      parsedAddress.columnNumber >= range.startColumn
      && parsedAddress.columnNumber <= range.endColumn
      && parsedAddress.rowNumber >= range.startRow
      && parsedAddress.rowNumber <= range.endRow
    ) {
      return range;
    }
  }

  return {
    startColumn: parsedAddress.columnNumber,
    endColumn: parsedAddress.columnNumber,
    startRow: parsedAddress.rowNumber,
    endRow: parsedAddress.rowNumber,
  };
}

async function addNormalizedImageToNamedCell(workbook, worksheet, namedCell, imagePath, analyteKey) {
  if (!imagePath || !fs.existsSync(imagePath)) {
    return;
  }

  const fixedAnchor = FIXED_PHOTO_ANCHORS[analyteKey];
  if (fixedAnchor) {
    const { data: normalizedBuffer } = await sharp(imagePath)
      .rotate()
      .resize({
        width: Math.max(20, Math.round(fixedAnchor.ext.width) * 2),
        height: Math.max(20, Math.round(fixedAnchor.ext.height) * 2),
        fit: 'cover',
        position: 'centre'
      })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    const imageId = workbook.addImage({ buffer: normalizedBuffer, extension: 'jpeg' });
    worksheet.addImage(imageId, {
      tl: fixedAnchor.tl,
      ext: fixedAnchor.ext,
      editAs: 'oneCell',
    });
    return;
  }

  // Find the merged range and target dimensions
  const range = getMergedRangeForCell(worksheet, namedCell.cell.address);
  // Calculate exact target cell/merge area in pixels
  const targetColWidth = sumPixels(range.startColumn, range.endColumn, (col) => getColumnWidthPixels(worksheet, col));
  const targetRowHeight = sumPixels(range.startRow, range.endRow, (row) => getRowHeightPixels(worksheet, row));

  const inset = IMAGE_EDGE_INSET_PIXELS;
  const renderW = Math.max(40, Math.round(targetColWidth - inset * 2));
  const renderH = Math.max(40, Math.round(targetRowHeight - inset * 2));

  // High-res buffer (2x display size)
  const { data: normalizedBuffer } = await sharp(imagePath)
    .rotate()
    .resize({
      width: Math.max(20, renderW * 2),
      height: Math.max(20, renderH * 2),
      fit: 'cover',
      position: 'centre'
    })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  const imageId = workbook.addImage({ buffer: normalizedBuffer, extension: 'jpeg' });

  // Match the user-adjusted reference image size in Excel: 6.54cm x 9.93cm
  const fixedWidth = FIXED_IMAGE_WIDTH_PIXELS;
  const fixedHeight = FIXED_IMAGE_HEIGHT_PIXELS;

  const offsetX = Math.max(0, Math.floor((targetColWidth - fixedWidth) / 2));
  const offsetY = Math.max(0, Math.floor((targetRowHeight - fixedHeight) / 2)) + IMAGE_VERTICAL_OFFSET_PIXELS;
  const anchorCol = pixelsToColumnPosition(worksheet, range.startColumn, offsetX);
  const anchorRow = pixelsToRowPosition(worksheet, range.startRow, offsetY);

  worksheet.addImage(imageId, {
    tl: { col: anchorCol, row: anchorRow },
    ext: { width: fixedWidth, height: fixedHeight },
    editAs: 'oneCell',
  });
}

function pivotQntechWaterRows(rows = []) {
  const grouped = new Map();
  for (const row of rows) {
    const key = [row.date, row.measurement_group || '', row.location || ''].join('|');
    const target = grouped.get(key) || {
      id: row.id,
      date: row.date,
      measurement_group: row.measurement_group,
      measurement_order: row.measurement_order,
      source_type: row.source_type,
      source_label: row.source_label,
      qntech_project_id: row.qntech_project_id,
      location: row.location,
      site_name: row.site_name,
      last_modified: row.last_modified,
      created_at: row.created_at,
    };
    if (row.item_code) target[row.item_code] = row.result_value;
    if (row.last_modified && (!target.last_modified || row.last_modified > target.last_modified)) {
      target.last_modified = row.last_modified;
    }
    grouped.set(key, target);
  }
  return Array.from(grouped.values());
}

function stripTemplateImages(workbook) {
  workbook.media = [];
  workbook.worksheets.forEach((worksheet) => {
    worksheet._media = [];
  });
}

async function sanitizeWorkbookDrawingXml(workbookPath) {
  if (!workbookPath || !fs.existsSync(workbookPath)) {
    return;
  }

  const zipBuffer = fs.readFileSync(workbookPath);
  const zip = await JSZip.loadAsync(zipBuffer);
  const drawingPaths = Object.keys(zip.files).filter((filePath) => /^xl\/drawings\/drawing\d+\.xml$/i.test(filePath));

  if (!drawingPaths.length) {
    return;
  }

  const sanitizedWidthEmu = String(FIXED_IMAGE_WIDTH_PIXELS * EMUS_PER_PIXEL);
  const sanitizedHeightEmu = String(FIXED_IMAGE_HEIGHT_PIXELS * EMUS_PER_PIXEL);
  let hasChanges = false;

  for (const drawingPath of drawingPaths) {
    const xml = await zip.file(drawingPath).async('string');
    let sanitizedXml = xml
      .replace(/<a:extLst>[\s\S]*?<\/a:extLst>/g, '')
      .replace(/<a:ext\s+cx="0"\s+cy="0"\s*\/>/g, `<a:ext cx="${sanitizedWidthEmu}" cy="${sanitizedHeightEmu}"/>`);

    sanitizedXml = sanitizedXml.replace(/<xdr:oneCellAnchor\b[\s\S]*?<\/xdr:oneCellAnchor>/g, (anchorXml) => {
      const extMatch = anchorXml.match(/<xdr:ext\s+cx="(\d+)"\s+cy="(\d+)"\s*\/>/);
      if (!extMatch) {
        return anchorXml;
      }

      const [, anchorCx, anchorCy] = extMatch;
      return anchorXml.replace(/<a:ext\s+cx="\d+"\s+cy="\d+"\s*\/>/, `<a:ext cx="${anchorCx}" cy="${anchorCy}"/>`);
    });

    if (sanitizedXml !== xml) {
      zip.file(drawingPath, sanitizedXml);
      hasChanges = true;
    }
  }

  if (!hasChanges) {
    return;
  }

  const sanitizedBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
  fs.writeFileSync(workbookPath, sanitizedBuffer);
}

async function bindWorkbookToPage(templatePath, workbookPath, page, pageContext) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);
  stripTemplateImages(workbook);

  const namedCells = parseNamedCellEntries(workbook);
  const rows = pageContext.rows;

  for (const namedCell of namedCells) {
    const worksheet = workbook.getWorksheet(namedCell.cell.sheetName);
    if (!worksheet) continue;

    worksheet.pageSetup = {
      ...(worksheet.pageSetup || {}),
      blackAndWhite: false,
      draft: false,
    };

    if (namedCell.normalizedName === normalizeKey('날짜')) {
      setCellValue(worksheet, namedCell.cell.address, page.date);
      continue;
    }

    const valueBinding = extractAnalyteValueBinding(namedCell);
    if (valueBinding) {
      const row = rows[valueBinding.position];
      setCellValue(worksheet, namedCell.cell.address, row?.[valueBinding.definition.field] ?? '');
      continue;
    }

    const analyteDefinition = ANALYTE_NAME_MAP.get(namedCell.normalizedName);
    if (analyteDefinition && analyteDefinition.photoNames.some((photoName) => normalizeKey(photoName) === namedCell.normalizedName)) {
      await addNormalizedImageToNamedCell(workbook, worksheet, namedCell, pageContext.photoSelection.selectedPhotos[analyteDefinition.key], analyteDefinition.key);
    }
  }

  await workbook.xlsx.writeFile(workbookPath);
  await sanitizeWorkbookDrawingXml(workbookPath);
}

async function runPendingJob(cacheKey, factory) {
  if (pendingPreviewJobs.has(cacheKey)) {
    return pendingPreviewJobs.get(cacheKey);
  }

  const promise = (async () => {
    try {
      return await factory();
    } finally {
      pendingPreviewJobs.delete(cacheKey);
    }
  })();

  pendingPreviewJobs.set(cacheKey, promise);
  return promise;
}

async function buildPagePreviewPdf({ db, baseDir, appDataPath, templateInfo, page, siteName }) {
  const pageContext = buildPageContext(db, baseDir, page, siteName);
  const templateSignature = getTemplateSignature(templateInfo.absolutePath);
  const cacheKey = hashParts([templateSignature, pageContext.contentSignature]);
  const directories = getPreviewDirectories(appDataPath);
  const workbookPath = path.join(directories.workbookDir, `${cacheKey}.xlsx`);
  const pdfPath = path.join(directories.pagePdfDir, `${cacheKey}.pdf`);

  await runPendingJob(cacheKey, async () => {
    if (fs.existsSync(pdfPath)) {
      return { pdfPath, workbookPath };
    }

    await bindWorkbookToPage(templateInfo.absolutePath, workbookPath, page, pageContext);

    const { convertExcelToPdf } = require('./excelPdfService.cjs');
    await convertExcelToPdf(workbookPath, pdfPath);
  });

  return { pdfPath, workbookPath };
}

async function buildBatchPreviewPdf({ db, baseDir, appDataPath, templateInfo, manifest, siteName }) {
  if (!manifest.pages.length) {
    throw new Error('선택한 기간에 수질분석 데이터가 없습니다.');
  }

  const directories = getPreviewDirectories(appDataPath);
  const batchKey = hashParts([
    getTemplateSignature(templateInfo.absolutePath),
    manifest.startDate,
    manifest.endDate,
  ]);
  const outputPath = path.join(directories.batchPdfDir, `${batchKey}.pdf`);

  await runPendingJob(batchKey, async () => {
    if (fs.existsSync(outputPath)) {
      return outputPath;
    }

    const pdfPaths = [];
    for (const page of manifest.pages) {
      const { pdfPath } = await buildPagePreviewPdf({ db, baseDir, appDataPath, templateInfo, page, siteName });
      pdfPaths.push(pdfPath);
    }

    const { PDFDocument } = require('pdf-lib');
    const merged = await PDFDocument.create();
    for (const pdfPath of pdfPaths) {
      const pdfBytes = fs.readFileSync(pdfPath);
      const doc = await PDFDocument.load(pdfBytes);
      const copiedPages = await merged.copyPages(doc, doc.getPageIndices());
      copiedPages.forEach((page) => merged.addPage(page));
    }
    const mergedBytes = await merged.save();
    fs.writeFileSync(outputPath, mergedBytes);
  });

  return outputPath;
}

function cloneSheet(workbook, sourceSheet, newSheetName) {
  const newSheet = workbook.addWorksheet(newSheetName);

  newSheet.pageSetup = { ...(sourceSheet.pageSetup || {}), blackAndWhite: false, draft: false };
  newSheet.properties = { ...(sourceSheet.properties || {}) };
  newSheet.views = [ ...(sourceSheet.views || []) ];

  // 컬럼 데이터 및 스타일 복사
  sourceSheet.columns.forEach((col, i) => {
    const newCol = newSheet.getColumn(i + 1);
    newCol.width = col.width;
    newCol.style = col.style ? JSON.parse(JSON.stringify(col.style)) : undefined;
  });

  sourceSheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const newRow = newSheet.getRow(rowNumber);
    newRow.height = row.height;
    newRow.hidden = row.hidden;
    newRow.outlineLevel = row.outlineLevel;

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const newCell = newRow.getCell(colNumber);
      newCell.value = cell.value;
      if (cell.style) {
        newCell.style = JSON.parse(JSON.stringify(cell.style));
      }
      if (cell.numFmt) newCell.numFmt = cell.numFmt;
    });
  });

  // 병합 정보 복사 (model.merges가 없을 경우를 대비해 직접 탐색은 어려우므로 모델 활용)
  const merges = sourceSheet.model.merges || [];
  merges.forEach(merge => {
    try { newSheet.mergeCells(merge); } catch (_) {}
  });

  return newSheet;
}

// --- 엑셀 내보내기: 단일 파일 내 시트 추가(복사) 방식 ---
async function buildBatchExportExcel({ db, baseDir, appDataPath, templateInfo, manifest, siteName }) {
  const startTotal = Date.now();
  console.log(`[Excel Export] 내보내기 요청 파라미터: startDate=${manifest.startDate}, endDate=${manifest.endDate}, siteName=${siteName || 'null'}`);
  console.log(`[Excel Export] 매니페스트 정보: 총 ${manifest.pages.length}개 페이지`);
  manifest.pages.forEach((p, idx) => {
    console.log(`[Excel Export] 페이지[${idx}]: 날짜=${p.date}, 그룹=${p.measurementGroup}, 차수=${p.measurementOrder}`);
  });

  if (!manifest.pages.length) {
    throw new Error('선택한 기간에 수질분석 데이터가 없습니다.');
  }

  console.log(`[Excel Export] 내보내기 시작: 총 ${manifest.pages.length}개 시트 (기간: ${manifest.startDate} ~ ${manifest.endDate}, 사이트: ${siteName || '전체'})`);

  const tempDir = os.tmpdir();
  const baseFileName = path.parse(templateInfo.fileName).name;
  const dateSuffix = manifest.startDate === manifest.endDate ? manifest.startDate : `${manifest.startDate}_${manifest.endDate}`;
  const clearFileName = `${baseFileName}-${dateSuffix}-${Date.now()}.xlsx`;
  const outputPath = path.join(tempDir, clearFileName);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templateInfo.absolutePath);
  stripTemplateImages(workbook);
  
  const templateSheet = workbook.worksheets[0];
  const templateSheetName = templateSheet.name;
  const namedCells = parseNamedCellEntries(workbook);

  for (let i = 0; i < manifest.pages.length; i++) {
    const startPage = Date.now();
    const page = manifest.pages[i];
    const pageContext = buildPageContext(db, baseDir, page, siteName);
    
    let finalSheetName = `${i + 1}차`;
    console.log(`[Excel Export] [${i + 1}/${manifest.pages.length}] "${finalSheetName}" (${page.date}) 처리 중...`);

    const currentSheet = cloneSheet(workbook, templateSheet, finalSheetName);

    const rows = pageContext.rows;
    let imagesAdded = 0;
    for (const namedCell of namedCells) {
      if (namedCell.cell.sheetName !== templateSheetName) continue;
      
      if (namedCell.normalizedName === normalizeKey('날짜')) {
        setCellValue(currentSheet, namedCell.cell.address, page.date);
        continue;
      }

      const valueBinding = extractAnalyteValueBinding(namedCell);
      if (valueBinding) {
        const row = rows[valueBinding.position];
        setCellValue(currentSheet, namedCell.cell.address, row?.[valueBinding.definition.field] ?? '');
        continue;
      }

      const analyteDefinition = ANALYTE_NAME_MAP.get(namedCell.normalizedName);
      if (analyteDefinition && analyteDefinition.photoNames.some((photoName) => normalizeKey(photoName) === namedCell.normalizedName)) {
        const imagePath = pageContext.photoSelection.selectedPhotos[analyteDefinition.key];
        if (imagePath) {
          await addNormalizedImageToNamedCell(workbook, currentSheet, namedCell, imagePath, analyteDefinition.key);
          imagesAdded++;
        }
      }
    }
    console.log(`[Excel Export] [${i + 1}/${manifest.pages.length}] 완료 (${Date.now() - startPage}ms, 이미지 ${imagesAdded}개)`);
  }

  workbook.removeWorksheet(templateSheet.id);
  if (workbook.definedNames) {
    workbook.definedNames.model = [];
  }

  console.log(`[Excel Export] 파일 저장 중: ${outputPath}`);
  const startSave = Date.now();
  await workbook.xlsx.writeFile(outputPath);
  await sanitizeWorkbookDrawingXml(outputPath);
  console.log(`[Excel Export] 저장 완료 (${Date.now() - startSave}ms)`);
  console.log(`[Excel Export] 전체 공정 완료 (${Date.now() - startTotal}ms)`);

  return [outputPath];
}

function getActiveDates(db, startDate, endDate, siteName) {
  let query = 'SELECT DISTINCT date FROM qntech_water_quality WHERE date BETWEEN ? AND ?';
  let params = [startDate, endDate];

  if (siteName) {
    query += ' AND site_name = ?';
    params.push(siteName);
  }

  query += ' ORDER BY date ASC';

  const rows = db.prepare(query).all(...params);
  return rows.map(r => r.date);
}

module.exports = {
  buildBatchExportExcel,
  buildBatchPreviewPdf,
  buildPreviewManifest,
  buildPageRenderData,
  buildPagePreviewPdf,
  findPageInManifest,
  normalizeDateRange,
  parsePageKey,
  normalizeKey,
  getActiveDates,
};
