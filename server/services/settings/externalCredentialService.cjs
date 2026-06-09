const fs = require('fs');
const { normalizeBaseUrl, invalidateQntechSessionCache } = require('../qntechAuthService.cjs');
const {
  isSheetsConfigured,
  getAppSettings,
  upsertAppSettings,
  upsertSite: upsertSiteToSheets,
} = require('../sitesSheetsService.cjs');

const SHEET_CREDENTIAL_FIELDS = {
  road_web: {
    urlKey: 'road_web_url',
    userIdField: 'road_web_user_id',
    passwordField: 'road_web_password',
  },
  water_analysis_app: {
    urlKey: 'water_analysis_url',
    userIdField: 'water_analysis_user_id',
    passwordField: 'water_analysis_password',
  },
};

function normalizeCredentialUrl(serviceKey, serviceUrl) {
  return serviceKey === 'water_analysis_app'
    ? normalizeBaseUrl(serviceUrl || '')
    : (serviceUrl || '');
}

function getCurrentSiteId(db) {
  const row = db.prepare('SELECT site_id FROM app_settings WHERE id = 1').get();
  return String(row?.site_id || '').trim();
}

function getCredential(db, serviceKey) {
  return db.prepare(`
    SELECT service_key, service_name, service_url, user_id, password, updated_at
    FROM web_app_credentials
    WHERE service_key = ?
  `).get(serviceKey);
}

function updateLocalCredential(db, serviceKey, patch = {}) {
  const existing = getCredential(db, serviceKey);
  if (!existing) return null;

  const nextUrl = patch.serviceUrl != null
    ? normalizeCredentialUrl(serviceKey, patch.serviceUrl)
    : existing.service_url;
  const nextUserId = patch.userId != null ? String(patch.userId || '') : existing.user_id;
  const nextPassword = patch.password != null ? String(patch.password || '') : existing.password;

  db.prepare(`
    UPDATE web_app_credentials
    SET service_url = ?, user_id = ?, password = ?, updated_at = CURRENT_TIMESTAMP
    WHERE service_key = ?
  `).run(nextUrl || '', nextUserId || '', nextPassword || '', serviceKey);

  if (serviceKey === 'water_analysis_app') {
    invalidateQntechSessionCache('water_analysis_app credentials updated');
  }

  return getCredential(db, serviceKey);
}

async function syncCommonAppSettingsToLocal(db) {
  if (!isSheetsConfigured()) return {};

  const appSettings = await getAppSettings();
  for (const [serviceKey, fields] of Object.entries(SHEET_CREDENTIAL_FIELDS)) {
    const serviceUrl = appSettings[fields.urlKey];
    if (serviceUrl) {
      updateLocalCredential(db, serviceKey, { serviceUrl });
    }
  }
  return appSettings;
}

function syncSiteCredentialsToLocal(db, site = {}) {
  for (const [serviceKey, fields] of Object.entries(SHEET_CREDENTIAL_FIELDS)) {
    const userId = site[fields.userIdField];
    const password = site[fields.passwordField];
    if (userId || password) {
      updateLocalCredential(db, serviceKey, { userId, password });
    }
  }
}

async function syncCredentialToSheets(db, { serviceKey, serviceUrl, userId, password } = {}) {
  if (!isSheetsConfigured()) return;
  const fields = SHEET_CREDENTIAL_FIELDS[serviceKey];
  if (!fields) return;

  if (serviceUrl != null) {
    await upsertAppSettings({
      [fields.urlKey]: normalizeCredentialUrl(serviceKey, serviceUrl),
    });
  }

  const siteId = getCurrentSiteId(db);
  if (!siteId) return;

  await upsertSiteToSheets({
    id: siteId,
    [fields.userIdField]: userId || '',
    [fields.passwordField]: password || '',
  });
}

async function saveWebAppCredentials(db, { serviceKey, serviceUrl, userId, password } = {}) {
  if (!serviceKey) {
    const err = new Error('serviceKey가 필요합니다.');
    err.statusCode = 400;
    throw err;
  }

  const credential = updateLocalCredential(db, serviceKey, { serviceUrl, userId, password });
  if (!credential) {
    const err = new Error('해당 설정을 찾을 수 없습니다.');
    err.statusCode = 404;
    throw err;
  }

  await syncCredentialToSheets(db, {
    serviceKey,
    serviceUrl: credential.service_url,
    userId: credential.user_id,
    password: credential.password,
  });

  return credential;
}

function saveQntechImportSettings(db, payload = {}, defaultQntechPhotoRoot) {
  const fixedPhotoRoot = defaultQntechPhotoRoot;
  if (fixedPhotoRoot && !fs.existsSync(fixedPhotoRoot)) {
    fs.mkdirSync(fixedPhotoRoot, { recursive: true });
  }
  const serializedMappings = JSON.stringify([]);
  db.prepare(`
    UPDATE app_settings
    SET qntech_photo_root = ?, qntech_sample_mappings = ?
    WHERE id = 1
  `).run(fixedPhotoRoot, serializedMappings);

  return db.prepare('SELECT qntech_photo_root, qntech_sample_mappings FROM app_settings WHERE id = 1').get();
}

module.exports = {
  saveWebAppCredentials,
  saveQntechImportSettings,
  syncCommonAppSettingsToLocal,
  syncSiteCredentialsToLocal,
};
