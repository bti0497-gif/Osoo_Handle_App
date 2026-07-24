const INVENTORY_TABLES = {
  medicine_logs: 'medicine_name',
  kit_logs: 'kit_name',
};

function roundInventory(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function clampInventory(value) {
  return Math.max(0, roundInventory(value));
}

function recalculateInventoryCascade(db, {
  tableName,
  nameColumn,
  itemName,
  metadata,
  startDate,
  explicitDates = new Set(),
}) {
  if (INVENTORY_TABLES[tableName] !== nameColumn) {
    throw new Error('지원하지 않는 재고 테이블입니다.');
  }

  const normalizedExplicitDates = explicitDates instanceof Set
    ? explicitDates
    : new Set(explicitDates || []);
  const siteId = String(metadata?.siteId || '').trim();
  if (!siteId) throw new Error('재고 연쇄 계산에 site_id가 필요합니다.');
  const previous = startDate
    ? db.prepare(`
        SELECT current_inventory
        FROM ${tableName}
        WHERE site_id = ? AND ${nameColumn} = ? AND date < ?
        ORDER BY date DESC, id DESC
        LIMIT 1
      `).get(siteId, itemName, startDate)
    : null;
  const rows = db.prepare(`
    SELECT id, date,
           COALESCE(purchase_amount, 0) AS purchase_amount,
           COALESCE(usage_amount, 0) AS usage_amount,
           current_inventory, is_synced, last_modified
    FROM ${tableName}
    WHERE site_id = ? AND ${nameColumn} = ? AND (? IS NULL OR date >= ?)
    ORDER BY date ASC, id ASC
  `).all(siteId, itemName, startDate || null, startDate || null);

  const updateStmt = db.prepare(`
    UPDATE ${tableName}
    SET current_inventory = ?,
        site_id = ?,
        site_name = ?,
        author = ?,
        last_modified = ?,
        is_synced = ?
    WHERE id = ?
  `);

  let runningInventory = Number(previous?.current_inventory || 0);
  for (const row of rows) {
    if (normalizedExplicitDates.has(row.date) && row.current_inventory != null) {
      runningInventory = clampInventory(row.current_inventory);
    } else {
      runningInventory = clampInventory(
        runningInventory + Number(row.purchase_amount || 0) - Number(row.usage_amount || 0)
      );
    }

    const previousInventory = row.current_inventory == null ? null : Number(row.current_inventory);
    const changed = runningInventory !== previousInventory;
    updateStmt.run(
      runningInventory,
      metadata.siteId,
      metadata.siteName,
      metadata.author,
      changed ? metadata.lastModified : (row.last_modified || metadata.lastModified),
      changed ? metadata.isSynced : (row.is_synced ?? 0),
      row.id
    );
  }
}

module.exports = {
  recalculateInventoryCascade,
};
