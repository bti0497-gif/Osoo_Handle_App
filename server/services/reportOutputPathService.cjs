'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPORT_ROOT_NAME = '업무일지류모음';

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function resolveDesktopPath() {
  const configured = String(process.env.OSOO_DESKTOP_PATH || '').trim();
  if (configured) return configured;

  const userProfile = process.env.USERPROFILE || os.homedir();
  const oneDrive = String(process.env.OneDrive || process.env.OneDriveConsumer || '').trim();
  const candidates = [
    path.join(userProfile, 'Desktop'),
    path.join(userProfile, '바탕 화면'),
    oneDrive ? path.join(oneDrive, 'Desktop') : '',
    oneDrive ? path.join(oneDrive, '바탕 화면') : '',
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function normalizeDatePart(value) {
  const normalized = String(value || '').trim().slice(0, 10).replace(/[^0-9]/g, '');
  if (!/^\d{8}$/.test(normalized)) {
    throw new Error('업무일지 출력 경로에 사용할 날짜가 올바르지 않습니다.');
  }
  return normalized;
}

function sanitizeReportType(value) {
  const sanitized = String(value || '업무일지')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  return sanitized || '업무일지';
}

function getReportOutputDirectory(startDate) {
  const datePart = normalizeDatePart(startDate);
  return ensureDirectory(path.join(resolveDesktopPath(), REPORT_ROOT_NAME, datePart.slice(0, 6)));
}

function getAvailableReportOutputPath({ reportType, siteName, startDate, endDate, extension }) {
  const startPart = normalizeDatePart(startDate);
  const endPart = normalizeDatePart(endDate || startDate);
  const dateSuffix = startPart === endPart ? startPart : `${startPart}_${endPart}`;
  const normalizedExtension = String(extension || '').startsWith('.')
    ? String(extension)
    : `.${String(extension || '')}`;
  const outputDir = getReportOutputDirectory(startDate);
  const normalizedSiteName = String(siteName || '').trim();
  const baseNameParts = [sanitizeReportType(reportType)];
  if (normalizedSiteName) baseNameParts.push(sanitizeReportType(normalizedSiteName));
  const baseName = `${baseNameParts.join('_')}_${dateSuffix}`;

  let outputPath = path.join(outputDir, `${baseName}${normalizedExtension}`);
  let copyNumber = 2;
  while (fs.existsSync(outputPath)) {
    outputPath = path.join(outputDir, `${baseName}_${copyNumber}${normalizedExtension}`);
    copyNumber += 1;
  }
  return outputPath;
}

module.exports = {
  getAvailableReportOutputPath,
  getReportOutputDirectory,
  resolveDesktopPath,
};
