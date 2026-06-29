const { recalculateInventoryCascade } = require('./inventoryCascadeService.cjs');

const KIT_FIELD_MAP = [
  { kitName: '암모니아성질소(NH3-N)', field: 'nh3_n' },
  { kitName: '질산성질소(NO3-N)', field: 'no3_n' },
  { kitName: '인산염인(PO4-P)', field: 'po4_p' },
  { kitName: '알칼리도(ALK)', field: 'alkalinity' },
];

function normalizeDate(value) {
  const s = String(value || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function isCountableWaterValue(value) {
  if (value === null || value === undefined) return false;
  return String(value).trim() !== '';
}

function buildSiteClause(metadata, tableAlias = '') {
  const siteId = String(metadata?.siteId || '').trim();
  if (!siteId) return { clause: '', params: [] };
  const prefix = tableAlias ? `${tableAlias}.` : '';
  return { clause: ` AND ${prefix}site_id = ?`, params: [siteId] };
}

function aggregateExpectedUsageByDate(db, startDate, endDate, metadata = {}) {
  const siteFilter = buildSiteClause(metadata);
  const rows = db.prepare(`
    SELECT date, item_code, result_value
    FROM qntech_water_quality
    WHERE date >= ? AND date <= ?${siteFilter.clause}
    ORDER BY date ASC
  `).all(startDate, endDate, ...siteFilter.params);

  const byDate = new Map();
  for (const row of rows) {
    const date = normalizeDate(row.date);
    if (!date) continue;

    const current = byDate.get(date) || Object.fromEntries(
      KIT_FIELD_MAP.map(({ kitName }) => [kitName, 0])
    );

    for (const { kitName, field } of KIT_FIELD_MAP) {
      if (row.item_code === field && isCountableWaterValue(row.result_value)) {
        current[kitName] += 1;
      }
    }

    byDate.set(date, current);
  }

  return byDate;
}

function recalculateKitInventory(db, kitName, metadata = {}, startDate) {
  recalculateInventoryCascade(db, {
    tableName: 'kit_logs',
    nameColumn: 'kit_name',
    itemName: kitName,
    metadata,
    startDate,
  });
}

function syncAnalysisKitUsageForRange(db, startDate, endDate, metadata = {}) {
  const normalizedStart = normalizeDate(startDate);
  const normalizedEnd = normalizeDate(endDate);
  if (!normalizedStart || !normalizedEnd) {
    throw new Error('키트 사용량 동기화 날짜 형식이 올바르지 않습니다.');
  }
  if (normalizedStart > normalizedEnd) {
    throw new Error('시작일은 종료일보다 클 수 없습니다.');
  }

  const expectedByDate = aggregateExpectedUsageByDate(db, normalizedStart, normalizedEnd, metadata);
  const siteFilter = buildSiteClause(metadata);
  const selectUsageStmt = db.prepare(`
    SELECT COALESCE(usage_amount, 0) AS usage_amount
    FROM kit_logs
    WHERE kit_name = ? AND date = ?${siteFilter.clause}
  `);
  const upsertUsageStmt = db.prepare(`
    INSERT INTO kit_logs (
      kit_name, date, purchase_amount, usage_amount, current_inventory,
      input_status, site_id, site_name, author, created_at, last_modified, is_synced
    ) VALUES (?, ?, 0, ?, 0, 'imported', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(kit_name, date) DO UPDATE SET
      usage_amount = excluded.usage_amount,
      input_status = excluded.input_status,
      site_id = excluded.site_id,
      site_name = excluded.site_name,
      author = excluded.author,
      last_modified = excluded.last_modified,
      is_synced = excluded.is_synced
  `);

  const unsyncedDates = new Set();
  const changedKits = new Set();
  let updatedCellCount = 0;
  let alreadyMatchedCellCount = 0;

  db.transaction(() => {
    for (const [date, expected] of expectedByDate.entries()) {
      for (const { kitName } of KIT_FIELD_MAP) {
        const analysisUsage = Number(expected[kitName] || 0);
        const currentUsage = Number(selectUsageStmt.get(kitName, date, ...siteFilter.params)?.usage_amount || 0);
        const targetUsage = Math.max(currentUsage, analysisUsage);
        if (currentUsage === targetUsage) {
          alreadyMatchedCellCount += 1;
          continue;
        }

        upsertUsageStmt.run(
          kitName,
          date,
          targetUsage,
          metadata.siteId,
          metadata.siteName,
          metadata.author,
          metadata.createdAt,
          metadata.lastModified,
          metadata.isSynced
        );
        unsyncedDates.add(date);
        changedKits.add(kitName);
        updatedCellCount += 1;
      }
    }

    changedKits.forEach((kitName) => {
      recalculateKitInventory(db, kitName, metadata, normalizedStart);
    });
  })();

  const sortedDates = Array.from(unsyncedDates).sort((a, b) => a.localeCompare(b));
  return {
    startDate: normalizedStart,
    endDate: normalizedEnd,
    summary: {
      checkedDateCount: expectedByDate.size,
      unsyncedDateCount: sortedDates.length,
      updatedCellCount,
      alreadyMatchedCellCount,
      recalculatedKitCount: changedKits.size,
    },
    unsyncedDates: sortedDates,
  };
}

module.exports = {
  KIT_FIELD_MAP,
  aggregateExpectedUsageByDate,
  recalculateKitInventory,
  syncAnalysisKitUsageForRange,
};
