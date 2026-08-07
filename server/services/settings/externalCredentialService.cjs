const fs = require('fs');
const { normalizeBaseUrl, invalidateQntechSessionCache } = require('../qntechAuthService.cjs');
const {
  isSheetsConfigured,
  getAppSettings,
  getSites: getSitesFromSheets,
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

function getGlobalCredential(db, serviceKey) {
  return db.prepare(`
    SELECT service_key, service_name, service_url, user_id, password, updated_at
    FROM web_app_credentials
    WHERE service_key = ?
  `).get(serviceKey);
}

function getCredential(db, serviceKey, siteId = '') {
  const globalCredential = getGlobalCredential(db, serviceKey);
  if (!globalCredential) return null;

  const resolvedSiteId = String(siteId || getCurrentSiteId(db)).trim();
  if (!resolvedSiteId || !['road_web', 'water_analysis_app'].includes(serviceKey)) {
    return globalCredential;
  }
  const scoped = db.prepare(`
    SELECT user_id, password, updated_at
    FROM site_web_app_credentials
    WHERE site_id = ? AND service_key = ?
  `).get(resolvedSiteId, serviceKey);

  // A row with blank values means this direction deliberately has no account.
  // Do not fall back to another direction's legacy credential.
  return scoped
    ? { ...globalCredential, ...scoped, site_id: resolvedSiteId }
    : globalCredential;
}

function listCredentials(db, siteId = '') {
  return db.prepare(`
    SELECT service_key FROM web_app_credentials ORDER BY id
  `).all().map((row) => getCredential(db, row.service_key, siteId));
}

function upsertSiteCredential(db, siteId, serviceKey, { userId, password }) {
  const normalizedSiteId = String(siteId || '').trim();
  if (!normalizedSiteId || !['road_web', 'water_analysis_app'].includes(serviceKey)) return;
  db.prepare(`
    INSERT INTO site_web_app_credentials (site_id, service_key, user_id, password, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(site_id, service_key) DO UPDATE SET
      user_id = excluded.user_id,
      password = excluded.password,
      updated_at = CURRENT_TIMESTAMP
  `).run(normalizedSiteId, serviceKey, String(userId || ''), String(password || ''));
}

function updateLocalCredential(db, serviceKey, patch = {}, siteId = '') {
  const resolvedSiteId = String(siteId || getCurrentSiteId(db)).trim();
  const existing = getCredential(db, serviceKey, resolvedSiteId);
  if (!existing) return null;

  const nextUrl = patch.serviceUrl != null
    ? normalizeCredentialUrl(serviceKey, patch.serviceUrl)
    : existing.service_url;
  const nextUserId = patch.userId != null ? String(patch.userId || '') : existing.user_id;
  const nextPassword = patch.password != null ? String(patch.password || '') : existing.password;

  db.prepare(`
    UPDATE web_app_credentials
    SET service_url = ?,
        user_id = CASE WHEN ? THEN ? ELSE user_id END,
        password = CASE WHEN ? THEN ? ELSE password END,
        updated_at = CURRENT_TIMESTAMP
    WHERE service_key = ?
  `).run(
    nextUrl || '',
    resolvedSiteId ? 0 : 1, nextUserId || '',
    resolvedSiteId ? 0 : 1, nextPassword || '',
    serviceKey,
  );
  if (resolvedSiteId) {
    upsertSiteCredential(db, resolvedSiteId, serviceKey, {
      userId: nextUserId,
      password: nextPassword,
    });
  }

  if (serviceKey === 'water_analysis_app') {
    invalidateQntechSessionCache('water_analysis_app credentials updated');
  }

  return getCredential(db, serviceKey, resolvedSiteId);
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

async function syncSiteCredentialForSite(db, siteId = '') {
  const normalizedSiteId = String(siteId || '').trim();
  if (!normalizedSiteId || !isSheetsConfigured()) return null;
  const sites = await getSitesFromSheets();
  const site = sites.find((item) => String(item?.id || '').trim() === normalizedSiteId);
  if (!site) return null;
  syncSiteCredentialsToLocal(db, site, { syncQntechSite: false });
  return site;
}

function syncSiteCredentialsToLocal(db, site = {}, { syncQntechSite = true } = {}) {
  const siteId = String(site.id || '').trim();
  if (!siteId) return;
  for (const [serviceKey, fields] of Object.entries(SHEET_CREDENTIAL_FIELDS)) {
    const userId = site[fields.userIdField];
    const password = site[fields.passwordField];
    // Empty credentials are also stored so this direction never borrows a
    // credential that belongs to the opposite direction.
    updateLocalCredential(db, serviceKey, { userId, password }, siteId);
  }

  if (syncQntechSite) {
    db.prepare(`
      UPDATE app_settings
      SET qntech_site_id = ?
      WHERE id = 1
    `).run(String(site.qntech_site_id || '').trim() || null);
  }
}

async function syncCredentialToSheets(db, { serviceKey, serviceUrl, userId, password } = {}, siteId = '') {
  if (!isSheetsConfigured()) return;
  const fields = SHEET_CREDENTIAL_FIELDS[serviceKey];
  if (!fields) return;

  if (serviceUrl != null) {
    await upsertAppSettings({
      [fields.urlKey]: normalizeCredentialUrl(serviceKey, serviceUrl),
    });
  }

  const resolvedSiteId = String(siteId || getCurrentSiteId(db)).trim();
  if (!resolvedSiteId) return;

  await upsertSiteToSheets({
    id: resolvedSiteId,
    [fields.userIdField]: userId || '',
    [fields.passwordField]: password || '',
  });
}

async function saveWebAppCredentials(db, { serviceKey, serviceUrl, userId, password } = {}, siteId = '') {
  if (!serviceKey) {
    const err = new Error('serviceKey가 필요합니다.');
    err.statusCode = 400;
    throw err;
  }

  const credential = updateLocalCredential(db, serviceKey, { serviceUrl, userId, password }, siteId);
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
  }, siteId);

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
  getCredential,
  listCredentials,
  saveWebAppCredentials,
  saveQntechImportSettings,
  syncCommonAppSettingsToLocal,
  syncSiteCredentialForSite,
  syncSiteCredentialsToLocal,
};
