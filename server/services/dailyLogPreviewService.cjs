const crypto = require('crypto');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');

const { convertExcelToPdf } = require('./excelPdfService.cjs');
const { getActiveLocations } = require('./qntechWaterValueImportService.cjs');
const { resolvePhotoRoot } = require('./qntechWaterPhotoImportService.cjs');

const PREVIEW_RENDER_VERSION = '2026-03-10-photo-frame-v9';

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

const IMAGE_EDGE_INSET_PIXELS = 0.5;
const IMAGE_VERTICAL_OFFSET_PIXELS = 2;

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

function getColumnWidthPixels(worksheet, columnNumber) {
  const column = worksheet.getColumn(columnNumber);
  const width = Number(column?.width || worksheet.properties?.defaultColWidth || 8.43);
  return Math.max(16, Math.round((((256 * width) + Math.round(128 / 7)) / 256) * 7));
}

function getRowHeightPixels(worksheet, rowNumber) {
  const row = worksheet.getRow(rowNumber);
  const height = Number(row?.height || worksheet.properties?.defaultRowHeight || 15);
  return Math.max(16, Math.round(height * (96 / 72)));
}

function sumPixels(start, end, sizeGetter) {
  let total = 0;
  for (let index = start; index <= end; index += 1) {
    total += sizeGetter(index);
  }
  return total;
}

function pixelsToColumnPosition(worksheet, startColumn, offsetPixels) {
  let remaining = Math.max(0, offsetPixels);
  let position = startColumn - 1;
  let currentColumn = startColumn;

  while (remaining > 0) {
    const columnWidth = getColumnWidthPixels(worksheet, currentColumn);
    if (remaining >= columnWidth) {
      position += 1;
      remaining -= columnWidth;
      currentColumn += 1;
      continue;
    }

    position += remaining / columnWidth;
    break;
  }

  return position;
}

function pixelsToRowPosition(worksheet, startRow, offsetPixels) {
  let remaining = Math.max(0, offsetPixels);
  let position = startRow - 1;
  let currentRow = startRow;

  while (remaining > 0) {
    const rowHeight = getRowHeightPixels(worksheet, currentRow);
    if (remaining >= rowHeight) {
      position += 1;
      remaining -= rowHeight;
      currentRow += 1;
      continue;
    }

    position += remaining / rowHeight;
    break;
  }

  return position;
}

function getImagePlacement(worksheet, address) {
  const fallbackAddress = parseCellAddress(address);
  const range = getMergedRangeForCell(worksheet, address);
  if (!range) {
    return {
      tl: { col: columnToIndex(fallbackAddress?.column || 'A'), row: (fallbackAddress?.rowNumber || 1) - 1 },
      br: {
        col: columnToIndex(fallbackAddress?.column || 'A') + 1,
        row: fallbackAddress?.rowNumber || 1,
      },
      renderSize: { width: 199, height: 239 },
    };
  }

  const targetWidth = sumPixels(range.startColumn, range.endColumn, (columnNumber) => getColumnWidthPixels(worksheet, columnNumber));
  const targetHeight = sumPixels(range.startRow, range.endRow, (rowNumber) => getRowHeightPixels(worksheet, rowNumber));
  const insetPixels = IMAGE_EDGE_INSET_PIXELS;
  const width = Math.max(1, Math.round(targetWidth - (insetPixels * 2)));
  const height = Math.max(1, Math.round(targetHeight - (insetPixels * 2)));
  const offsetX = insetPixels;
  const offsetY = insetPixels + IMAGE_VERTICAL_OFFSET_PIXELS;

  return {
    tl: {
      col: pixelsToColumnPosition(worksheet, range.startColumn, offsetX),
      row: pixelsToRowPosition(worksheet, range.startRow, offsetY),
    },
    br: {
      col: pixelsToColumnPosition(worksheet, range.startColumn, targetWidth - offsetX),
      row: pixelsToRowPosition(worksheet, range.startRow, targetHeight - insetPixels),
    },
    renderSize: { width, height },
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

function listPageGroups(db, startDate, endDate) {
  return db.prepare(`
    SELECT
      date,
      measurement_group AS measurementGroup,
      MIN(measurement_order) AS measurementOrder,
      MAX(COALESCE(source_label, '')) AS sourceLabel,
      COUNT(*) AS rowCount,
      COUNT(DISTINCT location) AS locationCount,
      MAX(COALESCE(last_modified, created_at, '')) AS lastModified
    FROM water_quality
    WHERE date BETWEEN ? AND ?
    GROUP BY date, measurement_group
    ORDER BY date ASC, measurementOrder ASC, measurementGroup ASC
  `).all(startDate, endDate);
}

function buildPreviewManifest(db, startDate, endDate) {
  const groups = listPageGroups(db, startDate, endDate);
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

function listPhotoFiles(baseDir, configuredPhotoRoot, date) {
  const photoDir = getDatePhotoDirectory(baseDir, configuredPhotoRoot, date);
  if (!fs.existsSync(photoDir)) {
    return [];
  }

  return fs.readdirSync(photoDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const absolutePath = path.join(photoDir, entry.name);
      const stat = fs.statSync(absolutePath);
      return {
        fileName: entry.name,
        absolutePath,
        normalizedName: normalizeKey(entry.name),
        lastModifiedMs: stat.mtimeMs
      };
    });
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
  const candidates = photoFiles.filter((photoFile) => analyteDefinition.photoKeywords.some((keyword) => photoFile.normalizedName.includes(normalizeKey(keyword))));
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
  return db.prepare(`
    SELECT *
    FROM water_quality
    WHERE date = ? AND measurement_group = ?
    ORDER BY measurement_order ASC, created_at ASC, id ASC, location ASC
  `).all(page.date, page.measurementGroup);
}

function getTemplateSignature(templatePath) {
  const stat = fs.statSync(templatePath);
  return `${path.basename(templatePath)}:${stat.mtimeMs}:${stat.size}`;
}

function buildPageContext(db, baseDir, page) {
  const activeLocations = getActiveLocations(db);
  const rows = sortRowsByLocation(getPageRows(db, page), activeLocations);
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

function buildPageRenderData({ db, baseDir, page }) {
  const pageContext = buildPageContext(db, baseDir, page);

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

async function addNormalizedImageToNamedCell(workbook, worksheet, namedCell, imagePath, analyteKey) {
  if (!imagePath || !fs.existsSync(imagePath)) {
    return;
  }

  const placement = getImagePlacement(worksheet, namedCell.cell.address);
  const { renderSize, ...excelPlacement } = placement;

  const { data: normalizedBuffer } = await sharp(imagePath)
    .rotate()
    .resize({
      width: Math.max(1, Math.round(renderSize.width)),
      height: Math.max(1, Math.round(renderSize.height)),
      fit: 'cover',
      position: 'centre'
    })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  const imageId = workbook.addImage({ buffer: normalizedBuffer, extension: 'jpeg' });

  worksheet.addImage(imageId, excelPlacement);
}

async function bindWorkbookToPage(templatePath, workbookPath, page, pageContext) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);

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

async function buildPagePreviewPdf({ db, baseDir, appDataPath, templateInfo, page }) {
  const pageContext = buildPageContext(db, baseDir, page);
  const templateSignature = getTemplateSignature(templateInfo.absolutePath);
  const cacheKey = hashParts([templateSignature, pageContext.contentSignature]);
  const directories = getPreviewDirectories(appDataPath);
  const workbookPath = path.join(directories.workbookDir, `${cacheKey}.xlsx`);
  const pdfPath = path.join(directories.pagePdfDir, `${cacheKey}.pdf`);

  if (fs.existsSync(pdfPath)) {
    return { pdfPath, cacheKey, pageContext };
  }

  await runPendingJob(cacheKey, async () => {
    if (fs.existsSync(pdfPath)) {
      return pdfPath;
    }

    await bindWorkbookToPage(templateInfo.absolutePath, workbookPath, page, pageContext);
    await convertExcelToPdf(workbookPath, pdfPath);
  });

  return { pdfPath, cacheKey, pageContext };
}

async function mergePdfFiles(pdfPaths, outputPath) {
  const mergedPdf = await PDFDocument.create();

  for (const pdfPath of pdfPaths) {
    const bytes = fs.readFileSync(pdfPath);
    const sourcePdf = await PDFDocument.load(bytes);
    const copiedPages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }

  const mergedBytes = await mergedPdf.save();
  fs.writeFileSync(outputPath, mergedBytes);
  return outputPath;
}

async function buildBatchPreviewPdf({ db, baseDir, appDataPath, templateInfo, manifest }) {
  if (!manifest.pages.length) {
    throw new Error('선택한 기간에 수질분석 데이터가 없습니다.');
  }

  const pageResults = [];
  for (const page of manifest.pages) {
    const pageResult = await buildPagePreviewPdf({ db, baseDir, appDataPath, templateInfo, page });
    pageResults.push(pageResult);
  }

  const directories = getPreviewDirectories(appDataPath);
  const batchKey = hashParts([
    getTemplateSignature(templateInfo.absolutePath),
    manifest.startDate,
    manifest.endDate,
    ...pageResults.map((result) => result.cacheKey)
  ]);
  const outputPath = path.join(directories.batchPdfDir, `${batchKey}.pdf`);

  if (fs.existsSync(outputPath)) {
    return outputPath;
  }

  await runPendingJob(`batch:${batchKey}`, async () => {
    if (fs.existsSync(outputPath)) {
      return outputPath;
    }

    await mergePdfFiles(pageResults.map((result) => result.pdfPath), outputPath);
  });

  return outputPath;
}

module.exports = {
  buildBatchPreviewPdf,
  buildPreviewManifest,
  buildPageRenderData,
  buildPagePreviewPdf,
  findPageInManifest,
  normalizeDateRange,
  parsePageKey,
};