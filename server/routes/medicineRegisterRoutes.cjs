const express = require('express');
const path = require('path');
const fs = require('fs');
const { parseNamedRanges, buildExcelTempPath, openExcelFile } = require('../services/excelOpenService.cjs');

const { resolveReportTemplatePath } = require('../services/reportTemplateService.cjs');

const router = express.Router();

// 기본 3종 약품 (순서 고정)
const BASE_MEDICINES = ['포도당', '중탄산나트륨', '팩(PAC)'];
// 기본 4종 키트 (순서 고정)
const BASE_KITS = ['암모니아성질소(NH3-N)', '질산성질소(NO3-N)', '인산염인(PO4-P)', '알칼리도(ALK)'];

/**
 * 월간 집계 데이터를 조회한다.
 * - purchase  : 해당 월 구매량 합계
 * - usage     : 해당 월 사용량 합계
 * - yearTotal : 해당 연도 1월 ~ 해당 월 사용량 누계
 * - balance   : 해당 월 내 가장 최근 current_inventory
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
  if (!ws) throw new Error('약품관리대장 템플릿 시트를 찾을 수 없습니다.');

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

  // 공통 헤더
  setNamed('대장명', `${year}년 ${Number(month)}월 약품관리대장`);
  setNamed('현장명', siteName || '');
  setNamed('사용약품', medicineNames.length ? `(${medicineNames.join(', ')})` : '()');

  // 기본 약품명/수치
  BASE_MEDICINES.forEach((name, idx) => {
    const i = idx + 1;
    const row = medicineData[idx] || {};
    setNamed(`약${i}약품명`, name);
    setNamed(`약${i}구매`, formatNumber(row.purchase));
    setNamed(`약${i}사용`, formatNumber(row.usage));
    setNamed(`약${i}누계`, formatNumber(row.yearTotal));
    setNamed(`약${i}잔량`, formatNumber(row.balance));
  });

  // 추가 약품(최대 3개)
  for (let i = 1; i <= 3; i++) {
    const row = extraData[i - 1] || {};
    const hasName = Boolean(row.name);
    setNamed(`추${i}약품명`, row.name || '');
    setNamed(`추${i}구매`, hasName ? formatNumber(row.purchase) : '');
    setNamed(`추${i}사용`, hasName ? formatNumber(row.usage) : '');
    setNamed(`추${i}누계`, hasName ? formatNumber(row.yearTotal) : '');
    setNamed(`추${i}잔량`, hasName ? formatNumber(row.balance) : '');
  }

  // 분석 시약(키트)
  const kitNameMap = {
    '암모니아성질소(NH3-N)': ['암모니아', '암모니아성질소', 'NH3'],
    '질산성질소(NO3-N)': ['질산', '질산성질소', 'NO3'],
    '인산염인(PO4-P)': ['인산', '인산염인', '인', 'PO4', 'PO4-P', 'PO4P'],
    '알칼리도(ALK)': ['알칼리', '알칼리도', 'Alkalinity'],
  };
  for (const [originName, prefixes] of Object.entries(kitNameMap)) {
    const row = kitData.find((item) => item.name === originName) || {};
    prefixes.forEach((prefix) => {
      setNamedAny([`${prefix}구매`], formatNumber(row.purchase));
      setNamedAny([`${prefix}사용`], formatNumber(row.usage));
      setNamedAny([`${prefix}누계`, `${prefix}연누계`], formatNumber(row.yearTotal));
      setNamedAny([`${prefix}잔량`], formatNumber(row.balance));
    });
  }

  // 일부 템플릿은 월 텍스트를 별도 named range로 둘 수 있음
  setNamed('월', `${Number(month)}월`);
  setNamed('기준월', `${year}.${mm}`);

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
        return res.status(400).json({ success: false, error: '유효하지 않은 연월입니다.' });
      }

      const mm = String(month).padStart(2, '0');
      const lastDay = new Date(year, month, 0).getDate();
      const dd = String(lastDay).padStart(2, '0');
      const startDate = `${year}-${mm}-01`;
      const endDate = `${year}-${mm}-${dd}`;
      const yearStart = `${year}-01-01`;

      // 현장명
      const settings = db.prepare('SELECT site_name FROM app_settings WHERE id = 1').get();
      const siteName = settings?.site_name || '';

      // 추가 약품 (기본 3종 제외, is_active=1인 것)
      const extraMedicines = db.prepare(
        `SELECT item_name FROM config_items
         WHERE category = 'medicine' AND is_active = 1
           AND item_name NOT IN ('포도당', '중탄산나트륨', '팩(PAC)')
         ORDER BY display_order ASC
         LIMIT 3`
      ).all().map((r) => r.item_name);

      // 기본 약품 집계
      const medicineData = BASE_MEDICINES.map((name) =>
        ({ name, ...getAggregate(db, 'medicine_logs', 'medicine_name', name, startDate, endDate, yearStart) })
      );

      // 추가 약품 집계 (최대 3개, 없으면 null)
      const extraData = Array.from({ length: 3 }, (_, i) => {
        const name = extraMedicines[i] || null;
        if (!name) return { name: '', purchase: 0, usage: 0, yearTotal: 0, balance: 0 };
        return { name, ...getAggregate(db, 'medicine_logs', 'medicine_name', name, startDate, endDate, yearStart) };
      });

      // 키트 집계
      const kitData = BASE_KITS.map((name) =>
        ({ name, ...getAggregate(db, 'kit_logs', 'kit_name', name, startDate, endDate, yearStart) })
      );

      // 인터록: 지난 달이거나 말일 데이터가 존재하면 생성 가능
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
          reason: isPastMonth ? '지난 달' : lastDayRecordCount > 0 ? `말일(${endDate}) 데이터 존재` : '',
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
        return res.status(400).json({ success: false, error: '유효하지 않은 연월입니다.' });
      }

      // 템플릿 파일 확인 (엑셀만 지원)
      const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, '약품관리대장', { excelOnly: true });
      if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
        return res.status(404).json({
          success: false,
          code: 'EXCEL_TEMPLATE_MISSING',
          error: '약품관리대장 엑셀 양식을 찾을 수 없습니다.',
          userMessage: '설정에서 약품관리대장 엑셀 파일을 업로드해 주세요.',
        });
      }

      const ext = path.extname(templateInfo.absolutePath).toLowerCase();
      if (!['.xlsx', '.xls', '.xlsm'].includes(ext)) {
        return res.status(400).json({
          success: false,
          code: 'EXCEL_TEMPLATE_INVALID',
          error: '엑셀 파일만 지원합니다.',
        });
      }

      // 집계 데이터 조회 (GET 엔드포인트와 동일 로직)
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
           AND item_name NOT IN ('포도당', '중탄산나트륨', '팩(PAC)')
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

      const outputPath = buildExcelTempPath('osoo-medicine-register', `약품관리대장_${y}_${mm}_${Date.now()}.xlsx`);

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

      // 서버에서 직접 파일 열기 (dev/Electron 모두 동작)
      await openExcelFile(outputPath);
      res.json({ success: true });
    } catch (err) {
      console.error('[medicine-register export]', err);
      res.status(500).json({
        success: false,
        code: 'EXPORT_FAILED',
        error: err.message,
        userMessage: `엑셀 생성에 실패했습니다: ${err.message}`,
      });
    }
  });

  return router;
};
