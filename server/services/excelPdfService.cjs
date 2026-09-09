'use strict';
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pdfConversionQueue = Promise.resolve();
let warmupPromise = null;
let hasWarmedUp = false;

function createWarmupWorkbook(workbookPath) {
  const bundledTemplatePath = path.join(
    __dirname,
    '..',
    '..',
    'templates',
    'reports',
    '일일업무일지.xlsx'
  );

  if (fs.existsSync(bundledTemplatePath)) {
    fs.copyFileSync(bundledTemplatePath, workbookPath);
    return Promise.resolve();
  }

  // 정상 설치에서는 패키지에 포함된 실제 일지 템플릿을 사용한다. 개발 중
  // 템플릿이 누락된 경우에만 ExcelJS를 불러와 기존 워밍업 동작을 보존한다.
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('warmup');
  worksheet.getCell('A1').value = 'warmup';
  return workbook.xlsx.writeFile(workbookPath);
}

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
    "Add-Type -TypeDefinition @'",
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class OsooExcelNativeMethods {',
    '  [DllImport("user32.dll")]',
    '  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);',
    '}',
    "'@",
    "$excel = $null",
    "$workbooks = $null",
    "$workbook = $null",
    "$excelProcessId = 0",
    "$excelProcessStartedAt = $null",
    "try {",
    "  $excel = New-Object -ComObject Excel.Application",
    "  $pidBuffer = [uint32]0",
    "  [void][OsooExcelNativeMethods]::GetWindowThreadProcessId([IntPtr]$excel.Hwnd, [ref]$pidBuffer)",
    "  $excelProcessId = [int]$pidBuffer",
    "  if ($excelProcessId -gt 0) {",
    "    try { $excelProcessStartedAt = (Get-Process -Id $excelProcessId -ErrorAction Stop).StartTime.ToUniversalTime().Ticks } catch { $excelProcessStartedAt = $null }",
    "  }",
    "  $excel.Visible = $false",
    "  $excel.DisplayAlerts = $false",
    "  $excel.EnableEvents = $false",
    "  $excel.AskToUpdateLinks = $false",
    "  $excel.AutomationSecurity = 3",
    "  $workbooks = $excel.Workbooks",
    "  $workbook = $workbooks.Open($sourcePath, 0, $true)",
    "  $xlTypePDF = 0",
    "  $workbook.ExportAsFixedFormat($xlTypePDF, $outputPath)",
    "} finally {",
    "  if ($workbook -ne $null) { try { $workbook.Close($false) } catch { } }",
    "  if ($excel -ne $null) { try { $excel.Quit() } catch { } }",
    "  if ($workbook -ne $null) { try { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook) } catch { } }",
    "  if ($workbooks -ne $null) { try { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbooks) } catch { } }",
    "  if ($excel -ne $null) { try { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) } catch { } }",
    "  $workbook = $null",
    "  $workbooks = $null",
    "  $excel = $null",
    "  [GC]::Collect()",
    "  [GC]::WaitForPendingFinalizers()",
    "  [GC]::Collect()",
    "  [GC]::WaitForPendingFinalizers()",
    "  if ($excelProcessId -gt 0 -and $null -ne $excelProcessStartedAt) {",
    "    try {",
    "      $ownedProcess = Get-Process -Id $excelProcessId -ErrorAction Stop",
    "      $sameProcess = $ownedProcess.ProcessName -eq 'EXCEL' -and $ownedProcess.StartTime.ToUniversalTime().Ticks -eq $excelProcessStartedAt",
    "      if ($sameProcess -and -not $ownedProcess.WaitForExit(5000)) {",
    "        Stop-Process -Id $excelProcessId -Force -ErrorAction Stop",
    "        [Console]::Out.WriteLine('OSOO_EXCEL_FORCED_CLOSE:' + $excelProcessId)",
    "      }",
    "    } catch { }",
    "  }",
    "}",
  ].join("\n");

  const encodedCommand = buildEncodedPowerShellCommand(powerShellScript);

  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand],
      { timeout: 120000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        const forcedClose = String(stdout || '').match(/OSOO_EXCEL_FORCED_CLOSE:(\d+)/);
        if (forcedClose) {
          console.warn(`[Excel PDF] 종료되지 않은 전용 Excel 프로세스를 회수했습니다. pid=${forcedClose[1]}`);
        }
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

    await createWarmupWorkbook(workbookPath);

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
