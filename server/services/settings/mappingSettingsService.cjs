const { getCurrentRecordMetadata } = require('../syncMetadataService.cjs');
const { getRangeCell, hasStoredData, formatDate, readExcelRange } = require('../excelService.cjs');

function ensureExcelReady(db, siteId) {
  if (!hasStoredData(db, siteId)) {
    throw new Error('엑셀 원본 데이터가 아직 준비되지 않았습니다. 먼저 파일을 업로드해주세요.');
  }
}

function toRoundedNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = parseFloat(String(value).replace(/,/g, ''));
  return Number.isNaN(parsed) ? fallback : Math.round(parsed * 10) / 10;
}

function createProgress(config = {}) {
  const startRow = Number(config.startRow) || 1;
  const endRow = Number(config.endRow) || startRow;
  return {
    current: 0,
    total: Math.max(0, endRow - startRow + 1),
    status: 'processing',
    result: null,
  };
}

function collectColumns(...sources) {
  const columns = new Set();
  for (const source of sources) {
    if (!source) continue;
    if (typeof source === 'string') {
      if (source.trim()) columns.add(source.trim().toUpperCase());
      continue;
    }
    if (Array.isArray(source)) {
      source.forEach((value) => {
        if (value) columns.add(String(value).trim().toUpperCase());
      });
      continue;
    }
    Object.values(source).forEach((value) => {
      if (typeof value === 'string' && value.trim()) {
        columns.add(value.trim().toUpperCase());
      } else if (value && typeof value === 'object') {
        Object.values(value).forEach((nested) => {
          if (nested) columns.add(String(nested).trim().toUpperCase());
        });
      }
    });
  }
  return Array.from(columns);
}

function formatRowDate(value) {
  return formatDate(value) || String(value || '').trim();
}

function getTodayKst() {
  return new Date(Date.now() + (9 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function isImportableDate(value) {
  const date = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
    && date >= '2000-01-01'
    && date <= getTodayKst();
}

function findFirstDateRow(rows, startRow, endRow, dateCol, scanRange = 30) {
  const from = Math.max(1, Number(startRow) - scanRange);
  const to = Math.max(Number(endRow) + scanRange, Number(startRow) + scanRange);
  for (let r = from; r <= to; r += 1) {
    if (isImportableDate(formatRowDate(getRangeCell(rows, r, dateCol)))) return r;
  }
  return null;
}

function collectMappedDates(rows, startRow, endRow, dateCol, label) {
  const dates = [];
  const seen = new Set();
  for (let r = startRow; r <= endRow; r += 1) {
    const formatted = formatRowDate(getRangeCell(rows, r, dateCol));
    if (!isImportableDate(formatted) || seen.has(formatted)) continue;
    dates.push(formatted);
    seen.add(formatted);
  }
  if (dates.length === 0) {
    const suggestedRow = findFirstDateRow(rows, startRow, endRow, dateCol);
    const suggestion = suggestedRow
      ? ` 가까운 날짜 행은 ${suggestedRow}행입니다.`
      : '';
    throw new Error(`${label} 시작행(${startRow})부터 종료행(${endRow}) 사이의 날짜를 확인할 수 없습니다. 날짜 칼럼(${dateCol})과 시작행/종료행을 다시 확인해주세요.${suggestion}`);
  }
  return dates;
}

function saveMappingSettings(db, prefix, config, siteId) {
  const { sheet, startRow, endRow, dateCol } = config;
  db.prepare(`
    INSERT INTO site_settings (
      site_id, ${prefix}_sheet, ${prefix}_start_row, ${prefix}_end_row, ${prefix}_date_col, updated_at
    ) VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
    ON CONFLICT(site_id) DO UPDATE SET
      ${prefix}_sheet = excluded.${prefix}_sheet,
      ${prefix}_start_row = excluded.${prefix}_start_row,
      ${prefix}_end_row = excluded.${prefix}_end_row,
      ${prefix}_date_col = excluded.${prefix}_date_col,
      updated_at = excluded.updated_at
  `).run(siteId, sheet, startRow, endRow, dateCol);
  const legacySiteId = String(db.prepare('SELECT site_id FROM app_settings WHERE id = 1').get()?.site_id || '').trim();
  if (legacySiteId === String(siteId)) {
    db.prepare(`
      UPDATE app_settings
      SET ${prefix}_sheet = ?, ${prefix}_start_row = ?, ${prefix}_end_row = ?, ${prefix}_date_col = ?
      WHERE id = 1
    `).run(sheet, startRow, endRow, dateCol);
  }
}

function isLegacyActiveSite(db, siteId) {
  const legacySiteId = String(db.prepare('SELECT site_id FROM app_settings WHERE id = 1').get()?.site_id || '').trim();
  return legacySiteId === String(siteId || '').trim();
}

function mirrorMappingItemToLegacy(db, category, itemName, excelCell) {
  db.prepare(`
    INSERT INTO config_items (category, item_name, excel_cell, is_active, display_order)
    VALUES (?, ?, ?, 1, 0)
    ON CONFLICT(category, item_name) DO UPDATE SET excel_cell = excluded.excel_cell
  `).run(category, itemName, excelCell);
}

function groupInventoryMappings(mapping) {
  const grouped = {};
  Object.keys(mapping || {}).forEach((key) => {
    const lastUnderscore = key.lastIndexOf('_');
    if (lastUnderscore === -1) return;
    const name = key.substring(0, lastUnderscore);
    const field = key.substring(lastUnderscore + 1);
    if (!grouped[name]) grouped[name] = {};
    grouped[name][field] = mapping[key];
  });
  return grouped;
}

function filterInventoryMappingByActiveItems(db, siteId, category, mapping) {
  const activeItems = db.prepare(
    "SELECT item_name FROM site_config_items WHERE site_id = ? AND category = ? AND is_active = 1 AND item_name NOT LIKE '%\\_purchase' ESCAPE '\\' AND item_name NOT LIKE '%\\_usage' ESCAPE '\\' AND item_name NOT LIKE '%\\_inventory' ESCAPE '\\'"
  ).all(siteId, category);
  if (activeItems.length === 0) return mapping;

  const allowedNames = new Set(activeItems.map((row) => row.item_name));
  return Object.fromEntries(
    Object.entries(mapping || {}).filter(([key]) => {
      const lastUnderscore = key.lastIndexOf('_');
      if (lastUnderscore === -1) return false;
      return allowedNames.has(key.substring(0, lastUnderscore));
    })
  );
}

async function saveFlowMapping(db, appDataPath, config, mapping, progress) {
  const { sheet, startRow, endRow, dateCol } = config;
  const metadata = getCurrentRecordMetadata(db, config || {});
  if (!metadata.siteId) throw new Error('엑셀 매핑을 저장할 현장이 선택되지 않았습니다.');

  saveMappingSettings(db, 'flow', config, metadata.siteId);

  const upsertStmt = db.prepare("INSERT INTO site_config_items (site_id, category, item_name, excel_cell, is_active, display_order) VALUES (?, 'flow', ?, ?, 1, 0) ON CONFLICT(site_id, category, item_name) DO UPDATE SET excel_cell = excluded.excel_cell, updated_at = datetime('now', 'localtime')");
  Object.entries(mapping || {}).forEach(([name, col]) => {
    if (name.endsWith('_raw') || name.endsWith('_flow')) {
      upsertStmt.run(metadata.siteId, name, col);
      if (isLegacyActiveSite(db, metadata.siteId)) mirrorMappingItemToLegacy(db, 'flow', name, col);
    }
  });

  ensureExcelReady(db, metadata.siteId);

  const flows = {};
  Object.keys(mapping || {}).forEach((key) => {
    if (!key.endsWith('_raw') && !key.endsWith('_flow')) return;
    const lastUnderscore = key.lastIndexOf('_');
    const name = key.substring(0, lastUnderscore);
    const field = key.substring(lastUnderscore + 1);
    if (!flows[name]) flows[name] = {};
    flows[name][field] = mapping[key];
  });

  const scanStartRow = Math.max(1, Number(startRow) - 30);
  const scanEndRow = Math.max(Number(endRow) + 30, Number(startRow) + 30);
  const rows = await readExcelRange(db, appDataPath, sheet, scanStartRow, scanEndRow, collectColumns(dateCol, flows), metadata.siteId);
  const mappedDates = collectMappedDates(rows, startRow, endRow, dateCol, '유량 데이터');
  const insertReading = db.prepare(`
    INSERT INTO flow_readings (
      date, type, raw_value, calculated_flow, input_status, site_id, site_name, author, created_at, last_modified, is_synced
    ) VALUES (?, ?, ?, ?, 'imported', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(site_id, date, type) DO UPDATE SET
      raw_value = excluded.raw_value,
      calculated_flow = excluded.calculated_flow,
      input_status = excluded.input_status,
      site_id = excluded.site_id,
      site_name = excluded.site_name,
      author = excluded.author,
      last_modified = excluded.last_modified,
      is_synced = excluded.is_synced
  `);
  const importedData = [];

  db.transaction(() => {
    const flowNames = Object.keys(flows).filter(Boolean);
    db.prepare("DELETE FROM flow_readings WHERE input_status = 'imported' AND site_id = ?").run(metadata.siteId);
    if (flowNames.length > 0 && mappedDates.length > 0) {
      const placeholders = flowNames.map(() => '?').join(',');
      const datePlaceholders = mappedDates.map(() => '?').join(',');
      db.prepare(`DELETE FROM flow_readings WHERE site_id = ? AND date IN (${datePlaceholders}) AND type IN (${placeholders})`)
        .run(metadata.siteId, ...mappedDates, ...flowNames);
    }

    for (let r = startRow; r <= endRow; r += 1) {
      const formatted = formatRowDate(getRangeCell(rows, r, dateCol));
      if (!isImportableDate(formatted)) { progress.current += 1; continue; }
      const rowResults = { date: formatted };
      Object.entries(flows).forEach(([itemName, cols]) => {
        const rawValue = toRoundedNumber(getRangeCell(rows, r, cols.raw || ''), null);
        const calcFlow = toRoundedNumber(getRangeCell(rows, r, cols.flow || ''), null);
        if (rawValue !== null || calcFlow !== null) {
          insertReading.run(
            formatted,
            itemName,
            rawValue,
            calcFlow,
            metadata.siteId,
            metadata.siteName,
            metadata.author,
            metadata.createdAt,
            metadata.lastModified,
            metadata.isSynced
          );
          if (rawValue !== null) rowResults[`${itemName}_검침`] = rawValue;
          if (calcFlow !== null) rowResults[`${itemName}_유량`] = calcFlow;
        }
      });
      if (Object.keys(rowResults).length > 1) importedData.push(rowResults);
      progress.current += 1;
    }
  })();

  progress.status = 'completed';
  progress.result = importedData;
  return { message: '유량 데이터 임포트 완료', count: importedData.length };
}

async function saveInventoryMapping(db, appDataPath, config, mapping, progress, options) {
  const { sheet, startRow, endRow, dateCol } = config;
  const metadata = getCurrentRecordMetadata(db, config || {});
  if (!metadata.siteId) throw new Error('엑셀 매핑을 저장할 현장이 선택되지 않았습니다.');
  const scopedMapping = options.category
    ? filterInventoryMappingByActiveItems(db, metadata.siteId, options.category, mapping)
    : mapping;

  saveMappingSettings(db, options.settingsPrefix, config, metadata.siteId);
  const upsertStmt = db.prepare(options.upsertConfigSql);
  Object.entries(scopedMapping || {}).forEach(([key, col]) => {
    upsertStmt.run(metadata.siteId, key, col);
    if (isLegacyActiveSite(db, metadata.siteId)) mirrorMappingItemToLegacy(db, options.category, key, col);
  });

  ensureExcelReady(db, metadata.siteId);

  const grouped = groupInventoryMappings(scopedMapping);
  const scanStartRow = Math.max(1, Number(startRow) - 30);
  const scanEndRow = Math.max(Number(endRow) + 30, Number(startRow) + 30);
  const rows = await readExcelRange(db, appDataPath, sheet, scanStartRow, scanEndRow, collectColumns(dateCol, grouped), metadata.siteId);
  const mappedDates = collectMappedDates(rows, startRow, endRow, dateCol, options.label || '재고 데이터');
  const insertStmt = db.prepare(options.insertSql);
  const importedData = [];

  db.transaction(() => {
    const itemNames = Object.keys(grouped).filter(Boolean);
    if (options.tableName) {
      db.prepare(`DELETE FROM ${options.tableName} WHERE input_status = 'imported' AND site_id = ?`).run(metadata.siteId);
    }
    if (itemNames.length > 0 && mappedDates.length > 0 && options.deleteSqlPrefix) {
      const placeholders = itemNames.map(() => '?').join(',');
      const datePlaceholders = mappedDates.map(() => '?').join(',');
      db.prepare(`${options.deleteSqlPrefix} site_id = ? AND date IN (${datePlaceholders}) AND ${options.nameColumn} IN (${placeholders})`)
        .run(metadata.siteId, ...mappedDates, ...itemNames);
    }

    for (let r = startRow; r <= endRow; r += 1) {
      const formatted = formatRowDate(getRangeCell(rows, r, dateCol));
      if (!isImportableDate(formatted)) { progress.current += 1; continue; }
      const rowResults = { date: formatted };
      Object.entries(grouped).forEach(([itemName, cols]) => {
        const purchase = toRoundedNumber(getRangeCell(rows, r, cols.purchase || ''), null);
        const usage = toRoundedNumber(getRangeCell(rows, r, cols.usage || ''), null);
        const inventory = toRoundedNumber(getRangeCell(rows, r, cols.inventory || ''), null);
        if (purchase !== null || usage !== null || inventory !== null) {
          insertStmt.run(
            itemName,
            formatted,
            purchase,
            usage,
            inventory,
            metadata.siteId,
            metadata.siteName,
            metadata.author,
            metadata.createdAt,
            metadata.lastModified,
            metadata.isSynced
          );
          if (purchase !== null) rowResults[`${itemName}_입고`] = purchase;
          if (usage !== null) rowResults[`${itemName}_사용`] = usage;
          if (inventory !== null) rowResults[`${itemName}_재고`] = inventory;
        }
      });
      if (Object.keys(rowResults).length > 1) importedData.push(rowResults);
      progress.current += 1;
    }
  })();

  progress.status = 'completed';
  progress.result = importedData;
  return { message: options.successMessage, count: importedData.length };
}

function saveKitMapping(db, appDataPath, config, mapping, progress) {
  return saveInventoryMapping(db, appDataPath, config, mapping, progress, {
    category: 'kit',
    tableName: 'kit_logs',
    label: '키트 데이터',
    nameColumn: 'kit_name',
    deleteSqlPrefix: 'DELETE FROM kit_logs WHERE',
    settingsPrefix: 'kit',
    upsertConfigSql: "INSERT INTO site_config_items (site_id, category, item_name, excel_cell, is_active, display_order) VALUES (?, 'kit', ?, ?, 1, 0) ON CONFLICT(site_id, category, item_name) DO UPDATE SET excel_cell = excluded.excel_cell, updated_at = datetime('now', 'localtime')",
    insertSql: `
    INSERT INTO kit_logs (
        kit_name, date, purchase_amount, usage_amount, current_inventory, input_status, site_id, site_name, author, created_at, last_modified, is_synced
      ) VALUES (?, ?, ?, ?, ?, 'imported', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(site_id, kit_name, date) DO UPDATE SET
        purchase_amount = excluded.purchase_amount,
        usage_amount = excluded.usage_amount,
        current_inventory = excluded.current_inventory,
        input_status = excluded.input_status,
        site_id = excluded.site_id,
        site_name = excluded.site_name,
        author = excluded.author,
        last_modified = excluded.last_modified,
        is_synced = excluded.is_synced
    `,
    successMessage: '키트 데이터 임포트 완료',
  });
}

function saveMedicineMapping(db, appDataPath, config, mapping, progress) {
  return saveInventoryMapping(db, appDataPath, config, mapping, progress, {
    category: 'medicine',
    tableName: 'medicine_logs',
    label: '약품 데이터',
    nameColumn: 'medicine_name',
    deleteSqlPrefix: 'DELETE FROM medicine_logs WHERE',
    settingsPrefix: 'med',
    upsertConfigSql: "INSERT INTO site_config_items (site_id, category, item_name, excel_cell, is_active, display_order) VALUES (?, 'medicine', ?, ?, 1, 0) ON CONFLICT(site_id, category, item_name) DO UPDATE SET excel_cell = excluded.excel_cell, updated_at = datetime('now', 'localtime')",
    insertSql: `
    INSERT INTO medicine_logs (
        medicine_name, date, purchase_amount, usage_amount, current_inventory, input_status, site_id, site_name, author, created_at, last_modified, is_synced
      ) VALUES (?, ?, ?, ?, ?, 'imported', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(site_id, medicine_name, date) DO UPDATE SET
        purchase_amount = excluded.purchase_amount,
        usage_amount = excluded.usage_amount,
        current_inventory = excluded.current_inventory,
        input_status = excluded.input_status,
        site_id = excluded.site_id,
        site_name = excluded.site_name,
        author = excluded.author,
        last_modified = excluded.last_modified,
        is_synced = excluded.is_synced
    `,
    successMessage: '약품 데이터 임포트 완료',
  });
}

async function saveWaterMapping(db, appDataPath, config, mapping, progress) {
  const { sheet, startRow, endRow, dateCol } = config;
  const metadata = getCurrentRecordMetadata(db, config || {});
  if (!metadata.siteId) throw new Error('엑셀 매핑을 저장할 현장이 선택되지 않았습니다.');

  saveMappingSettings(db, 'water', config, metadata.siteId);

  const itemDefinitions = [
    { aliases: ['암모니아성질소', '암모니아 질소', 'NH3-N'], itemCode: 'nh3_n', itemName: '암모니아성질소(NH3-N)', unit: 'mg/L' },
    { aliases: ['질산성질소', '질산성 질소', 'NO3-N'], itemCode: 'no3_n', itemName: '질산성질소(NO3-N)', unit: 'mg/L' },
    { aliases: ['인산염인', '오르토인산염', 'PO4-P'], itemCode: 'po4_p', itemName: '인산염인(PO4-P)', unit: 'mg/L' },
    { aliases: ['알칼리도', 'ALK'], itemCode: 'alkalinity', itemName: '알칼리도(ALK)', unit: 'mg/L' },
  ];
  const normalize = (value) => String(value || '').replace(/\s+/g, '').trim().toLowerCase();
  const resolveDefinition = (name) => itemDefinitions.find((definition) => (
    definition.aliases.some((alias) => normalize(name).includes(normalize(alias)) || normalize(alias).includes(normalize(name)))
  ));
  const activeLocationRows = db.prepare("SELECT item_name FROM site_config_items WHERE site_id = ? AND category = 'location' AND is_active = 1").all(metadata.siteId);
  const activeLocations = new Set(activeLocationRows.map((row) => row.item_name));
  const method = db.prepare('SELECT method FROM sites WHERE id = ?').get(metadata.siteId)?.method || 'A2O';
  const isMbr = String(method).trim().toUpperCase() === 'MBR';
  const po4pLocations = new Set(isMbr
    ? ['유량조정조', '포기조', '방류조']
    : ['유량조정조', '침전조', '방류조']
  );

  const locations = {};
  const scopedEntries = Object.entries(mapping || {}).filter(([key]) => {
    if (key === 'date') return false;
    const lastUnderscore = key.lastIndexOf('_');
    if (lastUnderscore === -1) return false;
    const paramName = key.substring(0, lastUnderscore);
    const locName = key.substring(lastUnderscore + 1);
    const definition = resolveDefinition(paramName);
    if (!definition) return false;
    if (definition.itemCode === 'po4_p') return po4pLocations.has(locName);
    if (activeLocations.size > 0 && !activeLocations.has(locName)) return false;
    return true;
  });
  const upsertStmt = db.prepare("INSERT INTO site_config_items (site_id, category, item_name, excel_cell, is_active, display_order) VALUES (?, 'water_mapping', ?, ?, 1, 0) ON CONFLICT(site_id, category, item_name) DO UPDATE SET excel_cell = excluded.excel_cell, updated_at = datetime('now', 'localtime')");
  scopedEntries.forEach(([key, col]) => {
    upsertStmt.run(metadata.siteId, key, col);
    if (isLegacyActiveSite(db, metadata.siteId)) mirrorMappingItemToLegacy(db, 'water_mapping', key, col);
  });

  ensureExcelReady(db, metadata.siteId);

  scopedEntries.forEach(([key, col]) => {
    const lastUnderscore = key.lastIndexOf('_');
    const paramName = key.substring(0, lastUnderscore);
    const locName = key.substring(lastUnderscore + 1);
    const definition = resolveDefinition(paramName);
    if (!locations[locName]) locations[locName] = [];
    locations[locName].push({ ...definition, col });
  });

  const scanStartRow = Math.max(1, Number(startRow) - 30);
  const scanEndRow = Math.max(Number(endRow) + 30, Number(startRow) + 30);
  const rows = await readExcelRange(
    db,
    appDataPath,
    sheet,
    scanStartRow,
    scanEndRow,
    collectColumns(dateCol, scopedEntries.map(([, col]) => col)),
    metadata.siteId
  );
  const mappedDates = collectMappedDates(rows, startRow, endRow, dateCol, '수질 데이터');
  const insertWater = db.prepare(`
    INSERT INTO qntech_water_quality (
      date, measurement_group, measurement_order, source_type, source_label,
      location, item_name, item_code, result_value, result_numeric, unit,
      input_status, site_id, site_name, author, created_at, last_modified, is_synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'imported', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(site_id, date, measurement_group, location, item_code) DO UPDATE SET
      measurement_order = excluded.measurement_order,
      source_type = excluded.source_type,
      source_label = excluded.source_label,
      input_status = excluded.input_status,
      item_name = excluded.item_name,
      result_value = excluded.result_value,
      result_numeric = excluded.result_numeric,
      unit = excluded.unit,
      site_id = excluded.site_id,
      site_name = excluded.site_name,
      author = excluded.author,
      last_modified = excluded.last_modified,
      is_synced = excluded.is_synced
  `);

  const importedData = [];

  db.transaction(() => {
    const metadata = getCurrentRecordMetadata(db, config || {});
    db.prepare("DELETE FROM qntech_water_quality WHERE site_id = ? AND (source_type = 'excel' OR measurement_group LIKE 'excel:%' OR measurement_group = '')").run(metadata.siteId);
    if (mappedDates.length > 0) {
      const datePlaceholders = mappedDates.map(() => '?').join(',');
      db.prepare(`DELETE FROM qntech_water_quality WHERE site_id = ? AND date IN (${datePlaceholders}) AND (source_type = 'excel' OR measurement_group LIKE 'excel:%' OR measurement_group = '')`)
        .run(metadata.siteId, ...mappedDates);
    }
    const cleanedDates = new Set();
    const dateOrderCounter = new Map();

    for (let r = startRow; r <= endRow; r += 1) {
      const formatted = formatRowDate(getRangeCell(rows, r, dateCol));
      if (!isImportableDate(formatted)) { progress.current += 1; continue; }

      if (!cleanedDates.has(formatted)) cleanedDates.add(formatted);

      const nextOrder = (dateOrderCounter.get(formatted) || 0) + 1;
      dateOrderCounter.set(formatted, nextOrder);
      const measurementGroup = `excel:${formatted}:${String(nextOrder).padStart(3, '0')}`;
      const rowResults = { date: formatted, measurement_group: measurementGroup };

      Object.entries(locations).forEach(([locName, definitions]) => {
        definitions.forEach((definition) => {
          const resultNumeric = toRoundedNumber(getRangeCell(rows, r, definition.col), null);
          if (resultNumeric === null) return;
          insertWater.run(
            formatted,
            measurementGroup,
            nextOrder,
            'excel',
            sheet,
            locName,
            definition.itemName,
            definition.itemCode,
            String(resultNumeric),
            resultNumeric,
            definition.unit,
            metadata.siteId,
            metadata.siteName,
            metadata.author,
            metadata.createdAt,
            metadata.lastModified,
            metadata.isSynced
          );
          rowResults[`${locName}_${definition.itemCode}`] = resultNumeric;
        });
      });

      if (Object.keys(rowResults).length > 2) importedData.push(rowResults);
      progress.current += 1;
    }
  })();

  progress.status = 'completed';
  progress.result = importedData;
  return { message: '수질 데이터 임포트 완료', count: importedData.length };
}

module.exports = {
  createProgress,
  saveFlowMapping,
  saveKitMapping,
  saveMedicineMapping,
  saveWaterMapping,
};
