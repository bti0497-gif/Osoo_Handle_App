'use strict';

const fs = require('fs');
const path = require('path');

const { db, appDataPath } = require('../server/database.cjs');
const {
  buildDailyWorkLogHwp,
  buildBatchDailyWorkLogPdf,
} = require('../server/services/dailyWorkLogHwpService.cjs');

async function main() {
  const requestedDates = process.argv.slice(2).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  const shouldBuildPdf = process.argv.includes('--pdf');
  const requestedMethod = process.argv.find((value) => /^--method=(A2O|MBR)$/i.test(value))?.split('=')[1]?.toUpperCase();
  const latest = db.prepare(`
    SELECT date
    FROM (
      SELECT date FROM flow_readings
      UNION SELECT date FROM medicine_logs
      UNION SELECT date FROM qntech_water_quality
    )
    WHERE date IS NOT NULL
    ORDER BY date DESC
    LIMIT 1
  `).get();
  const date = requestedDates[0] || latest?.date || new Date().toISOString().slice(0, 10);
  const settings = db.prepare(`
    SELECT app_settings.site_id, app_settings.site_name, app_settings.manager_name, app_settings.method
    FROM app_settings
    WHERE app_settings.id = 1
  `).get() || {};
  const method = requestedMethod
    || (String(settings.method || 'A2O').replace(/\s+/g, '').toUpperCase() === 'MBR' ? 'MBR' : 'A2O');
  const templatePath = path.join(__dirname, '..', 'templates', 'reports', `일일업무일지(${method}).hwp`);
  if (!fs.existsSync(templatePath)) throw new Error(`검증할 HWP 양식이 없습니다: ${templatePath}`);

  const templateInfo = { fileName: path.basename(templatePath), absolutePath: templatePath };
  const context = {
    siteId: settings.site_id || '',
    siteName: settings.site_name || '',
    author: settings.manager_name || '',
    method,
  };
  const hwp = await buildDailyWorkLogHwp({ db, appDataPath, templateInfo, date, context });
  const summary = {
    date,
    method,
    siteName: context.siteName,
    outputPath: hwp.outputPath,
    replacedCount: hwp.replacedCount,
    outputSize: fs.statSync(hwp.outputPath).size,
    boundSiteName: hwp.bookmarkValues.현장명,
  };

  if (shouldBuildPdf) {
    const pdf = await buildBatchDailyWorkLogPdf({
      db,
      appDataPath,
      templateInfo,
      manifest: { pages: (requestedDates.length ? requestedDates : [date]).map((item) => ({ date: item })) },
      context,
    });
    summary.pdfPath = pdf.outputPath;
    summary.pdfPages = pdf.pageCount;
  }

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    try { db.close(); } catch (_) {}
  });
