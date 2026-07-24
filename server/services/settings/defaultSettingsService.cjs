const BASE_KITS = ['암모니아성질소(NH3-N)', '질산성질소(NO3-N)', '인산염인(PO4-P)', '알칼리도(ALK)'];

function getMedicineDefaults(db, siteId) {
  return db.prepare(
    "SELECT item_name, COALESCE(default_amount, 0) AS default_amount FROM site_config_items WHERE site_id = ? AND category = 'medicine' AND item_name NOT LIKE '%\\_purchase' ESCAPE '\\' AND item_name NOT LIKE '%\\_usage' ESCAPE '\\' AND item_name NOT LIKE '%\\_inventory' ESCAPE '\\' ORDER BY display_order ASC"
  ).all(siteId);
}

function saveItemDefaults(db, siteId, category, items) {
  if (!Array.isArray(items)) {
    const err = new Error('items 배열이 필요합니다');
    err.statusCode = 400;
    throw err;
  }

  const existsStmt = db.prepare(
    'SELECT id FROM site_config_items WHERE site_id = ? AND category = ? AND item_name = ? LIMIT 1'
  );
  const stmt = db.prepare(
    "UPDATE site_config_items SET default_amount = ?, updated_at = datetime('now', 'localtime') WHERE site_id = ? AND category = ? AND item_name = ?"
  );
  const rows = items.filter((it) => it && String(it.name ?? '').trim());
  const legacySiteId = String(db.prepare('SELECT site_id FROM app_settings WHERE id = 1').get()?.site_id || '').trim();
  const legacyStmt = db.prepare(
    'UPDATE config_items SET default_amount = ? WHERE category = ? AND item_name = ?'
  );
  let matchedCount = 0;
  let changedCount = 0;

  db.transaction((list) => {
    for (const it of list) {
      const name = String(it.name ?? '').trim();
      if (!name) continue;
      if (!existsStmt.get(siteId, category, name)) continue;
      const raw = it.defaultAmount ?? it.default_amount ?? 0;
      const amt = Number(raw);
      const safeAmt = Number.isFinite(amt) ? amt : 0;
      matchedCount += 1;
      changedCount += stmt.run(safeAmt, siteId, category, name).changes;
      if (legacySiteId === String(siteId || '')) legacyStmt.run(safeAmt, category, name);
    }
  })(rows);

  return { rows, matchedCount, changedCount, skipped: rows.length - matchedCount };
}

function getKitDefaults(db, siteId) {
  const rows = db.prepare(
    "SELECT item_name, COALESCE(default_amount, 0) AS default_amount FROM site_config_items WHERE site_id = ? AND category = 'kit'"
  ).all(siteId);
  const rowMap = Object.fromEntries(rows.map(r => [r.item_name, r.default_amount]));
  return BASE_KITS.map(name => ({ item_name: name, default_amount: rowMap[name] ?? 0 }));
}

function getSludgeExportSettings(db, siteId) {
  return db.prepare('SELECT company_name, default_amount FROM site_sludge_export_settings WHERE site_id = ?').get(siteId)
    || { company_name: '', default_amount: 0 };
}

function saveSludgeExportSettings(db, siteId, { companyName, defaultAmount } = {}) {
  db.prepare(`
    INSERT INTO site_sludge_export_settings (site_id, company_name, default_amount, updated_at)
    VALUES (?, ?, ?, datetime('now', 'localtime'))
    ON CONFLICT(site_id) DO UPDATE SET
      company_name = excluded.company_name,
      default_amount = excluded.default_amount,
      updated_at = excluded.updated_at
  `).run(siteId, String(companyName || ''), Number(defaultAmount) || 0);
  const legacySiteId = String(db.prepare('SELECT site_id FROM app_settings WHERE id = 1').get()?.site_id || '').trim();
  if (legacySiteId === String(siteId || '')) {
    db.prepare(`
      INSERT INTO sludge_export_settings (id, company_name, default_amount, updated_at)
      VALUES (1, ?, ?, datetime('now', 'localtime'))
      ON CONFLICT(id) DO UPDATE SET
        company_name = excluded.company_name,
        default_amount = excluded.default_amount,
        updated_at = excluded.updated_at
    `).run(String(companyName || ''), Number(defaultAmount) || 0);
  }

  return getSludgeExportSettings(db, siteId);
}

module.exports = {
  getMedicineDefaults,
  saveItemDefaults,
  getKitDefaults,
  getSludgeExportSettings,
  saveSludgeExportSettings,
};
