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
 * PowerShell CLIXML 에러 출력을 사람이 읽을 수 있는 텍스트로 정제합니다.
 */
function parsePowerShellError(raw) {
  if (!raw) return '';
  if (!raw.includes('<CLIXML')) return raw.trim();
  const matches = [...raw.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)];
  if (matches.length === 0) return raw.trim();
  return matches
    .map((m) =>
      m[1]
        .replace(/_x000D__x000A_/g, ' ')
        .replace(/_x[0-9A-Fa-f]{4}_/g, '')
        .trim()
    )
    .filter(Boolean)
    .join(' ')
    .trim();
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
    "  try { $hwp.RegisterModule('FilePathCheckDLL', 'FilePathChecker') | Out-Null } catch {}",
    "  $hwp.SetMessageBoxMode(65535)",
    "  $openResult = $hwp.Open($templatePath, 'HWPX', 0)",
    "  if (-not $openResult) { throw \"HWPX 파일을 열 수 없습니다: $templatePath\" }",
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
          reject(new Error(parsePowerShellError(stderr || stdout || error.message)));
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

/**
 * HWPX 템플릿의 {{키}} 플레이스홀더를 AllReplace 방식으로 치환한 뒤 PDF로 저장합니다.
 * @param {string} templatePath - 원본 HWPX 파일 경로
 * @param {string} outputPath - 결과 PDF 파일 경로
 * @param {Object} bindings - { '{{키}}': '값', ... } 형태의 치환 맵
 */
function renderHwpxToPdfWithPlaceholders({ templatePath, outputPath, bindings = {} }) {
  const sourceAbsolutePath = path.resolve(templatePath);
  const outputAbsolutePath = path.resolve(outputPath);
  ensureDirectory(path.dirname(outputAbsolutePath));

  const serializedBindings = JSON.stringify(bindings || {});

  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$templatePath = ${toPowerShellLiteral(sourceAbsolutePath)}`,
    `$outputPath = ${toPowerShellLiteral(outputAbsolutePath)}`,
    `$bindingsJson = ${toPowerShellLiteral(serializedBindings)}`,
    "if (-not (Test-Path -LiteralPath $templatePath)) { throw \"HWPX template not found: $templatePath\" }",
    "if (Test-Path -LiteralPath $outputPath) { Remove-Item -LiteralPath $outputPath -Force }",
    "$bindings = ConvertFrom-Json $bindingsJson",
    "$hwp = $null",
    "try {",
    "  $hwp = New-Object -ComObject HWPFrame.HwpObject",
    "  try { $hwp.RegisterModule('FilePathCheckDLL', 'FilePathChecker') | Out-Null } catch {}",
    "  $hwp.SetMessageBoxMode(65535)",
    "  $openResult = $hwp.Open($templatePath, 'HWPX', 0)",
    "  if (-not $openResult) { throw \"HWPX 파일을 열 수 없습니다: $templatePath\" }",
    "  foreach ($prop in $bindings.PSObject.Properties) {",
    "    $findStr = [string]$prop.Name",
    "    $replStr = [string]$prop.Value",
    "    $param = $hwp.HParameterSet.HFindReplace",
    "    $hwp.HAction.GetDefault('AllReplace', $param.HSet) | Out-Null",
    "    $param.FindString = $findStr",
    "    $param.ReplaceString = $replStr",
    "    $param.IgnoreMessage = 1",
    "    $param.ReplaceMode = 1",
    "    $hwp.HAction.Execute('AllReplace', $param.HSet) | Out-Null",
    "  }",
    "  $hwp.SaveAs($outputPath)",
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
          reject(new Error(parsePowerShellError(stderr || stdout || error.message)));
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

/**
 * HWPX(ZIP) 안의 XML을 직접 치환하여 새 HWPX 파일을 생성합니다.
 * HWP 설치 불필요. {{키}} 형태의 플레이스홀더를 문자열 치환합니다.
 *
 * @param {string} templatePath - 원본 HWPX 파일 경로
 * @param {string} outputPath   - 결과 HWPX 파일 경로 (.hwpx)
 * @param {Object} bindings     - { '{{키}}': '값', ... }
 */
async function replaceHwpxPlaceholders({ templatePath, outputPath, bindings = {} }) {
  const JSZip = require('jszip');
  const sourceAbsolutePath = path.resolve(templatePath);
  const outputAbsolutePath = path.resolve(outputPath);
  ensureDirectory(path.dirname(outputAbsolutePath));

  const zipData = fs.readFileSync(sourceAbsolutePath);
  const zip = await JSZip.loadAsync(zipData);

  // HWPX 본문은 Contents/section*.xml 에 저장됩니다
  const xmlFiles = Object.keys(zip.files).filter(
    (name) => name.startsWith('Contents/') && name.endsWith('.xml')
  );

  for (const fileName of xmlFiles) {
    let content = await zip.files[fileName].async('string');
    for (const [placeholder, value] of Object.entries(bindings)) {
      // XML 인코딩 안전 치환
      const safeValue = String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      // 플레이스홀더는 이미 XML에서 그대로 나타날 수도 있고
      // &lt;&lt;키&gt;&gt; 형태로 인코딩돼 있을 수도 있으므로 두 가지 모두 치환
      const encodedPlaceholder = placeholder
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      content = content.split(placeholder).join(safeValue);
      if (encodedPlaceholder !== placeholder) {
        content = content.split(encodedPlaceholder).join(safeValue);
      }
    }
    zip.file(fileName, content);
  }

  const outputBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(outputAbsolutePath, outputBuffer);
  return outputAbsolutePath;
}

module.exports = {
  renderHwpxToPdf,
  renderHwpxToPdfWithPlaceholders,
  replaceHwpxPlaceholders,
};
