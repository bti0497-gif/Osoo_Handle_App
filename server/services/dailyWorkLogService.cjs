const crypto = require('crypto');
const ExcelJS = require('exceljs');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

const { convertExcelToPdf } = require('./excelPdfService.cjs');

const PREVIEW_RENDER_VERSION = '2026-06-18-daily-log-cumulative-and-aliases-v2';
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
    throw new Error('시작일은 종료일보다 클 수 없습니다.');
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

function getFlowReadings(db, date, scope = resolveSiteScope(db)) {
  const filter = siteWhere(scope);
  return db.prepare(`SELECT * FROM flow_readings WHERE date = ?${filter.clause}`).all(date, ...filter.params);
}

function getFlowReadingsForPrevDate(db, date, scope = resolveSiteScope(db)) {
  const prevDate = getPreviousDate(date);
  return getFlowReadings(db, prevDate, scope);
}

function getMedicineLogs(db, date, scope = resolveSiteScope(db)) {
  const filter = siteWhere(scope);
  return db.prepare(`SELECT * FROM medicine_logs WHERE date = ?${filter.clause}`).all(date, ...filter.params);
}

function getKitLogs(db, date, scope = resolveSiteScope(db)) {
  const filter = siteWhere(scope);
  return db.prepare(`SELECT * FROM kit_logs WHERE date = ?${filter.clause}`).all(date, ...filter.params);
}

function getOperationStatusLog(db, date, scope = resolveSiteScope(db)) {
  const filter = siteWhere(scope);
  return db.prepare(`
    SELECT *
    FROM operation_status_logs
    WHERE date = ?${filter.clause}
    ORDER BY last_modified DESC, id DESC
    LIMIT 1
  `).get(date, ...filter.params) || null;
}

function getCertificateWaterQualityRows(db, date, scope = resolveSiteScope(db), limit = 2) {
  const normalizedDate = normalizeDate(date);
  if (!normalizedDate) return [];

  const where = ['report_date <= ?'];
  const params = [normalizedDate];
  if (scope?.siteName) {
    // 성적서 water_quality는 전국 현장 자료를 캐시할 수 있으므로 현장명 매칭을 우선한다.
    // 과거 백필/레거시 데이터의 site_id가 현재 앱 site_id로 채워진 경우가 있어 OR 조건으로 묶으면 오매칭된다.
    where.push('(REPLACE(COALESCE(site_name, \'\'), \' \', \'\') = REPLACE(?, \' \', \'\') OR REPLACE(COALESCE(site_name_raw, \'\'), \' \', \'\') = REPLACE(?, \' \', \'\'))');
    params.push(scope.siteName, scope.siteName);
  } else if (scope?.siteId) {
    where.push('site_id = ?');
    params.push(scope.siteId);
  }

  const requestedLimit = Math.max(1, Number(limit) || 1);
  params.push(Math.max(requestedLimit * 5, 10));
  const rows = db.prepare(`
    SELECT report_date, bod, ss, tn, tp, total_coliform, mlss, drive_file_name, source_pdf_name, last_modified, id
    FROM water_quality
    WHERE ${where.join(' AND ')}
    ORDER BY report_date DESC, COALESCE(last_modified, created_at, '') DESC, id DESC
    LIMIT ?
  `).all(...params);

  const seen = new Set();
  const deduped = [];
  for (const row of rows) {
    const key = [
      row.report_date,
      row.bod,
      row.ss,
      row.tn,
      row.tp,
      row.total_coliform,
      row.mlss,
      row.drive_file_name,
      row.source_pdf_name,
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
    if (deduped.length >= requestedLimit) break;
  }

  return deduped;
}

function getSiteSettings(db) {
  return db.prepare('SELECT site_id, site_name, manager_name, method, series, flow_option FROM app_settings WHERE id = 1').get() || {};
}

function resolveSiteScope(db, overrides = {}) {
  const settings = getSiteSettings(db);
  const requestedSiteId = String(overrides.siteId || overrides.site_id || '').trim();
  const scopedSettings = requestedSiteId ? db.prepare(`
    SELECT s.id AS site_id, s.site_name, s.manager_name, s.method, s.series, ss.flow_option
    FROM sites s LEFT JOIN site_settings ss ON ss.site_id = s.id
    WHERE s.id = ?
  `).get(requestedSiteId) || {} : settings;
  return {
    siteId: String(requestedSiteId || scopedSettings.site_id || '').trim(),
    siteName: String(overrides.siteName || overrides.site_name || scopedSettings.site_name || '').trim(),
    author: String(overrides.author || scopedSettings.manager_name || '').trim(),
    settings: scopedSettings,
  };
}

function siteWhere(scope) {
  if (scope?.siteId) return { clause: ' AND site_id = ?', params: [scope.siteId] };
  if (scope?.siteName) return { clause: ' AND site_name = ?', params: [scope.siteName] };
  return { clause: '', params: [] };
}

/** flow_option이 비어 있으면: 2계열 → combined(1+2), 그 외 → single1 */
function resolveFlowOption(settings) {
  const raw = settings.flow_option != null ? String(settings.flow_option).trim() : '';
  if (raw) return raw;
  const series = String(settings.series || '').trim();
  if (series === '2계열') return 'combined';
  return 'single1';
}

function getActiveConfigItems(db, category, scope = resolveSiteScope(db)) {
  if (scope?.siteId) {
    return db.prepare("SELECT * FROM site_config_items WHERE site_id = ? AND category = ? AND is_active = 1 ORDER BY display_order ASC")
      .all(scope.siteId, category);
  }
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
function sumFlowField(db, type, field, startDate, endDate, scope = resolveSiteScope(db)) {
  const filter = siteWhere(scope);
  const row = db.prepare(
    `SELECT SUM(${field}) as total FROM flow_readings WHERE type = ? AND date BETWEEN ? AND ?${filter.clause}`
  ).get(type, startDate, endDate, ...filter.params);
  return row?.total ?? '';
}

function nonNegativeFlowField(field) {
  return `CASE WHEN (${field}) >= 0 THEN (${field}) ELSE 0 END`;
}

function sumMedicineField(db, name, field, startDate, endDate, scope = resolveSiteScope(db)) {
  const filter = siteWhere(scope);
  const row = db.prepare(
    `SELECT SUM(${field}) as total FROM medicine_logs WHERE medicine_name = ? AND date BETWEEN ? AND ?${filter.clause}`
  ).get(name, startDate, endDate, ...filter.params);
  return row?.total ?? '';
}

function sumKitField(db, name, field, startDate, endDate, scope = resolveSiteScope(db)) {
  const filter = siteWhere(scope);
  const row = db.prepare(
    `SELECT SUM(${field}) as total FROM kit_logs WHERE kit_name = ? AND date BETWEEN ? AND ?${filter.clause}`
  ).get(name, startDate, endDate, ...filter.params);
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

/**
 * flowOption에 따라 내부/외부 반송 유량값을 결정하는 헬퍼
 * @param {Array} flows - 해당 날짜의 flow_readings 목록
 * @param {string} keyword - '내부반송' 또는 '외부반송'
 * @param {string} flowOption - 'single1' | 'single2' | 'combined'
 * @returns {{ raw_value, calculated_flow }} 아니면 null
 */
function getFlowByOption(flows, keyword, flowOption) {
  // 1계열 현장이면 기존 방식 그대로
  if (!flowOption || flowOption === 'single1') {
    // 1계열: '내부반송유량값' 또는 '외부반송유량값' 형태
    return flows.find(f => {
      const t = String(f.type || '').trim();
      return t.includes(keyword) && !t.endsWith('2');
    }) || findFlowByKeyword(flows, keyword);
  }

  if (flowOption === 'single2') {
    // 2계열만 '내부반송유량값2' 형태
    return flows.find(f => {
      const t = String(f.type || '').trim();
      return t.includes(keyword) && t.endsWith('2');
    }) || null;
  }

  if (flowOption === 'combined') {
    // 1+2계열 합산
    const series1 = flows.find(f => {
      const t = String(f.type || '').trim();
      return t.includes(keyword) && !t.endsWith('2');
    });
    const series2 = flows.find(f => {
      const t = String(f.type || '').trim();
      return t.includes(keyword) && t.endsWith('2');
    });

    if (!series1 && !series2) return null;
    if (!series2) return series1;
    if (!series1) return series2;

    // 두 계열 합산
    const rawVal1 = parseFloat(series1.raw_value) || 0;
    const rawVal2 = parseFloat(series2.raw_value) || 0;
    const calcFlow1 = parseFloat(series1.calculated_flow) || 0;
    const calcFlow2 = parseFloat(series2.calculated_flow) || 0;

    return {
      ...series1,
      raw_value: rawVal1 + rawVal2,
      calculated_flow: calcFlow1 + calcFlow2
    };
  }

  // fallback
  return findFlowByKeyword(flows, keyword);
}

/**
 * flowOption에 따라 내부/외부 반송 기간 합계를 구하는 헬퍼
 */
function sumFlowFieldByOption(db, keyword, field, startDate, endDate, flowOption, scope = resolveSiteScope(db)) {
  const filter = siteWhere(scope);
  if (!flowOption || flowOption === 'single1') {
    // 1계열: type이 keyword를 포함하고 '2'로 끝나지 않는 것
    const row = db.prepare(
      `SELECT SUM(${field}) as total FROM flow_readings WHERE type LIKE ? AND type NOT LIKE '%2' AND date BETWEEN ? AND ?${filter.clause}`
    ).get(`%${keyword}%`, startDate, endDate, ...filter.params);
    return row?.total ?? '';
  }

  if (flowOption === 'single2') {
    // 2계열만: type이 keyword를 포함하고 '2'로 끝나는 것
    const row = db.prepare(
      `SELECT SUM(${field}) as total FROM flow_readings WHERE type LIKE ? AND type LIKE '%2' AND date BETWEEN ? AND ?${filter.clause}`
    ).get(`%${keyword}%`, startDate, endDate, ...filter.params);
    return row?.total ?? '';
  }

  if (flowOption === 'combined') {
    // 1+2계열 합산: keyword를 포함하는 모든 type의 합
    const row = db.prepare(
      `SELECT SUM(${field}) as total FROM flow_readings WHERE type LIKE ? AND date BETWEEN ? AND ?${filter.clause}`
    ).get(`%${keyword}%`, startDate, endDate, ...filter.params);
    return row?.total ?? '';
  }

  // fallback
  const row = db.prepare(
    `SELECT SUM(${field}) as total FROM flow_readings WHERE type LIKE ? AND date BETWEEN ? AND ?${filter.clause}`
  ).get(`%${keyword}%`, startDate, endDate, ...filter.params);
  return row?.total ?? '';
}

function findMedicineByKeyword(medicines, keyword) {
  return medicines.find(m => {
    const n = String(m.medicine_name || '').trim();
    return n.includes(keyword);
  });
}

function findKitByKeyword(logs, keyword) {
  if (!logs || !keyword) return null;
  const kw = String(keyword).replace(/\s+/g, '').toUpperCase();
  return logs.find(k => {
    const n = String(k.kit_name || '').replace(/\s+/g, '').toUpperCase();
    return n === kw || n.includes(kw) || kw.includes(n);
  });
}

function findFlowTypeNameByKeyword(db, keyword, scope) {
  const items = getActiveConfigItems(db, 'flow', scope);
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

function getActiveBaseFlowNames(db, scope) {
  return getActiveConfigItems(db, 'flow', scope)
    .map((item) => String(item.item_name || '').replace(/_(flow|raw)$/i, '').trim())
    .filter((name, index, names) => name && names.indexOf(name) === index);
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

function setBindingAliases(bindings, names, value) {
  for (const name of names) {
    bindings[name] = value ?? '';
  }
}

function bindCertificateWaterQuality(bindings, rows) {
  const orderedRows = Array.isArray(rows) ? rows.slice(0, 2) : [];
  for (let i = 0; i < 2; i += 1) {
    const suffix = String(i + 1);
    const row = orderedRows[i] || {};

    setBindingAliases(bindings, [`수질날짜${suffix}`, `시료채취일${suffix}`], row.report_date || '');
    setBindingAliases(bindings, [`수질ph${suffix}`, `PH${suffix}`, `ph${suffix}`], '');
    setBindingAliases(bindings, [`수질bod${suffix}`, `BOD${suffix}`, `bod${suffix}`], row.bod ?? '');
    setBindingAliases(bindings, [`수질cod${suffix}`, `COD${suffix}`, `cod${suffix}`, `수질toc${suffix}`, `TOC${suffix}`, `toc${suffix}`], '');
    setBindingAliases(bindings, [`수질ss${suffix}`, `SS${suffix}`, `ss${suffix}`], row.ss ?? '');
    setBindingAliases(bindings, [`수질tn${suffix}`, `TN${suffix}`, `T-N${suffix}`, `수질T-N${suffix}`, `tn${suffix}`], row.tn ?? '');
    setBindingAliases(bindings, [`수질tp${suffix}`, `TP${suffix}`, `T-P${suffix}`, `수질T-P${suffix}`, `tp${suffix}`], row.tp ?? '');
    setBindingAliases(bindings, [`수질대장균${suffix}`, `대장균${suffix}`, `총대장균군${suffix}`, `수질총대장균군${suffix}`], row.total_coliform ?? '');
    setBindingAliases(bindings, [`수질mlss${suffix}`, `MLSS${suffix}`, `mlss${suffix}`], row.mlss ?? '');
    setBindingAliases(bindings, [`수질비고${suffix}`, `비고${suffix}`], row.drive_file_name || row.source_pdf_name || '');
  }
}

function bindOperationStatus(bindings, operationStatus, certificateWaterRows = []) {
  const status = operationStatus || {};
  const certificateWithMlss = (Array.isArray(certificateWaterRows) ? certificateWaterRows : [])
    .find((row) => row.mlss !== null && row.mlss !== undefined && row.mlss !== '');

  setBindingAliases(bindings, ['ph', 'PH', '운전ph', '운전PH'], status.ph ?? '');
  setBindingAliases(bindings, ['산소', 'DO', 'do', '운전do', '운전DO'], status.do_value ?? '');
  setBindingAliases(bindings, ['svi', 'SVI', '운전svi', '운전SVI'], status.svi ?? '');
  setBindingAliases(bindings, ['ml', 'MLSS', 'mlss', '운전mlss', '운전MLSS'], certificateWithMlss?.mlss ?? '');
}

/**
 *
 *
 * 셀 이름 매핑:
 * - 유량: 유입전일/금일/누계/월간/연간, 방류~, 내부반송~, 외부반송~, 슬러지
 * - 약품: 포도당/중탄산/팩 + 추가약품1~3 (구입/사용/재고/월간/연간)
 * - 키트: 암모니아/질산/인/알칼리 (구입/사용/재고/월간/연간)
 * - 기본: 날짜, 이름
 * - 전력: 전일전력, 금일전력, 전력사용, 전력계산
 */
function buildBindingsForDate(db, date, context = {}) {
  const scope = resolveSiteScope(db, context);
  const settings = scope.settings || getSiteSettings(db);
  const flowOption = resolveFlowOption(settings);
  const flows = getFlowReadings(db, date, scope);
  const prevFlows = getFlowReadingsForPrevDate(db, date, scope);
  const medicines = getMedicineLogs(db, date, scope);
  const kits = getKitLogs(db, date, scope);
  const operationStatus = getOperationStatusLog(db, date, scope);
  const certificateWaterRows = getCertificateWaterQualityRows(db, date, scope, 2);

  const monthStart = getMonthStartDate(date);
  const yearStart = getYearStartDate(date);

  const bindings = {};

  // 제목은 양식 파일 원본 값을 유지한다 (현장마다 다른 제목 사용)
  // bindings['제목'] = '일 일 업 무 일 지';
  bindings['날짜'] = date;
  bindings['이름'] = scope.author || settings.manager_name || '';

  // --- 유량 데이터 ---
  // 파샬플롬 유량계가 있는 현장:
  //   파샬플롬 = 전체 유입량, 유입유량계 = 공정 유입량
  // 파샬플롬이 없는 현장:
  //   유입유량계 = 전체 유입량, 공정 유입량은 비움
  const activeFlowNames = getActiveBaseFlowNames(db, scope);
  const parshallType = activeFlowNames.find((name) => name.includes('파샬')) || '';
  const processInType = activeFlowNames.find((name) => name === '유입유량계')
    || activeFlowNames.find((name) => name.includes('유입')) || '';
  const hasParshall = Boolean(parshallType);
  const flowInType = hasParshall ? parshallType : (processInType || findFlowTypeNameByKeyword(db, '유입', scope));
  const flowIn = findFlowByType(flows, flowInType);
  const prevFlowIn = findFlowByType(prevFlows, flowInType);
  bindings['유입전일'] = prevFlowIn?.raw_value ?? '';
  bindings['유입금일'] = flowIn?.raw_value ?? '';
  bindings['유입누계'] = flowIn?.calculated_flow ?? '';
  bindings['월간유입'] = sumFlowField(db, flowInType, nonNegativeFlowField('calculated_flow'), monthStart, date, scope);
  bindings['연간유입'] = sumFlowField(db, flowInType, nonNegativeFlowField('calculated_flow'), yearStart, date, scope);

  const processIn = hasParshall ? findFlowByType(flows, processInType) : null;
  const prevProcessIn = hasParshall ? findFlowByType(prevFlows, processInType) : null;
  bindings['공정전일'] = prevProcessIn?.raw_value ?? '';
  bindings['공정금일'] = processIn?.raw_value ?? '';
  bindings['공정누계'] = processIn?.calculated_flow ?? '';

  // 방류유량계
  const flowOut = findFlowByKeyword(flows, '방류');
  const prevFlowOut = findFlowByKeyword(prevFlows, '방류');
  const flowOutType = findFlowTypeNameByKeyword(db, '방류', scope);
  bindings['방류전일'] = prevFlowOut?.raw_value ?? '';
  bindings['방류금일'] = flowOut?.raw_value ?? '';
  bindings['방류누계'] = flowOut?.calculated_flow ?? '';
  bindings['월간방류'] = sumFlowField(db, flowOutType, nonNegativeFlowField('calculated_flow'), monthStart, date, scope);
  bindings['연간방류'] = sumFlowField(db, flowOutType, nonNegativeFlowField('calculated_flow'), yearStart, date, scope);

  // 내부반송유량계 ── flowOption 적용
  const flowInternal = getFlowByOption(flows, '내부반송', flowOption) || getFlowByOption(flows, '내부', flowOption);
  const prevFlowInternal = getFlowByOption(prevFlows, '내부반송', flowOption) || getFlowByOption(prevFlows, '내부', flowOption);
  bindings['내부반송전일'] = prevFlowInternal?.raw_value ?? '';
  bindings['내부반송금일'] = flowInternal?.raw_value ?? '';
  bindings['내부누계'] = flowInternal?.calculated_flow ?? '';
  bindings['월간내부'] = sumFlowFieldByOption(db, '내부반송', nonNegativeFlowField('calculated_flow'), monthStart, date, flowOption, scope);
  bindings['연간내부'] = sumFlowFieldByOption(db, '내부반송', nonNegativeFlowField('calculated_flow'), yearStart, date, flowOption, scope);

  // 내부반송유량계 ── flowOption 적용
  const flowExternal = getFlowByOption(flows, '외부반송', flowOption) || getFlowByOption(flows, '외부', flowOption);
  const prevFlowExternal = getFlowByOption(prevFlows, '외부반송', flowOption) || getFlowByOption(prevFlows, '외부', flowOption);
  bindings['외부반송전일'] = prevFlowExternal?.raw_value ?? '';
  bindings['외부반송금일'] = flowExternal?.raw_value ?? '';
  bindings['외부누계'] = flowExternal?.calculated_flow ?? '';
  bindings['월간외부'] = sumFlowFieldByOption(db, '외부반송', nonNegativeFlowField('calculated_flow'), monthStart, date, flowOption, scope);
  bindings['연간외부'] = sumFlowFieldByOption(db, '외부반송', nonNegativeFlowField('calculated_flow'), yearStart, date, flowOption, scope);

  // 슬러지 처리량은 총 누계(calculated_flow)가 아니라 반출량(sludge_export) 기준이다.
  // 반출이 없는 날이 많으므로 값이 없으면 빈 칸으로 유지하고, 월간/연간도 반출량만 누적한다.
  const flowSludge = findFlowByKeyword(flows, '슬러지');
  const sludgeType = findFlowTypeNameByKeyword(db, '슬러지', scope);
  bindings['슬러지'] = flowSludge?.sludge_export ?? flowSludge?.raw_value ?? '';
  bindings['월간슬러지'] = sumFlowField(db, sludgeType, 'COALESCE(sludge_export, raw_value)', monthStart, date, scope);
  bindings['연간슬러지'] = sumFlowField(db, sludgeType, 'COALESCE(sludge_export, raw_value)', yearStart, date, scope);

  // --- 약품 데이터 ---
  let allMedicineItems = getActiveConfigItems(db, 'medicine', scope);
  
  // 과거 매핑 찌꺼기(DB 칼럼명 형태) 제외
  allMedicineItems = allMedicineItems.filter(item => {
    const name = item.item_name || '';
    return !name.includes('_purchase') && !name.includes('_usage') && !name.includes('_inventory');
  });

  allMedicineItems.forEach((item, idx) => {
    const medName = item.item_name;
    const medNameNoSpace = medName.replace(/\s+/g, '');
    let medLog = findMedicineByKeyword(medicines, medName);
    
    // PAC 특수 처리
    if (medNameNoSpace.includes('팩') || medNameNoSpace.toUpperCase().includes('PAC')) {
      medLog = findMedicineByKeyword(medicines, '팩') || findMedicineByKeyword(medicines, 'PAC') || medLog;
    }

    const filter = siteWhere(scope);
    const purchase = medLog?.purchase_amount ?? '';
    const usage = medLog?.usage_amount ?? '';
    const inventory = medLog?.current_inventory ?? '';
    const mTotal = db.prepare(`SELECT SUM(usage_amount) as total FROM medicine_logs WHERE medicine_name = ? AND date >= ? AND date <= ?${filter.clause}`).get(medName, monthStart, date, ...filter.params)?.total || 0;
    const yTotal = db.prepare(`SELECT SUM(usage_amount) as total FROM medicine_logs WHERE medicine_name = ? AND date >= ? AND date <= ?${filter.clause}`).get(medName, yearStart, date, ...filter.params)?.total || 0;

    // 기본 이름들
    const baseNames = [medNameNoSpace];
    if (medNameNoSpace.includes('포도')) baseNames.push('포도당');
    if (medNameNoSpace.includes('중탄')) baseNames.push('중탄', '중탄산', '중탄산나트륨');
    if (medNameNoSpace.includes('팩') || medNameNoSpace.toUpperCase().includes('PAC')) baseNames.push('팩', 'PAC', '팩(PAC)', 'PAC약품');

    // 확장 약품 별칭 매핑
    if (medNameNoSpace.includes('알루미늄') || medNameNoSpace.includes('알미늄')) {
      baseNames.push('알루미늄', '알루미늄설페이트', '알미늄', '알미늄나트륨');
    }
    if (medNameNoSpace.includes('차염') || medNameNoSpace.includes('차아염소')) {
      baseNames.push('차염', '차염소산', '차염소산나트륨', '차아염소', '차아염소나트륨');
    }
    if (medNameNoSpace.includes('인산트') || medNameNoSpace.includes('인산')) {
      baseNames.push('인산트', '인산');
    }
    if (medNameNoSpace.includes('폴리머') || medNameNoSpace.toUpperCase().includes('POLYMER')) {
      baseNames.push('폴리머', 'Polymer', 'POLYMER');
    }

    // 기본 이름들
    const uniqueBaseNames = [...new Set(baseNames)];

    uniqueBaseNames.forEach(bName => {
      bindings[`${bName}구입`] = purchase;
      bindings[`${bName}사용`] = usage;
      bindings[`${bName}재고`] = inventory;
      bindings[`${bName}잔량`] = inventory;
      bindings[`월간${bName}`] = mTotal;
      bindings[`연간${bName}`] = yTotal;
      bindings[`${bName}월간`] = mTotal;
      bindings[`${bName}월간누계`] = mTotal;
      bindings[`${bName}연간`] = yTotal;
      bindings[`${bName}연간누계`] = yTotal;
      bindings[`${bName}_purchase`] = purchase;
      bindings[`${bName}_usage`] = usage;
      bindings[`${bName}_inventory`] = inventory;
    });

    // 추가약품 호환용 (첫 3개 기본약품 제외한 나머지)
    // 송도(1), 중태(2), 대(3) 제외
    if (idx >= 3) {
       const extraIdx = idx - 2;
    // 중복 제거
       bindings[`추가약품명${extraIdx}`] = medName;
       bindings[`추가약품${extraIdx}구입`] = purchase;
       bindings[`추가약품${extraIdx}사용`] = usage;
       bindings[`추가약품${extraIdx}재고`] = inventory;
       bindings[`월간추가약품${extraIdx}`] = mTotal;
       bindings[`연간추가약품${extraIdx}`] = yTotal;
    }
  });

  // --- 키트 데이터 ---
  let allKitItems = getActiveConfigItems(db, 'kit', scope);
  allKitItems = allKitItems.filter(item => {
    const name = item.item_name || '';
    return !name.includes('_purchase') && !name.includes('_usage') && !name.includes('_inventory');
  });

  const kitFilter = siteWhere(scope);

  allKitItems.forEach((item) => {
    const kitName = item.item_name;
    const kitNameNoSpace = kitName.replace(/\s+/g, '');
    const kitLog = findKitByKeyword(kits, kitName);

    const purchase = kitLog?.purchase_amount ?? '';
    const usage = kitLog?.usage_amount ?? '';
    const inventory = kitLog?.current_inventory ?? '';
    const mTotal = db.prepare(`SELECT SUM(usage_amount) as total FROM kit_logs WHERE kit_name = ? AND date >= ? AND date <= ?${kitFilter.clause}`).get(kitName, monthStart, date, ...kitFilter.params)?.total || 0;
    const yTotal = db.prepare(`SELECT SUM(usage_amount) as total FROM kit_logs WHERE kit_name = ? AND date >= ? AND date <= ?${kitFilter.clause}`).get(kitName, yearStart, date, ...kitFilter.params)?.total || 0;

    const baseNames = [kitNameNoSpace];
    if (kitNameNoSpace.includes('암모니아') || kitNameNoSpace.toUpperCase().includes('NH3')) {
      baseNames.push('암모니아', 'NH3', 'NH3-N', 'NH3_N');
    }
    if (kitNameNoSpace.includes('질산') || kitNameNoSpace.toUpperCase().includes('NO3')) {
      baseNames.push('질산', 'NO3', 'NO3-N', 'NO3_N');
    }
    if (kitNameNoSpace.includes('인산') || kitNameNoSpace.includes('오르토인산염') || kitNameNoSpace.toUpperCase().includes('PO4')) {
      baseNames.push('인', '인산', 'PO4', 'PO4-P', 'PO4_P');
    }
    if (kitNameNoSpace.includes('알칼리') || kitNameNoSpace.toUpperCase().includes('ALK')) {
      baseNames.push('알칼리', '알칼리도', 'ALK');
    }

    // 중복 제거
    const uniqueKitBaseNames = [...new Set(baseNames)];

    uniqueKitBaseNames.forEach(bName => {
      bindings[`${bName}구입`] = purchase;
      bindings[`${bName}사용`] = usage;
      bindings[`${bName}재고`] = inventory;
      bindings[`${bName}잔량`] = inventory;
      bindings[`${bName}`] = inventory;
      bindings[`${bName}_inventory`] = inventory;
      bindings[`${bName}_usage`] = usage;
      bindings[`${bName}_purchase`] = purchase;
      bindings[`월간${bName}`] = mTotal;
      bindings[`연간${bName}`] = yTotal;
      bindings[`${bName}월간`] = mTotal;
      bindings[`${bName}월간누계`] = mTotal;
      bindings[`${bName}연간`] = yTotal;
      bindings[`${bName}연간누계`] = yTotal;
    });
  });

  // --- 전력 (flow_readings에서 '전력' 타입) ---
  const flowPower = findFlowByKeyword(flows, '전력');
  const prevFlowPower = findFlowByKeyword(prevFlows, '전력');
  bindings['전일전력'] = prevFlowPower?.raw_value ?? '';
  bindings['금일전력'] = flowPower?.raw_value ?? '';
  const powerReadingUnit = flowPower?.reading_unit || prevFlowPower?.reading_unit || '';
  bindings['전일전력입력단위'] = prevFlowPower?.reading_unit || powerReadingUnit;
  bindings['금일전력입력단위'] = flowPower?.reading_unit || powerReadingUnit;
  bindings['전력사용'] = flowPower?.calculated_flow ?? '';
  bindings['전력사용량'] = flowPower?.calculated_flow ?? '';
  
  // kw당 사용량= (금일 전력사용량 / (금일 방류량 처리량
  let kwPerM3 = '';
  const parsedPowerFlow = parseFloat(flowPower?.calculated_flow);
  const parsedOutFlow = parseFloat(flowOut?.calculated_flow); // 방류처리량(calculated_flow) 사용
  if (!isNaN(parsedPowerFlow) && !isNaN(parsedOutFlow) && parsedOutFlow > 0) {
    // Excel 후속 수식에서 텍스트가 아닌 숫자로 인식되도록
    // toFixed() 문자열 대신 소수점 세 자리 반올림 숫자를 바인딩한다.
    kwPerM3 = Math.round((parsedPowerFlow / parsedOutFlow) * 1000) / 1000;
  }
  setBindingAliases(bindings, [
    'kw당사용량',
    '전력효율',
    '1m3당사용량',
    '1제곱미터당사용량',
    '전력계산',
  ], kwPerM3);

  // 전력계산(방류량 전력량 계산값 바인딩
  bindings['전력효율'] = kwPerM3;

  // --- 성적서 수질 측정 ---
  // 큐앤테크 수질분석(qntech_water_quality)이 아니라 성적서 파싱값(water_quality)을 사용한다.
  bindCertificateWaterQuality(bindings, certificateWaterRows);

  // --- 기타 (수동 입력) ---
  bindings['수온'] = '';
  bindOperationStatus(bindings, operationStatus, certificateWaterRows);
  // 엑셀 이름 관리자의 영문 대소문자 명명(PAC vs pac, NH3-N vs NH3_N 등) 차이를
      // 파일이 이미 삭제되었거나 접근 불가한 경우 무시
  const normalizedBindings = { ...bindings };
  for (const [key, val] of Object.entries(bindings)) {
    if (key) {
      normalizedBindings[normalizeKey(key)] = val;
    }
  }

  return normalizedBindings;
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

function buildPageRenderData(db, page, context = {}) {
  const bindings = buildBindingsForDate(db, page.date, context);

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
      // 바인딩용에 없는 것은 건드리지 않음 (사용자 수동 입력
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

function buildContentSignature(db, date, context = {}) {
  const scope = resolveSiteScope(db, context);
  const flows = getFlowReadings(db, date, scope);
  const medicines = getMedicineLogs(db, date, scope);
  const kits = getKitLogs(db, date, scope);
  const operationStatus = getOperationStatusLog(db, date, scope);
  const certificateWaterRows = getCertificateWaterQualityRows(db, date, scope, 2);

  return hashParts([
    PREVIEW_RENDER_VERSION,
    date,
    flows.map((r) => [r.type, r.raw_value, r.calculated_flow, r.reading_unit, r.sludge_export, r.last_modified].join(':')).join('|'),
    medicines.map((r) => [r.medicine_name, r.purchase_amount, r.usage_amount, r.current_inventory, r.last_modified].join(':')).join('|'),
    kits.map((r) => [r.kit_name, r.purchase_amount, r.usage_amount, r.current_inventory, r.last_modified].join(':')).join('|'),
    operationStatus ? [operationStatus.ph, operationStatus.do_value, operationStatus.svi, operationStatus.last_modified].join(':') : '',
    certificateWaterRows.map((r) => [r.report_date, r.bod, r.ss, r.tn, r.tp, r.total_coliform, r.mlss, r.last_modified].join(':')).join('|'),
  ]);
}

async function buildPagePreviewPdf({ db, appDataPath, templateInfo, page, context = {} }) {
  const contentSignature = buildContentSignature(db, page.date, context);
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

    const bindings = buildBindingsForDate(db, page.date, context);
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

async function buildBatchPreviewPdf({ db, appDataPath, templateInfo, manifest, context = {} }) {
  if (!manifest.pages.length) {
    throw new Error('선택한 기간에 데이터가 없습니다.');
  }

  const pageResults = [];
  for (const page of manifest.pages) {
    const pageResult = await buildPagePreviewPdf({ db, appDataPath, templateInfo, page, context });
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

  if (!fs.existsSync(outputPath)) {
    await mergePdfFiles(pageResults.map((result) => result.pdfPath), outputPath);
  }

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
  // <c r="F5" ...>...</c> ?먮뒗 <c r="F5" .../>
  const cellRegex = new RegExp(
    `(<c\\s[^>]*r="${address}"[^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/c>)`,
    'i'
  );
  const cellMatch = cellRegex.exec(sheetXml);

  if (cellMatch) {
  // 기존 셀을 찾아서 교체
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

  // 기존 셀을 찾아서 교체
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

async function buildBatchExportExcel({ db, appDataPath, templateInfo, manifest, context = {} }) {
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

  // ?먮낯 ?쒗듃 XML ?쎄린
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

      // normalize path: ../drawings/drawing1.xml ??xl/drawings/drawing1.xml
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
    const bindings = buildBindingsForDate(db, page.date, context);

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

  // 각 날짜에 대해 시트를 복제하고 바인딩 적용
      wbXml = wbXml.replace(
        new RegExp(`name="${escapedOrigName}"`),
        `name="${pageDate}"`
      );
  // 원본 시트의 인쇄 영역 definedName 항목 추출을 위한 준비
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

      // 인쇄영역 definedName을 새 시트에도 적용
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

function getActiveDates(db, startDate, endDate, context = {}) {
  const scope = resolveSiteScope(db, context);
  const filter = siteWhere(scope);
  const query = `
    SELECT DISTINCT date FROM (
      SELECT date FROM flow_readings WHERE date BETWEEN ? AND ?${filter.clause}
      UNION
      SELECT date FROM medicine_logs WHERE date BETWEEN ? AND ?${filter.clause}
      UNION
      SELECT date FROM kit_logs WHERE date BETWEEN ? AND ?${filter.clause}
      UNION
      SELECT date FROM operation_status_logs WHERE date BETWEEN ? AND ?${filter.clause}
    )
    ORDER BY date ASC
  `;
  const rows = db.prepare(query).all(
    startDate, endDate, ...filter.params,
    startDate, endDate, ...filter.params,
    startDate, endDate, ...filter.params,
    startDate, endDate, ...filter.params
  );
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
