const Database = require('better-sqlite3');

const dbPath = process.argv[2];
const startDate = process.argv[3] || '2026-06-01';
const endDate = process.argv[4] || '2026-06-30';
const db = new Database(dbPath, { readonly: true });

try {
  const settings = db.prepare('SELECT site_name, site_id, manager_name FROM app_settings WHERE id = 1').get();
  const flow = db.prepare(`
    SELECT date, type, raw_value, calculated_flow, input_status, site_name, site_id, is_synced
    FROM flow_readings
    WHERE date BETWEEN ? AND ?
    ORDER BY date, type
  `).all(startDate, endDate);
  const medicineCount = db.prepare(`
    SELECT COUNT(*) AS count FROM medicine_logs WHERE date BETWEEN ? AND ?
  `).get(startDate, endDate)?.count || 0;
  const medicineSummary = db.prepare(`
    SELECT medicine_name, COUNT(*) AS count,
           SUM(COALESCE(purchase_amount, 0)) AS purchase,
           SUM(COALESCE(usage_amount, 0)) AS usage
    FROM medicine_logs
    WHERE date BETWEEN ? AND ?
    GROUP BY medicine_name
    ORDER BY medicine_name
  `).all(startDate, endDate);
  const kitCount = db.prepare(`
    SELECT COUNT(*) AS count FROM kit_logs WHERE date BETWEEN ? AND ?
  `).get(startDate, endDate)?.count || 0;
  const kitSummary = db.prepare(`
    SELECT kit_name, COUNT(*) AS count,
           SUM(COALESCE(purchase_amount, 0)) AS purchase,
           SUM(COALESCE(usage_amount, 0)) AS usage
    FROM kit_logs
    WHERE date BETWEEN ? AND ?
    GROUP BY kit_name
    ORDER BY kit_name
  `).all(startDate, endDate);
  const configuredInventory = db.prepare(`
    SELECT category, item_name, display_order
    FROM config_items
    WHERE category IN ('medicine', 'kit') AND COALESCE(is_active, 1) = 1
    ORDER BY category, display_order, item_name
  `).all();
  console.log(JSON.stringify({
    dbPath,
    settings,
    range: { startDate, endDate },
    flowCount: flow.length,
    flowTypes: [...new Set(flow.map((row) => row.type))],
    flow,
    medicineCount,
    medicineSummary,
    kitCount,
    kitSummary,
    configuredInventory,
  }, null, 2));
} finally {
  db.close();
}
