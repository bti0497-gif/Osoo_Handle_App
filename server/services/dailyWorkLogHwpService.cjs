'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

const { buildHwpxBookmarkValues } = require('./dailyWorkLogHwpxService.cjs');
const { convertHwpToPdf, ensureHwpSecurityModule } = require('./hwpPdfService.cjs');

const SECURITY_MODULE_NAME = 'OsooHandleFilePathChecker';
let conversionQueue = Promise.resolve();

function toPowerShellLiteral(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function buildEncodedCommand(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function ensureOutputDirectory(appDataPath) {
  const root = appDataPath || path.join(os.tmpdir(), 'osoo-handle-app');
  const outputDir = path.join(root, 'temp', 'daily-work-log-hwp');
  fs.mkdirSync(outputDir, { recursive: true });
  return outputDir;
}

function getAvailableOutputPath(appDataPath, date) {
  const outputDir = ensureOutputDirectory(appDataPath);
  const preferred = path.join(outputDir, `일일업무일지_${date}.hwp`);
  if (!fs.existsSync(preferred)) return preferred;
  return path.join(outputDir, `일일업무일지_${date}_${Date.now()}.hwp`);
}

function runPowerShell(script, timeout = 180000) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', buildEncodedCommand(script)],
      { timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(String(stderr || stdout || error.message).trim()));
          return;
        }
        resolve(String(stdout || '').trim());
      }
    );
  });
}

async function bindHwpTemplate({ templatePath, outputPath, bookmarkValues }) {
  await ensureHwpSecurityModule();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'osoo-hwp-bind-'));
  const valuesPath = path.join(tempDir, 'bookmark-values.json');
  fs.writeFileSync(valuesPath, JSON.stringify(bookmarkValues), 'utf8');

  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$templatePath = ${toPowerShellLiteral(path.resolve(templatePath))}`,
    `$outputPath = ${toPowerShellLiteral(path.resolve(outputPath))}`,
    `$valuesPath = ${toPowerShellLiteral(valuesPath)}`,
    "if (-not (Test-Path -LiteralPath $templatePath)) { throw \"HWP template not found: $templatePath\" }",
    "if (Test-Path -LiteralPath $outputPath) { Remove-Item -LiteralPath $outputPath -Force }",
    "$values = Get-Content -LiteralPath $valuesPath -Raw -Encoding UTF8 | ConvertFrom-Json",
    "$hwp = $null",
    "try {",
    "  $hwp = New-Object -ComObject HWPFrame.HwpObject",
    `  $securityRegistered = $hwp.RegisterModule('FilePathCheckDLL', '${SECURITY_MODULE_NAME}')`,
    "  if (-not $securityRegistered) { throw '한글 파일 접근 보안 모듈 등록에 실패했습니다.' }",
    "  try { $hwp.SetMessageBoxMode(0x00020000) } catch { }",
    "  $opened = $hwp.Open($templatePath, 'HWP', 'forceopen:true')",
    "  if (-not $opened) { throw '한글에서 HWP 기본양식을 열지 못했습니다.' }",
    "  $xml = [string]$hwp.GetTextFile('HWPML2X', '')",
    "  $replaced = 0",
    "  foreach ($property in $values.PSObject.Properties) {",
    "    $name = [string]$property.Name",
    "    $value = if ($null -eq $property.Value) { '' } else { [string]$property.Value }",
    "    $escapedName = [System.Security.SecurityElement]::Escape($name)",
    "    $marker = '<BOOKMARK Name=\"' + $escapedName + '\"/>'",
    "    if (-not $xml.Contains($marker)) { continue }",
    "    $escapedValue = [System.Security.SecurityElement]::Escape($value)",
    "    $xml = $xml.Replace($marker, $marker + '<CHAR>' + $escapedValue + '</CHAR>')",
    "    $replaced += 1",
    "  }",
    "  if ($replaced -eq 0) { throw 'HWP 양식에서 바인딩 가능한 책갈피를 찾지 못했습니다.' }",
    "  $loaded = $hwp.SetTextFile($xml, 'HWPML2X', '')",
    "  if ($loaded -ne 1) { throw '바인딩된 HWP 문서를 다시 불러오지 못했습니다.' }",
    "  $saved = $hwp.SaveAs($outputPath, 'HWP', '')",
    "  if (-not $saved) { throw '바인딩된 HWP 문서를 저장하지 못했습니다.' }",
    "  Write-Output $replaced",
    "} finally {",
    "  if ($hwp -ne $null) {",
    "    try { $hwp.Clear(1) } catch { }",
    "    try { $hwp.Quit() } catch { }",
    "    try { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($hwp) } catch { }",
    "  }",
    "  [GC]::Collect()",
    "  [GC]::WaitForPendingFinalizers()",
    "}",
  ].join('\n');

  try {
    const output = await runPowerShell(script);
    if (!fs.existsSync(outputPath)) throw new Error('HWP 출력 파일이 생성되지 않았습니다.');
    return Number(String(output).split(/\r?\n/).pop()) || 0;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function buildDailyWorkLogHwp({ db, appDataPath, templateInfo, date, context = {} }) {
  const bookmarkValues = await buildHwpxBookmarkValues(db, appDataPath, date, context);
  const settings = db.prepare('SELECT site_id, site_name FROM app_settings WHERE id = 1').get() || {};
  bookmarkValues.현장명 = String(context.siteName || settings.site_name || '').trim();
  if (!bookmarkValues.현장명) {
    throw new Error('HWP 일지에 바인딩할 현장명이 없습니다.');
  }

  const outputPath = getAvailableOutputPath(appDataPath, date);
  const replacedCount = await bindHwpTemplate({
    templatePath: templateInfo.absolutePath,
    outputPath,
    bookmarkValues,
  });
  return { outputPath, replacedCount, bookmarkValues };
}

function enqueue(task) {
  const queued = conversionQueue.catch(() => {}).then(task);
  conversionQueue = queued.catch(() => {});
  return queued;
}

function buildBatchDailyWorkLogHwp({ db, appDataPath, templateInfo, manifest, context = {} }) {
  return enqueue(async () => {
    const results = [];
    const dates = [...new Set(manifest.pages.map((page) => page.date))];
    for (const date of dates) {
      results.push(await buildDailyWorkLogHwp({ db, appDataPath, templateInfo, date, context }));
    }
    return results;
  });
}

async function mergePdfFiles(pdfPaths, outputPath) {
  const merged = await PDFDocument.create();
  for (const pdfPath of pdfPaths) {
    const source = await PDFDocument.load(fs.readFileSync(pdfPath));
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  fs.writeFileSync(outputPath, await merged.save());
  return { outputPath, pageCount: merged.getPageCount() };
}

async function buildBatchDailyWorkLogPdf({ db, appDataPath, templateInfo, manifest, context = {} }) {
  const hwpResults = await buildBatchDailyWorkLogHwp({ db, appDataPath, templateInfo, manifest, context });
  const pdfPaths = [];
  for (const result of hwpResults) {
    const pdfPath = result.outputPath.replace(/\.hwp$/i, '.pdf');
    await convertHwpToPdf(result.outputPath, pdfPath);
    pdfPaths.push(pdfPath);
  }

  const dates = hwpResults
    .map((result) => path.basename(result.outputPath).match(/(\d{4}-\d{2}-\d{2})/)?.[1])
    .filter(Boolean);
  const fileName = dates.length <= 1
    ? `일일업무일지_${dates[0] || 'output'}.pdf`
    : `일일업무일지_${dates[0]}_${dates[dates.length - 1]}.pdf`;
  const outputPath = path.join(ensureOutputDirectory(appDataPath), fileName);
  const merged = await mergePdfFiles(pdfPaths, outputPath);
  return { ...merged, hwpResults, pdfPaths };
}

module.exports = {
  bindHwpTemplate,
  buildBatchDailyWorkLogHwp,
  buildBatchDailyWorkLogPdf,
  buildDailyWorkLogHwp,
};
