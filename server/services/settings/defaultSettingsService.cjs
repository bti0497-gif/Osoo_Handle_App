const BASE_KITS = ['암모니아성질소(NH3-N)', '질산성질소(NO3-N)', '인산염인(PO4-P)', '알칼리도(ALK)'];

function getMedicineDefaults(db) {
  return db.prepare(
    "SELECT item_name, COALESCE(default_amount, 0) AS default_amount FROM config_items WHERE category = 'medicine' AND item_name NOT LIKE '%\\_purchase' ESCAPE '\\' AND item_name NOT LIKE '%\\_usage' ESCAPE '\\' AND item_name NOT LIKE '%\\_inventory' ESCAPE '\\' ORDER BY display_order ASC"
  ).all();
}

function saveItemDefaults(db, category, items) {
  if (!Array.isArray(items)) {
    const err = new Error('items 배열이 필요합니다');
    err.statusCode = 400;
    throw err;
  }

  const existsStmt = db.prepare(
    'SELECT id FROM config_items WHERE category = ? AND item_name = ? LIMIT 1'
  );
  const stmt = db.prepare(
    'UPDATE config_items SET default_amount = ? WHERE category = ? AND item_name = ?'
  );
  const rows = items.filter((it) => it && String(it.name ?? '').trim());
  let matchedCount = 0;
  let changedCount = 0;

  db.transaction((list) => {
    for (const it of list) {
      const name = String(it.name ?? '').trim();
      if (!name) continue;
      if (!existsStmt.get(category, name)) continue;
      const raw = it.defaultAmount ?? it.default_amount ?? 0;
      const amt = Number(raw);
      const safeAmt = Number.isFinite(amt) ? amt : 0;
      matchedCount += 1;
      changedCount += stmt.run(safeAmt, category, name).changes;
    }
  })(rows);

  return { rows, matchedCount, changedCount, skipped: rows.length - matchedCount };
}

function getKitDefaults(db) {
  const rows = db.prepare(
    "SELECT item_name, COALESCE(default_amount, 0) AS default_amount FROM config_items WHERE category = 'kit'"
  ).all();
  const rowMap = Object.fromEntries(rows.map(r => [r.item_name, r.default_amount]));
  return BASE_KITS.map(name => ({ item_name: name, default_amount: rowMap[name] ?? 0 }));
}

function getSludgeExportSettings(db) {
  return db.prepare('SELECT company_name, default_amount FROM sludge_export_settings WHERE id = 1').get()
    || { company_name: '', default_amount: 0 };
}

function saveSludgeExportSettings(db, { companyName, defaultAmount } = {}) {
  db.prepare(`
    INSERT INTO sludge_export_settings (id, company_name, default_amount, updated_at)
    VALUES (1, ?, ?, datetime('now', 'localtime'))
    ON CONFLICT(id) DO UPDATE SET
      company_name = excluded.company_name,
      default_amount = excluded.default_amount,
      updated_at = excluded.updated_at
  `).run(String(companyName || ''), Number(defaultAmount) || 0);

  return getSludgeExportSettings(db);
}

module.exports = {
  getMedicineDefaults,
  saveItemDefaults,
  getKitDefaults,
  getSludgeExportSettings,
  saveSludgeExportSettings,
};
