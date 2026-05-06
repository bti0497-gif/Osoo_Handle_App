const express = require('express');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const {
  buildBatchExportExcel,
  buildBatchPreviewPdf,
  buildPreviewManifest,
  buildPageRenderData,
  buildPagePreviewPdf,
  findPageInManifest,
  normalizeDateRange,
  parsePageKey,
  getActiveDates,
} = require('../services/dailyLogPreviewService.cjs');
const { resolveReportTemplatePath } = require('../services/reportTemplateService.cjs');
const { getHtmlTemplatePath } = require('../services/excelTemplateHtmlService.cjs');
const router = express.Router();

function buildMissingTemplateResponse(templateName) {
  const requestedTemplateName = String(templateName || '?섏쭏遺꾩꽍?쇱?').trim() || '?섏쭏遺꾩꽍?쇱?';
  return {
    code: 'REPORT_TEMPLATE_MISSING',
    error: `${requestedTemplateName} ?묒떇??李얠쓣 ???놁뒿?덈떎.`,
    userMessage: `${requestedTemplateName} ?묒떇??李얠쓣 ???놁뒿?덈떎.\n?ㅼ젙?먯꽌 ${requestedTemplateName} ?묒떇 ?뚯씪???낅줈?쒗빐 二쇱꽭??`
  };
}

module.exports = function(db, baseDir, appDataPath) {
  router.get('/api/logs/preview-template-html', async (req, res) => {
    const { templateName } = req.query;
    const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, templateName, { excelOnly: true });

    if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
      return res.status(404).json(buildMissingTemplateResponse(templateName));
    }

    const htmlPath = getHtmlTemplatePath(appDataPath, templateInfo.fileName);
    if (!fs.existsSync(htmlPath)) {
      return res.status(404).json({
        code: 'REPORT_TEMPLATE_HTML_MISSING',
        error: 'HTML ?쒗뵆由우쓣 李얠쓣 ???놁뒿?덈떎.',
        userMessage: 'HTML ?쒗뵆由우씠 ?꾩쭅 ?앹꽦?섏? ?딆븯?듬땲?? ?ㅼ젙?먯꽌 ?묒떇 ?뚯씪???ㅼ떆 ?낅줈?쒗빐 二쇱꽭??'
      });
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.sendFile(htmlPath);
  });

  router.get('/api/logs/active-dates', async (req, res) => {
    const { startDate, endDate, templateName } = req.query;

    const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, templateName, { excelOnly: true });
    if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
      return res.status(404).json(buildMissingTemplateResponse(templateName));
    }

    try {
      if (!startDate || !endDate) {
        return res.status(400).json({ success: false, error: 'startDate 諛?endDate媛 ?꾩슂?⑸땲??' });
      }

      const range = normalizeDateRange(startDate, endDate);
      const { siteName } = req.query;
      const activeDates = getActiveDates(db, range.startDate, range.endDate, siteName);
      console.log(`[Active Dates API] Range: ${range.startDate} ~ ${range.endDate}, Site: ${siteName || 'ALL'}, Found: ${activeDates.length}`);
      if (activeDates.length > 0) {
          console.log(`[Active Dates API] Sample dates: ${activeDates.slice(0, 5).join(', ')}${activeDates.length > 5 ? '...' : ''}`);
      }
      return res.json({ success: true, activeDates });
    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get('/api/logs/preview-manifest', async (req, res) => {
    const { startDate, endDate, date, templateName } = req.query;

    const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, templateName, { excelOnly: true });
    if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
      return res.status(404).json(buildMissingTemplateResponse(templateName));
    }

    try {
      const { siteName } = req.query;
      const range = normalizeDateRange(startDate || date, endDate || date || startDate);
      const manifest = buildPreviewManifest(db, range.startDate, range.endDate, siteName);

      return res.json({ success: true, ...manifest });
    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get('/api/logs/preview-pdf', async (req, res) => {
    const { date, startDate, endDate, pageKey, templateName, download } = req.query;
    const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, templateName, { excelOnly: true });

    if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
      return res.status(404).json(buildMissingTemplateResponse(templateName));
    }

    try {
      const { siteName } = req.query;
      const range = normalizeDateRange(startDate || date, endDate || date || startDate);
      const manifest = buildPreviewManifest(db, range.startDate, range.endDate, siteName);
      const targetPage = findPageInManifest(manifest, pageKey);

      if (!targetPage) {
        return res.status(404).json({ error: 'Preview page not found' });
      }

      const { pdfPath } = await buildPagePreviewPdf({
        db,
        baseDir,
        appDataPath,
        templateInfo,
        page: targetPage,
        siteName,
      });

      const outputFileName = `${path.parse(templateInfo.fileName).name}-${targetPage.date}-${targetPage.pageNumberForDate}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `${download === '1' ? 'attachment' : 'inline'}; filename="preview.pdf"; filename*=UTF-8''${encodeURIComponent(outputFileName)}`
      );
      res.setHeader('Cache-Control', 'private, max-age=3600');

      return res.sendFile(pdfPath);
    } catch (err) {
      console.error('[Excel Preview PDF Error]', err.message);
      return res.status(500).json({ error: `Excel PDF 誘몃━蹂닿린 ?앹꽦???ㅽ뙣?덉뒿?덈떎: ${err.message}` });
    }
  });

  router.get('/api/logs/preview-page-data', async (req, res) => {
    const { date, startDate, endDate, pageKey, templateName } = req.query;
    const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, templateName, { excelOnly: true });

    if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
      return res.status(404).json(buildMissingTemplateResponse(templateName));
    }

    try {
      const { siteName } = req.query;
      const range = normalizeDateRange(startDate || date, endDate || date || startDate);
      const manifest = buildPreviewManifest(db, range.startDate, range.endDate, siteName);
      const targetPage = findPageInManifest(manifest, pageKey);

      if (!targetPage) {
        return res.status(404).json({ error: 'Preview page not found' });
      }

      const renderData = buildPageRenderData({ db, baseDir, page: targetPage, siteName });
      const photoUrls = Object.fromEntries(
        Object.entries(renderData.selectedPhotos || {})
          .filter(([, photoPath]) => Boolean(photoPath))
          .map(([analyteKey]) => [
            analyteKey,
            `${req.protocol}://${req.get('host')}/api/logs/preview-photo?startDate=${encodeURIComponent(range.startDate)}&endDate=${encodeURIComponent(range.endDate)}&pageKey=${encodeURIComponent(targetPage.pageKey)}&templateName=${encodeURIComponent(templateInfo.fileName)}&analyte=${encodeURIComponent(analyteKey)}${siteName ? `&siteName=${encodeURIComponent(siteName)}` : ''}`,
          ])
      );

      return res.json({
        success: true,
        page: {
          ...renderData,
          photoUrls,
          selectedPhotos: undefined,
        },
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/api/logs/preview-photo', async (req, res) => {
    const { date, startDate, endDate, pageKey, templateName, analyte } = req.query;
    const analyteKey = String(analyte || '').trim();
    const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, templateName, { excelOnly: true });

    if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
      return res.status(404).json(buildMissingTemplateResponse(templateName));
    }

    if (!analyteKey) {
      return res.status(400).json({ error: 'analyte is required' });
    }

    try {
      const { siteName } = req.query;
      const range = normalizeDateRange(startDate || date, endDate || date || startDate);
      const manifest = buildPreviewManifest(db, range.startDate, range.endDate, siteName);
      const parsedPageKey = pageKey ? parsePageKey(pageKey) : null;
      const targetPage = findPageInManifest(manifest, pageKey || (parsedPageKey ? pageKey : ''));

      if (!targetPage) {
        return res.status(404).json({ error: 'Preview page not found' });
      }

      const renderData = buildPageRenderData({ db, baseDir, page: targetPage, siteName });
      const photoPath = renderData.selectedPhotos?.[analyteKey];

      if (!photoPath || !fs.existsSync(photoPath)) {
        return res.status(404).json({ error: 'Preview photo not found' });
      }

      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.sendFile(photoPath);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/logs/batch-pdf', async (req, res) => {
    const { date, startDate, endDate, templateName, download } = req.query;
    const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, templateName, { excelOnly: true });

    if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
      return res.status(404).json(buildMissingTemplateResponse(templateName));
    }

    try {
      const { siteName } = req.query;
      const range = normalizeDateRange(startDate || date, endDate || date || startDate);
      const manifest = buildPreviewManifest(db, range.startDate, range.endDate, siteName);
      const pdfPath = await buildBatchPreviewPdf({
        db,
        baseDir,
        appDataPath,
        templateInfo,
        manifest,
        siteName,
      });
      const outputFileName = `${path.parse(templateInfo.fileName).name}-${range.startDate}-${range.endDate}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `${download === '1' ? 'attachment' : 'inline'}; filename="report.pdf"; filename*=UTF-8''${encodeURIComponent(outputFileName)}`
      );
      res.setHeader('Cache-Control', 'private, max-age=3600');

      return res.sendFile(pdfPath);
    } catch (err) {
      console.error('[Excel Batch PDF Error]', err.message);
      return res.status(500).json({ error: `湲곌컙 PDF ?앹꽦???ㅽ뙣?덉뒿?덈떎: ${err.message}` });
    }
  });

  router.get('/api/logs/export', async (req, res) => {
    const { date, startDate, endDate, templateName } = req.query;
    const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, templateName, { excelOnly: true });

    if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
      return res.status(404).json(buildMissingTemplateResponse(templateName));
    }

    try {
      const { siteName } = req.query;
      const range = normalizeDateRange(startDate || date, endDate || date || startDate);
      console.log(`[Excel Export] Request Range: ${range.startDate} ~ ${range.endDate}, Site: ${siteName || 'ALL'}`);
      const manifest = buildPreviewManifest(db, range.startDate, range.endDate, siteName);
      console.log(`[Excel Export] Manifest generated. Total Sheets: ${manifest.pages.length}`);
      if (manifest.pages.length > 0) {
          const distinctDates = [...new Set(manifest.pages.map(p => p.date))];
          console.log(`[Excel Export] Manifest Dates: ${distinctDates.join(', ')}`);
      }
      
      if (!manifest.pages.length) {
          return res.status(400).json({ error: '?좏깮??湲곌컙???섏쭏遺꾩꽍 ?곗씠?곌? ?놁뒿?덈떎.' });
      }

      const outputPaths = await buildBatchExportExcel({
        db,
        baseDir,
        appDataPath,
        templateInfo,
        manifest,
        siteName,
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
      console.error('[Excel Batch Export Error]', err.message);
      return res.status(500).json({ error: `?대낫?닿린???ㅽ뙣?덉뒿?덈떎: ${err.message}` });
    }
  });

  router.get('/api/logs/generate-excel', async (req, res) => {
    const { date, templateName } = req.query;
    const mappingPath = path.join(baseDir, 'templates', 'mapping.json');
    const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, templateName, { excelOnly: true });

    if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
      return res.status(404).json(buildMissingTemplateResponse(templateName));
    }

    try {
      const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(templateInfo.absolutePath);
      const worksheet = workbook.worksheets[0];

      const flows = db.prepare('SELECT * FROM flow_readings WHERE date = ?').all(date);
      const medicines = db.prepare('SELECT * FROM medicine_logs WHERE date = ?').all(date);

      const getDataValue = (fieldName) => {
        if (fieldName === 'date') return date;
        const flowMatch = fieldName.match(/^flow_(\w+)_(\w+)$/);
        if (flowMatch) {
          const [, type, valType] = flowMatch;
          const r = flows.find(f => f.type === type);
          return r ? (valType === 'raw' ? r.raw_value : r.calculated_flow) : '';
        }
        const medMatch = fieldName.match(/^medicine_(\w+)_(\w+)$/);
        if (medMatch) {
          const [, name, valType] = medMatch;
          const m = medicines.find(med => med.medicine_name.includes(name));
          return m ? m[valType === 'usage' ? 'usage_amount' : 'purchase_amount'] : '';
        }
        return '';
      };

      const excelMapping = mapping.excel || {};
      for (const [cellAddr, config] of Object.entries(excelMapping)) {
        const field = typeof config === 'string' ? config : config.field;
        const type = typeof config === 'string' ? 'text' : config.type;
        if (type === 'text' || type === 'number') {
          worksheet.getCell(cellAddr).value = getDataValue(field);
        } else if (type === 'image') {
          const imagePath = path.join(baseDir, 'resources', 'images', date, `${field}.jpg`);
          if (fs.existsSync(imagePath)) {
            const imgId = workbook.addImage({ filename: imagePath, extension: 'jpeg' });
            worksheet.addImage(imgId, {
              tl: { col: worksheet.getCell(cellAddr).col - 1, row: worksheet.getCell(cellAddr).row - 1 },
              ext: { width: config.width || 200, height: config.height || 150 }
            });
          }
        }
      }

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=Log_${date}.xlsx`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      res.status(500).json({ error: 'Excel generation failed: ' + err.message });
    }
  });

  return router;
};
