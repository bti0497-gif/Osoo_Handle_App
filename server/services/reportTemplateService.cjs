const fs = require('fs');
const path = require('path');

const EXCEL_TEMPLATE_EXTENSIONS = new Set(['.xlsx', '.xls', '.xlsm']);

function normalizeTemplateKey(value) {
  return String(value || '').trim().toLowerCase();
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
  const bundledDirs = getBundledReportTemplateDirs(baseDir);

  bundledDirs.forEach((bundledDir) => {
    listFiles(bundledDir).forEach((fileName) => {
      const sourcePath = path.join(bundledDir, fileName);
      const targetPath = path.join(customDir, fileName);
      if (!fs.existsSync(targetPath)) {
        fs.copyFileSync(sourcePath, targetPath);
      }
    });
  });

  return customDir;
}

function listReportTemplates(baseDir, appDataPath) {
  const customDir = syncBundledTemplatesToAppData(baseDir, appDataPath);
  return listFiles(customDir).map((fileName) => ({
    fileName,
    relativePath: path.posix.join('templates', 'reports', fileName),
    isExcelTemplate: isExcelReportTemplate(fileName)
  }));
}

function resolveReportTemplatePath(baseDir, appDataPath, templateName, options = {}) {
  const customDir = syncBundledTemplatesToAppData(baseDir, appDataPath);
  const { excelOnly = false } = options;
  const availableTemplates = listFiles(customDir).filter((fileName) => !excelOnly || isExcelReportTemplate(fileName));

  let targetName = String(templateName || '').trim();
  if (!targetName) {
    targetName = availableTemplates.find((fileName) => isExcelReportTemplate(fileName)) || '';
  } else {
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
  getCustomReportTemplatesDir,
  isExcelReportTemplate,
  listReportTemplates,
  resolveReportTemplatePath,
  syncBundledTemplatesToAppData,
};
