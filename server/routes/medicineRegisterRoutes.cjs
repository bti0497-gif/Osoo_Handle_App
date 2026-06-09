const express = require('express');
const path = require('path');
const fs = require('fs');
const { buildExcelTempPath, openExcelFile } = require('../services/excelOpenService.cjs');
const { resolveReportTemplatePath } = require('../services/reportTemplateService.cjs');

const router = express.Router();

const BASE_MEDICINES = ['중탄산나트륨', '포도당', '팩(PAC)'];
const BASE_KITS = ['암모니아성질소(NH3-N)', '질산성질소(NO3-N)', '인산염인(PO4-P)', '알칼리도(ALK)'];

function resolveSiteScope(db, source = {}) {
  const settings = db.prepare('SELECT site_id, site_name FROM app_settings WHERE id = 1').get() || {};
  return {
    siteId: String(source.siteId || source.site_id || settings.site_id || '').trim(),
    siteName: String(source.siteName || source.site_name || settings.site_name || '').trim(),
  };
}

function siteWhere(scope) {
  if (scope?.siteId && scope?.siteName) return { clause: ' AND (site_id = ? OR site_name = ?)', params: [scope.siteId, scope.siteName] };
  if (scope?.siteId) return { clause: ' AND site_id = ?', params: [scope.siteId] };
  if (scope?.siteName) return { clause: ' AND site_name = ?', params: [scope.siteName] };
  return { clause: '', params: [] };
}

function getAggregate(db, table, nameCol, name, startDate, endDate, yearStart, scope) {
  const filter = siteWhere(scope);
  const purchase = db.prepare(
    `SELECT COALESCE(SUM(purchase_amount), 0) AS v FROM ${table}
     WHERE ${nameCol} = ? AND date >= ? AND date <= ?${filter.clause}`
  ).get(name, startDate, endDate, ...filter.params)?.v ?? 0;

  const usage = db.prepare(
    `SELECT COALESCE(SUM(usage_amount), 0) AS v FROM ${table}
     WHERE ${nameCol} = ? AND date >= ? AND date <= ?${filter.clause}`
  ).get(name, startDate, endDate, ...filter.params)?.v ?? 0;

  const yearTotal = db.prepare(
    `SELECT COALESCE(SUM(usage_amount), 0) AS v FROM ${table}
     WHERE ${nameCol} = ? AND date >= ? AND date <= ?${filter.clause}`
  ).get(name, yearStart, endDate, ...filter.params)?.v ?? 0;

  const balance = db.prepare(
    `SELECT current_inventory FROM ${table}
     WHERE ${nameCol} = ? AND date >= ? AND date <= ?${filter.clause}
     ORDER BY date DESC LIMIT 1`
  ).get(name, startDate, endDate, ...filter.params)?.current_inventory ?? 0;

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

  const mm = String(month).padStart(2, '0');
  const medicineNames = [...BASE_MEDICINES, ...(extraMedicines || [])].filter(Boolean);

  ws.getCell('A1').value = `${year}년 ${Number(month)}월 약품관리대장`;
  ws.getCell('A2').value = `현장: ${siteName || ''}`;
  ws.getCell('A3').value = `사용약품: ${medicineNames.length ? `(${medicineNames.join(', ')})` : '()'}`;
  ws.getCell('A4').value = `기준월: ${year}.${mm}`;

  let row = 6;
  ws.getCell(`A${row}`).value = '약품';
  ws.getCell(`B${row}`).value = '구매';
  ws.getCell(`C${row}`).value = '사용';
  ws.getCell(`D${row}`).value = '누계';
  ws.getCell(`E${row}`).value = '재고';
  row += 1;

  [...(medicineData || []), ...(extraData || [])].forEach((item) => {
    ws.getCell(`A${row}`).value = item?.name || '';
    ws.getCell(`B${row}`).value = formatNumber(item?.purchase);
    ws.getCell(`C${row}`).value = formatNumber(item?.usage);
    ws.getCell(`D${row}`).value = formatNumber(item?.yearTotal);
    ws.getCell(`E${row}`).value = formatNumber(item?.balance);
    row += 1;
  });

  row += 1;
  ws.getCell(`A${row}`).value = '킷';
  ws.getCell(`B${row}`).value = '구매';
  ws.getCell(`C${row}`).value = '사용';
  ws.getCell(`D${row}`).value = '누계';
  ws.getCell(`E${row}`).value = '재고';
  row += 1;

  (kitData || []).forEach((item) => {
    ws.getCell(`A${row}`).value = item?.name || '';
    ws.getCell(`B${row}`).value = formatNumber(item?.purchase);
    ws.getCell(`C${row}`).value = formatNumber(item?.usage);
    ws.getCell(`D${row}`).value = formatNumber(item?.yearTotal);
    ws.getCell(`E${row}`).value = formatNumber(item?.balance);
    row += 1;
  });

  await wb.xlsx.writeFile(outputPath);
}

module.exports = function (db, baseDir, appDataPath) {
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

      const scope = resolveSiteScope(db, req.query);
      const siteName = scope.siteName || '';
      const filter = siteWhere(scope);

      const extraMedicines = db.prepare(
        `SELECT item_name FROM config_items
         WHERE category = 'medicine' AND is_active = 1
           AND item_name NOT IN ('중탄산나트륨', '포도당', '팩(PAC)')
         ORDER BY display_order ASC
         LIMIT 3`
      ).all().map((r) => r.item_name);

      const medicineData = BASE_MEDICINES.map((name) => ({
        name,
        ...getAggregate(db, 'medicine_logs', 'medicine_name', name, startDate, endDate, yearStart, scope),
      }));

      const extraData = Array.from({ length: 3 }, (_, i) => {
        const name = extraMedicines[i] || null;
        if (!name) return { name: '', purchase: 0, usage: 0, yearTotal: 0, balance: 0 };
        return { name, ...getAggregate(db, 'medicine_logs', 'medicine_name', name, startDate, endDate, yearStart, scope) };
      });

      const kitData = BASE_KITS.map((name) => ({
        name,
        ...getAggregate(db, 'kit_logs', 'kit_name', name, startDate, endDate, yearStart, scope),
      }));

      const now = new Date();
      const isPastMonth = year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1);
      const lastDayRecordCount = db.prepare(`SELECT COUNT(*) AS cnt FROM medicine_logs WHERE date = ?${filter.clause}`).get(endDate, ...filter.params)?.cnt ?? 0;
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
          reason: isPastMonth ? '지난월' : (lastDayRecordCount > 0 ? `말일(${endDate}) 데이터 존재` : ''),
        },
      });
    } catch (err) {
      console.error('[medicine-register GET]', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/api/medicine-register/export', async (req, res) => {
    try {
      const { year, month } = req.body;
      const y = parseInt(year, 10);
      const m = parseInt(month, 10);

      if (!y || !m || m < 1 || m > 12) {
        return res.status(400).json({ success: false, error: '유효하지 않은 연월입니다.' });
      }

      const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, '약품관리대장', { excelOnly: true });
      if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
        return res.status(404).json({
          success: false,
          code: 'EXCEL_TEMPLATE_MISSING',
          error: '약품관리대장 양식 파일을 찾을 수 없습니다.',
          userMessage: '설정에서 약품관리대장 양식 파일을 업로드해 주세요.',
        });
      }

      const ext = path.extname(templateInfo.absolutePath).toLowerCase();
      if (!['.xlsx', '.xls', '.xlsm'].includes(ext)) {
        return res.status(400).json({
          success: false,
          code: 'EXCEL_TEMPLATE_INVALID',
          error: '엑셀 템플릿 파일만 허용됩니다.',
        });
      }

      const mm = String(m).padStart(2, '0');
      const lastDay = new Date(y, m, 0).getDate();
      const dd = String(lastDay).padStart(2, '0');
      const startDate = `${y}-${mm}-01`;
      const endDate = `${y}-${mm}-${dd}`;
      const yearStart = `${y}-01-01`;

      const scope = resolveSiteScope(db, req.body);
      const siteName = scope.siteName || '';

      const extraMedicines = db.prepare(
        `SELECT item_name FROM config_items
         WHERE category = 'medicine' AND is_active = 1
           AND item_name NOT IN ('중탄산나트륨', '포도당', '팩(PAC)')
         ORDER BY display_order ASC
         LIMIT 3`
      ).all().map((r) => r.item_name);

      const medicineData = BASE_MEDICINES.map((name) => ({
        name,
        ...getAggregate(db, 'medicine_logs', 'medicine_name', name, startDate, endDate, yearStart, scope),
      }));

      const extraData = Array.from({ length: 3 }, (_, i) => {
        const name = extraMedicines[i] || null;
        if (!name) return { name: '', purchase: 0, usage: 0, yearTotal: 0, balance: 0 };
        return { name, ...getAggregate(db, 'medicine_logs', 'medicine_name', name, startDate, endDate, yearStart, scope) };
      });

      const kitData = BASE_KITS.map((name) => ({
        name,
        ...getAggregate(db, 'kit_logs', 'kit_name', name, startDate, endDate, yearStart, scope),
      }));

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

      await openExcelFile(outputPath);
      res.json({ success: true });
    } catch (err) {
      console.error('[medicine-register export]', err);
      res.status(500).json({
        success: false,
        code: 'EXPORT_FAILED',
        error: err.message,
        userMessage: `양식 생성에 실패했습니다: ${err.message}`,
      });
    }
  });

  return router;
};
