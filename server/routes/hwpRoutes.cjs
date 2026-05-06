const express = require('express');
const path = require('path');
const fs = require('fs');

const { resolveReportTemplatePath } = require('../services/reportTemplateService.cjs');
const { renderHwpxToPdf } = require('../services/hwpPdfService.cjs');

const router = express.Router();

module.exports = function (db, baseDir, appDataPath) {
  router.get('/api/hwp/preview-pdf', async (req, res) => {
    const { templateName, download } = req.query;
    const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, templateName, { excelOnly: false });

    if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
      return res.status(404).json({
        code: 'HWP_TEMPLATE_MISSING',
        error: '?쒓? ?묒떇??李얠쓣 ???놁뒿?덈떎.',
        userMessage: '?ㅼ젙?먯꽌 ?쒓?(HWPX) ?묒떇 ?뚯씪???낅줈?쒗빐 二쇱꽭??'
      });
    }

    const ext = path.extname(templateInfo.absolutePath).toLowerCase();
    if (ext !== '.hwpx') {
      return res.status(400).json({
        code: 'HWP_TEMPLATE_INVALID',
        error: 'HWPX ?뚯씪留?吏?먰빀?덈떎.',
        userMessage: 'HWPX ?뺤떇???묒떇???낅줈?쒗빐 二쇱꽭??'
      });
    }

    try {
      // TODO: 異뷀썑 mapping.json??hwp ?뱀뀡 湲곕컲?쇰줈 bindings/imageBindings 援ъ꽦
      const bindings = {};
      const imageBindings = {};

      const outputDir = path.join(appDataPath, 'temp', 'hwp-previews');
      const outputPath = path.join(outputDir, `${path.parse(templateInfo.fileName).name}-preview.pdf`);

      const pdfPath = await renderHwpxToPdf({
        templatePath: templateInfo.absolutePath,
        outputPath,
        bindings,
        imageBindings,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `${download === '1' ? 'attachment' : 'inline'}; filename="preview.pdf"; filename*=UTF-8''${encodeURIComponent(path.basename(pdfPath))}`
      );
      res.setHeader('Cache-Control', 'no-store');
      return res.sendFile(pdfPath);
    } catch (err) {
      console.error('[HWP Preview Error]', err.message);
      return res.status(500).json({
        code: 'HWP_PREVIEW_FAILED',
        error: err.message,
        userMessage: `?쒓? PDF 誘몃━蹂닿린 ?앹꽦???ㅽ뙣?덉뒿?덈떎: ${err.message}`
      });
    }
  });

  return router;
};
