function activeItems(db, siteId, category, suffixes = []) {
  const rows = db.prepare('SELECT item_name FROM site_config_items WHERE site_id = ? AND category = ? AND is_active = 1 ORDER BY display_order').all(siteId, category);
  return rows.map((r) => String(r.item_name || '')).filter((name) => name && !suffixes.some((suffix) => name.endsWith(suffix)));
}

function finalizeDailyRecords(db, { date, siteId, siteName = '', author = 'system:20:00-finalization' }) {
  const now = new Date().toISOString();
  const insertInventory = (table, column, name) => {
    const exists = db.prepare(`SELECT 1 FROM ${table} WHERE site_id = ? AND ${column} = ? AND date = ?`).get(siteId, name, date);
    if (exists) return 0;
    const previous = db.prepare(`SELECT current_inventory FROM ${table} WHERE site_id = ? AND ${column} = ? AND date < ? ORDER BY date DESC, id DESC LIMIT 1`).get(siteId, name, date);
    db.prepare(`INSERT INTO ${table} (${column}, date, purchase_amount, usage_amount, current_inventory, input_status, site_id, site_name, author, created_at, last_modified, is_synced) VALUES (?, ?, 0, 0, ?, 'defaulted', ?, ?, ?, ?, ?, 0)`).run(name, date, Number(previous?.current_inventory || 0), siteId, siteName, author, now, now);
    return 1;
  };
  let medicine = 0; let kit = 0; let flow = 0;
  db.transaction(() => {
    activeItems(db, siteId, 'medicine', ['_purchase', '_usage', '_inventory']).forEach((name) => { medicine += insertInventory('medicine_logs', 'medicine_name', name); });
    activeItems(db, siteId, 'kit', ['_purchase', '_usage', '_inventory']).forEach((name) => { kit += insertInventory('kit_logs', 'kit_name', name); });
    activeItems(db, siteId, 'flow', ['_raw', '_flow']).forEach((type) => {
      if (type === '슬러지') return;
      const exists = db.prepare('SELECT 1 FROM flow_readings WHERE site_id = ? AND type = ? AND date = ?').get(siteId, type, date);
      if (exists) return;
      const previous = db.prepare('SELECT raw_value, reading_unit FROM flow_readings WHERE site_id = ? AND type = ? AND date < ? ORDER BY date DESC, id DESC LIMIT 1').get(siteId, type, date);
      db.prepare("INSERT INTO flow_readings (date, type, raw_value, calculated_flow, reading_unit, input_status, site_id, site_name, author, created_at, last_modified, is_synced) VALUES (?, ?, ?, 0, ?, 'defaulted', ?, ?, ?, ?, ?, 0)").run(date, type, Number(previous?.raw_value || 0), previous?.reading_unit || null, siteId, siteName, author, now, now);
      flow += 1;
    });
  })();
  return { medicine, kit, flow, total: medicine + kit + flow };
}

module.exports = { finalizeDailyRecords };
