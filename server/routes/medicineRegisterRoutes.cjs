const express = require('express');
const path = require('path');
const fs = require('fs');
const { parseNamedRanges, buildExcelTempPath, openExcelFile } = require('../services/excelOpenService.cjs');

const { resolveReportTemplatePath } = require('../services/reportTemplateService.cjs');

const router = express.Router();

// 湲곕낯 3醫??쏀뭹 (?쒖꽌 怨좎젙)
const BASE_MEDICINES = ['?щ룄??, '以묓깂?곕굹?몃ⅷ', '??PAC)'];
// 湲곕낯 4醫??ㅽ듃 (?쒖꽌 怨좎젙)
const BASE_KITS = ['?붾え?덉븘?깆쭏??NH3-N)', '吏덉궛?깆쭏??NO3-N)', '?몄궛?쇱씤(PO4-P)', '?뚯뭡由щ룄(ALK)'];

/**
 * ?붽컙 吏묎퀎 ?곗씠?곕? 議고쉶?쒕떎.
 * - purchase  : ?대떦 ??援щℓ???⑷퀎
 * - usage     : ?대떦 ???ъ슜???⑷퀎
 * - yearTotal : ?대떦 ?곕룄 1??~ ?대떦 ???ъ슜???꾧퀎
 * - balance   : ?대떦 ????媛??理쒓렐 current_inventory
 */
function getAggregate(db, table, nameCol, name, startDate, endDate, yearStart) {
  const purchase = db.prepare(
    `SELECT COALESCE(SUM(purchase_amount), 0) AS v FROM ${table}
     WHERE ${nameCol} = ? AND date >= ? AND date <= ?`
  ).get(name, startDate, endDate)?.v ?? 0;

  const usage = db.prepare(
    `SELECT COALESCE(SUM(usage_amount), 0) AS v FROM ${table}
     WHERE ${nameCol} = ? AND date >= ? AND date <= ?`
  ).get(name, startDate, endDate)?.v ?? 0;

  const yearTotal = db.prepare(
    `SELECT COALESCE(SUM(usage_amount), 0) AS v FROM ${table}
     WHERE ${nameCol} = ? AND date >= ? AND date <= ?`
  ).get(name, yearStart, endDate)?.v ?? 0;

  const balance = db.prepare(
    `SELECT current_inventory FROM ${table}
     WHERE ${nameCol} = ? AND date >= ? AND date <= ?
     ORDER BY date DESC LIMIT 1`
  ).get(name, startDate, endDate)?.current_inventory ?? 0;

  return { purchase, usage, yearTotal, balance };
}

function formatNumber(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '';
  const n = Number(v);
  return Number.isInteger(n) ? n : Number(n.toFixed(2));
}

async function exportMedicineRegisterXlsx({ templatePath, outputPath, year, month, siteName, medicineData, extraData, kitData, extraMedicines }) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templatePath);

  const ws = wb.worksheets[0];
  if (!ws) throw new Error('?쏀뭹愿由щ????쒗뵆由??쒗듃瑜?李얠쓣 ???놁뒿?덈떎.');

  const namedMap = parseNamedRanges(wb);
  const normalizeNamed = (s) => String(s || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s\-_.()/]/g, '');
  const normalizedNamedMap = new Map();
  Object.entries(namedMap).forEach(([key, info]) => {
    const nk = normalizeNamed(key);
    if (nk && !normalizedNamedMap.has(nk)) normalizedNamedMap.set(nk, info);
  });

  const resolveNamedInfo = (name) => {
    const exact = namedMap[name];
    if (exact) return exact;
    return normalizedNamedMap.get(normalizeNamed(name)) || null;
  };

  const setNamed = (name, value) => {
    const info = resolveNamedInfo(name);
    if (!info) return;
    const targetSheet = wb.getWorksheet(info.sheetName) || ws;
    targetSheet.getCell(info.address).value = value ?? '';
  };
  const setNamedAny = (names, value) => {
    (names || []).forEach((name) => setNamed(name, value));
  };

  const mm = String(month).padStart(2, '0');
  const medicineNames = [...BASE_MEDICINES, ...extraMedicines].filter(Boolean);

  // 怨듯넻 ?ㅻ뜑
  setNamed('??λ챸', `${year}??${Number(month)}???쏀뭹愿由щ???);
  setNamed('?꾩옣紐?, siteName || '');
  setNamed('?ъ슜?쏀뭹', medicineNames.length ? `(${medicineNames.join(', ')})` : '()');

  // 湲곕낯 ?쏀뭹紐??섏튂
  BASE_MEDICINES.forEach((name, idx) => {
    const i = idx + 1;
    const row = medicineData[idx] || {};
    setNamed(`??{i}?쏀뭹紐?, name);
    setNamed(`??{i}援щℓ`, formatNumber(row.purchase));
    setNamed(`??{i}?ъ슜`, formatNumber(row.usage));
    setNamed(`??{i}?꾧퀎`, formatNumber(row.yearTotal));
    setNamed(`??{i}?붾웾`, formatNumber(row.balance));
  });

  // 異붽? ?쏀뭹(理쒕? 3媛?
  for (let i = 1; i <= 3; i++) {
    const row = extraData[i - 1] || {};
    const hasName = Boolean(row.name);
    setNamed(`異?{i}?쏀뭹紐?, row.name || '');
    setNamed(`異?{i}援щℓ`, hasName ? formatNumber(row.purchase) : '');
    setNamed(`異?{i}?ъ슜`, hasName ? formatNumber(row.usage) : '');
    setNamed(`異?{i}?꾧퀎`, hasName ? formatNumber(row.yearTotal) : '');
    setNamed(`異?{i}?붾웾`, hasName ? formatNumber(row.balance) : '');
  }

  // 遺꾩꽍 ?쒖빟(?ㅽ듃)
  const kitNameMap = {
    '?붾え?덉븘?깆쭏??NH3-N)': ['?붾え?덉븘', '?붾え?덉븘?깆쭏??, 'NH3'],
    '吏덉궛?깆쭏??NO3-N)': ['吏덉궛', '吏덉궛?깆쭏??, 'NO3'],
    '?몄궛?쇱씤(PO4-P)': ['?몄궛', '?몄궛?쇱씤', '??, 'PO4', 'PO4-P', 'PO4P'],
    '?뚯뭡由щ룄(ALK)': ['?뚯뭡由?, '?뚯뭡由щ룄', 'Alkalinity'],
  };
  for (const [originName, prefixes] of Object.entries(kitNameMap)) {
    const row = kitData.find((item) => item.name === originName) || {};
    prefixes.forEach((prefix) => {
      setNamedAny([`${prefix}援щℓ`], formatNumber(row.purchase));
      setNamedAny([`${prefix}?ъ슜`], formatNumber(row.usage));
      setNamedAny([`${prefix}?꾧퀎`, `${prefix}?곕늻怨?], formatNumber(row.yearTotal));
      setNamedAny([`${prefix}?붾웾`], formatNumber(row.balance));
    });
  }

  // ?쇰? ?쒗뵆由우? ???띿뒪?몃? 蹂꾨룄 named range濡??????덉쓬
  setNamed('??, `${Number(month)}??);
  setNamed('湲곗???, `${year}.${mm}`);

  await wb.xlsx.writeFile(outputPath);
}

module.exports = function (db, baseDir, appDataPath) {
  /**
   * GET /api/medicine-register
   * Query: year (number), month (number)
   */
  router.get('/api/medicine-register', (req, res) => {
    try {
      const year = parseInt(req.query.year, 10);
      const month = parseInt(req.query.month, 10);

      if (!year || !month || month < 1 || month > 12) {
        return res.status(400).json({ success: false, error: '?좏슚?섏? ?딆? ?곗썡?낅땲??' });
      }

      const mm = String(month).padStart(2, '0');
      const lastDay = new Date(year, month, 0).getDate();
      const dd = String(lastDay).padStart(2, '0');
      const startDate = `${year}-${mm}-01`;
      const endDate = `${year}-${mm}-${dd}`;
      const yearStart = `${year}-01-01`;

      // ?꾩옣紐?
      const settings = db.prepare('SELECT site_name FROM app_settings WHERE id = 1').get();
      const siteName = settings?.site_name || '';

      // 異붽? ?쏀뭹 (湲곕낯 3醫??쒖쇅, is_active=1??寃?
      const extraMedicines = db.prepare(
        `SELECT item_name FROM config_items
         WHERE category = 'medicine' AND is_active = 1
           AND item_name NOT IN ('?щ룄??, '以묓깂?곕굹?몃ⅷ', '??PAC)')
         ORDER BY display_order ASC
         LIMIT 3`
      ).all().map((r) => r.item_name);

      // 湲곕낯 ?쏀뭹 吏묎퀎
      const medicineData = BASE_MEDICINES.map((name) =>
        ({ name, ...getAggregate(db, 'medicine_logs', 'medicine_name', name, startDate, endDate, yearStart) })
      );

      // 異붽? ?쏀뭹 吏묎퀎 (理쒕? 3媛? ?놁쑝硫?null)
      const extraData = Array.from({ length: 3 }, (_, i) => {
        const name = extraMedicines[i] || null;
        if (!name) return { name: '', purchase: 0, usage: 0, yearTotal: 0, balance: 0 };
        return { name, ...getAggregate(db, 'medicine_logs', 'medicine_name', name, startDate, endDate, yearStart) };
      });

      // ?ㅽ듃 吏묎퀎
      const kitData = BASE_KITS.map((name) =>
        ({ name, ...getAggregate(db, 'kit_logs', 'kit_name', name, startDate, endDate, yearStart) })
      );

      // ?명꽣濡? 吏???ъ씠嫄곕굹 留먯씪 ?곗씠?곌? 議댁옱?섎㈃ ?앹꽦 媛??
      const now = new Date();
      const isPastMonth = year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1);
      const lastDayRecordCount = db.prepare(
        `SELECT COUNT(*) AS cnt FROM medicine_logs WHERE date = ?`
      ).get(endDate)?.cnt ?? 0;
      const interlockEnabled = isPastMonth || lastDayRecordCount > 0;

      res.json({
        success: true,
        year,
        month,
        siteName,
        medicines: medicineData,
        extraMedicines: extraData,
        kits: kitData,
        interlock: {
          enabled: interlockEnabled,
          reason: isPastMonth ? '吏???? : lastDayRecordCount > 0 ? `留먯씪(${endDate}) ?곗씠??議댁옱` : '',
        },
      });
    } catch (err) {
      console.error('[medicine-register GET]', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/medicine-register/export
   * Body: { year, month }
   * Returns: { success: true }
   */
  router.post('/api/medicine-register/export', async (req, res) => {
    try {
      const { year, month } = req.body;
      const y = parseInt(year, 10);
      const m = parseInt(month, 10);

      if (!y || !m || m < 1 || m > 12) {
        return res.status(400).json({ success: false, error: '?좏슚?섏? ?딆? ?곗썡?낅땲??' });
      }

      // ?쒗뵆由??뚯씪 ?뺤씤 (?묒?留?吏??
      const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, '?쏀뭹愿由щ???, { excelOnly: true });
      if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
        return res.status(404).json({
          success: false,
          code: 'EXCEL_TEMPLATE_MISSING',
          error: '?쏀뭹愿由щ????묒? ?묒떇??李얠쓣 ???놁뒿?덈떎.',
          userMessage: '?ㅼ젙?먯꽌 ?쏀뭹愿由щ????묒? ?뚯씪???낅줈?쒗빐 二쇱꽭??',
        });
      }

      const ext = path.extname(templateInfo.absolutePath).toLowerCase();
      if (!['.xlsx', '.xls', '.xlsm'].includes(ext)) {
        return res.status(400).json({
          success: false,
          code: 'EXCEL_TEMPLATE_INVALID',
          error: '?묒? ?뚯씪留?吏?먰빀?덈떎.',
        });
      }

      // 吏묎퀎 ?곗씠??議고쉶 (GET ?붾뱶?ъ씤?몄? ?숈씪 濡쒖쭅)
      const mm = String(m).padStart(2, '0');
      const lastDay = new Date(y, m, 0).getDate();
      const dd = String(lastDay).padStart(2, '0');
      const startDate = `${y}-${mm}-01`;
      const endDate = `${y}-${mm}-${dd}`;
      const yearStart = `${y}-01-01`;

      const settings = db.prepare('SELECT site_name FROM app_settings WHERE id = 1').get();
      const siteName = settings?.site_name || '';

      const extraMedicines = db.prepare(
        `SELECT item_name FROM config_items
         WHERE category = 'medicine' AND is_active = 1
           AND item_name NOT IN ('?щ룄??, '以묓깂?곕굹?몃ⅷ', '??PAC)')
         ORDER BY display_order ASC
         LIMIT 3`
      ).all().map((r) => r.item_name);

      const medicineData = BASE_MEDICINES.map((name) =>
        ({ name, ...getAggregate(db, 'medicine_logs', 'medicine_name', name, startDate, endDate, yearStart) })
      );

      const extraData = Array.from({ length: 3 }, (_, i) => {
        const name = extraMedicines[i] || null;
        if (!name) return { name: '', purchase: 0, usage: 0, yearTotal: 0, balance: 0 };
        return { name, ...getAggregate(db, 'medicine_logs', 'medicine_name', name, startDate, endDate, yearStart) };
      });

      const kitData = BASE_KITS.map((name) =>
        ({ name, ...getAggregate(db, 'kit_logs', 'kit_name', name, startDate, endDate, yearStart) })
      );

      const outputPath = buildExcelTempPath('osoo-medicine-register', `?쏀뭹愿由щ???${y}_${mm}_${Date.now()}.xlsx`);

      await exportMedicineRegisterXlsx({
        templatePath: templateInfo.absolutePath,
        outputPath,
        year: y,
        month: m,
        siteName,
        medicineData,
        extraData,
        kitData,
        extraMedicines,
      });

      // ?쒕쾭?먯꽌 吏곸젒 ?뚯씪 ?닿린 (dev/Electron 紐⑤몢 ?숈옉)
      await openExcelFile(outputPath);
      res.json({ success: true });
    } catch (err) {
      console.error('[medicine-register export]', err);
      res.status(500).json({
        success: false,
        code: 'EXPORT_FAILED',
        error: err.message,
        userMessage: `?묒? ?앹꽦???ㅽ뙣?덉뒿?덈떎: ${err.message}`,
      });
    }
  });

  return router;
};
