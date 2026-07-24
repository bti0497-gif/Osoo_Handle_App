const express = require('express');
const path = require('path');
const fs = require('fs');
const {
  buildBatchExportExcel,
  buildPreviewManifest,
  buildPageRenderData,
  findPageInManifest,
  normalizeDateRange,
  parsePageKey,
  getActiveDates,
} = require('../services/dailyWorkLogService.cjs');
const { resolveReportTemplatePath } = require('../services/reportTemplateService.cjs');
const {
  buildBatchDailyWorkLogHwp,
  buildBatchDailyWorkLogPdf,
} = require('../services/dailyWorkLogHwpService.cjs');
const { syncCertificateCacheForSiteMonth } = require('../services/certificateCacheSyncService.cjs');
const { acquireDailyLogDatabase } = require('../services/bidirectionalDailyLogService.cjs');

const TEMPLATE_NAME = '일일업무일지';

const router = express.Router();

function buildMissingTemplateResponse() {
  return {
    code: 'REPORT_TEMPLATE_MISSING',
    error: `${TEMPLATE_NAME} 양식을 찾을 수 없습니다.`,
    userMessage: `${TEMPLATE_NAME} 양식을 찾을 수 없습니다.\n설정에서 ${TEMPLATE_NAME} 양식 파일을 업로드해 주세요.`
  };
}

function buildMissingHwpTemplateResponse() {
  return {
    code: 'REPORT_HWP_TEMPLATE_MISSING',
    error: `${TEMPLATE_NAME} HWP 양식을 찾을 수 없습니다.`,
    userMessage: `설정에서 ${TEMPLATE_NAME}(A2O).hwp 및 ${TEMPLATE_NAME}(MBR).hwp 양식을 업로드해 주세요.`,
  };
}

function isHwpAutomationUnavailable(error) {
  const message = String(error?.message || error || '');
  return message.includes('REGDB_E_CLASSNOTREG')
    || message.includes('0x80040154')
    || message.includes('HWPFrame.HwpObject')
    || message.includes('NoCOMClassIdentified');
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
  const getCurrentMethod = (siteId = '') => (
    (siteId ? db.prepare('SELECT method FROM sites WHERE id = ?').get(siteId)?.method : '')
    || db.prepare('SELECT method FROM app_settings WHERE id = 1').get()?.method
    || ''
  );

  const getRequestContext = (req) => {
    const siteId = req.query.siteId || req.query.site_id || req.siteContext?.siteId || '';
    return ({
    siteId,
    siteName: req.query.siteName || req.query.site_name || req.siteContext?.siteName || '',
    author: req.query.author || '',
    method: req.query.method || getCurrentMethod(siteId),
    dataSource: req.query.dataSource || req.query.data_source || 'local',
    localSiteName: req.query.localSiteName || req.query.local_site_name || '',
  });
  };

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
      const acquired = await acquireDailyLogDatabase(db, appDataPath, getRequestContext(req), range.startDate, range.endDate);
      try {
        if (!acquired.isRemote) await syncCertificateCacheForRange(range, acquired.context);
        const activeDates = getActiveDates(acquired.db, range.startDate, range.endDate, acquired.context);
        return res.json({ success: true, activeDates, dataSource: acquired.isRemote ? 'bigquery' : 'local' });
      } finally {
        acquired.release();
      }
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

  // 매니페스트 (날짜 범위 → 페이지 목록)
  router.get('/api/daily-work-log/preview-page-data', async (req, res) => {
    const { date, startDate, endDate, pageKey, templateName } = req.query;
    const resolvedTemplateName = templateName || TEMPLATE_NAME;

    const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, resolvedTemplateName, { excelOnly: true });
    if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
      return res.status(404).json(buildMissingTemplateResponse());
    }

    try {
      const parsedPageKey = parsePageKey(pageKey);
      const requestedDate = date || parsedPageKey?.date || startDate || endDate;
      const range = requestedDate
        ? normalizeDateRange(requestedDate, requestedDate)
        : normalizeDateRange(startDate, endDate);
      const manifest = buildPreviewManifest(range.startDate, range.endDate);
      const targetPage = findPageInManifest(manifest, pageKey)
        || (parsedPageKey?.date === range.startDate ? manifest.pages[0] : null);

      if (!targetPage) {
        return res.status(404).json({ error: 'Preview page not found' });
      }

      const acquired = await acquireDailyLogDatabase(db, appDataPath, getRequestContext(req), range.startDate, range.endDate);
      try {
        if (!acquired.isRemote) await syncCertificateCacheForRange(range, acquired.context);
        const renderData = buildPageRenderData(acquired.db, targetPage, acquired.context);
        return res.json({
          success: true,
          page: renderData,
          dataSource: acquired.isRemote ? 'bigquery' : 'local',
        });
      } finally {
        acquired.release();
      }
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
      const manifest = buildPreviewManifest(range.startDate, range.endDate);
      
      if (!manifest.pages.length) {
          return res.status(400).json({ error: '선택한 기간에 데이터가 없습니다.' });
      }

      const acquired = await acquireDailyLogDatabase(db, appDataPath, getRequestContext(req), range.startDate, range.endDate);
      let outputPaths;
      try {
        if (!acquired.isRemote) await syncCertificateCacheForRange(range, acquired.context);
        outputPaths = await buildBatchExportExcel({
            db: acquired.db,
            appDataPath,
            templateInfo,
            manifest,
            context: acquired.context
        });
      } finally {
        acquired.release();
      }
      
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

  router.get('/api/daily-work-log/export-pdf', async (req, res) => {
    const { startDate, endDate, date, templateName } = req.query;
    const resolvedTemplateName = templateName || TEMPLATE_NAME;
    const context = getRequestContext(req);
    const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, resolvedTemplateName, {
      hwpOnly: true,
      method: context.method,
    });
    if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
      return res.status(404).json(buildMissingHwpTemplateResponse());
    }

    try {
      const range = normalizeDateRange(startDate || date, endDate || date || startDate);
      const acquired = await acquireDailyLogDatabase(db, appDataPath, context, range.startDate, range.endDate);
      const manifest = buildPreviewManifest(range.startDate, range.endDate);
      let result;
      try {
        if (!acquired.isRemote) await syncCertificateCacheForRange(range, acquired.context);
        result = await buildBatchDailyWorkLogPdf({
          db: acquired.db,
          appDataPath,
          templateInfo,
          manifest,
          context: acquired.context,
        });
      } finally {
        acquired.release();
      }
      const { openExcelFile } = require('../services/excelOpenService.cjs');
      await openExcelFile(result.outputPath);
      return res.json({
        success: true,
        message: `${result.pageCount}페이지 PDF를 열었습니다.`,
        file: path.basename(result.outputPath),
        files: [path.basename(result.outputPath)],
        pageCount: result.pageCount,
        dateCount: manifest.pages.length,
      });
    } catch (err) {
      console.error('[Daily Work Log PDF Export Error]', err.message);
      if (isHwpAutomationUnavailable(err)) {
        return res.status(503).json({
          success: false,
          code: 'HWP_AUTOMATION_UNAVAILABLE',
          error: '한글 PDF 변환 기능을 사용할 수 없습니다.',
          userMessage: 'PDF 출력에는 한글 프로그램 설치가 필요합니다.',
        });
      }
      return res.status(500).json({ success: false, error: `PDF 생성에 실패했습니다: ${err.message}` });
    }
  });

  router.get(['/api/daily-work-log/export-hwp', '/api/daily-work-log/export-hwpx'], async (req, res) => {
    const { startDate, endDate, date, templateName } = req.query;
    const resolvedTemplateName = templateName || TEMPLATE_NAME;
    const context = getRequestContext(req);
    const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, resolvedTemplateName, {
      hwpOnly: true,
      method: context.method,
    });
    if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
      return res.status(404).json(buildMissingHwpTemplateResponse());
    }

    try {
      const range = normalizeDateRange(startDate || date, endDate || date || startDate);
      const acquired = await acquireDailyLogDatabase(db, appDataPath, context, range.startDate, range.endDate);

      const manifest = buildPreviewManifest(range.startDate, range.endDate);
      let results;
      try {
        if (!acquired.isRemote) await syncCertificateCacheForRange(range, acquired.context);
        results = await buildBatchDailyWorkLogHwp({
          db: acquired.db,
          appDataPath,
          templateInfo,
          manifest,
          context: acquired.context,
        });
      } finally {
        acquired.release();
      }

      const { openExcelFile } = require('../services/excelOpenService.cjs');
      for (const result of results) {
        await openExcelFile(result.outputPath);
      }

      return res.json({
        success: true,
        message: `${results.length}개의 HWP 일지를 열었습니다.`,
        files: results.map((result) => path.basename(result.outputPath)),
        bookmarkCount: results.reduce((sum, result) => sum + result.replacedCount, 0),
      });
    } catch (err) {
      console.error('[Daily Work Log HWP Export Error]', err);
      return res.status(500).json({
        success: false,
        error: `HWP 생성에 실패했습니다: ${err.message}`,
      });
    }
  });

  return router;
};
