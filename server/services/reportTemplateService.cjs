const fs = require('fs');
const path = require('path');

const EXCEL_TEMPLATE_EXTENSIONS = new Set(['.xlsx', '.xls', '.xlsm']);
const HWPX_TEMPLATE_EXTENSIONS = new Set(['.hwpx']);
const ALLOWED_REPORT_TEMPLATE_NAMES = [
  '일일업무일지',
  '수질분석일지',
  '약품관리대장',
  '약품입고일지',
  '슬러지반출관리대장',
  '슬러지사진대지',
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

  const siblingResourcesDir = path.join(path.dirname(baseDir), 'templates', 'reports');
  if (fs.existsSync(siblingResourcesDir)) {
    candidates.push(siblingResourcesDir);
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

function isOfficeLockFile(fileName) {
  return String(fileName || '').startsWith('~$');
}

function removeDisallowedTemplates(dirPath) {
  const files = listFiles(dirPath);
  files.forEach((fileName) => {
    if (isOfficeLockFile(fileName)) {
      return;
    }

    if (isAllowedReportTemplateName(fileName)) {
      return;
    }

    const fullPath = path.join(dirPath, fileName);
    if (fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
      } catch (error) {
        if (error?.code === 'EBUSY' || error?.code === 'EPERM') {
          console.warn(`[Report Template] 삭제할 수 없는 파일을 건너뜁니다: ${fullPath} (${error.code})`);
          return;
        }
        throw error;
      }
    }
  });
}

function isExcelReportTemplate(fileName) {
  return EXCEL_TEMPLATE_EXTENSIONS.has(path.extname(String(fileName || '')).toLowerCase());
}

function isHwpxReportTemplate(fileName) {
  return HWPX_TEMPLATE_EXTENSIONS.has(path.extname(String(fileName || '')).toLowerCase());
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
  const existingNames = new Set(existingFiles.map((fileName) => normalizeTemplateKey(fileName)));

  bundledDirs.forEach((bundledDir) => {
    listFiles(bundledDir).forEach((fileName) => {
      if (!isAllowedReportTemplateName(fileName)) {
        return;
      }

      const sourcePath = path.join(bundledDir, fileName);
      const targetPath = path.join(customDir, fileName);
      const shouldReplacePlaceholder = (() => {
        if (!fs.existsSync(targetPath)) return false;
        try {
          const sourceStat = fs.statSync(sourcePath);
          const targetStat = fs.statSync(targetPath);
          return targetStat.size > 0 && targetStat.size < 10000 && sourceStat.size > targetStat.size;
        } catch {
          return false;
        }
      })();

      // 같은 일지의 Excel/HWPX 양식을 함께 유지한다.
      if (existingNames.has(normalizeTemplateKey(fileName)) && !shouldReplacePlaceholder) {
        return;
      }

      if (!fs.existsSync(targetPath) || shouldReplacePlaceholder) {
        fs.copyFileSync(sourcePath, targetPath);
        existingNames.add(normalizeTemplateKey(fileName));
      }
    });
  });

  return customDir;
}

function listReportTemplates(baseDir, appDataPath) {
  const customDir = syncBundledTemplatesToAppData(baseDir, appDataPath);
  return listFiles(customDir)
    .filter((fileName) => !isOfficeLockFile(fileName))
    .filter((fileName) => isAllowedReportTemplateName(fileName))
    .map((fileName) => ({
      fileName,
      relativePath: path.posix.join('templates', 'reports', fileName),
      isExcelTemplate: isExcelReportTemplate(fileName),
      isHwpxTemplate: isHwpxReportTemplate(fileName),
    }));
}

function resolveReportTemplatePath(baseDir, appDataPath, templateName, options = {}) {
  const customDir = syncBundledTemplatesToAppData(baseDir, appDataPath);
  const { excelOnly = false, hwpxOnly = false } = options;
  const availableTemplates = listFiles(customDir)
    .filter((fileName) => !isOfficeLockFile(fileName))
    .filter((fileName) => isAllowedReportTemplateName(fileName))
    .filter((fileName) => !excelOnly || isExcelReportTemplate(fileName))
    .filter((fileName) => !hwpxOnly || isHwpxReportTemplate(fileName));

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
  isHwpxReportTemplate,
  listReportTemplates,
  resolveReportTemplatePath,
  syncBundledTemplatesToAppData,
};
