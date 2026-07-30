const fs = require('fs');
const path = require('path');

const EXCEL_TEMPLATE_EXTENSIONS = new Set(['.xlsx', '.xls', '.xlsm']);
const HWP_TEMPLATE_EXTENSIONS = new Set(['.hwp']);
const HWPX_TEMPLATE_EXTENSIONS = new Set(['.hwpx']);
const ALLOWED_REPORT_TEMPLATE_NAMES = [
  '일일업무일지',
  '일일업무일지(A2O)',
  '일일업무일지(MBR)',
  '월운영보고서',
  '수질분석일지',
  '약품관리대장',
  '약품입고일지',
  '슬러지반출관리대장',
  '슬러지사진대지',
];
const ALLOWED_REPORT_TEMPLATE_IDENTITIES = new Set(
  ALLOWED_REPORT_TEMPLATE_NAMES.map((name) => normalizeTemplateKey(name))
);
const FORCED_TEMPLATE_REVISIONS = Object.freeze({
  '수질분석일지.xlsx': '2026-07-30-six-locations-v1',
});
const TEMPLATE_REVISION_MARKER = '.bundled-template-revisions.json';

function normalizeTemplateKey(value) {
  return String(value || '').normalize('NFC').trim().toLowerCase();
}

function getTemplateIdentity(value) {
  return normalizeTemplateKey(path.parse(String(value || '')).name);
}

function normalizeMethod(value) {
  const method = String(value || '').replace(/\s+/g, '').toUpperCase();
  if (method === 'A2O' || method === 'MBR') return method;
  return '';
}

function getDailyWorkLogTemplateCandidates(templateName, method) {
  const identity = getTemplateIdentity(templateName);
  const baseIdentity = normalizeTemplateKey('일일업무일지');
  const methodCode = normalizeMethod(method);
  if (identity !== baseIdentity && !/^일일업무일지\((a2o|mbr)\)$/i.test(identity)) {
    return [];
  }

  const candidates = [];
  if (methodCode) {
    candidates.push(normalizeTemplateKey(`일일업무일지(${methodCode})`));
  }
  candidates.push(identity);
  candidates.push(baseIdentity);
  return Array.from(new Set(candidates));
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
    const packagedDefaultsDir = path.join(process.resourcesPath, 'defaults', 'report-templates');
    if (fs.existsSync(packagedDefaultsDir)) {
      candidates.push(packagedDefaultsDir);
    }

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
    if (fileName === TEMPLATE_REVISION_MARKER) {
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

function isHwpReportTemplate(fileName) {
  return HWP_TEMPLATE_EXTENSIONS.has(path.extname(String(fileName || '')).toLowerCase());
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
  const revisionMarkerPath = path.join(customDir, TEMPLATE_REVISION_MARKER);
  let appliedRevisions = {};
  try {
    appliedRevisions = JSON.parse(fs.readFileSync(revisionMarkerPath, 'utf8'));
  } catch {
    appliedRevisions = {};
  }
  let revisionMarkerChanged = false;

  bundledDirs.forEach((bundledDir) => {
    listFiles(bundledDir).forEach((fileName) => {
      if (!isAllowedReportTemplateName(fileName)) {
        return;
      }

      const sourcePath = path.join(bundledDir, fileName);
      const targetPath = path.join(customDir, fileName);
      const forcedRevision = FORCED_TEMPLATE_REVISIONS[fileName];

      // 구조가 바뀐 지정 양식만 릴리즈 최초 실행 때 한 번 교체한다.
      // 같은 버전의 이후 실행과 다른 현장 수정 양식은 다시 덮어쓰지 않는다.
      if (forcedRevision && appliedRevisions[fileName] !== forcedRevision) {
        fs.copyFileSync(sourcePath, targetPath);
        existingNames.add(normalizeTemplateKey(fileName));
        appliedRevisions[fileName] = forcedRevision;
        revisionMarkerChanged = true;
        return;
      }

      // 같은 일지의 Excel/HWP/HWPX 양식을 함께 유지한다.
      // 현장에서 수정한 양식은 크기나 내용과 관계없이 절대 덮어쓰지 않는다.
      if (existingNames.has(normalizeTemplateKey(fileName))) {
        return;
      }

      if (!fs.existsSync(targetPath)) {
        fs.copyFileSync(sourcePath, targetPath);
        existingNames.add(normalizeTemplateKey(fileName));
      }
    });
  });

  if (revisionMarkerChanged) {
    fs.writeFileSync(revisionMarkerPath, `${JSON.stringify(appliedRevisions, null, 2)}\n`, 'utf8');
  }

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
      isHwpTemplate: isHwpReportTemplate(fileName),
      isHwpxTemplate: isHwpxReportTemplate(fileName),
    }));
}

function resolveReportTemplatePath(baseDir, appDataPath, templateName, options = {}) {
  const customDir = syncBundledTemplatesToAppData(baseDir, appDataPath);
  const { excelOnly = false, hwpOnly = false, hwpxOnly = false, method = '' } = options;
  const availableTemplates = listFiles(customDir)
    .filter((fileName) => !isOfficeLockFile(fileName))
    .filter((fileName) => isAllowedReportTemplateName(fileName))
    .filter((fileName) => !excelOnly || isExcelReportTemplate(fileName))
    .filter((fileName) => !hwpOnly || isHwpReportTemplate(fileName))
    .filter((fileName) => !hwpxOnly || isHwpxReportTemplate(fileName));

  let targetName = String(templateName || '').trim();
  if (!targetName) {
    targetName = availableTemplates.find((fileName) => isExcelReportTemplate(fileName)) || '';
  } else {
    if (!isAllowedReportTemplateName(targetName)) {
      return null;
    }

    const dailyWorkLogCandidates = getDailyWorkLogTemplateCandidates(targetName, method);
    const matchedTemplate = dailyWorkLogCandidates.length > 0
      ? dailyWorkLogCandidates
        .map((candidate) => availableTemplates.find((fileName) => getTemplateIdentity(fileName) === candidate))
        .find(Boolean)
      : availableTemplates.find((fileName) => isTemplateMatched(fileName, targetName));
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
  isHwpReportTemplate,
  isHwpxReportTemplate,
  listReportTemplates,
  resolveReportTemplatePath,
  syncBundledTemplatesToAppData,
};
