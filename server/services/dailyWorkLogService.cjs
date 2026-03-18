const crypto = require('crypto');
const ExcelJS = require('exceljs');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

const { convertExcelToPdf } = require('./excelPdfService.cjs');

const PREVIEW_RENDER_VERSION = '2026-03-16-daily-work-log-flow-aggregate-v5';

const pendingPreviewJobs = new Map();

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

function normalizeDate(value) {
  return String(value || '').trim().slice(0, 10);
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

function buildPageKey(date) {
  return Buffer.from(JSON.stringify({ date, type: 'daily-work-log' }), 'utf8').toString('base64url');
}

function parsePageKey(pageKey) {
  try {
    const parsed = JSON.parse(Buffer.from(String(pageKey || ''), 'base64url').toString('utf8'));
    return { date: normalizeDate(parsed.date) };
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

// --- Data Aggregation ---

function getFlowReadings(db, date) {
  return db.prepare('SELECT * FROM flow_readings WHERE date = ?').all(date);
}

function getFlowReadingsForPrevDate(db, date) {
  const prevDate = getPreviousDate(date);
  return db.prepare('SELECT * FROM flow_readings WHERE date = ?').all(prevDate);
}

function getMedicineLogs(db, date) {
  return db.prepare('SELECT * FROM medicine_logs WHERE date = ?').all(date);
}

function getKitLogs(db, date) {
  return db.prepare('SELECT * FROM kit_logs WHERE date = ?').all(date);
}

function getSiteSettings(db) {
  return db.prepare('SELECT site_name, manager_name, method, series FROM app_settings WHERE id = 1').get() || {};
}

function getActiveConfigItems(db, category) {
  return db.prepare("SELECT * FROM config_items WHERE category = ? AND is_active = 1 ORDER BY display_order ASC").all(category);
}

function getPreviousDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return formatLocalDate(d);
}

function getMonthStartDate(dateStr) {
  return dateStr.slice(0, 7) + '-01';
}

function getYearStartDate(dateStr) {
  return dateStr.slice(0, 4) + '-01-01';
}

// 기간 합계 조회 헬퍼
function sumFlowField(db, type, field, startDate, endDate) {
  const row = db.prepare(
    `SELECT SUM(${field}) as total FROM flow_readings WHERE type = ? AND date BETWEEN ? AND ?`
  ).get(type, startDate, endDate);
  return row?.total ?? '';
}

function sumMedicineField(db, name, field, startDate, endDate) {
  const row = db.prepare(
    `SELECT SUM(${field}) as total FROM medicine_logs WHERE medicine_name = ? AND date BETWEEN ? AND ?`
  ).get(name, startDate, endDate);
  return row?.total ?? '';
}

function sumKitField(db, name, field, startDate, endDate) {
  const row = db.prepare(
    `SELECT SUM(${field}) as total FROM kit_logs WHERE kit_name = ? AND date BETWEEN ? AND ?`
  ).get(name, startDate, endDate);
  return row?.total ?? '';
}

function findFlowByType(flows, type) {
  return flows.find(f => normalizeKey(f.type).includes(normalizeKey(type)));
}

function findMedicineByName(medicines, name) {
  return medicines.find(m => normalizeKey(m.medicine_name).includes(normalizeKey(name)));
}

function findKitByName(kits, name) {
  return kits.find(k => normalizeKey(k.kit_name).includes(normalizeKey(name)));
}

function findFlowByKeyword(flows, keyword) {
  return flows.find(f => {
    const t = String(f.type || '').trim();
    return t.includes(keyword);
  });
}

function findMedicineByKeyword(medicines, keyword) {
  return medicines.find(m => {
    const n = String(m.medicine_name || '').trim();
    return n.includes(keyword);
  });
}

function findKitByKeyword(kits, keyword) {
  return kits.find(k => {
    const n = String(k.kit_name || '').trim();
    return n.includes(keyword);
  });
}

function findFlowTypeNameByKeyword(db, keyword) {
  const items = getActiveConfigItems(db, 'flow');
  const normalizedItems = items
    .map((item) => ({
      ...item,
      normalizedName: String(item.item_name || '').replace(/_(flow|raw)$/i, ''),
    }))
    .filter((item, index, array) => array.findIndex((candidate) => candidate.normalizedName === item.normalizedName) === index);

  const exactMatch = normalizedItems.find((item) => item.normalizedName === keyword);
  if (exactMatch) {
    return exactMatch.normalizedName;
  }

  const partialMatch = normalizedItems.find((item) => item.normalizedName.includes(keyword));
  return partialMatch?.normalizedName || keyword;
}

function findMedicineNameByKeyword(db, keyword) {
  const items = getActiveConfigItems(db, 'medicine');
  const match = items.find(item => item.item_name.includes(keyword));
  return match?.item_name || keyword;
}

function findKitNameByKeyword(db, keyword) {
  const items = getActiveConfigItems(db, 'kit');
  const match = items.find(item => item.item_name.includes(keyword));
  return match?.item_name || keyword;
}

/**
 * 지정된 날짜의 모든 데이터를 수집하여 일일업무일지 셀 이름에 맞는 바인딩 맵을 생성합니다.
 *
 * 셀 이름 매핑:
 * - 유량: 유입전일/금일/누계/월간/연간, 방류~, 내부반송~, 외부반송~, 슬러지
 * - 약품: 포도당/중탄산/팩 + 추가약품1~3 (구입/사용/재고/월간/연간)
 * - 키트: 암모니아/질산/인/알칼리 (구입/사용/재고/월간/연간)
 * - 기본: 날짜, 이름
 * - 전력: 전일전력, 금일전력, 전력사용, 전력계산
 */
function buildBindingsForDate(db, date) {
  const settings = getSiteSettings(db);
  const flows = getFlowReadings(db, date);
  const prevFlows = getFlowReadingsForPrevDate(db, date);
  const medicines = getMedicineLogs(db, date);
  const kits = getKitLogs(db, date);

  const monthStart = getMonthStartDate(date);
  const yearStart = getYearStartDate(date);

  const bindings = {};

  // --- 기본 정보 ---
  bindings['제목'] = '일 일 업 무 일 지';
  bindings['날짜'] = date;
  bindings['이름'] = settings.manager_name || '';

  // --- 유량 데이터 ---
  // 유입유량계
  const flowIn = findFlowByKeyword(flows, '유입');
  const prevFlowIn = findFlowByKeyword(prevFlows, '유입');
  const flowInType = findFlowTypeNameByKeyword(db, '유입');
  bindings['유입전일'] = prevFlowIn?.raw_value ?? '';
  bindings['유입금일'] = flowIn?.raw_value ?? '';
  bindings['유입누계'] = flowIn?.calculated_flow ?? '';
  bindings['월간유입'] = sumFlowField(db, flowInType, 'calculated_flow', monthStart, date);
  bindings['연간유입'] = sumFlowField(db, flowInType, 'calculated_flow', yearStart, date);

  // 방류유량계
  const flowOut = findFlowByKeyword(flows, '방류');
  const prevFlowOut = findFlowByKeyword(prevFlows, '방류');
  const flowOutType = findFlowTypeNameByKeyword(db, '방류');
  bindings['방류전일'] = prevFlowOut?.raw_value ?? '';
  bindings['방류금일'] = flowOut?.raw_value ?? '';
  bindings['방류누계'] = flowOut?.calculated_flow ?? '';
  bindings['월간방류'] = sumFlowField(db, flowOutType, 'calculated_flow', monthStart, date);
  bindings['연간방류'] = sumFlowField(db, flowOutType, 'calculated_flow', yearStart, date);

  // 내부반송유량계
  const flowInternal = findFlowByKeyword(flows, '내부반송') || findFlowByKeyword(flows, '내부');
  const prevFlowInternal = findFlowByKeyword(prevFlows, '내부반송') || findFlowByKeyword(prevFlows, '내부');
  const flowInternalType = findFlowTypeNameByKeyword(db, '내부');
  bindings['내부반송전일'] = prevFlowInternal?.raw_value ?? '';
  bindings['내부반송금일'] = flowInternal?.raw_value ?? '';
  bindings['내부누계'] = flowInternal?.calculated_flow ?? '';
  bindings['월간내부'] = sumFlowField(db, flowInternalType, 'calculated_flow', monthStart, date);
  bindings['연간내부'] = sumFlowField(db, flowInternalType, 'calculated_flow', yearStart, date);

  // 외부반송유량계
  const flowExternal = findFlowByKeyword(flows, '외부반송') || findFlowByKeyword(flows, '외부');
  const prevFlowExternal = findFlowByKeyword(prevFlows, '외부반송') || findFlowByKeyword(prevFlows, '외부');
  const flowExternalType = findFlowTypeNameByKeyword(db, '외부');
  bindings['외부반송전일'] = prevFlowExternal?.raw_value ?? '';
  bindings['외부반송금일'] = flowExternal?.raw_value ?? '';
  bindings['외부누계'] = flowExternal?.calculated_flow ?? '';
  bindings['월간외부'] = sumFlowField(db, flowExternalType, 'calculated_flow', monthStart, date);
  bindings['연간외부'] = sumFlowField(db, flowExternalType, 'calculated_flow', yearStart, date);

  // 슬러지 처리량은 총 누계(calculated_flow)가 아니라 반출량(sludge_export) 기준이다.
  // 반출이 없는 날이 많으므로 값이 없으면 빈 칸으로 유지하고, 월간/연간도 반출량만 누적한다.
  const flowSludge = findFlowByKeyword(flows, '슬러지');
  const sludgeType = findFlowTypeNameByKeyword(db, '슬러지');
  bindings['슬러지'] = flowSludge?.sludge_export ?? flowSludge?.raw_value ?? '';
  bindings['월간슬러지'] = sumFlowField(db, sludgeType, 'COALESCE(sludge_export, raw_value)', monthStart, date);
  bindings['연간슬러지'] = sumFlowField(db, sludgeType, 'COALESCE(sludge_export, raw_value)', yearStart, date);

  // --- 약품 데이터 ---
  // 포도당
  const medGlucose = findMedicineByKeyword(medicines, '포도당');
  const glucoseName = findMedicineNameByKeyword(db, '포도당');
  bindings['포도당구입'] = medGlucose?.purchase_amount ?? '';
  bindings['포도당사용'] = medGlucose?.usage_amount ?? '';
  bindings['포도당재고'] = medGlucose?.current_inventory ?? '';
  bindings['월간포도당'] = sumMedicineField(db, glucoseName, 'usage_amount', monthStart, date);
  bindings['연간포도당'] = sumMedicineField(db, glucoseName, 'usage_amount', yearStart, date);

  // 중탄산 (중탄산나트륨)
  const medSodium = findMedicineByKeyword(medicines, '중탄산');
  const sodiumName = findMedicineNameByKeyword(db, '중탄산');
  bindings['중탄산구입'] = medSodium?.purchase_amount ?? '';
  bindings['중탄산사용'] = medSodium?.usage_amount ?? '';
  bindings['중탄산재고'] = medSodium?.current_inventory ?? '';
  bindings['월간중탄산'] = sumMedicineField(db, sodiumName, 'usage_amount', monthStart, date);
  bindings['연간중탄산'] = sumMedicineField(db, sodiumName, 'usage_amount', yearStart, date);

  // 팩 (PAC)
  const medPac = findMedicineByKeyword(medicines, '팩') || findMedicineByKeyword(medicines, 'PAC');
  const pacName = findMedicineNameByKeyword(db, '팩');
  bindings['팩구입'] = medPac?.purchase_amount ?? '';
  bindings['팩사용'] = medPac?.usage_amount ?? '';
  bindings['팩재고'] = medPac?.current_inventory ?? '';
  bindings['월간팩'] = sumMedicineField(db, pacName, 'usage_amount', monthStart, date);
  bindings['연간팩'] = sumMedicineField(db, pacName, 'usage_amount', yearStart, date);

  // 추가약품 1~3 (config_items에서 medicine 카테고리의 4번째~6번째 항목)
  const allMedicineItems = getActiveConfigItems(db, 'medicine');
  const baseMedicineKeywords = ['포도당', '중탄산', '팩', 'PAC'];
  const extraMedicines = allMedicineItems.filter(item => 
    !baseMedicineKeywords.some(kw => item.item_name.includes(kw))
  );

  for (let i = 0; i < 3; i++) {
    const idx = i + 1;
    const extraItem = extraMedicines[i];
    if (extraItem) {
      const extraMed = findMedicineByKeyword(medicines, extraItem.item_name);
      bindings[`추가약품명${idx}`] = extraItem.item_name;
      bindings[`추가약품${idx}구입`] = extraMed?.purchase_amount ?? '';
      bindings[`추가약품${idx}사용`] = extraMed?.usage_amount ?? '';
      bindings[`추가약품${idx}재고`] = extraMed?.current_inventory ?? '';
      bindings[`월간추가약품${idx}`] = sumMedicineField(db, extraItem.item_name, 'usage_amount', monthStart, date);
      bindings[`연간추가약품${idx}`] = sumMedicineField(db, extraItem.item_name, 'usage_amount', yearStart, date);
    } else {
      bindings[`추가약품명${idx}`] = '';
      bindings[`추가약품${idx}구입`] = '';
      bindings[`추가약품${idx}사용`] = '';
      bindings[`추가약품${idx}재고`] = '';
      bindings[`월간추가약품${idx}`] = '';
      bindings[`연간추가약품${idx}`] = '';
    }
  }

  // --- 키트 데이터 ---
  // 암모니아
  const kitNh3 = findKitByKeyword(kits, '암모니아');
  const kitNh3Name = findKitNameByKeyword(db, '암모니아');
  bindings['암모니아구입'] = kitNh3?.purchase_amount ?? '';
  bindings['암모니아사용'] = kitNh3?.usage_amount ?? '';
  bindings['암모니아재고'] = kitNh3?.current_inventory ?? '';
  bindings['월간암모니아'] = sumKitField(db, kitNh3Name, 'usage_amount', monthStart, date);
  bindings['연간암모니아'] = sumKitField(db, kitNh3Name, 'usage_amount', yearStart, date);

  // 질산
  const kitNo3 = findKitByKeyword(kits, '질산');
  const kitNo3Name = findKitNameByKeyword(db, '질산');
  bindings['질산구입'] = kitNo3?.purchase_amount ?? '';
  bindings['질산사용'] = kitNo3?.usage_amount ?? '';
  bindings['질산재고'] = kitNo3?.current_inventory ?? '';
  bindings['월간질산'] = sumKitField(db, kitNo3Name, 'usage_amount', monthStart, date);
  bindings['연간질산'] = sumKitField(db, kitNo3Name, 'usage_amount', yearStart, date);

  // 인
  const kitP = findKitByKeyword(kits, '인');
  const kitPName = findKitNameByKeyword(db, '인');
  bindings['인구입'] = kitP?.purchase_amount ?? '';
  bindings['인사용'] = kitP?.usage_amount ?? '';
  bindings['인재고'] = kitP?.current_inventory ?? '';
  bindings['월간인'] = sumKitField(db, kitPName, 'usage_amount', monthStart, date);
  bindings['연간인'] = sumKitField(db, kitPName, 'usage_amount', yearStart, date);

  // 알칼리도
  const kitAlk = findKitByKeyword(kits, '알칼리');
  const kitAlkName = findKitNameByKeyword(db, '알칼리');
  bindings['알칼리구입'] = kitAlk?.purchase_amount ?? '';
  bindings['알칼리도사용'] = kitAlk?.usage_amount ?? '';
  bindings['알칼리재고'] = kitAlk?.current_inventory ?? '';
  bindings['월간알칼리'] = sumKitField(db, kitAlkName, 'usage_amount', monthStart, date);
  bindings['연간알칼리'] = sumKitField(db, kitAlkName, 'usage_amount', yearStart, date);

  // --- 전력 (flow_readings에서 '전력' 타입) ---
  const flowPower = findFlowByKeyword(flows, '전력');
  const prevFlowPower = findFlowByKeyword(prevFlows, '전력');
  bindings['전일전력'] = prevFlowPower?.raw_value ?? '';
  bindings['금일전력'] = flowPower?.raw_value ?? '';
  bindings['전력사용'] = flowPower?.calculated_flow ?? '';
  // 전력계산은 수동 입력용이므로 빈 값 유지
  bindings['전력계산'] = '';

  // --- 수질 분석 (향후 구현, 현재는 빈 값) ---
  ['ph', 'bod', 'toc', 'ss', 'tn', 'tp', '대장균'].forEach(item => {
    bindings[`수질${item}1`] = '';
    bindings[`수질${item}2`] = '';
  });
  bindings['수질날짜1'] = '';
  bindings['수질날짜2'] = '';

  // --- 기타 (수동 입력) ---
  bindings['수온'] = '';
  bindings['산소'] = '';
  bindings['ml'] = '';
  bindings['svi'] = '';

  return bindings;
}

// --- Manifest ---

function enumerateDateRange(startDate, endDate) {
  const dates = [];
  const current = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  while (current <= end) {
    dates.push(formatLocalDate(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

function buildPreviewManifest(startDate, endDate) {
  const dates = enumerateDateRange(startDate, endDate);

  const pages = dates.map((date, index) => ({
    pageKey: buildPageKey(date),
    absoluteIndex: index,
    date,
    pageNumberForDate: 1,
    totalPagesForDate: 1,
    isRange: startDate !== endDate,
  }));

  return {
    startDate,
    endDate,
    totalPages: pages.length,
    pages,
  };
}

function findPageInManifest(manifest, pageKey) {
  if (!pageKey) {
    return manifest.pages[0] || null;
  }
  return manifest.pages.find((page) => page.pageKey === pageKey) || null;
}

// --- Page Render Data ---

function buildPageRenderData(db, page) {
  const bindings = buildBindingsForDate(db, page.date);

  return {
    pageKey: page.pageKey,
    date: page.date,
    pageNumberForDate: page.pageNumberForDate,
    totalPagesForDate: page.totalPagesForDate,
    bindings,
  };
}

// --- Excel Binding & PDF ---

function getPreviewDirectories(appDataPath) {
  const rootDir = ensureDirectory(path.join(appDataPath, 'temp', 'daily-work-log-previews'));
  return {
    rootDir,
    pagePdfDir: ensureDirectory(path.join(rootDir, 'pages')),
    batchPdfDir: ensureDirectory(path.join(rootDir, 'batches')),
    workbookDir: ensureDirectory(path.join(rootDir, 'workbooks')),
  };
}

function getTemplateSignature(templatePath) {
  const stat = fs.statSync(templatePath);
  return `${path.basename(templatePath)}:${stat.mtimeMs}:${stat.size}`;
}

function setCellValue(worksheet, address, value) {
  worksheet.getCell(address).value = value === undefined || value === null ? '' : value;
}

async function bindWorkbookToPage(templatePath, workbookPath, bindings) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);

  const namedCells = parseNamedCellEntries(workbook);

  for (const namedCell of namedCells) {
    const worksheet = workbook.getWorksheet(namedCell.cell.sheetName);
    if (!worksheet) continue;

    worksheet.pageSetup = {
      ...(worksheet.pageSetup || {}),
      blackAndWhite: false,
      draft: false,
    };

    // 셀 이름을 정규화하여 바인딩에서 찾기
    const normalizedName = namedCell.normalizedName;
    const originalName = namedCell.name;

    // 정규화된 이름으로 먼저 찾고, 없으면 원래 이름으로 찾기
    let value;
    if (Object.prototype.hasOwnProperty.call(bindings, normalizedName)) {
      value = bindings[normalizedName];
    } else if (Object.prototype.hasOwnProperty.call(bindings, originalName)) {
      value = bindings[originalName];
    } else {
      // 바인딩에 없는 셀은 건드리지 않음 (사용자 수동 입력용)
      continue;
    }

    setCellValue(worksheet, namedCell.cell.address, value);
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

function buildContentSignature(db, date) {
  const flows = getFlowReadings(db, date);
  const medicines = getMedicineLogs(db, date);
  const kits = getKitLogs(db, date);

  return hashParts([
    PREVIEW_RENDER_VERSION,
    date,
    flows.map((r) => [r.type, r.raw_value, r.calculated_flow, r.sludge_export, r.last_modified].join(':')).join('|'),
    medicines.map((r) => [r.medicine_name, r.purchase_amount, r.usage_amount, r.current_inventory, r.last_modified].join(':')).join('|'),
    kits.map((r) => [r.kit_name, r.purchase_amount, r.usage_amount, r.current_inventory, r.last_modified].join(':')).join('|'),
  ]);
}

async function buildPagePreviewPdf({ db, appDataPath, templateInfo, page }) {
  const contentSignature = buildContentSignature(db, page.date);
  const templateSignature = getTemplateSignature(templateInfo.absolutePath);
  const cacheKey = hashParts([templateSignature, contentSignature]);
  const directories = getPreviewDirectories(appDataPath);
  const workbookPath = path.join(directories.workbookDir, `${cacheKey}.xlsx`);
  const pdfPath = path.join(directories.pagePdfDir, `${cacheKey}.pdf`);

  if (fs.existsSync(pdfPath)) {
    return { pdfPath, cacheKey };
  }

  await runPendingJob(cacheKey, async () => {
    if (fs.existsSync(pdfPath)) {
      return pdfPath;
    }

    const bindings = buildBindingsForDate(db, page.date);
    await bindWorkbookToPage(templateInfo.absolutePath, workbookPath, bindings);
    await convertExcelToPdf(workbookPath, pdfPath);
  });

  return { pdfPath, cacheKey };
}

async function mergePdfFiles(pdfPaths, outputPath) {
  const mergedPdf = await PDFDocument.create();

  for (const pdfFilePath of pdfPaths) {
    const bytes = fs.readFileSync(pdfFilePath);
    const sourcePdf = await PDFDocument.load(bytes);
    const copiedPages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }

  const mergedBytes = await mergedPdf.save();
  fs.writeFileSync(outputPath, mergedBytes);
  return outputPath;
}

async function buildBatchPreviewPdf({ db, appDataPath, templateInfo, manifest }) {
  if (!manifest.pages.length) {
    throw new Error('선택한 기간에 데이터가 없습니다.');
  }

  const pageResults = [];
  for (const page of manifest.pages) {
    const pageResult = await buildPagePreviewPdf({ db, appDataPath, templateInfo, page });
    pageResults.push(pageResult);
  }

  const directories = getPreviewDirectories(appDataPath);
  const batchKey = hashParts([
    getTemplateSignature(templateInfo.absolutePath),
    manifest.startDate,
    manifest.endDate,
    ...pageResults.map((result) => result.cacheKey),
  ]);
  const outputPath = path.join(directories.batchPdfDir, `${batchKey}.pdf`);

  return outputPath;
}



function cloneSheet(workbook, sourceSheet, newSheetName) {
  const newSheet = workbook.addWorksheet(newSheetName);

  newSheet.pageSetup = { ...(sourceSheet.pageSetup || {}), blackAndWhite: false, draft: false };
  newSheet.properties = { ...(sourceSheet.properties || {}) };
  newSheet.views = [ ...(sourceSheet.views || []) ];

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

  const merges = sourceSheet.model.merges || [];
  merges.forEach(merge => {
    try { newSheet.mergeCells(merge); } catch (_) {}
  });

  return newSheet;
}

// --- 엑셀 내보내기: 단일 파일 내 시트 추가(복사) 방식 ---
async function buildBatchExportExcel({ db, appDataPath, templateInfo, manifest }) {
  if (!manifest.pages.length) {
    throw new Error('선택한 기간에 데이터가 없습니다.');
  }

  // 시스템 임시 폴더 사용
  const tempDir = os.tmpdir();
  const baseFileName = path.parse(templateInfo.fileName).name;
  const dateSuffix = manifest.startDate === manifest.endDate ? manifest.startDate : `${manifest.startDate}_${manifest.endDate}`;
  const clearFileName = `${baseFileName}-${dateSuffix}-${Date.now()}.xlsx`;
  const outputPath = path.join(tempDir, clearFileName);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templateInfo.absolutePath);
  
  const templateSheet = workbook.worksheets[0];
  const templateSheetName = templateSheet.name;
  const namedCells = parseNamedCellEntries(workbook);

  // [Phase 1]: 날짜별 시트 생성. 일일업무일지는 날짜당 1시트를 기준으로 한다.
  const mappingTasks = [];

  for (let i = 0; i < manifest.pages.length; i++) {
    const page = manifest.pages[i];
    const pageDate = page.date || '날짜미상';
    const sheetName = pageDate;
    
    // 2. 템플릿 기반으로 시트 생성 (첫 번째 페이지는 기존 템플릿 시트 이름 변경, 나머지는 복사)
    let currentSheet;
    if (i === 0) {
      currentSheet = templateSheet;
      currentSheet.name = sheetName;
    } else {
      currentSheet = cloneSheet(workbook, templateSheet, sheetName);
    }
    
    // 3. 차후 바인딩을 위해 작업 저장
    mappingTasks.push({
      sheet: currentSheet,
      page: page
    });
  }

  // [Phase 2]: 준비된 빈 시트에 일괄 데이터 바인딩
  for (let j = 0; j < mappingTasks.length; j++) {
    const task = mappingTasks[j];
    const currentSheet = task.sheet;
    const page = task.page;

    // 데이터 바인딩
    const bindings = buildBindingsForDate(db, page.date);
    for (const namedCell of namedCells) {
      if (namedCell.cell.sheetName !== templateSheetName) continue;

      const normalizedName = namedCell.normalizedName;
      const originalName = namedCell.name;

      let value;
      if (Object.prototype.hasOwnProperty.call(bindings, normalizedName)) {
        value = bindings[normalizedName];
      } else if (Object.prototype.hasOwnProperty.call(bindings, originalName)) {
        value = bindings[originalName];
      } else {
        continue;
      }

      setCellValue(currentSheet, namedCell.cell.address, value);
    }
  }

  await workbook.xlsx.writeFile(outputPath);
  return [outputPath];
}

function getActiveDates(db, startDate, endDate) {
  const query = `
    SELECT DISTINCT date FROM (
      SELECT date FROM flow_readings WHERE date BETWEEN ? AND ?
      UNION
      SELECT date FROM medicine_logs WHERE date BETWEEN ? AND ?
      UNION
      SELECT date FROM kit_logs WHERE date BETWEEN ? AND ?
    )
    ORDER BY date ASC
  `;
  const rows = db.prepare(query).all(startDate, endDate, startDate, endDate, startDate, endDate);
  return rows.map(r => r.date);
}

module.exports = {
  buildBatchExportExcel,
  buildBatchPreviewPdf,
  buildPreviewManifest,
  buildPageRenderData,
  buildPagePreviewPdf,
  buildBindingsForDate,
  findPageInManifest,
  normalizeDateRange,
  parsePageKey,
  getActiveDates,
};
