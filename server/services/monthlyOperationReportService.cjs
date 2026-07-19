const ExcelJS = require('exceljs');
const fs = require('fs');
const JSZip = require('jszip');

const TEMPLATE_NAME = '월운영보고서';
const REQUIRED_NAMES = [
  '현장명년도월', '날짜', '유입량', '방류량', '슬러지', '포도당', '중탄산', '응집제',
  '포도당이월', '포도당입고', '중탄산이월', '중탄산입고', '응집제이월', '응집제입고',
];

function parseNamedRange(value) {
  const match = String(value || '').match(/^(?:'((?:[^']|'')+)'|([^!]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/);
  if (!match) return null;
  return {
    sheetName: (match[1] || match[2] || '').replace(/''/g, "'"),
    startColumn: match[3], startRow: Number(match[4]),
    endColumn: match[5] || match[3], endRow: Number(match[6] || match[4]),
  };
}

function buildNamedRangeMap(workbook) {
  const model = Array.isArray(workbook.definedNames?.model) ? workbook.definedNames.model : [];
  return Object.fromEntries(model.flatMap((entry) => {
    const parsed = parseNamedRange(entry.ranges?.[0]);
    return parsed ? [[entry.name, parsed]] : [];
  }));
}

function siteScope(db, source = {}) {
  const settings = db.prepare('SELECT site_id, site_name FROM app_settings WHERE id = 1').get() || {};
  return {
    siteName: String(source.siteName || source.site_name || settings.site_name || '').trim(),
  };
}

function siteWhere() {
  // 로컬 DB는 현장별로 분리되어 있고 과거 레코드에는 site_name이 비어 있을 수 있다.
  // 월보고서에서 현장명 필터를 걸면 정상적인 기존 자료가 누락되므로 로컬 전체를 사용한다.
  return { clause: '', params: [] };
}

function monthRange(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) throw new Error('유효한 연월을 선택해 주세요.');
  const mm = String(m).padStart(2, '0');
  const days = new Date(y, m, 0).getDate();
  return { year: y, month: m, days, startDate: `${y}-${mm}-01`, endDate: `${y}-${mm}-${String(days).padStart(2, '0')}` };
}

function resolveMedicineNames(db) {
  const names = db.prepare(`
    SELECT item_name FROM config_items
    WHERE category = 'medicine' AND is_active = 1
      AND item_name NOT GLOB '*_purchase' AND item_name NOT GLOB '*_usage' AND item_name NOT GLOB '*_inventory'
    ORDER BY display_order ASC
  `).all().map((row) => String(row.item_name || '').trim()).filter(Boolean);
  const pick = (patterns, fallback) => names.find((name) => patterns.some((pattern) => pattern.test(name))) || fallback;
  return {
    glucose: pick([/포도당/i, /질소제거제/i], '포도당'),
    bicarbonate: pick([/중탄산/i], '중탄산나트륨'),
    coagulant: pick([/응집제/i, /PAC/i, /팩\s*\(/i], '팩(PAC)'),
  };
}

function getMonthlyData(db, source = {}) {
  const range = monthRange(source.year, source.month);
  const scope = siteScope(db, source);
  const filter = siteWhere(scope);
  const flows = db.prepare(`
    SELECT date, type, calculated_flow, sludge_export FROM flow_readings
    WHERE date BETWEEN ? AND ?${filter.clause} ORDER BY date, type
  `).all(range.startDate, range.endDate, ...filter.params);
  const medicineNames = resolveMedicineNames(db);
  const medicines = db.prepare(`
    SELECT date, medicine_name, purchase_amount, usage_amount, current_inventory FROM medicine_logs
    WHERE date BETWEEN ? AND ?${filter.clause} ORDER BY date, medicine_name
  `).all(range.startDate, range.endDate, ...filter.params);

  const blankDay = (date) => ({ date, inflow: null, outflow: null, sludge: null, glucose: null, bicarbonate: null, coagulant: null });
  const byDate = new Map();
  const ensureDay = (date) => {
    if (!byDate.has(date)) byDate.set(date, blankDay(date));
    return byDate.get(date);
  };
  for (const row of flows) {
    const target = ensureDay(row.date);
    const type = String(row.type || '');
    const value = row.calculated_flow == null ? null : Math.max(0, Number(row.calculated_flow));
    if (type.includes('유입') && value != null) target.inflow = (target.inflow || 0) + value;
    if (type.includes('방류') && value != null) target.outflow = (target.outflow || 0) + value;
    if (type.includes('슬러지') && row.sludge_export != null) target.sludge = (target.sludge || 0) + Number(row.sludge_export);
  }
  const roleByName = new Map(Object.entries(medicineNames).map(([role, name]) => [name, role]));
  for (const row of medicines) {
    const role = roleByName.get(String(row.medicine_name || '').trim());
    if (role && row.usage_amount != null) ensureDay(row.date)[role] = Number(row.usage_amount);
  }

  const inventory = {};
  for (const [role, name] of Object.entries(medicineNames)) {
    const previous = db.prepare(`SELECT current_inventory FROM medicine_logs WHERE medicine_name = ? AND date < ?${filter.clause} ORDER BY date DESC, id DESC LIMIT 1`).get(name, range.startDate, ...filter.params);
    const receipt = db.prepare(`SELECT COALESCE(SUM(purchase_amount), 0) AS total FROM medicine_logs WHERE medicine_name = ? AND date BETWEEN ? AND ?${filter.clause}`).get(name, range.startDate, range.endDate, ...filter.params);
    inventory[role] = { name, carryover: Number(previous?.current_inventory || 0), receipt: Number(receipt?.total || 0) };
  }
  const rows = Array.from({ length: 31 }, (_, index) => {
    const day = index + 1;
    if (day > range.days) return blankDay(null);
    const date = `${range.startDate.slice(0, 8)}${String(day).padStart(2, '0')}`;
    return byDate.get(date) || blankDay(date);
  });
  return { ...range, siteName: scope.siteName, medicineNames, inventory, rows };
}

async function enforceAutomaticFullCalculation(filePath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  const workbookEntry = zip.file('xl/workbook.xml');
  if (!workbookEntry) throw new Error('엑셀 통합문서 계산 설정을 찾을 수 없습니다.');
  let xml = await workbookEntry.async('string');
  const calcPr = '<calcPr calcId="171027" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1" calcOnSave="1"/>';
  xml = /<calcPr\b[^>]*(?:\/>|>[^<]*<\/calcPr>)/.test(xml)
    ? xml.replace(/<calcPr\b[^>]*(?:\/>|>[^<]*<\/calcPr>)/, calcPr)
    : xml.replace('</workbook>', `${calcPr}</workbook>`);
  zip.file('xl/workbook.xml', xml);
  fs.writeFileSync(filePath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

async function exportMonthlyOperationReport({ db, templatePath, outputPath, year, month, ...source }) {
  const data = getMonthlyData(db, { year, month, ...source });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);
  const named = buildNamedRangeMap(workbook);
  const missing = REQUIRED_NAMES.filter((name) => !named[name]);
  if (missing.length) throw new Error(`월운영보고서 양식의 이름 정의가 누락되었습니다: ${missing.join(', ')}`);

  const setScalar = (name, value) => {
    const item = named[name];
    workbook.getWorksheet(item.sheetName).getCell(`${item.startColumn}${item.startRow}`).value = value;
  };
  const setColumn = (name, values) => {
    const item = named[name];
    if (item.startColumn !== item.endColumn || item.endRow - item.startRow + 1 !== values.length) throw new Error(`${name} 이름 범위가 예상 구조와 다릅니다.`);
    const sheet = workbook.getWorksheet(item.sheetName);
    values.forEach((value, index) => { sheet.getCell(`${item.startColumn}${item.startRow + index}`).value = value; });
  };

  setScalar('현장명년도월', `${data.siteName} ${data.year}년 ${data.month}월 운영보고서`);
  setColumn('날짜', data.rows.map((row) => row.date ? new Date(data.year, data.month - 1, Number(row.date.slice(-2))) : null));
  for (const [name, key] of [['유입량', 'inflow'], ['방류량', 'outflow'], ['슬러지', 'sludge'], ['포도당', 'glucose'], ['중탄산', 'bicarbonate'], ['응집제', 'coagulant']]) setColumn(name, data.rows.map((row) => row[key]));
  for (const [name, role, field] of [['포도당이월', 'glucose', 'carryover'], ['포도당입고', 'glucose', 'receipt'], ['중탄산이월', 'bicarbonate', 'carryover'], ['중탄산입고', 'bicarbonate', 'receipt'], ['응집제이월', 'coagulant', 'carryover'], ['응집제입고', 'coagulant', 'receipt']]) setScalar(name, data.inventory[role][field]);

  // ExcelJS는 수식을 계산하지 않는다. 기존 수식은 그대로 두고 Excel이 파일을
  // 열 때 전체 통합문서를 자동 재계산하도록 계산 속성만 설정한다.
  workbook.calcProperties.fullCalcOnLoad = true;
  workbook.calcProperties.forceFullCalc = true;
  workbook.calcProperties.calcMode = 'auto';
  await workbook.xlsx.writeFile(outputPath);
  await enforceAutomaticFullCalculation(outputPath);
  return data;
}

module.exports = { TEMPLATE_NAME, REQUIRED_NAMES, monthRange, getMonthlyData, enforceAutomaticFullCalculation, exportMonthlyOperationReport };
