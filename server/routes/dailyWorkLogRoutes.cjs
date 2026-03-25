const express = require('express');
const path = require('path');
const fs = require('fs');
const {
  buildBatchExportExcel,
  buildPreviewManifest,
  buildPageRenderData,
  findPageInManifest,
  normalizeDateRange,
  getActiveDates,
} = require('../services/dailyWorkLogService.cjs');
const { resolveReportTemplatePath } = require('../services/reportTemplateService.cjs');

const TEMPLATE_NAME = '일일업무일지';

const router = express.Router();

function buildMissingTemplateResponse() {
  return {
    code: 'REPORT_TEMPLATE_MISSING',
    error: `${TEMPLATE_NAME} 양식을 찾을 수 없습니다.`,
    userMessage: `${TEMPLATE_NAME} 양식을 찾을 수 없습니다.\n설정에서 ${TEMPLATE_NAME} 양식 파일을 업로드해 주세요.`
  };
}

module.exports = function (db, baseDir, appDataPath) {

  router.get('/api/daily-work-log/active-dates', async (req, res) => {
    const { startDate, endDate, templateName } = req.query;
    const resolvedTemplateName = templateName || TEMPLATE_NAME;

    const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, resolvedTemplateName, { excelOnly: true });
    if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
      return res.status(404).json(buildMissingTemplateResponse());
    }

    try {
      if (!startDate || !endDate) {
        return res.status(400).json({ success: false, error: 'startDate 및 endDate가 필요합니다.' });
      }

      const range = normalizeDateRange(startDate, endDate);
      const activeDates = getActiveDates(db, range.startDate, range.endDate);

      return res.json({ success: true, activeDates });
    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
  });

  // 매니페스트 (날짜 범위 → 페이지 목록)
  router.get('/api/daily-work-log/preview-manifest', async (req, res) => {
    const { startDate, endDate, date, templateName } = req.query;
    const resolvedTemplateName = templateName || TEMPLATE_NAME;

    const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, resolvedTemplateName, { excelOnly: true });
    if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
      return res.status(404).json(buildMissingTemplateResponse());
    }

    try {
      const range = normalizeDateRange(startDate || date, endDate || date || startDate);
      const manifest = buildPreviewManifest(range.startDate, range.endDate);

      return res.json({ success: true, ...manifest });
    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
  });

  // 페이지 렌더 데이터 (프리뷰용)
  router.get('/api/daily-work-log/preview-page-data', async (req, res) => {
    const { date, startDate, endDate, pageKey, templateName } = req.query;
    const resolvedTemplateName = templateName || TEMPLATE_NAME;

    const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, resolvedTemplateName, { excelOnly: true });
    if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
      return res.status(404).json(buildMissingTemplateResponse());
    }

    try {
      const range = normalizeDateRange(startDate || date, endDate || date || startDate);
      const manifest = buildPreviewManifest(range.startDate, range.endDate);
      const targetPage = findPageInManifest(manifest, pageKey);

      if (!targetPage) {
        return res.status(404).json({ error: 'Preview page not found' });
      }

      const renderData = buildPageRenderData(db, targetPage);

      return res.json({
        success: true,
        page: renderData,
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 엑셀 내보내기 (일일업무일지 - 시스템 Excel로 직접 열기)
  router.get('/api/daily-work-log/export', async (req, res) => {
    const { startDate, endDate, date, templateName } = req.query;
    const resolvedTemplateName = templateName || TEMPLATE_NAME;

    const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, resolvedTemplateName, { excelOnly: true });
    if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
      return res.status(404).json(buildMissingTemplateResponse());
    }

    try {
      const range = normalizeDateRange(startDate || date, endDate || date || startDate);
      const manifest = buildPreviewManifest(range.startDate, range.endDate);
      
      if (!manifest.pages.length) {
          return res.status(400).json({ error: '선택한 기간에 데이터가 없습니다.' });
      }

      const outputPaths = await buildBatchExportExcel({
          db,
          appDataPath,
          templateInfo,
          manifest
      });
      
      // 생성된 각 파일을 시스템 기본 프로그램(Excel)으로 열기
      const { exec } = require('child_process');
      for (const filePath of outputPaths) {
        exec(`start "" "${filePath}"`);
      }

      return res.json({ 
        success: true, 
        message: `${outputPaths.length}개의 엑셀 파일을 열었습니다.`,
        files: outputPaths.map(p => path.basename(p)),
      });
      
    } catch (err) {
      console.error('[Daily Work Log Export Error]', err.message);
      return res.status(500).json({ error: `내보내기에 실패했습니다: ${err.message}` });
    }
  });

  return router;
};
