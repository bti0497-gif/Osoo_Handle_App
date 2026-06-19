'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const { PDFDocument } = require('pdf-lib');

const { buildBindingsForDate } = require('./dailyWorkLogService.cjs');
const { convertHwpxToPdf } = require('./hwpPdfService.cjs');
const { getDailyWeather } = require('./weatherHistoryService.cjs');

const CHECK_MARK = String.fromCodePoint(0x25CB);

const BOOKMARK_BINDING_KEYS = {
  날짜: ['날짜'],
  전날유입: ['유입전일'],
  오늘유입: ['유입금일'],
  유입량: ['유입누계'],
  전날공정: ['공정전일'],
  오늘공정: ['공정금일'],
  공정량: ['공정누계'],
  전날방류: ['방류전일'],
  오늘방류: ['방류금일'],
  방류량: ['방류누계'],
  전날내부: ['내부반송전일'],
  오늘내부: ['내부반송금일'],
  내부량: ['내부누계'],
  전날외부: ['외부반송전일'],
  오늘외부: ['외부반송금일'],
  외부량: ['외부누계'],
  수온: ['수온'],
  산소: ['산소', 'DO'],
  mlss: ['mlss', 'MLSS'],
  svi: ['svi', 'SVI'],
  반출량: ['슬러지'],
  월간누계: ['월간슬러지'],
  전날지침: ['전일전력'],
  오늘지침: ['금일전력'],
  전력량: ['전력사용량', '전력사용'],
  '전력/유입': ['전력계산', '전력효율'],
  포도당사용: ['포도당사용'],
  포도당잔량: ['포도당잔량', '포도당재고'],
  포도당구매: ['포도당구입'],
  포도당월사용: ['포도당월간누계', '월간포도당'],
  중탄산사용: ['중탄산사용', '중탄산나트륨사용'],
  중탄산잔량: ['중탄산잔량', '중탄산재고', '중탄산나트륨재고'],
  중탄산구매: ['중탄산구입', '중탄산나트륨구입'],
  중탄산월사용: ['중탄산월간누계', '중탄산나트륨월간누계', '월간중탄산'],
  팩사용: ['팩사용', 'PAC사용'],
  팩잔량: ['팩잔량', '팩재고', 'PAC재고'],
  '팩 구매': ['팩구입', 'PAC구입'],
  팩월사용: ['팩월간누계', 'PAC월간누계', '월간팩'],
};

const LOCATION_PREFIXES = [
  { prefix: '유량조', matches: ['유량조정조', '유량조', '유입조'] },
  { prefix: '혐기조', matches: ['혐기조', '혐기'] },
  { prefix: '무산소', matches: ['무산소조', '무산소'] },
  { prefix: '포기조', matches: ['포기조', '폭기조', '포기', '폭기'] },
  { prefix: '침전조', matches: ['침전조', '침전'] },
  { prefix: '방류', matches: ['방류조', '방류수', '방류', '말단'] },
];

const ITEM_SUFFIXES = {
  nh3_n: '암모',
  no3_n: '질산',
  po4_p: '인',
  alkalinity: '알칼리',
};

function normalizeKey(value) {
  return String(value || '').normalize('NFC').replace(/\s+/g, '').trim().toLowerCase();
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatValue(value) {
  return value === null || value === undefined ? '' : String(value);
}

function formatDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(value || '');
  return `${Number(match[1])}년 ${Number(match[2])}월 ${Number(match[3])}일`;
}

function formatNumber(value, decimals = 0) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(number)) return String(value);
  return number.toLocaleString('ko-KR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatBookmarkValues(values) {
  const waterSuffixes = ['암모', '질산', '인', '알칼리'];
  const integerBookmarks = new Set([
    '전날유입', '오늘유입', '유입량',
    '전날공정', '오늘공정', '공정량',
    '전날방류', '오늘방류', '방류량',
    '전날내부', '오늘내부', '내부량',
    '전날외부', '오늘외부', '외부량',
    '반출량', '계근량', '월간누계',
    '전날지침', '오늘지침', '전력량', '전력/유입',
    '포도당재고', '포도당사용', '포도당잔량', '포도당구매', '포도당월사용',
    '중탄산재고', '중탄산사용', '중탄산잔량', '중탄산구매', '중탄산월사용',
    '팩재고', '팩사용', '팩잔량', '팩 구매', '팩월사용',
  ]);

  const formatted = { ...values, 날짜: formatDate(values.날짜) };
  for (const [bookmark, value] of Object.entries(formatted)) {
    if (value === '') continue;
    if (waterSuffixes.some((suffix) => bookmark.endsWith(suffix))) {
      formatted[bookmark] = formatNumber(value, 1);
    } else if (integerBookmarks.has(bookmark)) {
      formatted[bookmark] = formatNumber(value, 0);
    }
  }
  if (formatted.기온 !== '') formatted.기온 = formatNumber(formatted.기온, 1);
  return formatted;
}

function pickBinding(bindings, keys) {
  for (const key of keys || []) {
    const direct = bindings[key];
    if (direct !== undefined && direct !== null && direct !== '') return direct;
    const normalized = bindings[normalizeKey(key)];
    if (normalized !== undefined && normalized !== null && normalized !== '') return normalized;
  }
  return '';
}

function getSiteFilter(db, context = {}) {
  const settings = db.prepare(`
    SELECT app_settings.site_id, app_settings.site_name, app_settings.manager_name, app_settings.method,
           sites.target_lat, sites.target_lng
    FROM app_settings
    LEFT JOIN sites ON sites.id = app_settings.site_id
    WHERE app_settings.id = 1
  `).get() || {};
  const siteId = String(context.siteId || settings.site_id || '').trim();
  const siteName = String(context.siteName || settings.site_name || '').trim();
  if (siteId) return { clause: ' AND site_id = ?', params: [siteId], settings };
  if (siteName) return { clause: ' AND site_name = ?', params: [siteName], settings };
  return { clause: '', params: [], settings };
}

function findLocationPrefix(location) {
  const normalized = normalizeKey(location);
  return LOCATION_PREFIXES.find((entry) => entry.matches.some((match) => normalized.includes(normalizeKey(match))))?.prefix || '';
}

function getQntechBindings(db, date, context = {}) {
  const filter = getSiteFilter(db, context);
  const method = String(context.method || filter.settings.method || '').replace(/\s+/g, '').toUpperCase();
  const selectRows = (siteFilter) => db.prepare(`
    SELECT location, item_code, result_value, result_numeric, author, measurement_order
    FROM qntech_water_quality
    WHERE date = ?${siteFilter.clause}
    ORDER BY measurement_order DESC, last_modified DESC, id DESC
  `).all(date, ...siteFilter.params);
  let rows = selectRows(filter);
  if (!rows.length && filter.clause) {
    // 현장 앱의 레거시 로컬 행은 site_id가 비어 있을 수 있다.
    rows = selectRows({ clause: '', params: [] });
  }

  const values = {};
  const seen = new Set();
  for (const row of rows) {
    const prefix = findLocationPrefix(row.location);
    const suffix = ITEM_SUFFIXES[String(row.item_code || '').toLowerCase()];
    if (!prefix || !suffix) continue;
    // MBR 현장 화면에서는 침전조를 사용하지 않는다. 과거 임포트 데이터가 DB에 남아 있어도
    // HWPX의 1차 침전조(막여과) 행에는 출력하지 않고, 방류 데이터는 별도 방류 책갈피에 유지한다.
    if (method === 'MBR' && prefix === '침전조') continue;
    const bookmark = `${prefix}${suffix}`;
    if (seen.has(bookmark)) continue;
    values[bookmark] = row.result_value ?? row.result_numeric ?? '';
    seen.add(bookmark);
  }

  values['분석자명'] = filter.settings.manager_name || context.author || '';
  return values;
}

function findMedicinePreviousInventory(db, date, keywords, context = {}) {
  const filter = getSiteFilter(db, context);
  const conditions = keywords.map(() => 'REPLACE(UPPER(medicine_name), \' \', \'\') LIKE ?').join(' OR ');
  const params = keywords.map((keyword) => `%${normalizeKey(keyword).toUpperCase()}%`);
  const row = db.prepare(`
    SELECT current_inventory
    FROM medicine_logs
    WHERE date < ? AND (${conditions})${filter.clause}
    ORDER BY date DESC, last_modified DESC, id DESC
    LIMIT 1
  `).get(date, ...params, ...filter.params);
  return row?.current_inventory ?? '';
}

function getDeterministicSludgeTime(date) {
  const seed = String(date || '').replace(/\D/g, '').split('').reduce((sum, digit) => sum + Number(digit), 0);
  return `08:${String((seed % 6) * 10).padStart(2, '0')}`;
}

function getSludgeDetails(db, date, amount, monthlyTotal) {
  const numericAmount = Number(amount);
  if (amount === null || amount === undefined || amount === '' || !Number.isFinite(numericAmount) || numericAmount <= 0) {
    return { 시간: '', 업체명: '', 반출량: '', 계근량: '', 월간누계: '' };
  }
  const log = db.prepare(`
    SELECT sludge_amount
    FROM sludge_photo_logs
    WHERE date = ?
    LIMIT 1
  `).get(date) || {};
  const settings = db.prepare('SELECT company_name FROM sludge_export_settings WHERE id = 1').get() || {};
  const resolvedAmount = log.sludge_amount ?? amount;
  return {
    시간: getDeterministicSludgeTime(date),
    업체명: settings.company_name || '',
    반출량: resolvedAmount,
    계근량: resolvedAmount,
    월간누계: monthlyTotal,
  };
}

function getPreviousDate(date) {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() - 1);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function getProcessFlowBindings(db, date, context = {}) {
  const filter = getSiteFilter(db, context);
  const findReading = (targetDate) => db.prepare(`
    SELECT raw_value, calculated_flow
    FROM flow_readings
    WHERE date = ?
      AND (REPLACE(type, ' ', '') LIKE '%공정%' OR REPLACE(type, ' ', '') LIKE '%처리수%')
      ${filter.clause}
    ORDER BY CASE WHEN REPLACE(type, ' ', '') LIKE '%공정%' THEN 0 ELSE 1 END, id
    LIMIT 1
  `).get(targetDate, ...filter.params) || {};

  const current = findReading(date);
  const previous = findReading(getPreviousDate(date));
  return {
    전날공정: previous.raw_value ?? '',
    오늘공정: current.raw_value ?? '',
    공정량: current.calculated_flow ?? '',
  };
}

function getChecklistBindings(method) {
  const normalizedMethod = String(method || '').replace(/\s+/g, '').toUpperCase();
  const a2oBookmarks = ['침전1', '침전2', '침전3', '응집1', '응집2', '여과1', '여과2'];
  const mbrBookmarks = ['분리막1', '분리막2', '분릭막3'];
  const values = Object.fromEntries([...a2oBookmarks, ...mbrBookmarks].map((bookmark) => [bookmark, '']));
  if (normalizedMethod === 'A2O') a2oBookmarks.forEach((bookmark) => { values[bookmark] = CHECK_MARK; });
  if (normalizedMethod === 'MBR') mbrBookmarks.forEach((bookmark) => { values[bookmark] = CHECK_MARK; });
  if (normalizedMethod !== 'A2O' && normalizedMethod !== 'MBR') {
    console.warn(`[Daily Work Log HWPX] 알 수 없는 공법 '${method || ''}': 시설 점검 책갈피를 비워 둡니다.`);
  }
  return values;
}

async function buildHwpxBookmarkValues(db, appDataPath, date, context = {}) {
  const bindings = buildBindingsForDate(db, date, context);
  const filter = getSiteFilter(db, context);
  const values = {};

  for (const [bookmark, keys] of Object.entries(BOOKMARK_BINDING_KEYS)) {
    values[bookmark] = pickBinding(bindings, keys);
  }

  Object.assign(values, getQntechBindings(db, date, context));
  Object.assign(values, getProcessFlowBindings(db, date, context));
  Object.assign(values, getChecklistBindings(context.method || filter.settings.method));
  Object.assign(values, getSludgeDetails(db, date, values.반출량, values.월간누계));

  const powerUsage = Number(values['전력량']);
  const inflowUsage = Number(values['유입량']);
  values['전력/유입'] = Number.isFinite(powerUsage) && Number.isFinite(inflowUsage) && inflowUsage > 0
    ? powerUsage / inflowUsage
    : '';

  values['포도당재고'] = findMedicinePreviousInventory(db, date, ['포도당'], context);
  values['중탄산재고'] = findMedicinePreviousInventory(db, date, ['중탄산', '중탄산나트륨'], context);
  values['팩재고'] = findMedicinePreviousInventory(db, date, ['팩', 'PAC'], context);
  values['포도당사용'] = values['포도당사용'] === '' ? 0 : values['포도당사용'];
  values['중탄산사용'] = values['중탄산사용'] === '' ? 0 : values['중탄산사용'];
  values['팩사용'] = values['팩사용'] === '' ? 0 : values['팩사용'];
  values['포도당구매'] = values['포도당구매'] || '';
  values['중탄산구매'] = values['중탄산구매'] || '';
  values['팩 구매'] = values['팩 구매'] || '';

  const weather = await getDailyWeather({ db, appDataPath, date, context });
  values.날씨 = weather.weather || '';
  values.기온 = weather.averageTemperature ?? '';
  values.분석자명 = filter.settings.manager_name || context.author || '';
  return formatBookmarkValues(values);
}

function replaceBookmarkText(sectionXml, bookmarkValues) {
  const bookmarkRegex = /<hp:bookmark\b[^>]*\bname="([^"]*)"[^>]*\/>/gi;
  let cursor = 0;
  let output = '';
  let match;
  let replacedCount = 0;

  while ((match = bookmarkRegex.exec(sectionXml))) {
    output += sectionXml.slice(cursor, match.index);
    const paragraphEnd = sectionXml.indexOf('</hp:p>', bookmarkRegex.lastIndex);
    const searchEnd = paragraphEnd >= 0 ? paragraphEnd : sectionXml.length;
    const paragraphTail = sectionXml.slice(bookmarkRegex.lastIndex, searchEnd);
    const textMatch = /<hp:t(\s[^>]*)?\/>|<hp:t(\s[^>]*)?>([\s\S]*?)<\/hp:t>/i.exec(paragraphTail);

    output += match[0];
    if (!textMatch) {
      cursor = bookmarkRegex.lastIndex;
      continue;
    }

    const beforeText = paragraphTail.slice(0, textMatch.index);
    const attributes = textMatch[1] || textMatch[2] || '';
    const value = formatValue(bookmarkValues[match[1]]);
    output += beforeText + `<hp:t${attributes}>${escapeXml(value)}</hp:t>`;
    cursor = bookmarkRegex.lastIndex + textMatch.index + textMatch[0].length;
    bookmarkRegex.lastIndex = cursor;
    replacedCount += 1;
  }

  output += sectionXml.slice(cursor);
  return { xml: output, replacedCount };
}

function ensureOutputDirectory(appDataPath) {
  const root = appDataPath || path.join(os.tmpdir(), 'osoo-handle-app');
  const outputDir = path.join(root, 'temp', 'daily-work-log-hwpx');
  fs.mkdirSync(outputDir, { recursive: true });
  return outputDir;
}

function writeOutputFile(outputPath, buffer) {
  try {
    fs.writeFileSync(outputPath, buffer);
    return outputPath;
  } catch (error) {
    if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
    const parsed = path.parse(outputPath);
    const fallbackPath = path.join(parsed.dir, `${parsed.name}_${Date.now()}${parsed.ext}`);
    fs.writeFileSync(fallbackPath, buffer);
    return fallbackPath;
  }
}

async function buildDailyWorkLogHwpx({ db, appDataPath, templateInfo, date, context = {} }) {
  const templateBuffer = fs.readFileSync(templateInfo.absolutePath);
  const zip = await JSZip.loadAsync(templateBuffer);
  const bookmarkValues = await buildHwpxBookmarkValues(db, appDataPath, date, context);
  let replacedCount = 0;

  const sectionNames = Object.keys(zip.files).filter((name) => /^Contents\/section\d+\.xml$/i.test(name));
  for (const sectionName of sectionNames) {
    const sectionXml = await zip.file(sectionName).async('string');
    const result = replaceBookmarkText(sectionXml, bookmarkValues);
    zip.file(sectionName, result.xml);
    replacedCount += result.replacedCount;
  }

  const mimeEntry = zip.file('mimetype');
  if (mimeEntry) {
    const mimeType = await mimeEntry.async('string');
    zip.file('mimetype', mimeType, { compression: 'STORE' });
  }

  const requestedOutputPath = path.join(ensureOutputDirectory(appDataPath), `일일업무일지_${date}.hwpx`);
  const outputBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  const outputPath = writeOutputFile(requestedOutputPath, outputBuffer);

  return { outputPath, replacedCount, bookmarkValues };
}

async function buildBatchDailyWorkLogHwpx({ db, appDataPath, templateInfo, manifest, context = {} }) {
  const results = [];
  const dates = [...new Set(manifest.pages.map((page) => page.date))];
  for (const date of dates) {
    results.push(await buildDailyWorkLogHwpx({
      db,
      appDataPath,
      templateInfo,
      date,
      context,
    }));
  }
  return results;
}

async function mergePdfFiles(pdfPaths, outputPath) {
  const merged = await PDFDocument.create();
  for (const pdfPath of pdfPaths) {
    const source = await PDFDocument.load(fs.readFileSync(pdfPath));
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  fs.writeFileSync(outputPath, await merged.save());
  return { outputPath, pageCount: merged.getPageCount() };
}

async function buildBatchDailyWorkLogPdf({ db, appDataPath, templateInfo, manifest, context = {} }) {
  const hwpxResults = await buildBatchDailyWorkLogHwpx({ db, appDataPath, templateInfo, manifest, context });
  const outputDir = ensureOutputDirectory(appDataPath);
  const pdfPaths = [];
  for (const result of hwpxResults) {
    const pdfPath = result.outputPath.replace(/\.hwpx$/i, '.pdf');
    await convertHwpxToPdf(result.outputPath, pdfPath);
    pdfPaths.push(pdfPath);
  }

  const dates = hwpxResults.map((result) => path.basename(result.outputPath).match(/(\d{4}-\d{2}-\d{2})/)?.[1]).filter(Boolean);
  const fileName = dates.length <= 1
    ? `일일업무일지_${dates[0] || 'output'}.pdf`
    : `일일업무일지_${dates[0]}_${dates[dates.length - 1]}.pdf`;
  const outputPath = path.join(outputDir, fileName);
  const merged = await mergePdfFiles(pdfPaths, outputPath);
  return { ...merged, hwpxResults, pdfPaths };
}

module.exports = {
  buildBatchDailyWorkLogHwpx,
  buildBatchDailyWorkLogPdf,
  buildDailyWorkLogHwpx,
  buildHwpxBookmarkValues,
  replaceBookmarkText,
};
