const fs = require('fs');
const path = require('path');

const EXCEL_TEMPLATE_EXTENSIONS = new Set(['.xlsx', '.xls', '.xlsm']);
const ALLOWED_REPORT_TEMPLATE_NAMES = [
  '?쇱씪?낅Т?쇱?',
  '?섏쭏遺꾩꽍?쇱?',
  '?쏀뭹愿由щ???,
  '?쏀뭹?낃퀬?쇱?',
  '슬러지諛섏텧愿由щ???,
  '슬러지?ъ쭊?吏',
];
const ALLOWED_REPORT_TEMPLATE_IDENTITIES = new Set(
  ALLOWED_REPORT_TEMPLATE_NAMES.map((name) => normalizeTemplateKey(name))
);

function normalizeTemplateKey(value) {
  return String(value || '').normalize('NFC').trim().toLowerCase();
}

function getTemplateIdentity(value) {
  return normalizeTemplateKey(path.parse(String(value || '')).name);
}

function isAllowedReportTemplateName(value) {
  return ALLOWED_REPORT_TEMPLATE_IDENTITIES.has(getTemplateIdentity(value));
}

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

function getCustomReportTemplatesDir(appDataPath) {
  return ensureDirectory(path.join(appDataPath, 'templates', 'reports'));
}

function getBundledReportTemplateDirs(baseDir) {
  const candidates = [];
  const workspaceDir = path.join(baseDir, 'templates', 'reports');
  if (fs.existsSync(workspaceDir)) {
    candidates.push(workspaceDir);
  }

  if (process.resourcesPath) {
    const packagedDir = path.join(process.resourcesPath, 'templates', 'reports');
    if (fs.existsSync(packagedDir)) {
      candidates.push(packagedDir);
    }
  }

  return Array.from(new Set(candidates));
}

function listFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'ko'));
}

function removeDisallowedTemplates(dirPath) {
  const files = listFiles(dirPath);
  files.forEach((fileName) => {
    if (isAllowedReportTemplateName(fileName)) {
      return;
    }

    const fullPath = path.join(dirPath, fileName);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  });
}

function isExcelReportTemplate(fileName) {
  return EXCEL_TEMPLATE_EXTENSIONS.has(path.extname(String(fileName || '')).toLowerCase());
}

function isTemplateMatched(fileName, templateName) {
  const normalizedTarget = normalizeTemplateKey(templateName);
  if (!normalizedTarget) {
    return false;
  }

  const exactFileName = normalizeTemplateKey(fileName);
  if (exactFileName === normalizedTarget) {
    return true;
  }

  const baseName = normalizeTemplateKey(path.parse(fileName).name);
  return baseName === normalizedTarget;
}

function syncBundledTemplatesToAppData(baseDir, appDataPath) {
  const customDir = getCustomReportTemplatesDir(appDataPath);
  removeDisallowedTemplates(customDir);
  const bundledDirs = getBundledReportTemplateDirs(baseDir);

  const existingFiles = listFiles(customDir);
  const existingIdentities = new Set(existingFiles.map(f => getTemplateIdentity(f)));

  bundledDirs.forEach((bundledDir) => {
    listFiles(bundledDir).forEach((fileName) => {
      if (!isAllowedReportTemplateName(fileName)) {
        return;
      }

      const identity = getTemplateIdentity(fileName);
      const sourcePath = path.join(bundledDir, fileName);
      const targetPath = path.join(customDir, fileName);

      // ?대떦 ?앸퀎?먯쓽 ?뚯씪???대? 議댁옱?섎㈃ (?뺤옣???곴??놁씠) 蹂듭궗?섏? ?딆쓬
      if (existingIdentities.has(identity)) {
        return;
      }

      if (!fs.existsSync(targetPath)) {
        fs.copyFileSync(sourcePath, targetPath);
        existingIdentities.add(identity); // ?덈줈 異붽????앸퀎??湲곕줉
      }
    });
  });

  return customDir;
}

function listReportTemplates(baseDir, appDataPath) {
  const customDir = syncBundledTemplatesToAppData(baseDir, appDataPath);
  return listFiles(customDir)
    .filter((fileName) => isAllowedReportTemplateName(fileName))
    .map((fileName) => ({
    fileName,
    relativePath: path.posix.join('templates', 'reports', fileName),
    isExcelTemplate: isExcelReportTemplate(fileName)
    }));
}

function resolveReportTemplatePath(baseDir, appDataPath, templateName, options = {}) {
  const customDir = syncBundledTemplatesToAppData(baseDir, appDataPath);
  const { excelOnly = false } = options;
  const availableTemplates = listFiles(customDir)
    .filter((fileName) => isAllowedReportTemplateName(fileName))
    .filter((fileName) => !excelOnly || isExcelReportTemplate(fileName));

  let targetName = String(templateName || '').trim();
  if (!targetName) {
    targetName = availableTemplates.find((fileName) => isExcelReportTemplate(fileName)) || '';
  } else {
    if (!isAllowedReportTemplateName(targetName)) {
      return null;
    }

    const matchedTemplate = availableTemplates.find((fileName) => isTemplateMatched(fileName, targetName));
    targetName = matchedTemplate || '';
  }

  if (!targetName) {
    return null;
  }

  const targetPath = path.join(customDir, targetName);
  if (fs.existsSync(targetPath)) {
    return {
      fileName: targetName,
      absolutePath: targetPath,
      relativePath: path.posix.join('templates', 'reports', targetName)
    };
  }

  return null;
}

module.exports = {
  ALLOWED_REPORT_TEMPLATE_NAMES,
  getCustomReportTemplatesDir,
  isAllowedReportTemplateName,
  isExcelReportTemplate,
  listReportTemplates,
  resolveReportTemplatePath,
  syncBundledTemplatesToAppData,
};
