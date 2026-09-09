const fs = require('fs');
const path = require('path');

const { httpRequest } = require('./qntechAuthService.cjs');
const { enqueueBackgroundFileTask } = require('./backgroundFileTaskService.cjs');
const { sanitize } = require('./drivePathService.cjs');
const { writePhotoPreparationManifest } = require('./qntechWaterPhotoManifestService.cjs');

const TARGET_PHOTO_ITEMS = ['암모니아성 질소', '질산성 질소', '오르토인산염', '알칼리도'];

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
  if (totalProjects > 1) return `${projectIndex + 1}차`;
  return '';
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
  // New files use the ordinary YYYYMMDD order.  Readers retain support for
  // the older YYYYDDMM names already stored on field computers.
  return String(date || '').replace(/-/g, '').slice(0, 8);
}

function toRoadworkPhotoKey(itemName) {
  const compact = String(itemName || '').replace(/\s+/g, '');
  if (compact.includes('알칼리도')) return 'alkalinity';
  if (compact.includes('암모니아성질소')) return 'nh3_n';
  if (compact.includes('질산성질소')) return 'no3_n';
  if (compact.includes('오르토인산염') || compact.includes('인산염인')) return 'po4_p';
  return '';
}

function selectFirstRoundPreparedPhotos(savedPhotos = []) {
  const firstRoundItems = [];
  const firstRoundKeys = new Set();
  for (const photo of Array.isArray(savedPhotos) ? savedPhotos : []) {
    if (photo.projectIndex !== 0) continue;
    const key = toRoadworkPhotoKey(photo.itemName);
    if (!key || firstRoundKeys.has(key)) continue;
    firstRoundKeys.add(key);
    firstRoundItems.push({ key, filePath: photo.savedPath });
  }
  return firstRoundItems;
}

function sanitizeItemForFileName(itemName) {
  const cleaned = sanitize(itemName || '').replace(/\s+/g, '');
  return cleaned || '분석항목';
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

async function saveProjectPhotos({ db, baseUrl, cookieJar, projects, date, baseDir, configuredPhotoRoot, siteId, siteName }) {
  const photoRoot = resolvePhotoRoot(baseDir, configuredPhotoRoot);
  const photoDir = buildPhotoDirectory(photoRoot, date);
  ensureDirectory(photoDir);
  const driveUploadErrors = [];
  const sourceProjects = Array.isArray(projects) ? projects : [];
  const effectiveSiteId = String(siteId || db.prepare('SELECT site_id FROM app_settings WHERE id = 1').get()?.site_id || '').trim();

  const selectedFiles = [];
  const totalProjects = sourceProjects.length;
  const projectsWithRecognizedPhotos = new Set();
  sourceProjects.forEach((project, projectIndex) => {
    const sourceLabel = buildProjectSourceLabel(project, projectIndex, totalProjects);
    const projectKey = String(project?.id || `index-${projectIndex}`);
    for (const file of project.files || []) {
      const matchedItem = matchTargetItem(file?.item?.name);
      if (!matchedItem) continue;
      projectsWithRecognizedPhotos.add(projectKey);
      selectedFiles.push({
        itemName: matchedItem,
        sourceLabel,
        projectId: String(project?.id || '').trim() || null,
        projectIndex,
        filePath: file.filePath
      });
    }
  });

  const firstProject = sourceProjects[0] || null;
  const firstProjectId = String(firstProject?.id || '').trim();
  writePhotoPreparationManifest({
    photoRoot,
    siteId: effectiveSiteId,
    siteName,
    date,
    status: 'preparing',
    projectCount: totalProjects,
    selectedProjectId: firstProjectId,
    selectedProjectIndex: firstProject ? 0 : null,
    identifiedPhotoCount: selectedFiles.filter((file) => file.projectIndex === 0).length,
    savedPhotoCount: 0,
    items: [],
  });

  const findRowIdByProjectStmt = db.prepare(`
    SELECT id
    FROM qntech_water_quality
    WHERE site_id = ? AND date = ? AND qntech_project_id = ?
    ORDER BY measurement_order ASC, id ASC
    LIMIT 1
  `);
  const findAnyQntechRowIdStmt = db.prepare(`
    SELECT id
    FROM qntech_water_quality
    WHERE site_id = ? AND date = ? AND source_type = 'qntech'
    ORDER BY measurement_order ASC, id ASC
    LIMIT 1
  `);

  const savedPhotos = [];
  const driveQueuedPhotos = [];
  const photoDownloadErrors = [];
  const photoLocalSaveErrors = [];
  const usedFileNames = new Map();
  const stamp = toImportDateStamp(date);
  for (const file of selectedFiles) {
    let downloaded;
    try {
      downloaded = await downloadPhoto(baseUrl, cookieJar, file.filePath);
    } catch (error) {
      photoDownloadErrors.push({
        itemName: file.itemName,
        projectIndex: file.projectIndex,
        result: 'download-failed',
        reason: String(error?.message || error).slice(0, 160),
      });
      continue;
    }
    const ext = pickExtension(file.filePath, downloaded.contentType);
    const rowId = file.projectId
      ? (findRowIdByProjectStmt.get(effectiveSiteId, date, file.projectId)?.id || null)
      : null;
    const fallbackRowId = findAnyQntechRowIdStmt.get(effectiveSiteId, date)?.id || null;
    const finalRowId = rowId || fallbackRowId || 0;
    const itemToken = sanitizeItemForFileName(file.itemName);

    const key = `${finalRowId}|${itemToken}`;
    const duplicateIndex = usedFileNames.get(key) || 0;
    usedFileNames.set(key, duplicateIndex + 1);
    const duplicateSuffix = duplicateIndex > 0 ? `_${duplicateIndex}` : '';
    const readableName = `${finalRowId}_${stamp}_${itemToken}${duplicateSuffix}${ext.toLowerCase()}`;
    const targetPath = path.join(photoDir, readableName);
    try {
      fs.writeFileSync(targetPath, downloaded.body);
    } catch (error) {
      photoLocalSaveErrors.push({
        itemName: file.itemName,
        projectIndex: file.projectIndex,
        result: 'local-save-failed',
        reason: String(error?.message || error).slice(0, 160),
      });
      continue;
    }

    const savedPhoto = {
      itemName: file.itemName,
      sourceLabel: file.sourceLabel,
      projectId: file.projectId,
      projectIndex: file.projectIndex,
      fileName: readableName,
      savedPath: targetPath,
      size: downloaded.body.length,
      contentType: downloaded.contentType,
      fileUrl: downloaded.fileUrl
    };
    savedPhotos.push(savedPhoto);

    const driveItemLabel = ['수질분석', file.sourceLabel, file.itemName]
      .filter(Boolean)
      .join('_');
    try {
      enqueueBackgroundFileTask(db, {
        taskType: 'management-photo-drive',
        dedupeKey: `water:${targetPath}`,
        payload: {
          date,
          siteName: siteName || 'Unknown Site',
          itemLabel: driveItemLabel,
          photoIndex: duplicateIndex > 0 ? duplicateIndex + 1 : 0,
          extension: ext,
          mimeType: downloaded.contentType || 'image/jpeg',
          localPath: targetPath,
        },
      });
      driveQueuedPhotos.push({ ...savedPhoto, queued: true });
    } catch (error) {
      driveUploadErrors.push({
        itemName: file.itemName,
        projectIndex: file.projectIndex,
        result: 'drive-queue-failed',
        reason: String(error?.message || error).slice(0, 160),
      });
    }
  }

  // 공사입력도우미는 해당 날짜의 첫 분석 회차만 사용한다. 같은 항목의 사진이
  // 여러 장이어도 첫 장만 명세에 기록해 외부 일지에 중복 첨부하지 않는다.
  const { prepareRoadworkPhotos } = require('./roadworkPhotoResizeService.cjs');
  const prepared = await prepareRoadworkPhotos({
    photoRoot, siteId: effectiveSiteId, date,
    items: selectFirstRoundPreparedPhotos(savedPhotos),
  });
  const firstRoundItems = prepared.items;
  const firstRoundIdentifiedCount = selectedFiles.filter((file) => file.projectIndex === 0).length;
  const firstRoundDownloadFailureCount = photoDownloadErrors.filter((item) => item.projectIndex === 0).length;
  const firstRoundLocalSaveFailureCount = photoLocalSaveErrors.filter((item) => item.projectIndex === 0).length;
  const preparationStatus = firstRoundItems.length === 4
    ? 'ready'
    : firstRoundItems.length > 0
      ? 'partial'
      : firstRoundDownloadFailureCount + firstRoundLocalSaveFailureCount > 0
        ? 'failed'
        : 'none';
  const { manifest } = writePhotoPreparationManifest({
    photoRoot,
    siteId: effectiveSiteId,
    siteName,
    date,
    status: preparationStatus,
    projectCount: totalProjects,
    selectedProjectId: firstProjectId,
    selectedProjectIndex: firstProject ? 0 : null,
    identifiedPhotoCount: firstRoundIdentifiedCount,
    savedPhotoCount: firstRoundItems.length,
    downloadFailureCount: firstRoundDownloadFailureCount,
    localSaveFailureCount: firstRoundLocalSaveFailureCount,
    items: firstRoundItems,
  });

  return {
    photoRoot,
    photoDirectory: photoDir,
    driveFolderId: '',
    driveFolderUrl: '',
    savedPhotos,
    driveUploadedPhotos: [],
    driveQueuedPhotos,
    driveUploadErrors,
    identifiedPhotos: selectedFiles.length,
    photoSourceProjectCount: totalProjects,
    photoProjectsWithRecognizedFiles: projectsWithRecognizedPhotos.size,
    photoProjectsWithoutRecognizedFiles: Math.max(0, totalProjects - projectsWithRecognizedPhotos.size),
    photoDownloadFailureCount: photoDownloadErrors.length,
    photoDownloadErrors,
    photoLocalSaveFailureCount: photoLocalSaveErrors.length,
    photoLocalSaveErrors,
    photoPreparation: {
      resizeDiagnostics: prepared.diagnostics,
      status: manifest.status,
      selectedProjectIndex: manifest.selectedProjectIndex,
      readyPhotoCount: manifest.readyPhotoCount,
      missingPhotoCount: manifest.missingPhotoCount,
      identifiedPhotoCount: manifest.identifiedPhotoCount,
      downloadFailureCount: manifest.downloadFailureCount,
      localSaveFailureCount: manifest.localSaveFailureCount,
    },
  };
}

module.exports = {
  saveProjectPhotos,
  selectFirstRoundPreparedPhotos,
  getDefaultPhotoRoot,
  resolvePhotoRoot
};
