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

function toPowerShellLiteral(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

/**
 * HWPX 템플릿을 한글 COM으로 열어서 북마크에 텍스트/이미지를 삽입한 뒤 PDF로 저장합니다.
 *
 * 주의:
 * - 실행 PC에 한글이 설치되어 있어야 합니다.
 * - 보안/정책에 따라 COM 자동화가 차단될 수 있습니다.
 */
function renderHwpxToPdf({ templatePath, outputPath, bindings = {}, imageBindings = {} }) {
  const sourceAbsolutePath = path.resolve(templatePath);
  const outputAbsolutePath = path.resolve(outputPath);
  ensureDirectory(path.dirname(outputAbsolutePath));

  const serializedBindings = JSON.stringify(bindings || {});
  const serializedImages = JSON.stringify(imageBindings || {});

  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$templatePath = ${toPowerShellLiteral(sourceAbsolutePath)}`,
    `$outputPath = ${toPowerShellLiteral(outputAbsolutePath)}`,
    `$bindingsJson = ${toPowerShellLiteral(serializedBindings)}`,
    `$imagesJson = ${toPowerShellLiteral(serializedImages)}`,
    "if (-not (Test-Path -LiteralPath $templatePath)) { throw \"HWPX template not found: $templatePath\" }",
    "if (Test-Path -LiteralPath $outputPath) { Remove-Item -LiteralPath $outputPath -Force }",
    "$bindings = ConvertFrom-Json $bindingsJson",
    "$images = ConvertFrom-Json $imagesJson",
    "$hwp = $null",
    "try {",
    // 한글 자동화 객체 생성 (배포 환경에 따라 ProgID가 다를 수 있음)
    "  $hwp = New-Object -ComObject HWPFrame.HwpObject",
    "  $hwp.RegisterModule('FilePathCheckDLL', 'FilePathChecker') | Out-Null",
    "  $hwp.Open($templatePath)",
    // 텍스트 바인딩
    "  foreach ($prop in $bindings.PSObject.Properties) {",
    "    $name = [string]$prop.Name",
    "    $value = [string]$prop.Value",
    "    if ($hwp.MoveToBookmark($name)) {",
    "      $hwp.Run('SelectAll') | Out-Null",
    "      $hwp.InsertText($value)",
    "    }",
    "  }",
    // 이미지 바인딩: 북마크 위치로 이동 후 InsertPicture
    "  foreach ($prop in $images.PSObject.Properties) {",
    "    $name = [string]$prop.Name",
    "    $imgPath = [string]$prop.Value",
    "    if (-not $imgPath) { continue }",
    "    if (-not (Test-Path -LiteralPath $imgPath)) { continue }",
    "    if ($hwp.MoveToBookmark($name)) {",
    "      $hwp.Run('SelectAll') | Out-Null",
    "      $hwp.Run('Delete') | Out-Null",
    "      $hwp.InsertPicture($imgPath)",
    "    }",
    "  }",
    // PDF 저장 (버전에 따라 액션명이 다를 수 있어, 실패 시 에러 메시지로 확인 필요)
    "  $hwp.SaveAs($outputPath, 'PDF')",
    "} finally {",
    "  if ($hwp -ne $null) {",
    "    try { $hwp.Quit() } catch {}",
    "    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($hwp)",
    "  }",
    "  [GC]::Collect()",
    "  [GC]::WaitForPendingFinalizers()",
    "}",
  ].join("\n");

  const encoded = buildEncodedPowerShellCommand(script);

  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout: 120000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || stdout || error.message).trim()));
          return;
        }

        if (!fs.existsSync(outputAbsolutePath)) {
          reject(new Error('HWPX PDF 변환이 완료되지 않았습니다.'));
          return;
        }

        resolve(outputAbsolutePath);
      }
    );
  });
}

module.exports = {
  renderHwpxToPdf,
};
