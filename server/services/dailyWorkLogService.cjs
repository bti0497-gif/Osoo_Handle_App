const crypto = require('crypto');
const ExcelJS = require('exceljs');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

const { convertExcelToPdf } = require('./excelPdfService.cjs');

const PREVIEW_RENDER_VERSION = '2026-03-16-daily-work-log-flow-aggregate-v5';
const EXPORT_TEMP_RETENTION_MS = 24 * 60 * 60 * 1000;

const pendingPreviewJobs = new Map();

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

function getExportTempDirectory() {
  return ensureDirectory(path.join(os.tmpdir(), 'osoo-handle-app', 'daily-work-log-exports'));
}

function cleanupOldExportTempFiles() {
  const targetDir = getExportTempDirectory();
  const now = Date.now();

  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const fullPath = path.join(targetDir, entry.name);
    try {
      const stat = fs.statSync(fullPath);
      if ((now - stat.mtimeMs) > EXPORT_TEMP_RETENTION_MS) {
        fs.unlinkSync(fullPath);
      }
    } catch (_) {
      // 파일이 이미 삭제되었거나 접근 불가한 경우 무시
    }
  }
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

  // 제목은 양식 파일 원본 값을 유지한다 (현장마다 다른 제목 사용)
  // bindings['제목'] = '일 일 업 무 일 지';
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

// --- 엑셀 내보내기: JSZip 기반 (도형/이미지/카메라 보존) ---

/**
 * xlsx 파일을 zip으로 열어, definedNames에서 셀 이름 ↔ 셀 주소 매핑을 추출한다.
 * ExcelJS는 사용하지 않고, workbook.xml의 XML을 직접 파싱한다.
 */
function parseDefinedNamesFromXml(workbookXml) {
  const names = [];
  // <definedName name="..." ...>RANGE</definedName> 패턴 매칭
  const regex = /<definedName\s+name="([^"]+)"[^>]*>([^<]+)<\/definedName>/g;
  let match;
  while ((match = regex.exec(workbookXml)) !== null) {
    const name = match[1];
    const range = match[2];
    const cellRef = parseCellReference(range);
    if (cellRef) {
      names.push({ name, normalizedName: normalizeKey(name), cell: cellRef });
    }
  }
  return names;
}

/**
 * workbook.xml에서 시트 이름 → rId 매핑을, workbook.xml.rels에서 rId → 파일명 매핑을 추출하여
 * 시트 이름 → 실제 zip 경로를 반환한다.
 */
function resolveSheetPaths(workbookXml, relsXml) {
  const sheetMap = {};
  // <sheet name="..." sheetId="..." r:id="..."/>
  const sheetRegex = /<sheet\s+name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/?>/g;
  let m;
  while ((m = sheetRegex.exec(workbookXml)) !== null) {
    sheetMap[m[1]] = m[2]; // name → rId
  }

  const relMap = {};
  // <Relationship Id="..." ... Target="..."/>
  const relRegex = /<Relationship\s[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*/g;
  while ((m = relRegex.exec(relsXml)) !== null) {
    relMap[m[1]] = m[2]; // rId → target path
  }

  const result = {};
  for (const [sheetName, rId] of Object.entries(sheetMap)) {
    const target = relMap[rId];
    if (target) {
      // target은 "worksheets/sheet1.xml" 형태, zip 경로는 "xl/worksheets/sheet1.xml"
      result[sheetName] = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    }
  }
  return result;
}

/**
 * 셀 주소(예: "F5")를 열 번호(1-based)로 변환한다.
 */
function colLetterToNumber(letters) {
  let n = 0;
  for (const ch of letters) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n;
}

/**
 * 열 번호(1-based)를 셀 주소 문자열(예: "AF")로 변환한다.
 */
function colNumberToLetter(num) {
  let result = '';
  while (num > 0) {
    const remainder = (num - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    num = Math.floor((num - 1) / 26);
  }
  return result;
}

/**
 * 시트 XML 내에서 특정 셀의 값을 교체한다.
 * 기존 셀 태그의 <v>...</v> 값을 새 값으로 교체하거나,
 * 셀이 없으면 해당 행에 새 셀을 삽입한다.
 *
 * 숫자 값은 <v>로, 문자열은 inlineStr 방식의 <is><t>로 저장한다.
 */
function setCellInSheetXml(sheetXml, address, value) {
  const colMatch = address.match(/^([A-Z]+)(\d+)$/);
  if (!colMatch) return sheetXml;
  const colLetters = colMatch[1];
  const rowNum = colMatch[2];

  const strValue = value === undefined || value === null ? '' : String(value);
  const isNum = strValue !== '' && !isNaN(Number(strValue)) && isFinite(Number(strValue));

  // 기존 셀을 찾아서 교체
  // <c r="F5" ...>...</c> 또는 <c r="F5" .../>
  const cellRegex = new RegExp(
    `(<c\\s[^>]*r="${address}"[^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/c>)`,
    'i'
  );
  const cellMatch = cellRegex.exec(sheetXml);

  if (cellMatch) {
    // 기존 셀이 있음 → 값 교체
    let openTag = cellMatch[1];
    if (isNum) {
      // 숫자: t 속성 제거, <v> 사용
      openTag = openTag.replace(/\s+t="[^"]*"/, '');
      const replacement = `${openTag}><v>${strValue}</v></c>`;
      return sheetXml.replace(cellMatch[0], replacement);
    } else {
      // 문자열: t="inlineStr", <is><t> 사용
      openTag = openTag.replace(/\s+t="[^"]*"/, '');
      openTag = openTag.replace(/(r="[^"]+")/, `$1 t="inlineStr"`);
      const escaped = strValue.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const replacement = `${openTag}><is><t>${escaped}</t></is></c>`;
      return sheetXml.replace(cellMatch[0], replacement);
    }
  }

  // 셀이 없으면 → 해당 행에 새 셀을 삽입
  const rowRegex = new RegExp(`(<row\\s[^>]*r="${rowNum}"[^>]*?>)([\\s\\S]*?)(<\\/row>)`, 'i');
  const rowMatch = rowRegex.exec(sheetXml);
  if (rowMatch) {
    let newCell;
    if (isNum) {
      newCell = `<c r="${address}"><v>${strValue}</v></c>`;
    } else {
      const escaped = strValue.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      newCell = `<c r="${address}" t="inlineStr"><is><t>${escaped}</t></is></c>`;
    }
    const updatedRow = `${rowMatch[1]}${rowMatch[2]}${newCell}${rowMatch[3]}`;
    return sheetXml.replace(rowMatch[0], updatedRow);
  }

  return sheetXml; // 행도 없으면 변경하지 않음
}

async function buildBatchExportExcel({ db, appDataPath, templateInfo, manifest }) {
  const JSZip = require('jszip');

  if (!manifest.pages.length) {
    throw new Error('선택한 기간에 데이터가 없습니다.');
  }

  cleanupOldExportTempFiles();
  const tempDir = getExportTempDirectory();
  const baseFileName = path.parse(templateInfo.fileName).name;
  const templateBuffer = fs.readFileSync(templateInfo.absolutePath);
  const dateSuffix = manifest.startDate === manifest.endDate
    ? manifest.startDate
    : `${manifest.startDate}_${manifest.endDate}`;
  const clearFileName = `${baseFileName}-${dateSuffix}-${Date.now()}.xlsx`;
  const outputPath = path.join(tempDir, clearFileName);

  const zip = await JSZip.loadAsync(templateBuffer);
  let wbXml = await zip.file('xl/workbook.xml').async('string');
  let wbRelsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  let contentTypesXml = await zip.file('[Content_Types].xml').async('string');

  const namedCells = parseDefinedNamesFromXml(wbXml);
  const sheetPaths = resolveSheetPaths(wbXml, wbRelsXml);
  const firstSheetName = Object.keys(sheetPaths)[0];
  const firstSheetZipPath = sheetPaths[firstSheetName]; // e.g. "xl/worksheets/sheet1.xml"

  console.log(`[Daily Work Log Export] JSZip multi-sheet: ${namedCells.length} named cells, template sheet: "${firstSheetName}"`);

  // 원본 시트 관련 파일 경로 파악
  const sheetFileName = path.basename(firstSheetZipPath); // "sheet1.xml"
  const sheetBaseName = path.parse(sheetFileName).name;   // "sheet1"
  const sheetDir = path.dirname(firstSheetZipPath);       // "xl/worksheets"

  // 원본 시트 XML 읽기
  const templateSheetXml = await zip.file(firstSheetZipPath).async('string');

  // 원본 시트의 rels 파일 (도형/이미지 참조)
  const sheetRelsPath = `${sheetDir}/_rels/${sheetFileName}.rels`;
  const hasSheetRels = !!zip.file(sheetRelsPath);
  const templateSheetRels = hasSheetRels ? await zip.file(sheetRelsPath).async('string') : null;

  // 원본 시트의 drawing 파일 찾기
  let templateDrawingPath = null;
  let templateDrawingXml = null;
  let templateDrawingRelsPath = null;
  let templateDrawingRels = null;
  if (templateSheetRels) {
    const drawMatch = templateSheetRels.match(/Target="([^"]*drawing[^"]*\.xml)"/i);
    if (drawMatch) {
      const drawTarget = drawMatch[1];
      templateDrawingPath = drawTarget.startsWith('/')
        ? drawTarget.slice(1)
        : path.posix.join('xl/worksheets', drawTarget).replace(/\.\.\//g, '').replace('worksheets/drawings', 'drawings');

      // normalize path: ../drawings/drawing1.xml → xl/drawings/drawing1.xml
      if (drawTarget.startsWith('..')) {
        templateDrawingPath = path.posix.normalize(`xl/worksheets/${drawTarget}`);
      }

      if (zip.file(templateDrawingPath)) {
        templateDrawingXml = await zip.file(templateDrawingPath).async('string');
        const drawingFileName = path.basename(templateDrawingPath);
        templateDrawingRelsPath = `${path.dirname(templateDrawingPath)}/_rels/${drawingFileName}.rels`;
        if (zip.file(templateDrawingRelsPath)) {
          templateDrawingRels = await zip.file(templateDrawingRelsPath).async('string');
        }
      }
    }
  }

  // 원본 시트의 인쇄 영역 definedName 항목 추출을 위한 준비
  const escapedOrigName = firstSheetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // wbRelsXml에서 기존 최대 rId 번호 찾기
  const rIdMatches = [...wbRelsXml.matchAll(/Id="rId(\d+)"/g)];
  let maxRId = rIdMatches.reduce((max, m) => Math.max(max, parseInt(m[1])), 0);

  // wbXml에서 기존 최대 sheetId 찾기
  const sheetIdMatches = [...wbXml.matchAll(/sheetId="(\d+)"/g)];
  let maxSheetId = sheetIdMatches.reduce((max, m) => Math.max(max, parseInt(m[1])), 0);

  // [Content_Types].xml에서 기존 시트 Override 추가용 위치 찾기
  const contentTypeInsertPoint = '</Types>';

  // 각 날짜에 대해 시트를 복제하고 바인딩 적용
  for (let i = 0; i < manifest.pages.length; i++) {
    const page = manifest.pages[i];
    const pageDate = page.date || '날짜미상';
    const bindings = buildBindingsForDate(db, page.date);

    if (i === 0) {
      // === 첫 번째 시트: 원본 시트를 직접 수정 ===
      let sheetXml = templateSheetXml;
      for (const nc of namedCells) {
        if (nc.cell.sheetName !== firstSheetName) continue;
        const nName = nc.normalizedName;
        const oName = nc.name;
        let value;
        if (Object.prototype.hasOwnProperty.call(bindings, nName)) value = bindings[nName];
        else if (Object.prototype.hasOwnProperty.call(bindings, oName)) value = bindings[oName];
        else continue;
        sheetXml = setCellInSheetXml(sheetXml, nc.cell.address, value);
      }
      zip.file(firstSheetZipPath, sheetXml);

      // 시트 이름 변경
      wbXml = wbXml.replace(
        new RegExp(`name="${escapedOrigName}"`),
        `name="${pageDate}"`
      );
      // definedName 참조도 업데이트
      wbXml = wbXml.replace(new RegExp(`'${escapedOrigName}'!`, 'g'), `'${pageDate}'!`);
      wbXml = wbXml.replace(new RegExp(`${escapedOrigName}!`, 'g'), `'${pageDate}'!`);

    } else {
      // === 추가 시트: 시트 XML/도면/rels를 복사 ===
      const newSheetNum = i + 1;
      const newSheetFileName = `sheet${maxSheetId + newSheetNum}.xml`;
      const newSheetZipPath = `${sheetDir}/${newSheetFileName}`;
      const newRId = `rId${++maxRId}`;
      const newSheetId = ++maxSheetId;

      // 시트 XML 복사 및 바인딩
      let newSheetXml = templateSheetXml;
      for (const nc of namedCells) {
        if (nc.cell.sheetName !== firstSheetName) continue;
        const nName = nc.normalizedName;
        const oName = nc.name;
        let value;
        if (Object.prototype.hasOwnProperty.call(bindings, nName)) value = bindings[nName];
        else if (Object.prototype.hasOwnProperty.call(bindings, oName)) value = bindings[oName];
        else continue;
        newSheetXml = setCellInSheetXml(newSheetXml, nc.cell.address, value);
      }
      zip.file(newSheetZipPath, newSheetXml);

      // 시트 rels 복사 (도면 참조 포함)
      let newDrawingPath = null;
      if (templateSheetRels) {
        let newSheetRels = templateSheetRels;

        // drawing 파일도 복제
        if (templateDrawingPath && templateDrawingXml) {
          const drawingBaseName = path.parse(path.basename(templateDrawingPath)).name;
          const newDrawingFileName = `${drawingBaseName}_s${newSheetNum}.xml`;
          newDrawingPath = `${path.dirname(templateDrawingPath)}/${newDrawingFileName}`;

          zip.file(newDrawingPath, templateDrawingXml);

          // drawing rels도 복사 (이미지 참조)
          if (templateDrawingRels) {
            const newDrawingRelsPath = `${path.dirname(templateDrawingPath)}/_rels/${newDrawingFileName}.rels`;
            zip.file(newDrawingRelsPath, templateDrawingRels);
          }

          // 시트 rels에서 drawing 경로를 새 경로로 교체
          const oldDrawingTarget = path.basename(templateDrawingPath);
          newSheetRels = newSheetRels.replace(oldDrawingTarget, newDrawingFileName);
        }

        const newSheetRelsPath = `${sheetDir}/_rels/${newSheetFileName}.rels`;
        zip.file(newSheetRelsPath, newSheetRels);
      }

      // workbook.xml에 새 시트 등록
      const sheetInsertRegex = /(<\/sheets>)/;
      wbXml = wbXml.replace(
        sheetInsertRegex,
        `<sheet name="${pageDate}" sheetId="${newSheetId}" r:id="${newRId}"/></sheets>`
      );

      // 인쇄영역 등 definedName을 새 시트에도 적용
      // localSheetId는 시트 순서 (0-based index)
      const printAreaRegex = /<definedName\s+name="_xlnm\.Print_Area"[^>]*>([^<]+)<\/definedName>/;
      const printAreaMatch = printAreaRegex.exec(wbXml);
      if (printAreaMatch) {
        const origRange = printAreaMatch[1];
        // 첫 시트 이름으로 된 참조를 새 시트 이름으로 교체
        const newRangeRef = origRange.replace(
          new RegExp(`'[^']*'!`),
          `'${pageDate}'!`
        );
        const newDefinedName = `<definedName name="_xlnm.Print_Area" localSheetId="${i}">${newRangeRef}</definedName>`;
        wbXml = wbXml.replace('</definedNames>', `${newDefinedName}</definedNames>`);
      }

      // workbook.xml.rels에 새 관계 등록
      wbRelsXml = wbRelsXml.replace(
        '</Relationships>',
        `<Relationship Id="${newRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${newSheetFileName}"/></Relationships>`
      );

      // [Content_Types].xml에 새 시트 등록
      contentTypesXml = contentTypesXml.replace(
        contentTypeInsertPoint,
        `<Override PartName="/xl/worksheets/${newSheetFileName}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>${contentTypeInsertPoint}`
      );

      // drawing도 [Content_Types].xml에 등록
      if (newDrawingPath) {
        const drawingPartName = '/' + newDrawingPath.replace(/\\/g, '/');
        contentTypesXml = contentTypesXml.replace(
          contentTypeInsertPoint,
          `<Override PartName="${drawingPartName}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>${contentTypeInsertPoint}`
        );
      }
    }
  }

  // 수정된 메타 XML들을 zip에 반영
  zip.file('xl/workbook.xml', wbXml);
  zip.file('xl/_rels/workbook.xml.rels', wbRelsXml);
  zip.file('[Content_Types].xml', contentTypesXml);

  const outputBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(outputPath, outputBuffer);

  console.log(`[Daily Work Log Export] Generated single file with ${manifest.pages.length} sheet(s): ${path.basename(outputPath)}`);
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
