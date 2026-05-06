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
 * PowerShell CLIXML ?먮윭 異쒕젰???щ엺???쎌쓣 ???덈뒗 ?띿뒪?몃줈 ?뺤젣?⑸땲??
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
 * HWPX ?쒗뵆由우쓣 ?쒓? COM?쇰줈 ?댁뼱??遺곷쭏?ъ뿉 ?띿뒪???대?吏瑜??쎌엯????PDF濡???ν빀?덈떎.
 *
 * 二쇱쓽:
 * - ?ㅽ뻾 PC???쒓????ㅼ튂?섏뼱 ?덉뼱???⑸땲??
 * - 蹂댁븞/?뺤콉???곕씪 COM ?먮룞?붽? 李⑤떒?????덉뒿?덈떎.
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
    // ?쒓? ?먮룞??媛앹껜 ?앹꽦 (諛고룷 ?섍꼍???곕씪 ProgID媛 ?ㅻ? ???덉쓬)
    "  $hwp = New-Object -ComObject HWPFrame.HwpObject",
    "  try { $hwp.RegisterModule('FilePathCheckDLL', 'FilePathChecker') | Out-Null } catch {}",
    "  $hwp.SetMessageBoxMode(65535)",
    "  $openResult = $hwp.Open($templatePath, 'HWPX', 0)",
    "  if (-not $openResult) { throw \"HWPX ?뚯씪???????놁뒿?덈떎: $templatePath\" }",
    // ?띿뒪??諛붿씤??
    "  foreach ($prop in $bindings.PSObject.Properties) {",
    "    $name = [string]$prop.Name",
    "    $value = [string]$prop.Value",
    "    if ($hwp.MoveToBookmark($name)) {",
    "      $hwp.Run('SelectAll') | Out-Null",
    "      $hwp.InsertText($value)",
    "    }",
    "  }",
    // ?대?吏 諛붿씤?? 遺곷쭏???꾩튂濡??대룞 ??InsertPicture
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
    // PDF ???(踰꾩쟾???곕씪 ?≪뀡紐낆씠 ?ㅻ? ???덉뼱, ?ㅽ뙣 ???먮윭 硫붿떆吏濡??뺤씤 ?꾩슂)
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
          reject(new Error('HWPX PDF 蹂?섏씠 ?꾨즺?섏? ?딆븯?듬땲??'));
          return;
        }

        resolve(outputAbsolutePath);
      }
    );
  });
}

/**
 * HWPX ?쒗뵆由우쓽 {{??} ?뚮젅?댁뒪??붾? AllReplace 諛⑹떇?쇰줈 移섑솚????PDF濡???ν빀?덈떎.
 * @param {string} templatePath - ?먮낯 HWPX ?뚯씪 寃쎈줈
 * @param {string} outputPath - 寃곌낵 PDF ?뚯씪 寃쎈줈
 * @param {Object} bindings - { '{{??}': '媛?, ... } ?뺥깭??移섑솚 留?
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
    "  if (-not $openResult) { throw \"HWPX ?뚯씪???????놁뒿?덈떎: $templatePath\" }",
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
          reject(new Error('HWPX PDF 蹂?섏씠 ?꾨즺?섏? ?딆븯?듬땲??'));
          return;
        }
        resolve(outputAbsolutePath);
      }
    );
  });
}

/**
 * HWPX(ZIP) ?덉쓽 XML??吏곸젒 移섑솚?섏뿬 ??HWPX ?뚯씪???앹꽦?⑸땲??
 * HWP ?ㅼ튂 遺덊븘?? {{??} ?뺥깭???뚮젅?댁뒪??붾? 臾몄옄??移섑솚?⑸땲??
 *
 * @param {string} templatePath - ?먮낯 HWPX ?뚯씪 寃쎈줈
 * @param {string} outputPath   - 寃곌낵 HWPX ?뚯씪 寃쎈줈 (.hwpx)
 * @param {Object} bindings     - { '{{??}': '媛?, ... }
 */
async function replaceHwpxPlaceholders({ templatePath, outputPath, bindings = {} }) {
  const JSZip = require('jszip');
  const sourceAbsolutePath = path.resolve(templatePath);
  const outputAbsolutePath = path.resolve(outputPath);
  ensureDirectory(path.dirname(outputAbsolutePath));

  const zipData = fs.readFileSync(sourceAbsolutePath);
  const zip = await JSZip.loadAsync(zipData);

  // HWPX 蹂몃Ц? Contents/section*.xml ????λ맗?덈떎
  const xmlFiles = Object.keys(zip.files).filter(
    (name) => name.startsWith('Contents/') && name.endsWith('.xml')
  );

  for (const fileName of xmlFiles) {
    let content = await zip.files[fileName].async('string');
    for (const [placeholder, value] of Object.entries(bindings)) {
      // XML ?몄퐫???덉쟾 移섑솚
      const safeValue = String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      // ?뚮젅?댁뒪??붾뒗 ?대? XML?먯꽌 洹몃?濡??섑????섎룄 ?덇퀬
      // &lt;&lt;??gt;&gt; ?뺥깭濡??몄퐫?⑸뤌 ?덉쓣 ?섎룄 ?덉쑝誘濡???媛吏 紐⑤몢 移섑솚
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
