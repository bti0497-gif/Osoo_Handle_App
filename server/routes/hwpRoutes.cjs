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
        error: '한글 양식을 찾을 수 없습니다.',
        userMessage: '설정에서 한글(HWPX) 양식 파일을 업로드해 주세요.'
      });
    }

    const ext = path.extname(templateInfo.absolutePath).toLowerCase();
    if (ext !== '.hwpx') {
      return res.status(400).json({
        code: 'HWP_TEMPLATE_INVALID',
        error: 'HWPX 파일만 지원합니다.',
        userMessage: 'HWPX 형식의 양식을 업로드해 주세요.'
      });
    }

    try {
      // TODO: 추후 mapping.json의 hwp 섹션 기반으로 bindings/imageBindings 구성
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
        userMessage: `한글 PDF 미리보기 생성에 실패했습니다: ${err.message}`
      });
    }
  });

  return router;
};
