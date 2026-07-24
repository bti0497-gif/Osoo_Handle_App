'use strict';

const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

let conversionQueue = Promise.resolve();

const SECURITY_MODULE_NAME = 'OsooHandleFilePathChecker';
const SECURITY_MODULE_URL = 'https://github.com/hancom-io/devcenter-archive/raw/main/hwp-automation/%EB%B3%B4%EC%95%88%EB%AA%A8%EB%93%88%28Automation%29.zip';
const SECURITY_MODULE_SHA256 = '9AC5B97C47AC8AED1E8BCA27A3EEF39411361D8F68C262509F0C40A8F9D21BB6';

function toPowerShellLiteral(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function buildEncodedCommand(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(String(stderr || stdout || error.message).trim()));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function normalizePowerShellError(output) {
  const text = String(output || '').trim();
  if (!text) return '';

  if (!text.includes('#< CLIXML')) {
    return text;
  }

  const messages = [];
  const regex = /<S\s+S="Error">([\s\S]*?)<\/S>/g;
  let match = regex.exec(text);
  while (match) {
    messages.push(
      decodeXmlEntities(match[1])
        .replace(/_x000D__x000A_/g, '\n')
        .replace(/_x000D_/g, '\r')
        .replace(/_x000A_/g, '\n')
        .replace(/_x0009_/g, '\t')
        .trim()
    );
    match = regex.exec(text);
  }

  const normalized = messages.filter(Boolean).join('\n').trim();
  return normalized || text.replace('#< CLIXML', '').trim();
}

function securityModulePath() {
  const appDataRoot = process.env.APPDATA || process.env.LOCALAPPDATA || process.cwd();
  return path.join(appDataRoot, 'Osoo_Handle_App', 'security', 'FilePathCheckerModuleExample.dll');
}

function verifySecurityModule(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase() === SECURITY_MODULE_SHA256;
}

async function downloadSecurityModule() {
  const response = await fetch(SECURITY_MODULE_URL);
  if (!response.ok) throw new Error(`한글 보안 모듈 다운로드 실패: HTTP ${response.status}`);
  const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));
  const entry = zip.file(/(^|\/)FilePathCheckerModuleExample\.dll$/i)[0];
  if (!entry) throw new Error('한글 보안 모듈 ZIP에서 DLL을 찾지 못했습니다.');
  const buffer = await entry.async('nodebuffer');
  if (!verifySecurityModule(buffer)) throw new Error('한글 보안 모듈 무결성 검증에 실패했습니다.');
  return buffer;
}

async function ensureHwpSecurityModule() {
  const modulePath = securityModulePath();
  let valid = false;
  if (fs.existsSync(modulePath)) {
    valid = verifySecurityModule(fs.readFileSync(modulePath));
  }
  if (!valid) {
    const buffer = await downloadSecurityModule();
    fs.mkdirSync(path.dirname(modulePath), { recursive: true });
    fs.writeFileSync(modulePath, buffer);
  }

  await execFileAsync(
    'reg.exe',
    [
      'ADD',
      'HKCU\\Software\\HNC\\HwpAutomation\\Modules',
      '/v',
      SECURITY_MODULE_NAME,
      '/t',
      'REG_SZ',
      '/d',
      modulePath,
      '/f',
    ],
    { windowsHide: true }
  );
  return modulePath;
}

async function runHwpToPdfConversion(sourcePath, outputPath) {
  const sourceAbsolutePath = path.resolve(sourcePath);
  const outputAbsolutePath = path.resolve(outputPath);
  const sourceFormat = path.extname(sourceAbsolutePath).toLowerCase() === '.hwp' ? 'HWP' : 'HWPX';
  fs.mkdirSync(path.dirname(outputAbsolutePath), { recursive: true });
  await ensureHwpSecurityModule();

  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$sourcePath = ${toPowerShellLiteral(sourceAbsolutePath)}`,
    `$outputPath = ${toPowerShellLiteral(outputAbsolutePath)}`,
    "if (-not (Test-Path -LiteralPath $sourcePath)) { throw \"HWP/HWPX file not found: $sourcePath\" }",
    "if (Test-Path -LiteralPath $outputPath) { Remove-Item -LiteralPath $outputPath -Force }",
    "$hwp = $null",
    "try {",
    "  $hwp = New-Object -ComObject HWPFrame.HwpObject",
    `  $securityRegistered = $hwp.RegisterModule('FilePathCheckDLL', '${SECURITY_MODULE_NAME}')`,
    "  if (-not $securityRegistered) { throw '한글 파일 접근 보안 모듈 등록에 실패했습니다.' }",
    "  try { $hwp.SetMessageBoxMode(0x00020000) } catch { }",
    `  $opened = $hwp.Open($sourcePath, '${sourceFormat}', 'forceopen:true')`,
    "  if (-not $opened) { throw '한글에서 HWP/HWPX 파일을 열지 못했습니다.' }",
    "  $saved = $hwp.SaveAs($outputPath, 'PDF', '')",
    "  if (-not $saved) { throw '한글에서 PDF 저장을 완료하지 못했습니다.' }",
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

  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', buildEncodedCommand(script)],
      { timeout: 180000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = normalizePowerShellError(stderr || stdout || error.message);
          reject(new Error(`한글 PDF 변환 실패: ${detail}`));
          return;
        }
        if (!fs.existsSync(outputAbsolutePath)) {
          reject(new Error('한글 PDF 변환 결과 파일이 생성되지 않았습니다.'));
          return;
        }
        resolve(outputAbsolutePath);
      }
    );
  });
}

function convertHwpxToPdf(sourcePath, outputPath) {
  const task = conversionQueue
    .catch(() => {})
    .then(() => runHwpToPdfConversion(sourcePath, outputPath));
  conversionQueue = task.catch(() => {});
  return task;
}

module.exports = {
  convertHwpToPdf: convertHwpxToPdf,
  convertHwpxToPdf,
  ensureHwpSecurityModule,
};
