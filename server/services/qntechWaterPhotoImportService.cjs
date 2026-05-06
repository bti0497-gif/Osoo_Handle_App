const fs = require('fs');
const path = require('path');

const { httpRequest } = require('./qntechAuthService.cjs');
const {
  isDriveConfigured,
  getDriveRootFolderId,
  getOrCreateFolderPath,
  uploadBufferToFolder
} = require('./driveService.cjs');
const {
  sanitize,
  waterAnalysisPhotoSegments,
} = require('./drivePathService.cjs');

const TARGET_PHOTO_ITEMS = ['?붾え?덉븘??吏덉냼', '吏덉궛??吏덉냼', '?ㅻⅤ???몄궛??, '?뚯뭡由щ룄'];

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
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
  const analysisProcess = sanitize(project?.analysisProcess);
  const note = sanitize(project?.note);
  if (analysisProcess) return analysisProcess;
  if (note) return note;
  if (totalProjects > 1) return `${projectIndex + 1}李?;
  return '';
}


async function ensureDrivePhotoFolder(siteName, date) {
  if (!isDriveConfigured()) {
    return null;
  }

  const rootFolderId = getDriveRootFolderId();
  const segments = waterAnalysisPhotoSegments(siteName || 'Unknown Site', date);
  return getOrCreateFolderPath(rootFolderId, segments);
}

function getDefaultPhotoRoot(baseDir) {
  const appDataRoot = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'Osoo_Handle_App')
    : '';

  if (appDataRoot) {
    return path.join(appDataRoot, '사진관리', '수질분석');
  }

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
  return path.join(photoRoot, year, month, '데이타불러오기');
}

function toImportDateStamp(date) {
  // ?붿껌 湲곗?: yyyyddmm
  const y = String(date || '').slice(0, 4);
  const m = String(date || '').slice(5, 7);
  const d = String(date || '').slice(8, 10);
  return `${y}${d}${m}`;
}

function sanitizeItemForFileName(itemName) {
  const cleaned = sanitize(itemName || '').replace(/\s+/g, '');
  return cleaned || '遺꾩꽍??ぉ';
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
    throw new Error(`?ъ쭊 ?ㅼ슫濡쒕뱶 ?ㅽ뙣: status=${response.statusCode}`);
  }

  return {
    fileUrl,
    body: response.body,
    contentType: response.headers['content-type'] || ''
  };
}

async function saveProjectPhotos({ db, baseUrl, cookieJar, projects, date, baseDir, configuredPhotoRoot, siteName }) {
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

  const findRowIdByProjectStmt = db.prepare(`
    SELECT id
    FROM water_quality
    WHERE date = ? AND qntech_project_id = ?
    ORDER BY measurement_order ASC, id ASC
    LIMIT 1
  `);
  const findAnyQntechRowIdStmt = db.prepare(`
    SELECT id
    FROM water_quality
    WHERE date = ? AND source_type = 'qntech'
    ORDER BY measurement_order ASC, id ASC
    LIMIT 1
  `);

  const savedPhotos = [];
  const driveUploadedPhotos = [];
  const usedFileNames = new Map();
  const stamp = toImportDateStamp(date);
  for (const file of selectedFiles) {
    const downloaded = await downloadPhoto(baseUrl, cookieJar, file.filePath);
    const ext = pickExtension(file.filePath, downloaded.contentType);
    const rowId = file.projectId
      ? (findRowIdByProjectStmt.get(date, file.projectId)?.id || null)
      : null;
    const fallbackRowId = findAnyQntechRowIdStmt.get(date)?.id || null;
    const finalRowId = rowId || fallbackRowId || 0;
    const itemToken = sanitizeItemForFileName(file.itemName);

    const key = `${finalRowId}|${itemToken}`;
    const duplicateIndex = usedFileNames.get(key) || 0;
    usedFileNames.set(key, duplicateIndex + 1);
    const duplicateSuffix = duplicateIndex > 0 ? `_${duplicateIndex}` : '';
    const readableName = `${finalRowId}_${stamp}_${itemToken}${duplicateSuffix}${ext.toLowerCase()}`;
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