'use strict';

const OPERATIONAL_SITE_TABLES = [
  'flow_readings',
  'medicine_logs',
  'kit_logs',
  'qntech_water_quality',
  'facility_logs',
  'operation_status_logs',
  'sludge_photo_logs',
  'attendance',
  'work_records',
];

function tableHasSiteId(db, tableName) {
  const exists = db.prepare(`
    SELECT 1 AS found
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(tableName);
  if (!exists) return false;
  return db.prepare(`PRAGMA table_info("${tableName}")`).all()
    .some((column) => column.name === 'site_id');
}

function inspectSiteIdentity(db) {
  const settings = db.prepare(`
    SELECT site_id, site_name, multi_site_enabled
    FROM app_settings WHERE id = 1
  `).get() || {};
  const currentSiteId = String(settings.site_id || '').trim();
  const totals = new Map();

  for (const tableName of OPERATIONAL_SITE_TABLES) {
    if (!tableHasSiteId(db, tableName)) continue;
    const rows = db.prepare(`
      SELECT TRIM(COALESCE(site_id, '')) AS site_id, COUNT(*) AS count
      FROM "${tableName}"
      GROUP BY TRIM(COALESCE(site_id, ''))
    `).all();
    for (const row of rows) {
      const siteId = String(row.site_id || '');
      totals.set(siteId, Number(totals.get(siteId) || 0) + Number(row.count || 0));
    }
  }

  return {
    currentSiteId,
    currentSiteName: String(settings.site_name || '').trim(),
    multiSiteEnabled: Number(settings.multi_site_enabled || 0) === 1,
    currentSiteExists: Boolean(
      currentSiteId && db.prepare('SELECT 1 AS found FROM sites WHERE id = ?').get(currentSiteId)
    ),
    rowCounts: [...totals.entries()]
      .map(([siteId, count]) => ({ siteId, count }))
      .sort((left, right) => right.count - left.count),
  };
}

function repairUnambiguousSingleSiteIdentity(db) {
  const before = inspectSiteIdentity(db);
  if (before.multiSiteEnabled || !before.currentSiteId) {
    return { applied: false, reason: before.multiSiteEnabled ? 'multi-site' : 'site-id-missing', before };
  }

  const currentCount = before.rowCounts.find((item) => item.siteId === before.currentSiteId)?.count || 0;
  const otherPopulated = before.rowCounts.filter(
    (item) => item.siteId && item.siteId !== before.currentSiteId && item.count > 0
  );
  if (currentCount > 0 || otherPopulated.length !== 1) {
    return { applied: false, reason: 'not-unambiguous', before };
  }

  const historical = db.prepare(`
    SELECT id, site_name, manager_name, method, series
    FROM sites WHERE id = ?
  `).get(otherPopulated[0].siteId);
  if (!historical) {
    return { applied: false, reason: 'historical-site-not-found', before };
  }

  db.prepare(`
    UPDATE app_settings
    SET site_id = ?, site_name = ?, manager_name = ?, method = ?, series = ?
    WHERE id = 1
  `).run(
    historical.id,
    historical.site_name || '',
    historical.manager_name || '',
    historical.method || 'A2O',
    historical.series || '1계열'
  );

  return {
    applied: true,
    reason: 'restored-only-populated-site',
    previousSiteId: before.currentSiteId,
    siteId: String(historical.id),
    rowCount: otherPopulated[0].count,
  };
}

module.exports = {
  OPERATIONAL_SITE_TABLES,
  inspectSiteIdentity,
  repairUnambiguousSingleSiteIdentity,
};
