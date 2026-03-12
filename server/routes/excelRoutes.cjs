const express = require('express');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const {
  buildBatchPreviewPdf,
  buildPreviewManifest,
  buildPageRenderData,
  buildPagePreviewPdf,
  findPageInManifest,
  normalizeDateRange,
  parsePageKey,
} = require('../services/dailyLogPreviewService.cjs');
const { resolveReportTemplatePath } = require('../services/reportTemplateService.cjs');
const { getHtmlTemplatePath } = require('../services/excelTemplateHtmlService.cjs');
const router = express.Router();

function buildMissingTemplateResponse(templateName) {
  const requestedTemplateName = String(templateName || '수질분석일지').trim() || '수질분석일지';
  return {
    code: 'REPORT_TEMPLATE_MISSING',
    error: `${requestedTemplateName} 양식을 찾을 수 없습니다.`,
    userMessage: `${requestedTemplateName} 양식을 찾을 수 없습니다.\n설정에서 ${requestedTemplateName} 양식 파일을 업로드해 주세요.`
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
        error: 'HTML 템플릿을 찾을 수 없습니다.',
        userMessage: 'HTML 템플릿이 아직 생성되지 않았습니다. 설정에서 양식 파일을 다시 업로드해 주세요.'
      });
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.sendFile(htmlPath);
  });

  router.get('/api/logs/preview-manifest', async (req, res) => {
    const { startDate, endDate, date, templateName } = req.query;

    const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, templateName, { excelOnly: true });
    if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
      return res.status(404).json(buildMissingTemplateResponse(templateName));
    }

    try {
      const range = normalizeDateRange(startDate || date, endDate || date || startDate);
      const manifest = buildPreviewManifest(db, range.startDate, range.endDate);

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
      const range = normalizeDateRange(startDate || date, endDate || date || startDate);
      const manifest = buildPreviewManifest(db, range.startDate, range.endDate);
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
      return res.status(500).json({ error: `Excel PDF 미리보기 생성에 실패했습니다: ${err.message}` });
    }
  });

  router.get('/api/logs/preview-page-data', async (req, res) => {
    const { date, startDate, endDate, pageKey, templateName } = req.query;
    const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, templateName, { excelOnly: true });

    if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
      return res.status(404).json(buildMissingTemplateResponse(templateName));
    }

    try {
      const range = normalizeDateRange(startDate || date, endDate || date || startDate);
      const manifest = buildPreviewManifest(db, range.startDate, range.endDate);
      const targetPage = findPageInManifest(manifest, pageKey);

      if (!targetPage) {
        return res.status(404).json({ error: 'Preview page not found' });
      }

      const renderData = buildPageRenderData({ db, baseDir, page: targetPage });
      const photoUrls = Object.fromEntries(
        Object.entries(renderData.selectedPhotos || {})
          .filter(([, photoPath]) => Boolean(photoPath))
          .map(([analyteKey]) => [
            analyteKey,
            `${req.protocol}://${req.get('host')}/api/logs/preview-photo?startDate=${encodeURIComponent(range.startDate)}&endDate=${encodeURIComponent(range.endDate)}&pageKey=${encodeURIComponent(targetPage.pageKey)}&templateName=${encodeURIComponent(templateInfo.fileName)}&analyte=${encodeURIComponent(analyteKey)}`,
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
      const range = normalizeDateRange(startDate || date, endDate || date || startDate);
      const manifest = buildPreviewManifest(db, range.startDate, range.endDate);
      const parsedPageKey = pageKey ? parsePageKey(pageKey) : null;
      const targetPage = findPageInManifest(manifest, pageKey || (parsedPageKey ? pageKey : ''));

      if (!targetPage) {
        return res.status(404).json({ error: 'Preview page not found' });
      }

      const renderData = buildPageRenderData({ db, baseDir, page: targetPage });
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
      const range = normalizeDateRange(startDate || date, endDate || date || startDate);
      const manifest = buildPreviewManifest(db, range.startDate, range.endDate);
      const pdfPath = await buildBatchPreviewPdf({
        db,
        baseDir,
        appDataPath,
        templateInfo,
        manifest,
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
      return res.status(500).json({ error: `기간 PDF 생성에 실패했습니다: ${err.message}` });
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
