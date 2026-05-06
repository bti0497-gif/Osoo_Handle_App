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
      // ?뚯씪???대? ??젣?섏뿀嫄곕굹 ?묎렐 遺덇???寃쎌슦 臾댁떆
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
    throw new Error('?좏슚???좎쭨 踰붿쐞瑜??낅젰??二쇱꽭??');
  }

  if (normalizedStartDate > normalizedEndDate) {
    throw new Error('?쒖옉?쇱? 醫낅즺?쇰낫????쓣 ???놁뒿?덈떎.');
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
  const settings = getSiteSettings(db);
  return db.prepare('SELECT * FROM flow_readings WHERE date = ? AND site_name = ?').all(date, settings.site_name);
}

function getFlowReadingsForPrevDate(db, date) {
  const prevDate = getPreviousDate(date);
  const settings = getSiteSettings(db);
  return db.prepare('SELECT * FROM flow_readings WHERE date = ? AND site_name = ?').all(prevDate, settings.site_name);
}

function getMedicineLogs(db, date) {
  const settings = getSiteSettings(db);
  return db.prepare('SELECT * FROM medicine_logs WHERE date = ? AND site_name = ?').all(date, settings.site_name);
}

function getKitLogs(db, date) {
  const settings = getSiteSettings(db);
  return db.prepare('SELECT * FROM kit_logs WHERE date = ? AND site_name = ?').all(date, settings.site_name);
}

function getSiteSettings(db) {
  return db.prepare('SELECT site_name, manager_name, method, series, flow_option FROM app_settings WHERE id = 1').get() || {};
}

/** flow_option??鍮꾩뼱 ?덉쑝硫? 2怨꾩뿴 ??combined(1+2), 洹?????single1 */
function resolveFlowOption(settings) {
  const raw = settings.flow_option != null ? String(settings.flow_option).trim() : '';
  if (raw) return raw;
  const series = String(settings.series || '').trim();
  if (series === '2怨꾩뿴') return 'combined';
  return 'single1';
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

// 湲곌컙 ?⑷퀎 議고쉶 ?ы띁
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

/**
 * flowOption???곕씪 ?대?/?몃? 諛섏넚 ?좊웾媛믪쓣 寃곗젙?섎뒗 ?ы띁
 * @param {Array} flows - ?대떦 ?좎쭨??flow_readings 紐⑸줉
 * @param {string} keyword - '?대?諛섏넚' ?먮뒗 '?몃?諛섏넚'
 * @param {string} flowOption - 'single1' | 'single2' | 'combined'
 * @returns {{ raw_value, calculated_flow }} ?먮뒗 null
 */
function getFlowByOption(flows, keyword, flowOption) {
  // 1怨꾩뿴 ?꾩옣?대㈃ 湲곗〈 諛⑹떇 洹몃?濡?
  if (!flowOption || flowOption === 'single1') {
    // 1怨꾩뿴: '?대?諛섏넚?좊웾怨? ?먮뒗 '?대?諛섏넚?좊웾怨?' ?뺥깭
    return flows.find(f => {
      const t = String(f.type || '').trim();
      return t.includes(keyword) && !t.endsWith('2');
    }) || findFlowByKeyword(flows, keyword);
  }

  if (flowOption === 'single2') {
    // 2怨꾩뿴留? '?대?諛섏넚?좊웾怨?' ?뺥깭
    return flows.find(f => {
      const t = String(f.type || '').trim();
      return t.includes(keyword) && t.endsWith('2');
    }) || null;
  }

  if (flowOption === 'combined') {
    // 1+2怨꾩뿴 ?⑹궛
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

    // ??怨꾩뿴 ?⑹궛
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
 * flowOption???곕씪 ?대?/?몃? 諛섏넚 湲곌컙 ?⑷퀎瑜?援ы븯???ы띁
 */
function sumFlowFieldByOption(db, keyword, field, startDate, endDate, flowOption) {
  if (!flowOption || flowOption === 'single1') {
    // 1怨꾩뿴: type??keyword瑜??ы븿?섍퀬 '2'濡??앸굹吏 ?딅뒗 寃?
    const row = db.prepare(
      `SELECT SUM(${field}) as total FROM flow_readings WHERE type LIKE ? AND type NOT LIKE '%2' AND date BETWEEN ? AND ?`
    ).get(`%${keyword}%`, startDate, endDate);
    return row?.total ?? '';
  }

  if (flowOption === 'single2') {
    // 2怨꾩뿴留? type??keyword瑜??ы븿?섍퀬 '2'濡??앸굹??寃?
    const row = db.prepare(
      `SELECT SUM(${field}) as total FROM flow_readings WHERE type LIKE ? AND type LIKE '%2' AND date BETWEEN ? AND ?`
    ).get(`%${keyword}%`, startDate, endDate);
    return row?.total ?? '';
  }

  if (flowOption === 'combined') {
    // 1+2怨꾩뿴 ?⑹궛: keyword瑜??ы븿?섎뒗 紐⑤뱺 type????
    const row = db.prepare(
      `SELECT SUM(${field}) as total FROM flow_readings WHERE type LIKE ? AND date BETWEEN ? AND ?`
    ).get(`%${keyword}%`, startDate, endDate);
    return row?.total ?? '';
  }

  // fallback
  const row = db.prepare(
    `SELECT SUM(${field}) as total FROM flow_readings WHERE type LIKE ? AND date BETWEEN ? AND ?`
  ).get(`%${keyword}%`, startDate, endDate);
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
 * 吏?뺣맂 ?좎쭨??紐⑤뱺 ?곗씠?곕? ?섏쭛?섏뿬 ?쇱씪?낅Т?쇱? ? ?대쫫??留욌뒗 諛붿씤??留듭쓣 ?앹꽦?⑸땲??
 *
 * ? ?대쫫 留ㅽ븨:
 * - ?좊웾: ?좎엯?꾩씪/湲덉씪/?꾧퀎/?붽컙/?곌컙, 諛⑸쪟~, ?대?諛섏넚~, ?몃?諛섏넚~, 슬러지
 * - ?쏀뭹: ?щ룄??以묓깂????+ 異붽??쏀뭹1~3 (援ъ엯/?ъ슜/?ш퀬/?붽컙/?곌컙)
 * - ?ㅽ듃: ?붾え?덉븘/吏덉궛/???뚯뭡由?(援ъ엯/?ъ슜/?ш퀬/?붽컙/?곌컙)
 * - 湲곕낯: ?좎쭨, ?대쫫
 * - ?꾨젰: ?꾩씪?꾨젰, 湲덉씪?꾨젰, ?꾨젰?ъ슜, ?꾨젰怨꾩궛
 */
function buildBindingsForDate(db, date) {
  const settings = getSiteSettings(db);
  const flowOption = resolveFlowOption(settings);
  const flows = getFlowReadings(db, date);
  const prevFlows = getFlowReadingsForPrevDate(db, date);
  const medicines = getMedicineLogs(db, date);
  const kits = getKitLogs(db, date);

  const monthStart = getMonthStartDate(date);
  const yearStart = getYearStartDate(date);

  const bindings = {};

  // ?쒕ぉ? ?묒떇 ?뚯씪 ?먮낯 媛믪쓣 ?좎??쒕떎 (?꾩옣留덈떎 ?ㅻⅨ ?쒕ぉ ?ъ슜)
  // bindings['?쒕ぉ'] = '??????臾???吏';
  bindings['?좎쭨'] = date;
  bindings['?대쫫'] = settings.manager_name || '';

  // --- ?좊웾 ?곗씠??---
  // ?좎엯?좊웾怨?(?좎엯? ?遺遺?1媛쒖씠誘濡?flowOption ?곸슜 ????
  const flowIn = findFlowByKeyword(flows, '?좎엯');
  const prevFlowIn = findFlowByKeyword(prevFlows, '?좎엯');
  const flowInType = findFlowTypeNameByKeyword(db, '?좎엯');
  bindings['?좎엯?꾩씪'] = prevFlowIn?.raw_value ?? '';
  bindings['?좎엯湲덉씪'] = flowIn?.raw_value ?? '';
  bindings['?좎엯?꾧퀎'] = flowIn?.calculated_flow ?? '';
  bindings['?붽컙?좎엯'] = sumFlowField(db, flowInType, 'calculated_flow', monthStart, date);
  bindings['?곌컙?좎엯'] = sumFlowField(db, flowInType, 'calculated_flow', yearStart, date);

  // 諛⑸쪟?좊웾怨?(諛⑸쪟???遺遺?1媛쒖씠誘濡?flowOption ?곸슜 ????
  const flowOut = findFlowByKeyword(flows, '諛⑸쪟');
  const prevFlowOut = findFlowByKeyword(prevFlows, '諛⑸쪟');
  const flowOutType = findFlowTypeNameByKeyword(db, '諛⑸쪟');
  bindings['諛⑸쪟?꾩씪'] = prevFlowOut?.raw_value ?? '';
  bindings['諛⑸쪟湲덉씪'] = flowOut?.raw_value ?? '';
  bindings['諛⑸쪟?꾧퀎'] = flowOut?.calculated_flow ?? '';
  bindings['?붽컙諛⑸쪟'] = sumFlowField(db, flowOutType, 'calculated_flow', monthStart, date);
  bindings['?곌컙諛⑸쪟'] = sumFlowField(db, flowOutType, 'calculated_flow', yearStart, date);

  // ?대?諛섏넚?좊웾怨??? flowOption ?곸슜
  const flowInternal = getFlowByOption(flows, '?대?諛섏넚', flowOption) || getFlowByOption(flows, '?대?', flowOption);
  const prevFlowInternal = getFlowByOption(prevFlows, '?대?諛섏넚', flowOption) || getFlowByOption(prevFlows, '?대?', flowOption);
  bindings['?대?諛섏넚?꾩씪'] = prevFlowInternal?.raw_value ?? '';
  bindings['?대?諛섏넚湲덉씪'] = flowInternal?.raw_value ?? '';
  bindings['?대??꾧퀎'] = flowInternal?.calculated_flow ?? '';
  bindings['?붽컙?대?'] = sumFlowFieldByOption(db, '?대?諛섏넚', 'calculated_flow', monthStart, date, flowOption);
  bindings['?곌컙?대?'] = sumFlowFieldByOption(db, '?대?諛섏넚', 'calculated_flow', yearStart, date, flowOption);

  // ?몃?諛섏넚?좊웾怨??? flowOption ?곸슜
  const flowExternal = getFlowByOption(flows, '?몃?諛섏넚', flowOption) || getFlowByOption(flows, '?몃?', flowOption);
  const prevFlowExternal = getFlowByOption(prevFlows, '?몃?諛섏넚', flowOption) || getFlowByOption(prevFlows, '?몃?', flowOption);
  bindings['?몃?諛섏넚?꾩씪'] = prevFlowExternal?.raw_value ?? '';
  bindings['?몃?諛섏넚湲덉씪'] = flowExternal?.raw_value ?? '';
  bindings['?몃??꾧퀎'] = flowExternal?.calculated_flow ?? '';
  bindings['?붽컙?몃?'] = sumFlowFieldByOption(db, '?몃?諛섏넚', 'calculated_flow', monthStart, date, flowOption);
  bindings['?곌컙?몃?'] = sumFlowFieldByOption(db, '?몃?諛섏넚', 'calculated_flow', yearStart, date, flowOption);

  // 슬러지 泥섎━?됱? 珥??꾧퀎(calculated_flow)媛 ?꾨땲??諛섏텧??sludge_export) 湲곗??대떎.
  // 諛섏텧???녿뒗 ?좎씠 留롮쑝誘濡?媛믪씠 ?놁쑝硫?鍮?移몄쑝濡??좎??섍퀬, ?붽컙/?곌컙??諛섏텧?됰쭔 ?꾩쟻?쒕떎.
  const flowSludge = findFlowByKeyword(flows, '슬러지');
  const sludgeType = findFlowTypeNameByKeyword(db, '슬러지');
  bindings['슬러지'] = flowSludge?.sludge_export ?? flowSludge?.raw_value ?? '';
  bindings['?붽컙슬러지'] = sumFlowField(db, sludgeType, 'COALESCE(sludge_export, raw_value)', monthStart, date);
  bindings['?곌컙슬러지'] = sumFlowField(db, sludgeType, 'COALESCE(sludge_export, raw_value)', yearStart, date);

  // --- ?쏀뭹 ?곗씠??---
  let allMedicineItems = getActiveConfigItems(db, 'medicine');
  
  // 怨쇨굅 留ㅽ븨 李뚭볼湲?DB 移쇰읆紐??뺥깭) ?쒖쇅
  allMedicineItems = allMedicineItems.filter(item => {
    const name = item.item_name || '';
    return !name.includes('_purchase') && !name.includes('_usage') && !name.includes('_inventory');
  });

  allMedicineItems.forEach((item, idx) => {
    const medName = item.item_name;
    const medNameNoSpace = medName.replace(/\s+/g, '');
    let medLog = findMedicineByKeyword(medicines, medName);
    
    // PAC/???뱀닔 泥섎━
    if (medNameNoSpace.includes('??) || medNameNoSpace.toUpperCase().includes('PAC')) {
      medLog = findMedicineByKeyword(medicines, '??) || findMedicineByKeyword(medicines, 'PAC') || medLog;
    }

    const siteName = getSiteSettings(db).site_name;
    const purchase = medLog?.purchase_amount ?? '';
    const usage = medLog?.usage_amount ?? '';
    const inventory = medLog?.current_inventory ?? '';
    const mTotal = db.prepare('SELECT SUM(usage_amount) as total FROM medicine_logs WHERE medicine_name = ? AND site_name = ? AND date >= ? AND date <= ?').get(medName, siteName, monthStart, date)?.total || 0;
    const yTotal = db.prepare('SELECT SUM(usage_amount) as total FROM medicine_logs WHERE medicine_name = ? AND site_name = ? AND date >= ? AND date <= ?').get(medName, siteName, yearStart, date)?.total || 0;

    // 湲곕낯 ?대쫫??
    const baseNames = [medNameNoSpace];
    if (medNameNoSpace.includes('?щ룄??)) baseNames.push('?щ룄??);
    if (medNameNoSpace.includes('以묓깂??)) baseNames.push('以묓깂??, '以묓깂?곕굹?몃ⅷ');
    if (medNameNoSpace.includes('??) || medNameNoSpace.toUpperCase().includes('PAC')) baseNames.push('??, 'PAC', '??PAC)', 'PAC??);

    // 異붽? ?뺤옣???꾪븳 ?쏀뭹紐?蹂꾨챸 留ㅽ븨 (?ъ슜?먭? ?묒???吏? ?ㅼ뼇???대쫫 吏??
    if (medNameNoSpace.includes('?뚮（誘쇱궛') || medNameNoSpace.includes('?뚮???)) {
      baseNames.push('?뚮（誘쇱궛', '?뚮（誘쇱궛?섑듃瑜?, '?뚮???, '?뚮??곕굹?몃ⅷ');
    }
    if (medNameNoSpace.includes('李⑥뿼') || medNameNoSpace.includes('李⑥븘?쇱냼??)) {
      baseNames.push('李⑥뿼', '李⑥뿼?뚯궛', '李⑥뿼?뚯궛?섑듃瑜?, '李⑥븘?쇱냼??, '李⑥븘?쇱냼?곕굹?몃ⅷ');
    }
    if (medNameNoSpace.includes('?몄궛?섑듃瑜?) || medNameNoSpace.includes('?몄궛??)) {
      baseNames.push('?몄궛?섑듃瑜?, '?몄궛??);
    }
    if (medNameNoSpace.includes('?대━癒?) || medNameNoSpace.toUpperCase().includes('POLYMER')) {
      baseNames.push('?대━癒?, 'Polymer', 'POLYMER');
    }

    // 以묐났 ?쒓굅
    const uniqueBaseNames = [...new Set(baseNames)];

    uniqueBaseNames.forEach(bName => {
      bindings[`${bName}援ъ엯`] = purchase;
      bindings[`${bName}援ъ엯??] = purchase;
      bindings[`${bName}?ъ슜`] = usage;
      bindings[`${bName}?ъ슜??] = usage;
      bindings[`${bName}?ш퀬`] = inventory;
      bindings[`${bName}?ш퀬??] = inventory;
      bindings[`${bName}?붾웾`] = inventory;
      bindings[`?붽컙${bName}`] = mTotal;
      bindings[`?곌컙${bName}`] = yTotal;
      bindings[`${bName}?붽컙`] = mTotal;
      bindings[`${bName}?붽컙?꾧퀎`] = mTotal;
      bindings[`${bName}?붽컙?ъ슜?됰늻怨?] = mTotal;
      bindings[`${bName}?곌컙`] = yTotal;
      bindings[`${bName}?곌컙?꾧퀎`] = yTotal;
      bindings[`${bName}_purchase`] = purchase;
      bindings[`${bName}_usage`] = usage;
      bindings[`${bName}_inventory`] = inventory;
    });

    // 異붽??쏀뭹 ?명솚??(泥?3媛?湲곕낯?쏀뭹 ?쒖쇅???섎㉧吏)
    // ?щ룄??1), 以묓깂??2), ??3) ?쒖쇅
    if (idx >= 3) {
       const extraIdx = idx - 2;
       // ?ъ슜?먯쓽 ?섎룄?濡??꾩옣蹂?異붽? ?쏀뭹 ?대쫫???묒? ?쇱뿉 ?숈쟻?쇰줈 肉뚮젮以?
       bindings[`異붽??쏀뭹紐?{extraIdx}`] = medName;
       bindings[`異붽??쏀뭹${extraIdx}援ъ엯`] = purchase;
       bindings[`異붽??쏀뭹${extraIdx}?ъ슜`] = usage;
       bindings[`異붽??쏀뭹${extraIdx}?ш퀬`] = inventory;
       bindings[`?붽컙異붽??쏀뭹${extraIdx}`] = mTotal;
       bindings[`?곌컙異붽??쏀뭹${extraIdx}`] = yTotal;
    }
  });

  // --- ?ㅽ듃 ?곗씠??---
  let allKitItems = getActiveConfigItems(db, 'kit');
  allKitItems = allKitItems.filter(item => {
    const name = item.item_name || '';
    return !name.includes('_purchase') && !name.includes('_usage') && !name.includes('_inventory');
  });

  const siteName = getSiteSettings(db).site_name;

  allKitItems.forEach((item) => {
    const kitName = item.item_name;
    const kitNameNoSpace = kitName.replace(/\s+/g, '');
    const kitLog = findKitByKeyword(kits, kitName);

    const purchase = kitLog?.purchase_amount ?? '';
    const usage = kitLog?.usage_amount ?? '';
    const inventory = kitLog?.current_inventory ?? '';
    const mTotal = db.prepare('SELECT SUM(usage_amount) as total FROM kit_logs WHERE kit_name = ? AND site_name = ? AND date >= ? AND date <= ?').get(kitName, siteName, monthStart, date)?.total || 0;
    const yTotal = db.prepare('SELECT SUM(usage_amount) as total FROM kit_logs WHERE kit_name = ? AND site_name = ? AND date >= ? AND date <= ?').get(kitName, siteName, yearStart, date)?.total || 0;

    const baseNames = [kitNameNoSpace];
    if (kitNameNoSpace.includes('?붾え?덉븘') || kitNameNoSpace.toUpperCase().includes('NH3')) {
      baseNames.push('?붾え?덉븘', 'NH3', 'NH3-N', 'NH3_N', 'NH3-N', 'NH3 -N');
    }
    if (kitNameNoSpace.includes('吏덉궛') || kitNameNoSpace.toUpperCase().includes('NO3')) {
      baseNames.push('吏덉궛', 'NO3', 'NO3-N', 'NO3_N');
    }
    if (kitNameNoSpace.includes('?몄궛??) || kitNameNoSpace.includes('?ㅻⅤ?좎씤?곗뿼') || kitNameNoSpace.toUpperCase().includes('PO4')) {
      baseNames.push('??, 'PO4', 'PO4-P', 'PO4_P');
    }
    if (kitNameNoSpace.includes('?뚯뭡由?) || kitNameNoSpace.toUpperCase().includes('ALK')) {
      baseNames.push('?뚯뭡由?, 'ALK');
    }

    // 以묐났 ?쒓굅
    const uniqueKitBaseNames = [...new Set(baseNames)];

    uniqueKitBaseNames.forEach(bName => {
      bindings[`${bName}援ъ엯`] = purchase;
      bindings[`${bName}援ъ엯??] = purchase;
      bindings[`${bName}?ъ슜`] = usage;
      bindings[`${bName}?ъ슜??] = usage;
      bindings[`${bName}?ш퀬`] = inventory;
      bindings[`${bName}?ш퀬??] = inventory;
      bindings[`${bName}?붾웾`] = inventory;
      bindings[`${bName}`] = inventory; // ? ?대쫫??'NH3-N' ?깆씪 ??湲곕낯?쇰줈 ?ш퀬(怨꾩궛媛? 諛붿씤??
      bindings[`${bName}_inventory`] = inventory;
      bindings[`${bName}_usage`] = usage;
      bindings[`${bName}_purchase`] = purchase;
      bindings[`?붽컙${bName}`] = mTotal;
      bindings[`?곌컙${bName}`] = yTotal;
      bindings[`${bName}?붽컙`] = mTotal;
      bindings[`${bName}?붽컙?꾧퀎`] = mTotal;
      bindings[`${bName}?붽컙?ъ슜?됰늻怨?] = mTotal;
      bindings[`${bName}?곌컙`] = yTotal;
      bindings[`${bName}?곌컙?꾧퀎`] = yTotal;
    });
  });

  // --- ?꾨젰 (flow_readings?먯꽌 '?꾨젰' ??? ---
  const flowPower = findFlowByKeyword(flows, '?꾨젰');
  const prevFlowPower = findFlowByKeyword(prevFlows, '?꾨젰');
  bindings['?꾩씪?꾨젰'] = prevFlowPower?.raw_value ?? '';
  bindings['湲덉씪?꾨젰'] = flowPower?.raw_value ?? '';
  bindings['?꾨젰?ъ슜'] = flowPower?.calculated_flow ?? '';
  bindings['?꾨젰?ъ슜??] = flowPower?.calculated_flow ?? '';
  
  // kw???ъ슜??= (湲덉씪 ?꾨젰?ъ슜?? / (湲덉씪 諛⑸쪟??泥섎━??
  let kwPerM3 = '';
  const parsedPowerFlow = parseFloat(flowPower?.calculated_flow);
  const parsedOutFlow = parseFloat(flowOut?.calculated_flow); // 諛⑸쪟泥섎━??calculated_flow) ?ъ슜
  if (!isNaN(parsedPowerFlow) && !isNaN(parsedOutFlow) && parsedOutFlow > 0) {
    kwPerM3 = (parsedPowerFlow / parsedOutFlow).toFixed(3); // 1m3???ъ슜??(蹂댄넻 ?뚯닔??3?먮━源뚯?)
  }
  bindings['kw?뱀궗?⑸웾'] = kwPerM3;
  bindings['?꾨젰?⑥쑉'] = kwPerM3;
  bindings['1m3?뱀궗?⑸웾'] = kwPerM3;

  // ?꾨젰怨꾩궛(諛⑸쪟???꾨젰??怨꾩궛媛? 諛붿씤??
  bindings['?꾨젰怨꾩궛'] = kwPerM3;

  // --- ?섏쭏 遺꾩꽍 (?ν썑 援ы쁽, ?꾩옱??鍮?媛? ---
  ['ph', 'bod', 'toc', 'ss', 'tn', 'tp', '??κ퇏'].forEach(item => {
    bindings[`?섏쭏${item}1`] = '';
    bindings[`?섏쭏${item}2`] = '';
  });
  bindings['?섏쭏?좎쭨1'] = '';
  bindings['?섏쭏?좎쭨2'] = '';

  // --- 湲고? (?섎룞 ?낅젰) ---
  bindings['?섏삩'] = '';
  bindings['?곗냼'] = '';
  bindings['ml'] = '';
  bindings['svi'] = '';
  // ?묒? ?대쫫 愿由ъ옄???곷Ц ??뚮Ц??紐낅챸(PAC vs pac, NH3-N vs NH3_N ?? 李⑥씠瑜?
  // 洹쇰낯?곸쑝濡?諛깆뿏?쒕떒?먯꽌 臾대젰?뷀븯湲??꾪빐 紐⑤뱺 諛붿씤???ㅻ? ?뺢퇋?뷀븯??蹂듭젣?⑸땲??
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

    // ? ?대쫫???뺢퇋?뷀븯??諛붿씤?⑹뿉??李얘린
    const normalizedName = namedCell.normalizedName;
    const originalName = namedCell.name;

    // ?뺢퇋?붾맂 ?대쫫?쇰줈 癒쇱? 李얘퀬, ?놁쑝硫??먮옒 ?대쫫?쇰줈 李얘린
    let value;
    if (Object.prototype.hasOwnProperty.call(bindings, normalizedName)) {
      value = bindings[normalizedName];
    } else if (Object.prototype.hasOwnProperty.call(bindings, originalName)) {
      value = bindings[originalName];
    } else {
      // 諛붿씤?⑹뿉 ?녿뒗 ?? 嫄대뱶由ъ? ?딆쓬 (?ъ슜???섎룞 ?낅젰??
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
    throw new Error('?좏깮??湲곌컙???곗씠?곌? ?놁뒿?덈떎.');
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

// --- ?묒? ?대낫?닿린: JSZip 湲곕컲 (?꾪삎/?대?吏/移대찓??蹂댁〈) ---

/**
 * xlsx ?뚯씪??zip?쇰줈 ?댁뼱, definedNames?먯꽌 ? ?대쫫 ??? 二쇱냼 留ㅽ븨??異붿텧?쒕떎.
 * ExcelJS???ъ슜?섏? ?딄퀬, workbook.xml??XML??吏곸젒 ?뚯떛?쒕떎.
 */
function parseDefinedNamesFromXml(workbookXml) {
  const names = [];
  // <definedName name="..." ...>RANGE</definedName> ?⑦꽩 留ㅼ묶
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
 * workbook.xml?먯꽌 ?쒗듃 ?대쫫 ??rId 留ㅽ븨?? workbook.xml.rels?먯꽌 rId ???뚯씪紐?留ㅽ븨??異붿텧?섏뿬
 * ?쒗듃 ?대쫫 ???ㅼ젣 zip 寃쎈줈瑜?諛섑솚?쒕떎.
 */
function resolveSheetPaths(workbookXml, relsXml) {
  const sheetMap = {};
  // <sheet name="..." sheetId="..." r:id="..."/>
  const sheetRegex = /<sheet\s+name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/?>/g;
  let m;
  while ((m = sheetRegex.exec(workbookXml)) !== null) {
    sheetMap[m[1]] = m[2]; // name ??rId
  }

  const relMap = {};
  // <Relationship Id="..." ... Target="..."/>
  const relRegex = /<Relationship\s[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*/g;
  while ((m = relRegex.exec(relsXml)) !== null) {
    relMap[m[1]] = m[2]; // rId ??target path
  }

  const result = {};
  for (const [sheetName, rId] of Object.entries(sheetMap)) {
    const target = relMap[rId];
    if (target) {
      // target? "worksheets/sheet1.xml" ?뺥깭, zip 寃쎈줈??"xl/worksheets/sheet1.xml"
      result[sheetName] = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    }
  }
  return result;
}

/**
 * ? 二쇱냼(?? "F5")瑜???踰덊샇(1-based)濡?蹂?섑븳??
 */
function colLetterToNumber(letters) {
  let n = 0;
  for (const ch of letters) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n;
}

/**
 * ??踰덊샇(1-based)瑜?? 二쇱냼 臾몄옄???? "AF")濡?蹂?섑븳??
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
 * ?쒗듃 XML ?댁뿉???뱀젙 ???媛믪쓣 援먯껜?쒕떎.
 * 湲곗〈 ? ?쒓렇??<v>...</v> 媛믪쓣 ??媛믪쑝濡?援먯껜?섍굅??
 * ????놁쑝硫??대떦 ?됱뿉 ??????쎌엯?쒕떎.
 *
 * ?レ옄 媛믪? <v>濡? 臾몄옄?댁? inlineStr 諛⑹떇??<is><t>濡???ν븳??
 */
function setCellInSheetXml(sheetXml, address, value) {
  const colMatch = address.match(/^([A-Z]+)(\d+)$/);
  if (!colMatch) return sheetXml;
  const colLetters = colMatch[1];
  const rowNum = colMatch[2];

  const strValue = value === undefined || value === null ? '' : String(value);
  const isNum = strValue !== '' && !isNaN(Number(strValue)) && isFinite(Number(strValue));

  // 湲곗〈 ???李얠븘??援먯껜
  // <c r="F5" ...>...</c> ?먮뒗 <c r="F5" .../>
  const cellRegex = new RegExp(
    `(<c\\s[^>]*r="${address}"[^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/c>)`,
    'i'
  );
  const cellMatch = cellRegex.exec(sheetXml);

  if (cellMatch) {
    // 湲곗〈 ????덉쓬 ??媛?援먯껜
    let openTag = cellMatch[1];
    if (isNum) {
      // ?レ옄: t ?띿꽦 ?쒓굅, <v> ?ъ슜
      openTag = openTag.replace(/\s+t="[^"]*"/, '');
      const replacement = `${openTag}><v>${strValue}</v></c>`;
      return sheetXml.replace(cellMatch[0], replacement);
    } else {
      // 臾몄옄?? t="inlineStr", <is><t> ?ъ슜
      openTag = openTag.replace(/\s+t="[^"]*"/, '');
      openTag = openTag.replace(/(r="[^"]+")/, `$1 t="inlineStr"`);
      const escaped = strValue.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const replacement = `${openTag}><is><t>${escaped}</t></is></c>`;
      return sheetXml.replace(cellMatch[0], replacement);
    }
  }

  // ????놁쑝硫????대떦 ?됱뿉 ??????쎌엯
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

  return sheetXml; // ?됰룄 ?놁쑝硫?蹂寃쏀븯吏 ?딆쓬
}

async function buildBatchExportExcel({ db, appDataPath, templateInfo, manifest }) {
  const JSZip = require('jszip');

  if (!manifest.pages.length) {
    throw new Error('?좏깮??湲곌컙???곗씠?곌? ?놁뒿?덈떎.');
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

  // ?먮낯 ?쒗듃 愿???뚯씪 寃쎈줈 ?뚯븙
  const sheetFileName = path.basename(firstSheetZipPath); // "sheet1.xml"
  const sheetBaseName = path.parse(sheetFileName).name;   // "sheet1"
  const sheetDir = path.dirname(firstSheetZipPath);       // "xl/worksheets"

  // ?먮낯 ?쒗듃 XML ?쎄린
  const templateSheetXml = await zip.file(firstSheetZipPath).async('string');

  // ?먮낯 ?쒗듃??rels ?뚯씪 (?꾪삎/?대?吏 李몄“)
  const sheetRelsPath = `${sheetDir}/_rels/${sheetFileName}.rels`;
  const hasSheetRels = !!zip.file(sheetRelsPath);
  const templateSheetRels = hasSheetRels ? await zip.file(sheetRelsPath).async('string') : null;

  // ?먮낯 ?쒗듃??drawing ?뚯씪 李얘린
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

  // ?먮낯 ?쒗듃???몄뇙 ?곸뿭 definedName ??ぉ 異붿텧???꾪븳 以鍮?
  const escapedOrigName = firstSheetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // wbRelsXml?먯꽌 湲곗〈 理쒕? rId 踰덊샇 李얘린
  const rIdMatches = [...wbRelsXml.matchAll(/Id="rId(\d+)"/g)];
  let maxRId = rIdMatches.reduce((max, m) => Math.max(max, parseInt(m[1])), 0);

  // wbXml?먯꽌 湲곗〈 理쒕? sheetId 李얘린
  const sheetIdMatches = [...wbXml.matchAll(/sheetId="(\d+)"/g)];
  let maxSheetId = sheetIdMatches.reduce((max, m) => Math.max(max, parseInt(m[1])), 0);

  // [Content_Types].xml?먯꽌 湲곗〈 ?쒗듃 Override 異붽????꾩튂 李얘린
  const contentTypeInsertPoint = '</Types>';

  // 媛??좎쭨??????쒗듃瑜?蹂듭젣?섍퀬 諛붿씤???곸슜
  for (let i = 0; i < manifest.pages.length; i++) {
    const page = manifest.pages[i];
    const pageDate = page.date || '?좎쭨誘몄긽';
    const bindings = buildBindingsForDate(db, page.date);

    if (i === 0) {
      // === 泥?踰덉㎏ ?쒗듃: ?먮낯 ?쒗듃瑜?吏곸젒 ?섏젙 ===
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

      // ?쒗듃 ?대쫫 蹂寃?
      wbXml = wbXml.replace(
        new RegExp(`name="${escapedOrigName}"`),
        `name="${pageDate}"`
      );
      // definedName 李몄“???낅뜲?댄듃
      wbXml = wbXml.replace(new RegExp(`'${escapedOrigName}'!`, 'g'), `'${pageDate}'!`);
      wbXml = wbXml.replace(new RegExp(`${escapedOrigName}!`, 'g'), `'${pageDate}'!`);

    } else {
      // === 異붽? ?쒗듃: ?쒗듃 XML/?꾨㈃/rels瑜?蹂듭궗 ===
      const newSheetNum = i + 1;
      const newSheetFileName = `sheet${maxSheetId + newSheetNum}.xml`;
      const newSheetZipPath = `${sheetDir}/${newSheetFileName}`;
      const newRId = `rId${++maxRId}`;
      const newSheetId = ++maxSheetId;

      // ?쒗듃 XML 蹂듭궗 諛?諛붿씤??
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

      // ?쒗듃 rels 蹂듭궗 (?꾨㈃ 李몄“ ?ы븿)
      let newDrawingPath = null;
      if (templateSheetRels) {
        let newSheetRels = templateSheetRels;

        // drawing ?뚯씪??蹂듭젣
        if (templateDrawingPath && templateDrawingXml) {
          const drawingBaseName = path.parse(path.basename(templateDrawingPath)).name;
          const newDrawingFileName = `${drawingBaseName}_s${newSheetNum}.xml`;
          newDrawingPath = `${path.dirname(templateDrawingPath)}/${newDrawingFileName}`;

          zip.file(newDrawingPath, templateDrawingXml);

          // drawing rels??蹂듭궗 (?대?吏 李몄“)
          if (templateDrawingRels) {
            const newDrawingRelsPath = `${path.dirname(templateDrawingPath)}/_rels/${newDrawingFileName}.rels`;
            zip.file(newDrawingRelsPath, templateDrawingRels);
          }

          // ?쒗듃 rels?먯꽌 drawing 寃쎈줈瑜???寃쎈줈濡?援먯껜
          const oldDrawingTarget = path.basename(templateDrawingPath);
          newSheetRels = newSheetRels.replace(oldDrawingTarget, newDrawingFileName);
        }

        const newSheetRelsPath = `${sheetDir}/_rels/${newSheetFileName}.rels`;
        zip.file(newSheetRelsPath, newSheetRels);
      }

      // workbook.xml?????쒗듃 ?깅줉
      const sheetInsertRegex = /(<\/sheets>)/;
      wbXml = wbXml.replace(
        sheetInsertRegex,
        `<sheet name="${pageDate}" sheetId="${newSheetId}" r:id="${newRId}"/></sheets>`
      );

      // ?몄뇙?곸뿭 ??definedName?????쒗듃?먮룄 ?곸슜
      // localSheetId???쒗듃 ?쒖꽌 (0-based index)
      const printAreaRegex = /<definedName\s+name="_xlnm\.Print_Area"[^>]*>([^<]+)<\/definedName>/;
      const printAreaMatch = printAreaRegex.exec(wbXml);
      if (printAreaMatch) {
        const origRange = printAreaMatch[1];
        // 泥??쒗듃 ?대쫫?쇰줈 ??李몄“瑜????쒗듃 ?대쫫?쇰줈 援먯껜
        const newRangeRef = origRange.replace(
          new RegExp(`'[^']*'!`),
          `'${pageDate}'!`
        );
        const newDefinedName = `<definedName name="_xlnm.Print_Area" localSheetId="${i}">${newRangeRef}</definedName>`;
        wbXml = wbXml.replace('</definedNames>', `${newDefinedName}</definedNames>`);
      }

      // workbook.xml.rels????愿怨??깅줉
      wbRelsXml = wbRelsXml.replace(
        '</Relationships>',
        `<Relationship Id="${newRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${newSheetFileName}"/></Relationships>`
      );

      // [Content_Types].xml?????쒗듃 ?깅줉
      contentTypesXml = contentTypesXml.replace(
        contentTypeInsertPoint,
        `<Override PartName="/xl/worksheets/${newSheetFileName}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>${contentTypeInsertPoint}`
      );

      // drawing??[Content_Types].xml???깅줉
      if (newDrawingPath) {
        const drawingPartName = '/' + newDrawingPath.replace(/\\/g, '/');
        contentTypesXml = contentTypesXml.replace(
          contentTypeInsertPoint,
          `<Override PartName="${drawingPartName}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>${contentTypeInsertPoint}`
        );
      }
    }
  }

  // ?섏젙??硫뷀? XML?ㅼ쓣 zip??諛섏쁺
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
