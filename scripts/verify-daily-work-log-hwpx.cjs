'use strict';

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const { db, appDataPath } = require('../server/database.cjs');
const {
  buildDailyWorkLogHwpx,
  buildBatchDailyWorkLogPdf,
} = require('../server/services/dailyWorkLogHwpxService.cjs');

async function countStaticCircleMarks(filePath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  let count = 0;
  for (const name of Object.keys(zip.files).filter((item) => /^Contents\/section\d+\.xml$/i.test(item))) {
    const xml = await zip.file(name).async('string');
    count += (xml.match(/○/g) || []).length;
  }
  return count;
}

async function main() {
  const requestedDates = process.argv.slice(2).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  const requestedDate = requestedDates[0];
  const shouldBuildPdf = process.argv.includes('--pdf');
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
  const date = requestedDate || latest?.date || new Date().toISOString().slice(0, 10);
  const templateDir = path.join(__dirname, '..', 'templates', 'reports');
  const fileName = fs.readdirSync(templateDir).find((name) => name.toLowerCase().endsWith('.hwpx'));
  if (!fileName) throw new Error('검증할 HWPX 양식을 찾을 수 없습니다.');

  const templateInfo = {
    fileName,
    absolutePath: path.join(templateDir, fileName),
  };
  const settings = db.prepare(`
    SELECT app_settings.site_id, app_settings.site_name, app_settings.manager_name, app_settings.method,
           sites.target_lat, sites.target_lng
    FROM app_settings
    LEFT JOIN sites ON sites.id = app_settings.site_id
    WHERE app_settings.id = 1
  `).get() || {};
  const context = {
    siteId: settings.site_id || '',
    siteName: settings.site_name || '',
    author: settings.manager_name || '',
  };

  const beforeCircleCount = await countStaticCircleMarks(templateInfo.absolutePath);
  const hwpx = await buildDailyWorkLogHwpx({ db, appDataPath, templateInfo, date, context });
  const afterCircleCount = await countStaticCircleMarks(hwpx.outputPath);
  const summary = {
    date,
    method: settings.method,
    location: { latitude: settings.target_lat, longitude: settings.target_lng },
    outputPath: hwpx.outputPath,
    replacedCount: hwpx.replacedCount,
    beforeCircleCount,
    afterCircleCount,
    selectedBindings: {
      날짜: hwpx.bookmarkValues.날짜,
      날씨: hwpx.bookmarkValues.날씨,
      기온: hwpx.bookmarkValues.기온,
      침전1: hwpx.bookmarkValues.침전1,
      분리막1: hwpx.bookmarkValues.분리막1,
      응집1: hwpx.bookmarkValues.응집1,
      여과1: hwpx.bookmarkValues.여과1,
      시간: hwpx.bookmarkValues.시간,
      반출량: hwpx.bookmarkValues.반출량,
      계근량: hwpx.bookmarkValues.계근량,
      분석자명: hwpx.bookmarkValues.분석자명,
      유량조암모: hwpx.bookmarkValues.유량조암모,
      유량조질산: hwpx.bookmarkValues.유량조질산,
      무산소암모: hwpx.bookmarkValues.무산소암모,
      포기조암모: hwpx.bookmarkValues.포기조암모,
      침전조암모: hwpx.bookmarkValues.침전조암모,
      방류암모: hwpx.bookmarkValues.방류암모,
    },
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
