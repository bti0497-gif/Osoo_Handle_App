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
const { restoreOperationalData } = require('../services/bigQueryRestoreService.cjs');
const { syncCertificateCacheForSiteMonth } = require('../services/certificateCacheSyncService.cjs');

const TEMPLATE_NAME = '일일업무일지';

const router = express.Router();

function buildMissingTemplateResponse() {
  return {
    code: 'REPORT_TEMPLATE_MISSING',
    error: `${TEMPLATE_NAME} 양식을 찾을 수 없습니다.`,
    userMessage: `${TEMPLATE_NAME} 양식을 찾을 수 없습니다.\n설정에서 ${TEMPLATE_NAME} 양식 파일을 업로드해 주세요.`
  };
}

function getMonthKeys(startDate, endDate) {
  const months = [];
  const cursor = new Date(`${startDate.slice(0, 7)}-01T00:00:00`);
  const end = new Date(`${endDate.slice(0, 7)}-01T00:00:00`);
  while (cursor <= end) {
    months.push({
      year: String(cursor.getFullYear()),
      month: String(cursor.getMonth() + 1).padStart(2, '0'),
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

module.exports = function (db, baseDir, appDataPath) {
  const getRequestContext = (req) => ({
    siteId: req.query.siteId || req.query.site_id || '',
    siteName: req.query.siteName || req.query.site_name || '',
    author: req.query.author || '',
  });

  const syncCertificateCacheForRange = async (range, context) => {
    const siteName = String(context.siteName || db.prepare('SELECT site_name FROM app_settings WHERE id = 1').get()?.site_name || '').trim();
    if (!siteName) return;

    for (const item of getMonthKeys(range.startDate, range.endDate)) {
      try {
        await syncCertificateCacheForSiteMonth({ db, siteName, year: item.year, month: item.month });
      } catch (err) {
        console.warn('[Daily Work Log] certificate cache sync skipped:', err.message);
      }
    }
  };

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
      await restoreOperationalData(db, {
        startDate: range.startDate,
        endDate: range.endDate,
        tables: ['flow_readings', 'medicine_logs', 'kit_logs'],
        ...getRequestContext(req),
      });
      await syncCertificateCacheForRange(range, getRequestContext(req));
      const activeDates = getActiveDates(db, range.startDate, range.endDate, getRequestContext(req));

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
      await restoreOperationalData(db, {
        startDate: range.startDate,
        endDate: range.endDate,
        tables: ['flow_readings', 'medicine_logs', 'kit_logs'],
        ...getRequestContext(req),
      });
      await syncCertificateCacheForRange(range, getRequestContext(req));
      const manifest = buildPreviewManifest(range.startDate, range.endDate);

      return res.json({ success: true, ...manifest });
    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
  });

  // 매니페스트 (날짜 범위 → 페이지 목록)
  router.get('/api/daily-work-log/preview-page-data', async (req, res) => {
    const { date, startDate, endDate, pageKey, templateName } = req.query;
    const resolvedTemplateName = templateName || TEMPLATE_NAME;

    const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, resolvedTemplateName, { excelOnly: true });
    if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
      return res.status(404).json(buildMissingTemplateResponse());
    }

    try {
      const range = normalizeDateRange(startDate || date, endDate || date || startDate);
      await restoreOperationalData(db, {
        startDate: range.startDate,
        endDate: range.endDate,
        tables: ['flow_readings', 'medicine_logs', 'kit_logs'],
        ...getRequestContext(req),
      });
      await syncCertificateCacheForRange(range, getRequestContext(req));
      const manifest = buildPreviewManifest(range.startDate, range.endDate);
      const targetPage = findPageInManifest(manifest, pageKey);

      if (!targetPage) {
        return res.status(404).json({ error: 'Preview page not found' });
      }

      const renderData = buildPageRenderData(db, targetPage, getRequestContext(req));

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

    // DEBUG: 어떤 양식 파일이 사용되는지 확인
    const tStat = fs.statSync(templateInfo.absolutePath);
    console.log(`[Daily Work Log Export] Template: ${templateInfo.absolutePath} (${tStat.size} bytes, mtime: ${tStat.mtime.toISOString()})`);

    try {
      const range = normalizeDateRange(startDate || date, endDate || date || startDate);
      await restoreOperationalData(db, {
        startDate: range.startDate,
        endDate: range.endDate,
        tables: ['flow_readings', 'medicine_logs', 'kit_logs'],
        ...getRequestContext(req),
      });
      await syncCertificateCacheForRange(range, getRequestContext(req));
      const manifest = buildPreviewManifest(range.startDate, range.endDate);
      
      if (!manifest.pages.length) {
          return res.status(400).json({ error: '선택한 기간에 데이터가 없습니다.' });
      }

      const outputPaths = await buildBatchExportExcel({
          db,
          appDataPath,
          templateInfo,
          manifest,
          context: getRequestContext(req)
      });
      
      // 생성된 각 파일을 시스템 기본 프로그램(Excel)으로 열기
      const { openExcelFile } = require('../services/excelOpenService.cjs');
      for (const filePath of outputPaths) {
        await openExcelFile(filePath);
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
