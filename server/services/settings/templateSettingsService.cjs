const fs = require('fs');
const path = require('path');
const { parseAndStoreExcel } = require('../excelService.cjs');
const {
  ALLOWED_REPORT_TEMPLATE_NAMES,
  isAllowedReportTemplateName,
  listReportTemplates,
} = require('../reportTemplateService.cjs');

function cleanupDisallowedReportTemplates(reportsDir) {
  const entries = fs.readdirSync(reportsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

  for (const fileName of entries) {
    if (isAllowedReportTemplateName(fileName)) {
      continue;
    }

    const fullPath = path.join(reportsDir, fileName);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }
}

async function handleSettingsUpload(db, files, {
  baseDir,
  appDataPath,
  reportsDir,
  excelOriginalsDir,
}) {
  const uploadFiles = files || {};
  const result = { originalPath: null, sheets: [] };

  if (uploadFiles.excel_original) {
    const original = uploadFiles.excel_original[0];
    const originalPath = `appdata/templates/excel-originals/${original.filename}`;
    db.prepare('UPDATE app_settings SET excel_template_path = ? WHERE id = 1').run(originalPath);

    const filePath = path.join(excelOriginalsDir, original.filename);
    const sheets = await parseAndStoreExcel(db, filePath);
    result.originalPath = originalPath;
    result.sheets = sheets;
  }

  const reportTemplates = uploadFiles.report_templates || [];
  const replacedTemplates = [];

  cleanupDisallowedReportTemplates(reportsDir);

  const invalidTemplateFiles = reportTemplates
    .map((templateFile) => String(templateFile.filename || '').normalize('NFC'))
    .filter((fileName) => !isAllowedReportTemplateName(fileName));

  if (invalidTemplateFiles.length) {
    for (const templateFile of reportTemplates) {
      const uploadedPath = path.join(reportsDir, String(templateFile.filename || '').normalize('NFC'));
      if (fs.existsSync(uploadedPath)) {
        fs.unlinkSync(uploadedPath);
      }
    }

    const err = new Error('허용된 파일명 형식으로 업로드할 수 없습니다.');
    err.statusCode = 400;
    err.payload = {
      code: 'INVALID_REPORT_TEMPLATE_NAME',
      userMessage: `허용된 파일명 형식으로 업로드할 수 없습니다.\n사용 가능 템플릿 형식: ${ALLOWED_REPORT_TEMPLATE_NAMES.join(', ')}`,
      invalidFiles: invalidTemplateFiles,
    };
    throw err;
  }

  for (const templateFile of reportTemplates) {
    const uploadedName = String(templateFile.filename || '').normalize('NFC');
    const uploadedIdentity = path.parse(uploadedName).name.normalize('NFC').trim().toLowerCase();
    const uploadedExtension = path.extname(uploadedName).toLowerCase();

    const currentFiles = fs.readdirSync(reportsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);

    for (const existingName of currentFiles) {
      if (existingName === uploadedName) {
        continue;
      }

      const existingIdentity = path.parse(existingName).name.normalize('NFC').trim().toLowerCase();
      const existingExtension = path.extname(existingName).toLowerCase();
      if (existingIdentity === uploadedIdentity && existingExtension === uploadedExtension) {
        const existingPath = path.join(reportsDir, existingName);
        if (fs.existsSync(existingPath)) {
          fs.unlinkSync(existingPath);
          replacedTemplates.push({
            template: uploadedIdentity,
            removedFile: existingName,
            appliedFile: uploadedName,
          });
        }
      }
    }
  }

  result.replacedTemplates = replacedTemplates;
  result.reportTemplates = listReportTemplates(baseDir, appDataPath);
  return result;
}

module.exports = {
  cleanupDisallowedReportTemplates,
  handleSettingsUpload,
};
