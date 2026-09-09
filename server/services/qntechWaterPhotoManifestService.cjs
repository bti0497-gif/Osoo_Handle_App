'use strict';

const fs = require('fs');
const path = require('path');

const PHOTO_MANIFEST_SCHEMA_VERSION = 1;
const PHOTO_MANIFEST_DIRECTORY = '.osoo-roadwork-photo-manifests';

const ROADWORK_WATER_PHOTO_ITEMS = [
  { key: 'alkalinity', label: '알칼리도' },
  { key: 'nh3_n', label: '암모니아성질소' },
  { key: 'no3_n', label: '질산성질소' },
  { key: 'po4_p', label: '인산염인' },
];

function normalizeDate(value) {
  const date = String(value || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('invalid QnTECH photo manifest date');
  }
  return date;
}

function normalizeSiteId(value) {
  return String(value || '').trim();
}

function toSafeSegment(value) {
  const normalized = normalizeSiteId(value);
  if (!normalized) return 'unscoped';
  return normalized
    .normalize('NFC')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.{2,}/g, '_')
    .slice(0, 160) || 'unscoped';
}

function getPhotoManifestPath(photoRoot, siteId, date) {
  const normalizedDate = normalizeDate(date);
  return path.join(
    path.resolve(photoRoot),
    PHOTO_MANIFEST_DIRECTORY,
    toSafeSegment(siteId),
    `${normalizedDate.replace(/-/g, '')}.json`,
  );
}

function isPathInside(rootPath, targetPath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeManifestItems(photoRoot, items = []) {
  const byKey = new Map((Array.isArray(items) ? items : []).map((item) => [item?.key, item]));
  return ROADWORK_WATER_PHOTO_ITEMS.map((definition) => {
    const source = byKey.get(definition.key) || {};
    const absolutePath = String(source.filePath || source.savedPath || '').trim();
    const ready = Boolean(absolutePath && fs.existsSync(absolutePath) && isPathInside(photoRoot, absolutePath));
    return {
      key: definition.key,
      label: definition.label,
      status: ready ? 'ready' : 'missing',
      relativePath: ready ? path.relative(path.resolve(photoRoot), path.resolve(absolutePath)) : '',
      fileName: ready ? path.basename(absolutePath) : '',
      size: ready ? Number(fs.statSync(absolutePath).size || 0) : 0,
    };
  });
}

function writePhotoPreparationManifest({
  photoRoot,
  siteId,
  siteName,
  date,
  status,
  projectCount = 0,
  selectedProjectId = '',
  selectedProjectIndex = null,
  identifiedPhotoCount = 0,
  savedPhotoCount = 0,
  downloadFailureCount = 0,
  localSaveFailureCount = 0,
  items = [],
}) {
  const normalizedDate = normalizeDate(date);
  const normalizedSiteId = normalizeSiteId(siteId);
  const manifestPath = getPhotoManifestPath(photoRoot, normalizedSiteId, normalizedDate);
  const normalizedItems = normalizeManifestItems(photoRoot, items);
  const readyPhotoCount = normalizedItems.filter((item) => item.status === 'ready').length;
  const manifest = {
    schemaVersion: PHOTO_MANIFEST_SCHEMA_VERSION,
    source: 'qntech-import',
    siteId: normalizedSiteId,
    siteName: String(siteName || '').trim(),
    date: normalizedDate,
    preparedAt: new Date().toISOString(),
    status: String(status || (readyPhotoCount === 4 ? 'ready' : readyPhotoCount > 0 ? 'partial' : 'none')),
    projectCount: Number(projectCount || 0),
    selectedProjectId: String(selectedProjectId || '').trim(),
    selectedProjectIndex: Number.isInteger(selectedProjectIndex) ? selectedProjectIndex : null,
    identifiedPhotoCount: Number(identifiedPhotoCount || 0),
    savedPhotoCount: Number(savedPhotoCount || 0),
    downloadFailureCount: Number(downloadFailureCount || 0),
    localSaveFailureCount: Number(localSaveFailureCount || 0),
    readyPhotoCount,
    missingPhotoCount: normalizedItems.length - readyPhotoCount,
    items: normalizedItems,
  };

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const tempPath = `${manifestPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(manifest, null, 2), 'utf8');
    try {
      fs.renameSync(tempPath, manifestPath);
    } catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
      fs.rmSync(manifestPath, { force: true });
      fs.renameSync(tempPath, manifestPath);
    }
  } finally {
    fs.rmSync(tempPath, { force: true });
  }

  return { manifest, manifestPath };
}

function readPhotoPreparationManifest({ photoRoot, siteId, date }) {
  const normalizedDate = normalizeDate(date);
  const normalizedSiteId = normalizeSiteId(siteId);
  const manifestPath = getPhotoManifestPath(photoRoot, normalizedSiteId, normalizedDate);
  const unavailableItems = (reason) => ROADWORK_WATER_PHOTO_ITEMS.map((item) => ({
    ...item,
    available: false,
    filePath: '',
    availabilityReason: reason,
  }));

  if (!fs.existsSync(manifestPath)) {
    return {
      manifestFound: false,
      preparationStatus: 'not-imported',
      preparedAt: '',
      photos: unavailableItems('not-imported'),
    };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return {
      manifestFound: true,
      preparationStatus: 'manifest-invalid',
      preparedAt: '',
      manifestError: String(error?.message || error).slice(0, 160),
      photos: unavailableItems('manifest-invalid'),
    };
  }

  if (
    Number(manifest?.schemaVersion) !== PHOTO_MANIFEST_SCHEMA_VERSION
    || String(manifest?.source || '') !== 'qntech-import'
    || String(manifest?.date || '') !== normalizedDate
    || String(manifest?.siteId || '') !== normalizedSiteId
  ) {
    return {
      manifestFound: true,
      preparationStatus: 'manifest-mismatch',
      preparedAt: String(manifest?.preparedAt || ''),
      photos: unavailableItems('manifest-mismatch'),
    };
  }

  const manifestItems = new Map((Array.isArray(manifest.items) ? manifest.items : []).map((item) => [item?.key, item]));
  const manifestStatus = String(manifest.status || 'manifest-invalid');
  const photos = ROADWORK_WATER_PHOTO_ITEMS.map((definition) => {
    const item = manifestItems.get(definition.key) || {};
    const relativePath = String(item.relativePath || '').trim();
    if (item.status !== 'ready' || !relativePath) {
      return {
        ...definition,
        available: false,
        filePath: '',
        availabilityReason: manifestStatus === 'preparing' ? 'preparing' : 'not-provided',
      };
    }
    const filePath = path.resolve(photoRoot, relativePath);
    if (!isPathInside(photoRoot, filePath)) {
      return { ...definition, available: false, filePath: '', availabilityReason: 'manifest-path-invalid' };
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return { ...definition, available: false, filePath: '', availabilityReason: 'prepared-file-missing' };
    }
    return { ...definition, available: true, filePath, availabilityReason: 'ready' };
  });

  return {
    manifestFound: true,
    preparationStatus: manifestStatus,
    preparedAt: String(manifest.preparedAt || ''),
    selectedProjectIndex: Number.isInteger(manifest.selectedProjectIndex) ? manifest.selectedProjectIndex : null,
    readyPhotoCount: photos.filter((item) => item.available).length,
    missingPhotoCount: photos.filter((item) => !item.available).length,
    photos,
  };
}

module.exports = {
  PHOTO_MANIFEST_DIRECTORY,
  PHOTO_MANIFEST_SCHEMA_VERSION,
  ROADWORK_WATER_PHOTO_ITEMS,
  getPhotoManifestPath,
  readPhotoPreparationManifest,
  writePhotoPreparationManifest,
};
