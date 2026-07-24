const fs = require('fs');
const path = require('path');
const { getCurrentRecordMetadata } = require('../syncMetadataService.cjs');

function normalizeDate(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length !== 8) return '';
  const date = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function toNullableNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const normalized = String(value).replace(/,/g, '').trim();
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

function getConfiguredNames(db, category) {
  return db.prepare(`
    SELECT item_name
    FROM config_items
    WHERE category = ? AND COALESCE(is_active, 1) = 1
    ORDER BY display_order ASC, item_name ASC
  `).all(category).map((row) => String(row.item_name || '').trim()).filter(Boolean);
}

function resolveConfiguredName(rawName, configuredNames) {
  const normalized = normalizeName(rawName);
  if (!normalized) return '';
  const exact = configuredNames.find((name) => normalizeName(name) === normalized);
  if (exact) return exact;
  return configuredNames.find((name) => {
    const candidate = normalizeName(name);
    return candidate.includes(normalized) || normalized.includes(candidate);
  }) || String(rawName || '').trim();
}

function resolveFlowName(rawName, configuredNames) {
  const direct = resolveConfiguredName(rawName, configuredNames);
  if (configuredNames.includes(direct)) return direct;
  const normalized = normalizeName(rawName);
  const keywordGroups = [
    ['유입'],
    ['방류'],
    ['내부', '반송'],
    ['외부', '반송'],
    ['전력'],
    ['슬러지'],
  ];
  const keywords = keywordGroups.find((group) => group.every((keyword) => normalized.includes(keyword)));
  if (!keywords) return '';
  return configuredNames.find((name) => {
    const candidate = normalizeName(name);
    return keywords.every((keyword) => candidate.includes(keyword));
  }) || '';
}

function classifyInventoryRow(row, medicineNames, kitNames) {
  const rawName = String(
    row?.chmcText
    || row?.chmcClssNmText
    || row?.column29
    || ''
  ).trim();
  const normalized = normalizeName(rawName);
  const classText = normalizeName(row?.dwrmChmcClssCd || '');
  const formulaAliases = [
    { source: 'nh3', target: 'nh3' },
    { source: 'no3', target: 'no3' },
    { source: 'po4', target: 'po4' },
    { source: 'alk', target: 'alk' },
  ];
  const formulaAlias = formulaAliases.find(({ source }) => normalized.includes(source));
  const formulaKit = formulaAlias
    ? kitNames.find((name) => normalizeName(name).includes(formulaAlias.target))
    : '';
  if (formulaKit) return { kind: 'kit', name: formulaKit };
  const medicine = medicineNames.find((name) => {
    const candidate = normalizeName(name);
    return candidate === normalized || candidate.includes(normalized) || normalized.includes(candidate);
  });
  const kit = kitNames.find((name) => {
    const candidate = normalizeName(name);
    return candidate === normalized || candidate.includes(normalized) || normalized.includes(candidate);
  });
  if (kit && !medicine) return { kind: 'kit', name: kit };
  if (medicine && !kit) return { kind: 'medicine', name: medicine };
  if (/kit|키트|시약/.test(classText)) return { kind: 'kit', name: kit || rawName };
  return { kind: 'medicine', name: medicine || rawName };
}

function normalizeDocuments(db, documents = []) {
  const flowNames = getConfiguredNames(db, 'flow');
  const medicineNames = getConfiguredNames(db, 'medicine');
  const kitNames = getConfiguredNames(db, 'kit');
  const normalized = [];
  const rejected = [];

  for (const source of Array.isArray(documents) ? documents : []) {
    const date = normalizeDate(source?.date);
    if (!date) {
      rejected.push({ documentKey: String(source?.documentKey || ''), reason: 'date-missing' });
      continue;
    }

    const flows = (Array.isArray(source.flow) ? source.flow : []).map((row) => ({
      type: resolveFlowName(row?.insrIdntIdText || row?.dwrmWeihgInsrCd, flowNames),
      previousReading: toNullableNumber(row?.prvdDrwtMsrmVal),
      rawValue: toNullableNumber(row?.tdayDrwtMsrmVal),
      usage: toNullableNumber(row?.drwtProsAmnt),
    })).filter((row) => row.type);

    const electricityRaw = source?.electricity || {};
    if (toNullableNumber(electricityRaw.todayReading) !== null || toNullableNumber(electricityRaw.usage) !== null) {
      const electricityName = flowNames.find((name) => String(name).includes('전력')) || '전력량';
      flows.push({
        type: electricityName,
        previousReading: toNullableNumber(electricityRaw.previousReading),
        rawValue: toNullableNumber(electricityRaw.todayReading),
        usage: toNullableNumber(electricityRaw.usage),
      });
    }

    const medicine = [];
    const kit = [];
    for (const row of Array.isArray(source.chemicals) ? source.chemicals : []) {
      const classified = classifyInventoryRow(row, medicineNames, kitNames);
      if (!classified.name) continue;
      const normalizedRow = {
        name: classified.name,
        purchase: toNullableNumber(row?.chmcPuchAmnt) ?? 0,
        usage: toNullableNumber(row?.chmcUseAmnt) ?? 0,
        inventory: toNullableNumber(row?.chmcRsqnVal),
      };
      (classified.kind === 'kit' ? kit : medicine).push(normalizedRow);
    }

    normalized.push({
      date,
      documentKey: String(source?.documentKey || ''),
      flows,
      medicine,
      kit,
    });
  }

  normalized.sort((a, b) => a.date.localeCompare(b.date));
  return { documents: normalized, rejected };
}

function inspectRestore(db, payload = {}) {
  const normalized = normalizeDocuments(db, payload.documents);
  const metadata = getCurrentRecordMetadata(db, payload);
  const flowTypes = new Set();
  const medicineNames = new Set();
  const kitNames = new Set();
  let flowRows = 0;
  let medicineRows = 0;
  let kitRows = 0;
  let existingRows = 0;

  for (const document of normalized.documents) {
    for (const row of document.flows) {
      flowTypes.add(row.type);
      flowRows += 1;
      if (db.prepare('SELECT 1 FROM flow_readings WHERE site_id = ? AND date = ? AND type = ?').get(metadata.siteId, document.date, row.type)) existingRows += 1;
    }
    for (const row of document.medicine) {
      medicineNames.add(row.name);
      medicineRows += 1;
      if (db.prepare('SELECT 1 FROM medicine_logs WHERE site_id = ? AND date = ? AND medicine_name = ?').get(metadata.siteId, document.date, row.name)) existingRows += 1;
    }
    for (const row of document.kit) {
      kitNames.add(row.name);
      kitRows += 1;
      if (db.prepare('SELECT 1 FROM kit_logs WHERE site_id = ? AND date = ? AND kit_name = ?').get(metadata.siteId, document.date, row.name)) existingRows += 1;
    }
  }

  return {
    success: normalized.documents.length > 0,
    documentCount: normalized.documents.length,
    rejectedCount: normalized.rejected.length,
    flowRows,
    medicineRows,
    kitRows,
    existingRows,
    mappings: {
      flow: Array.from(flowTypes),
      medicine: Array.from(medicineNames),
      kit: Array.from(kitNames),
    },
    rejected: normalized.rejected,
  };
}

function enumerateDates(startDate, endDate) {
  const result = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (cursor <= end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function round3(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 1000) / 1000 : 0;
}

function nullableRound3(value) {
  return value === null || value === undefined ? null : round3(value);
}

async function backupDatabase(db, appDataPath) {
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const backupDir = path.join(appDataPath, 'backups', 'history-restore');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `osoo-before-history-restore-${timestamp}.db`);
  await db.backup(backupPath);
  return backupPath;
}

async function applyRestore(db, appDataPath, payload = {}) {
  const normalized = normalizeDocuments(db, payload.documents);
  if (!normalized.documents.length) {
    const error = new Error('복원할 상세자료가 없습니다.');
    error.statusCode = 400;
    throw error;
  }

  const startDate = normalized.documents[0].date;
  const endDate = normalized.documents[normalized.documents.length - 1].date;
  const dates = enumerateDates(startDate, endDate);
  const metadata = getCurrentRecordMetadata(db, payload);
  const backupPath = await backupDatabase(db, appDataPath);

  const documentsByDate = new Map(normalized.documents.map((document) => [document.date, document]));
  const flowTypes = [...new Set(normalized.documents.flatMap((document) => document.flows.map((row) => row.type)))];
  const configuredMedicineNames = getConfiguredNames(db, 'medicine');
  const configuredKitNames = getConfiguredNames(db, 'kit');
  const medicineNames = [...new Set([
    ...configuredMedicineNames,
    ...normalized.documents.flatMap((document) => document.medicine.map((row) => row.name)),
  ])];
  const kitNames = [...new Set([
    ...configuredKitNames,
    ...normalized.documents.flatMap((document) => document.kit.map((row) => row.name)),
  ])];

  const flowSource = new Map();
  const medicineSource = new Map();
  const kitSource = new Map();
  for (const document of normalized.documents) {
    for (const row of document.flows) flowSource.set(`${document.date}\u0000${row.type}`, row);
    for (const row of document.medicine) medicineSource.set(`${document.date}\u0000${row.name}`, row);
    for (const row of document.kit) kitSource.set(`${document.date}\u0000${row.name}`, row);
  }

  const insertFlow = db.prepare(`
    INSERT INTO flow_readings (
      date, type, raw_value, calculated_flow, reading_unit, is_reset, is_manual,
      sludge_export, input_status, site_id, site_name, author, created_at, last_modified, is_synced
    ) VALUES (?, ?, ?, ?, ?, 0, 0, NULL, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(site_id, date, type) DO UPDATE SET
      raw_value = excluded.raw_value,
      calculated_flow = excluded.calculated_flow,
      reading_unit = excluded.reading_unit,
      is_reset = 0,
      is_manual = 0,
      input_status = excluded.input_status,
      site_id = excluded.site_id,
      site_name = excluded.site_name,
      author = excluded.author,
      last_modified = excluded.last_modified,
      is_synced = 0
    WHERE excluded.input_status = 'imported'
  `);
  const insertMedicine = db.prepare(`
    INSERT INTO medicine_logs (
      medicine_name, date, purchase_amount, usage_amount, current_inventory,
      input_status, site_id, site_name, author, created_at, last_modified, is_synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(site_id, medicine_name, date) DO UPDATE SET
      purchase_amount = excluded.purchase_amount,
      usage_amount = excluded.usage_amount,
      current_inventory = excluded.current_inventory,
      input_status = excluded.input_status,
      site_id = excluded.site_id,
      site_name = excluded.site_name,
      author = excluded.author,
      last_modified = excluded.last_modified,
      is_synced = 0
    WHERE excluded.input_status = 'imported'
  `);
  const insertKit = db.prepare(`
    INSERT INTO kit_logs (
      kit_name, date, purchase_amount, usage_amount, current_inventory,
      input_status, site_id, site_name, author, created_at, last_modified, is_synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(site_id, kit_name, date) DO UPDATE SET
      purchase_amount = excluded.purchase_amount,
      usage_amount = excluded.usage_amount,
      current_inventory = excluded.current_inventory,
      input_status = excluded.input_status,
      site_id = excluded.site_id,
      site_name = excluded.site_name,
      author = excluded.author,
      last_modified = excluded.last_modified,
      is_synced = 0
    WHERE excluded.input_status = 'imported'
  `);

  const stats = {
    flowInserted: 0,
    medicineInserted: 0,
    kitInserted: 0,
    sourceRowsOverwritten: 0,
    correctedClassificationRows: 0,
    protectedExisting: 0,
    flowRowsWithoutReading: 0,
    complementedDates: dates.filter((date) => !documentsByDate.has(date)).length,
  };

  const countRows = (tableName, nameColumn, names) => {
    if (!names.length) return 0;
    const placeholders = names.map(() => '?').join(', ');
    return Number(db.prepare(`
      SELECT COUNT(*) AS count FROM ${tableName}
      WHERE site_id = ? AND date BETWEEN ? AND ? AND ${nameColumn} IN (${placeholders})
    `).get(metadata.siteId, startDate, endDate, ...names)?.count || 0);
  };

  const verification = db.transaction(() => {
    const existingMedicineNames = db.prepare(`
      SELECT DISTINCT medicine_name
      FROM medicine_logs
      WHERE site_id = ? AND date BETWEEN ? AND ?
    `).all(metadata.siteId, startDate, endDate);
    for (const row of existingMedicineNames) {
      const classified = classifyInventoryRow(
        { chmcText: row.medicine_name },
        configuredMedicineNames,
        configuredKitNames
      );
      if (classified.kind !== 'kit') continue;
      const deleted = db.prepare(`
        DELETE FROM medicine_logs
        WHERE site_id = ? AND date BETWEEN ? AND ? AND medicine_name = ?
      `).run(metadata.siteId, startDate, endDate, row.medicine_name);
      stats.correctedClassificationRows += deleted.changes;
    }

    for (const type of flowTypes) {
      const localPrevious = db.prepare(`
        SELECT raw_value FROM flow_readings
        WHERE site_id = ? AND type = ? AND date < ? AND raw_value IS NOT NULL
        ORDER BY date DESC, id DESC LIMIT 1
      `).get(metadata.siteId, type, startDate);
      let previousRaw = toNullableNumber(localPrevious?.raw_value);

      for (const date of dates) {
        const source = flowSource.get(`${date}\u0000${type}`);
        const existing = db.prepare(
          'SELECT raw_value FROM flow_readings WHERE site_id = ? AND date = ? AND type = ?'
        ).get(metadata.siteId, date, type);
        const existingRaw = toNullableNumber(existing?.raw_value);
        const sourceBase = source?.previousReading ?? previousRaw;
        const rawValue = source?.rawValue
          ?? existingRaw
          ?? (sourceBase != null && source?.usage != null ? round3(sourceBase + source.usage) : null)
          ?? source?.previousReading
          ?? previousRaw
          ?? null;
        const usage = source
          ? (source.usage ?? (
              rawValue !== null && previousRaw !== null
                ? Math.max(0, rawValue - previousRaw)
                : 0
            ))
          : 0;
        const status = source ? 'imported' : 'defaulted';
        const existedBefore = Boolean(existing);
        const result = insertFlow.run(
          date,
          type,
          nullableRound3(rawValue),
          round3(usage),
          String(type).includes('전력') ? 'KWH' : null,
          status,
          metadata.siteId,
          metadata.siteName,
          metadata.author,
          metadata.createdAt,
          metadata.lastModified
        );
        if (source && existedBefore && result.changes) stats.sourceRowsOverwritten += 1;
        else if (result.changes) stats.flowInserted += 1;
        else stats.protectedExisting += 1;
        if (rawValue === null) stats.flowRowsWithoutReading += 1;
        else previousRaw = rawValue;
      }
    }

    const restoreInventory = ({ names, sourceMap, tableName, nameColumn, insert }) => {
      for (const name of names) {
        const localPrevious = db.prepare(`
          SELECT current_inventory FROM ${tableName}
          WHERE site_id = ? AND ${nameColumn} = ? AND date < ? AND current_inventory IS NOT NULL
          ORDER BY date DESC, id DESC LIMIT 1
        `).get(metadata.siteId, name, startDate);
        const firstSource = normalized.documents
          .map((document) => document[tableName === 'medicine_logs' ? 'medicine' : 'kit'].find((row) => row.name === name))
          .find(Boolean);
        let inventory = toNullableNumber(localPrevious?.current_inventory);
        if (inventory === null && firstSource) {
          inventory = firstSource.inventory !== null
            ? firstSource.inventory - firstSource.purchase + firstSource.usage
            : 0;
        }
        inventory ??= 0;

        for (const date of dates) {
          const source = sourceMap.get(`${date}\u0000${name}`);
          const existedBefore = Boolean(db.prepare(
            `SELECT 1 FROM ${tableName} WHERE site_id = ? AND ${nameColumn} = ? AND date = ?`
          ).get(metadata.siteId, name, date));
          const purchase = source?.purchase ?? 0;
          const usage = source?.usage ?? 0;
          inventory = source?.inventory ?? round3(inventory + purchase - usage);
          const status = source ? 'imported' : 'defaulted';
          const result = insert.run(
            name,
            date,
            round3(purchase),
            round3(usage),
            round3(inventory),
            status,
            metadata.siteId,
            metadata.siteName,
            metadata.author,
            metadata.createdAt,
            metadata.lastModified
          );
          if (result.changes) {
            if (source && existedBefore) stats.sourceRowsOverwritten += 1;
            else if (tableName === 'medicine_logs') stats.medicineInserted += 1;
            else stats.kitInserted += 1;
          } else {
            stats.protectedExisting += 1;
          }
        }
      }
    };

    restoreInventory({
      names: medicineNames,
      sourceMap: medicineSource,
      tableName: 'medicine_logs',
      nameColumn: 'medicine_name',
      insert: insertMedicine,
    });
    restoreInventory({
      names: kitNames,
      sourceMap: kitSource,
      tableName: 'kit_logs',
      nameColumn: 'kit_name',
      insert: insertKit,
    });

    const result = {
      flowRows: countRows('flow_readings', 'type', flowTypes),
      medicineRows: countRows('medicine_logs', 'medicine_name', medicineNames),
      kitRows: countRows('kit_logs', 'kit_name', kitNames),
      expectedFlowRows: dates.length * flowTypes.length,
      expectedMedicineRows: dates.length * medicineNames.length,
      expectedKitRows: dates.length * kitNames.length,
    };
    result.complete = result.flowRows >= result.expectedFlowRows
      && result.medicineRows >= result.expectedMedicineRows
      && result.kitRows >= result.expectedKitRows;
    if (!result.complete) {
      const error = new Error('복원 데이터 연속성 검증에 실패했습니다. 변경 내용은 저장되지 않았습니다.');
      error.statusCode = 500;
      error.details = { stats, verification: result, backupPath };
      throw error;
    }
    return result;
  })();

  if (!verification.complete) {
    const error = new Error('복원 후 연속성 검증에 실패했습니다. 백업 파일을 보존했습니다.');
    error.statusCode = 500;
    error.details = { stats, verification, backupPath };
    throw error;
  }

  return {
    success: true,
    startDate,
    endDate,
    sourceDocumentCount: normalized.documents.length,
    totalDateCount: dates.length,
    stats,
    verification,
    backupPath,
  };
}

module.exports = {
  applyRestore,
  inspectRestore,
  normalizeDocuments,
};
