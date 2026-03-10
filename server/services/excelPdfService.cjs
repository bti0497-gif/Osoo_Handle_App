const ExcelJS = require('exceljs');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pdfConversionQueue = Promise.resolve();
let warmupPromise = null;
let hasWarmedUp = false;

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

function buildEncodedPowerShellCommand(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function sanitizeFileNameSegment(value) {
  return String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, '_');
}

function toPowerShellLiteral(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function runExcelToPdfConversion(sourcePath, outputPath) {
  const sourceAbsolutePath = path.resolve(sourcePath);
  const outputAbsolutePath = path.resolve(outputPath);

  const powerShellScript = [
    "$ErrorActionPreference = 'Stop'",
    `$sourcePath = ${toPowerShellLiteral(sourceAbsolutePath)}`,
    `$outputPath = ${toPowerShellLiteral(outputAbsolutePath)}`,
    "$outputDirectory = Split-Path -Parent $outputPath",
    "if (-not (Test-Path -LiteralPath $sourcePath)) { throw \"Excel template file not found: $sourcePath\" }",
    "if (-not (Test-Path -LiteralPath $outputDirectory)) { New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null }",
    "if (Test-Path -LiteralPath $outputPath) { Remove-Item -LiteralPath $outputPath -Force }",
    "$excel = $null",
    "$workbook = $null",
    "try {",
    "  $excel = New-Object -ComObject Excel.Application",
    "  $excel.Visible = $false",
    "  $excel.DisplayAlerts = $false",
    "  $excel.EnableEvents = $false",
    "  $excel.AskToUpdateLinks = $false",
    "  $excel.AutomationSecurity = 3",
    "  $workbook = $excel.Workbooks.Open($sourcePath, 0, $true)",
    "  $xlTypePDF = 0",
    "  $workbook.ExportAsFixedFormat($xlTypePDF, $outputPath)",
    "} finally {",
    "  if ($workbook -ne $null) { $workbook.Close($false) }",
    "  if ($excel -ne $null) { $excel.Quit() }",
    "  if ($workbook -ne $null) { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook) }",
    "  if ($excel -ne $null) { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) }",
    "  [GC]::Collect()",
    "  [GC]::WaitForPendingFinalizers()",
    "}",
  ].join("\n");

  const encodedCommand = buildEncodedPowerShellCommand(powerShellScript);

  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand],
      { timeout: 120000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || stdout || error.message).trim()));
          return;
        }

        if (!fs.existsSync(outputAbsolutePath)) {
          reject(new Error('Excel PDF 변환이 완료되지 않았습니다.'));
          return;
        }

        resolve(outputAbsolutePath);
      }
    );
  });
}

function convertExcelToPdf(sourcePath, outputPath) {
  const conversionTask = pdfConversionQueue
    .catch(() => {})
    .then(() => runExcelToPdfConversion(sourcePath, outputPath));

  pdfConversionQueue = conversionTask.catch(() => {});
  return conversionTask;
}

async function warmUpExcelPdfConverter(appDataPath) {
  if (hasWarmedUp) {
    return;
  }

  if (warmupPromise) {
    return warmupPromise;
  }

  warmupPromise = (async () => {
    const warmupDir = ensureDirectory(
      appDataPath
        ? path.join(appDataPath, 'temp', 'report-previews', 'warmup')
        : path.join(os.tmpdir(), 'osoo-handle-pdf-warmup')
    );
    const workbookPath = path.join(warmupDir, 'excel-pdf-warmup.xlsx');
    const pdfPath = path.join(warmupDir, 'excel-pdf-warmup.pdf');

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('warmup');
    worksheet.getCell('A1').value = 'warmup';
    await workbook.xlsx.writeFile(workbookPath);

    await convertExcelToPdf(workbookPath, pdfPath);
    hasWarmedUp = true;
  })().finally(() => {
    warmupPromise = null;
  });

  return warmupPromise;
}

function getPreviewPdfPath(appDataPath, templateFileName, date) {
  const previewDir = ensureDirectory(path.join(appDataPath, 'temp', 'report-previews'));
  const safeTemplateName = sanitizeFileNameSegment(path.parse(templateFileName || 'preview').name) || 'preview';
  const safeDate = sanitizeFileNameSegment(date || 'latest') || 'latest';
  return path.join(previewDir, `${safeTemplateName}_${safeDate}.pdf`);
}

module.exports = {
  convertExcelToPdf,
  getPreviewPdfPath,
  warmUpExcelPdfConverter,
};