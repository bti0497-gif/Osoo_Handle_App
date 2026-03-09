const fs = require('fs');
const path = require('path');

const { httpRequest } = require('./qntechAuthService.cjs');
const {
  isDriveConfigured,
  getDriveRootFolderId,
  getOrCreateFolderPath,
  uploadBufferToFolder
} = require('./driveService.cjs');

const TARGET_PHOTO_ITEMS = ['암모니아성 질소', '질산성 질소', '오르토 인산염', '알칼리도'];
const DRIVE_CATEGORY_NAME = '수질분석';

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function sanitizeSegment(value) {
  return String(value || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchTargetItem(name) {
  const compact = String(name || '').replace(/\s+/g, '');
  return TARGET_PHOTO_ITEMS.find((target) => compact.includes(target.replace(/\s+/g, '')));
}

function pickExtension(filePathValue, contentType) {
  const url = /^https?:\/\//i.test(filePathValue)
    ? new URL(filePathValue)
    : new URL(filePathValue, 'https://eco.qntech.co.kr');
  const ext = path.extname(url.pathname || '');
  if (ext) return ext;
  if ((contentType || '').includes('png')) return '.png';
  if ((contentType || '').includes('webp')) return '.webp';
  return '.jpg';
}

function buildProjectSourceLabel(project, projectIndex, totalProjects) {
  const analysisProcess = sanitizeSegment(project?.analysisProcess);
  const note = sanitizeSegment(project?.note);
  if (analysisProcess) return analysisProcess;
  if (note) return note;
  if (totalProjects > 1) return `${projectIndex + 1}차`;
  return '';
}

function buildReadablePhotoName(date, itemName, sourceLabel, extension, duplicateIndex = 0) {
  const segments = [date];
  if (sourceLabel) segments.push(sanitizeSegment(sourceLabel));
  segments.push(sanitizeSegment(itemName));
  if (duplicateIndex > 0) {
    segments.push(String(duplicateIndex + 1));
  }
  return `${segments.filter(Boolean).join('-')}${extension}`;
}

async function ensureDrivePhotoFolder(siteName, date) {
  if (!isDriveConfigured()) {
    return null;
  }

  const rootFolderId = getDriveRootFolderId();
  const segments = [
    sanitizeSegment(siteName || 'Unknown Site'),
    DRIVE_CATEGORY_NAME,
    date.slice(0, 4),
    date.slice(5, 7),
    date
  ];

  return getOrCreateFolderPath(rootFolderId, segments);
}

function getDefaultPhotoRoot(baseDir) {
  return path.join(baseDir, '사진관리', '수질분석');
}

function resolvePhotoRoot(baseDir, configuredPhotoRoot) {
  const normalized = String(configuredPhotoRoot || '').trim();
  if (!normalized) return getDefaultPhotoRoot(baseDir);
  if (path.isAbsolute(normalized)) return normalized;
  return path.join(baseDir, normalized);
}

function buildPhotoDirectory(photoRoot, date) {
  const year = date.slice(0, 4);
  const month = date.slice(5, 7);
  return path.join(photoRoot, year, month, date);
}

async function downloadPhoto(baseUrl, cookieJar, filePathValue) {
  const fileUrl = /^https?:\/\//i.test(filePathValue)
    ? filePathValue
    : new URL(filePathValue, `${baseUrl}/`).toString();

  const headers = {
    'User-Agent': 'Osoo-QnTECH/1.0',
    Origin: baseUrl,
    Referer: `${baseUrl}/`
  };

  const cookieHeader = cookieJar.toHeader();
  if (cookieHeader) headers.Cookie = cookieHeader;

  const response = await httpRequest(fileUrl, { headers });
  if (response.statusCode >= 400) {
    throw new Error(`사진 다운로드 실패: status=${response.statusCode}`);
  }

  return {
    fileUrl,
    body: response.body,
    contentType: response.headers['content-type'] || ''
  };
}

async function saveProjectPhotos({ baseUrl, cookieJar, projects, date, baseDir, configuredPhotoRoot, siteName }) {
  const photoRoot = resolvePhotoRoot(baseDir, configuredPhotoRoot);
  const photoDir = buildPhotoDirectory(photoRoot, date);
  ensureDirectory(photoDir);
  const driveFolder = await ensureDrivePhotoFolder(siteName, date);
  const sourceProjects = Array.isArray(projects) ? projects : [];

  const selectedFiles = [];
  const totalProjects = sourceProjects.length;
  sourceProjects.forEach((project, projectIndex) => {
    const sourceLabel = buildProjectSourceLabel(project, projectIndex, totalProjects);
    for (const file of project.files || []) {
      const matchedItem = matchTargetItem(file?.item?.name);
      if (!matchedItem) continue;
      selectedFiles.push({
        itemName: matchedItem,
        sourceLabel,
        projectId: String(project?.id || '').trim() || null,
        filePath: file.filePath
      });
    }
  });

  const savedPhotos = [];
  const driveUploadedPhotos = [];
  const usedFileNames = new Map();
  for (const file of selectedFiles) {
    const downloaded = await downloadPhoto(baseUrl, cookieJar, file.filePath);
    const ext = pickExtension(file.filePath, downloaded.contentType);
    const duplicateIndex = usedFileNames.get(`${file.sourceLabel}|${file.itemName}`) || 0;
    usedFileNames.set(`${file.sourceLabel}|${file.itemName}`, duplicateIndex + 1);

    const readableName = buildReadablePhotoName(date, file.itemName, file.sourceLabel, ext, duplicateIndex);
    const targetPath = path.join(photoDir, readableName);
    fs.writeFileSync(targetPath, downloaded.body);

    const savedPhoto = {
      itemName: file.itemName,
      sourceLabel: file.sourceLabel,
      projectId: file.projectId,
      fileName: readableName,
      savedPath: targetPath,
      size: downloaded.body.length,
      contentType: downloaded.contentType,
      fileUrl: downloaded.fileUrl
    };
    savedPhotos.push(savedPhoto);

    if (driveFolder?.id) {
      const driveFile = await uploadBufferToFolder({
        folderId: driveFolder.id,
        fileName: readableName,
        buffer: downloaded.body,
        mimeType: downloaded.contentType || 'image/jpeg'
      });

      driveUploadedPhotos.push({
        ...savedPhoto,
        driveFileId: driveFile.id,
        driveUrl: driveFile.webViewLink || driveFile.webContentLink || ''
      });
    }
  }

  return {
    photoRoot,
    photoDirectory: photoDir,
    driveFolderId: driveFolder?.id || '',
    driveFolderUrl: driveFolder?.webViewLink || '',
    savedPhotos,
    driveUploadedPhotos,
    identifiedPhotos: selectedFiles.length
  };
}

module.exports = {
  saveProjectPhotos,
  getDefaultPhotoRoot,
  resolvePhotoRoot
};