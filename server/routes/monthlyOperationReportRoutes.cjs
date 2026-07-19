const express = require('express');
const fs = require('fs');
const path = require('path');
const { buildExcelTempPath, openExcelFile } = require('../services/excelOpenService.cjs');
const { resolveReportTemplatePath } = require('../services/reportTemplateService.cjs');
const { TEMPLATE_NAME, getMonthlyData, exportMonthlyOperationReport } = require('../services/monthlyOperationReportService.cjs');

module.exports = function monthlyOperationReportRoutes(db, baseDir, appDataPath) {
  const router = express.Router();
  router.get('/api/monthly-operation-report', (req, res) => {
    try { return res.json({ success: true, ...getMonthlyData(db, req.query) }); }
    catch (error) { return res.status(400).json({ success: false, error: error.message }); }
  });
  router.post('/api/monthly-operation-report/export', async (req, res) => {
    try {
      const template = resolveReportTemplatePath(baseDir, appDataPath, TEMPLATE_NAME, { excelOnly: true });
      if (!template?.absolutePath || !fs.existsSync(template.absolutePath)) return res.status(404).json({ success: false, code: 'EXCEL_TEMPLATE_MISSING', userMessage: '월운영보고서 양식을 찾을 수 없습니다. 설정에서 양식을 등록해 주세요.' });
      const year = Number(req.body?.year);
      const month = Number(req.body?.month);
      const outputPath = buildExcelTempPath('osoo-monthly-operation-report', `월운영보고서_${year}_${String(month).padStart(2, '0')}_${Date.now()}.xlsx`);
      const data = await exportMonthlyOperationReport({ db, templatePath: template.absolutePath, outputPath, year, month, ...req.body });
      await openExcelFile(outputPath);
      return res.json({ success: true, file: path.basename(outputPath), siteName: data.siteName });
    } catch (error) {
      console.error('[Monthly Operation Report]', error);
      return res.status(500).json({ success: false, code: 'EXPORT_FAILED', userMessage: `월운영보고서 생성에 실패했습니다: ${error.message}` });
    }
  });
  return router;
};
