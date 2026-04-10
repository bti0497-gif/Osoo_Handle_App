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

function getCurrentRecordMetadata(db) {
  const defaults = getDefaultSiteMetadata(db);
  const timestamp = getCurrentTimestamp();

  return {
    siteName: defaults.siteName,
    author: defaults.author,
    siteId: defaults.siteId,
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