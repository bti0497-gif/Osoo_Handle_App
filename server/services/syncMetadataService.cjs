function getCurrentTimestamp() {
  return new Date().toISOString();
}

function getDefaultSiteMetadata(db) {
  const row = db.prepare('SELECT site_name, manager_name, site_id FROM app_settings WHERE id = 1').get();

  return {
    siteName: row?.site_name || 'Unknown Site',
    author: row?.manager_name || 'Unknown Author',
    siteId: row?.site_id || null,
  };
}

function resolveSiteMetadataById(db, siteId) {
  if (!siteId) return null;
  const row = db.prepare(`
    SELECT id, site_name, manager_name
    FROM sites
    WHERE id = ? AND COALESCE(is_active, 1) = 1
  `).get(String(siteId));
  if (!row) return null;
  return {
    siteId: String(row.id),
    siteName: row.site_name || '',
    author: row.manager_name || '',
  };
}

function getCurrentRecordMetadata(db, overrides = {}) {
  const defaults = getDefaultSiteMetadata(db);
  const candidateSiteId = overrides?.site_id || overrides?.siteId || null;
  const resolvedById = resolveSiteMetadataById(db, candidateSiteId);
  const timestamp = getCurrentTimestamp();

  return {
    siteName: resolvedById?.siteName || overrides?.site_name || overrides?.siteName || defaults.siteName,
    author: resolvedById?.author || overrides?.author || defaults.author,
    siteId: resolvedById?.siteId || candidateSiteId || defaults.siteId,
    createdAt: timestamp,
    lastModified: timestamp,
    isSynced: 0
  };
}

module.exports = {
  getCurrentTimestamp,
  getDefaultSiteMetadata,
  getCurrentRecordMetadata
};