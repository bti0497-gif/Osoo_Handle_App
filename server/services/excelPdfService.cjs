const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

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

function convertExcelToPdf(sourcePath, outputPath) {
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

function getPreviewPdfPath(appDataPath, templateFileName, date) {
  const previewDir = ensureDirectory(path.join(appDataPath, 'temp', 'report-previews'));
  const safeTemplateName = sanitizeFileNameSegment(path.parse(templateFileName || 'preview').name) || 'preview';
  const safeDate = sanitizeFileNameSegment(date || 'latest') || 'latest';
  return path.join(previewDir, `${safeTemplateName}_${safeDate}.pdf`);
}

module.exports = {
  convertExcelToPdf,
  getPreviewPdfPath,
};