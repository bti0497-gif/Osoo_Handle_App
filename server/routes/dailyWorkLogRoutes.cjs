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

const TEMPLATE_NAME = '?쇱씪?낅Т?쇱?';

const router = express.Router();

function buildMissingTemplateResponse() {
  return {
    code: 'REPORT_TEMPLATE_MISSING',
    error: `${TEMPLATE_NAME} ?묒떇??李얠쓣 ???놁뒿?덈떎.`,
    userMessage: `${TEMPLATE_NAME} ?묒떇??李얠쓣 ???놁뒿?덈떎.\n?ㅼ젙?먯꽌 ${TEMPLATE_NAME} ?묒떇 ?뚯씪???낅줈?쒗빐 二쇱꽭??`
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
        return res.status(400).json({ success: false, error: 'startDate 諛?endDate媛 ?꾩슂?⑸땲??' });
      }

      const range = normalizeDateRange(startDate, endDate);
      const activeDates = getActiveDates(db, range.startDate, range.endDate);

      return res.json({ success: true, activeDates });
    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
  });

  // 留ㅻ땲?섏뒪??(?좎쭨 踰붿쐞 ???섏씠吏 紐⑸줉)
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

  // ?섏씠吏 ?뚮뜑 ?곗씠??(?꾨━酉곗슜)
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

  // ?묒? ?대낫?닿린 (?쇱씪?낅Т?쇱? - ?쒖뒪??Excel濡?吏곸젒 ?닿린)
  router.get('/api/daily-work-log/export', async (req, res) => {
    const { startDate, endDate, date, templateName } = req.query;
    const resolvedTemplateName = templateName || TEMPLATE_NAME;

    const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, resolvedTemplateName, { excelOnly: true });
    if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
      return res.status(404).json(buildMissingTemplateResponse());
    }

    // DEBUG: ?대뼡 ?묒떇 ?뚯씪???ъ슜?섎뒗吏 ?뺤씤
    const tStat = fs.statSync(templateInfo.absolutePath);
    console.log(`[Daily Work Log Export] Template: ${templateInfo.absolutePath} (${tStat.size} bytes, mtime: ${tStat.mtime.toISOString()})`);

    try {
      const range = normalizeDateRange(startDate || date, endDate || date || startDate);
      const manifest = buildPreviewManifest(range.startDate, range.endDate);
      
      if (!manifest.pages.length) {
          return res.status(400).json({ error: '?좏깮??湲곌컙???곗씠?곌? ?놁뒿?덈떎.' });
      }

      const outputPaths = await buildBatchExportExcel({
          db,
          appDataPath,
          templateInfo,
          manifest
      });
      
      // ?앹꽦??媛??뚯씪???쒖뒪??湲곕낯 ?꾨줈洹몃옩(Excel)?쇰줈 ?닿린
      const { openExcelFile } = require('../services/excelOpenService.cjs');
      for (const filePath of outputPaths) {
        await openExcelFile(filePath);
      }

      return res.json({ 
        success: true, 
        message: `${outputPaths.length}媛쒖쓽 ?묒? ?뚯씪???댁뿀?듬땲??`,
        files: outputPaths.map(p => path.basename(p)),
      });
      
    } catch (err) {
      console.error('[Daily Work Log Export Error]', err.message);
      return res.status(500).json({ error: `?대낫?닿린???ㅽ뙣?덉뒿?덈떎: ${err.message}` });
    }
  });

  return router;
};
