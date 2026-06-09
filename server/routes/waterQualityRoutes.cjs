const express = require('express');
const { importQntechWaterValues, importQntechWaterPhotos, importQntechWaterAll, importQntechWaterRange } = require('../services/qntechWaterImportService.cjs');
const { getCurrentRecordMetadata } = require('../services/syncMetadataService.cjs');

const router = express.Router();

const WATER_ITEM_DEFINITIONS = [
  { itemCode: 'nh3_n', itemName: '암모니아성질소(NH3-N)', unit: 'mg/L' },
  { itemCode: 'no3_n', itemName: '질산성질소(NO3-N)', unit: 'mg/L' },
  { itemCode: 'po4_p', itemName: '인산염인(PO4-P)', unit: 'mg/L' },
  { itemCode: 'alkalinity', itemName: '알칼리도(ALK)', unit: 'mg/L' },
  { itemCode: 'tn', itemName: 'TN', unit: 'mg/L' },
  { itemCode: 'tp', itemName: 'TP', unit: 'mg/L' },
  { itemCode: 'cod', itemName: 'COD', unit: 'mg/L' },
  { itemCode: 'ss', itemName: 'SS', unit: 'mg/L' },
];

function normalizeMeasurementGroup(item = {}) {
  const date = String(item.date || '').trim().slice(0, 10);
  const rawGroup = String(item.measurement_group || '').trim();
  if (rawGroup) return rawGroup;

  const projectId = String(item.qntech_project_id || '').trim();
  if (projectId) return `qntech:${projectId}`;

  return `manual:${date}`;
}

function normalizeMeasurementOrder(item = {}) {
  const numeric = Number(item.measurement_order);
  if (Number.isFinite(numeric) && numeric > 0) return Math.floor(numeric);
  return 1;
}

function normalizeSourceType(item = {}) {
  const sourceType = String(item.source_type || '').trim();
  if (sourceType) return sourceType;
  return item.qntech_project_id ? 'qntech' : 'manual';
}

function toNumeric(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function pivotWaterRows(rows = []) {
  const grouped = new Map();
  for (const row of rows) {
    const key = [row.date, row.measurement_group || '', row.location || ''].join('|');
    const target = grouped.get(key) || {
      id: row.id,
      date: row.date,
      measurement_group: row.measurement_group,
      measurement_order: row.measurement_order,
      source_type: row.source_type,
      source_label: row.source_label,
      qntech_project_id: row.qntech_project_id,
      location: row.location,
      site_id: row.site_id,
      site_name: row.site_name,
      author: row.author,
      created_at: row.created_at,
      last_modified: row.last_modified,
      is_synced: row.is_synced,
    };
    if (row.item_code) target[row.item_code] = row.result_value;
    grouped.set(key, target);
  }
  return Array.from(grouped.values());
}

function buildWaterItemRows(item, metadata) {
  const base = {
    date: item.date,
    measurement_group: normalizeMeasurementGroup(item),
    measurement_order: normalizeMeasurementOrder(item),
    source_type: normalizeSourceType(item),
    source_label: item.source_label ?? null,
    qntech_project_id: item.qntech_project_id ?? null,
    location: item.location || '유입수',
    site_id: metadata.siteId,
    site_name: metadata.siteName,
    author: metadata.author,
    created_at: metadata.createdAt,
    last_modified: metadata.lastModified,
    is_synced: metadata.isSynced,
  };

  return WATER_ITEM_DEFINITIONS
    .filter((definition) => item[definition.itemCode] !== undefined && item[definition.itemCode] !== null && item[definition.itemCode] !== '')
    .map((definition) => ({
      ...base,
      item_name: definition.itemName,
      item_code: definition.itemCode,
      result_value: String(item[definition.itemCode]),
      result_numeric: toNumeric(item[definition.itemCode]),
      unit: definition.unit,
    }));
}

function createUpsertStatement(db) {
  return db.prepare(`
    INSERT INTO qntech_water_quality (
      date, measurement_group, measurement_order, source_type, source_label, qntech_project_id,
      location, item_name, item_code, result_value, result_numeric, unit,
      site_id, site_name, author, created_at, last_modified, is_synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, measurement_group, location, item_code) DO UPDATE SET
      measurement_order = excluded.measurement_order,
      source_type = excluded.source_type,
      source_label = excluded.source_label,
      qntech_project_id = excluded.qntech_project_id,
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
}

function runUpsert(stmt, row) {
  return stmt.run(
    row.date,
    row.measurement_group,
    row.measurement_order,
    row.source_type,
    row.source_label,
    row.qntech_project_id,
    row.location,
    row.item_name,
    row.item_code,
    row.result_value,
    row.result_numeric,
    row.unit,
    row.site_id,
    row.site_name,
    row.author,
    row.created_at,
    row.last_modified,
    row.is_synced
  );
}

module.exports = function (db, baseDir) {
  let rangeImportProgress = {
    status: 'idle',
    totalDates: 0,
    completedDates: 0,
    currentDate: null,
    message: ''
  };

  router.get('/api/water-quality', (req, res) => {
    const { date, site_id } = req.query;
    const rows = site_id
      ? db.prepare('SELECT * FROM qntech_water_quality WHERE date = ? AND site_id = ? ORDER BY measurement_order ASC, created_at ASC, id ASC, location ASC, item_code ASC').all(date, String(site_id))
      : db.prepare('SELECT * FROM qntech_water_quality WHERE date = ? ORDER BY measurement_order ASC, created_at ASC, id ASC, location ASC, item_code ASC').all(date);
    res.json(pivotWaterRows(rows));
  });

  router.get('/api/water-quality/history', (req, res) => {
    try {
      const { site_id } = req.query;
      const rows = site_id
        ? db.prepare('SELECT * FROM qntech_water_quality WHERE site_id = ? ORDER BY date ASC, measurement_order ASC, created_at ASC, id ASC, location ASC, item_code ASC').all(String(site_id))
        : db.prepare('SELECT * FROM qntech_water_quality ORDER BY date ASC, measurement_order ASC, created_at ASC, id ASC, location ASC, item_code ASC').all();
      res.json({ success: true, history: pivotWaterRows(rows) });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message, error: err.message });
    }
  });

  router.get('/api/water-quality/import-range-progress', (req, res) => {
    res.json({ success: true, progress: rangeImportProgress });
  });

  router.post('/api/water-quality/bulk', (req, res) => {
    const { items = [] } = req.body || {};
    try {
      const metadata = getCurrentRecordMetadata(db, req.body);
      const stmt = createUpsertStatement(db);
      const insertMany = db.transaction((rows) => {
        for (const item of rows) {
          for (const row of buildWaterItemRows(item, metadata)) {
            runUpsert(stmt, row);
          }
        }
      });
      insertMany(Array.isArray(items) ? items : []);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message, error: err.message });
    }
  });

  router.post('/api/water-quality/import-values-from-qntech', async (req, res) => {
    const { date } = req.body || {};
    try {
      const result = await importQntechWaterValues(db, date);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message, error: err.message });
    }
  });

  router.post('/api/water-quality/import-photos-from-qntech', async (req, res) => {
    const { date } = req.body || {};
    try {
      const result = await importQntechWaterPhotos(db, baseDir, date);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message, error: err.message });
    }
  });

  router.post('/api/water-quality/import-from-qntech', async (req, res) => {
    const { date } = req.body || {};
    try {
      const result = await importQntechWaterAll(db, baseDir, date);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, message: err.message, error: err.message });
    }
  });

  router.post('/api/water-quality/import-range-from-qntech', async (req, res) => {
    const { startDate, endDate } = req.body || {};
    try {
      rangeImportProgress = {
        status: 'processing',
        totalDates: 0,
        completedDates: 0,
        currentDate: null,
        message: '기간 데이터를 준비하는 중...'
      };

      const result = await importQntechWaterRange(db, baseDir, startDate, endDate, {
        onProgress: (progress) => {
          rangeImportProgress = { ...rangeImportProgress, ...progress };
        }
      });

      rangeImportProgress = {
        ...rangeImportProgress,
        status: 'completed',
        totalDates: result.processedDates || rangeImportProgress.totalDates,
        completedDates: result.processedDates || rangeImportProgress.completedDates,
        currentDate: result.endDate || rangeImportProgress.currentDate,
        message: '기간 데이터 불러오기가 완료되었습니다.'
      };
      res.json(result);
    } catch (err) {
      rangeImportProgress = {
        ...rangeImportProgress,
        status: 'error',
        message: err.message
      };
      res.status(500).json({ success: false, message: err.message, error: err.message });
    }
  });

  router.post('/api/water-quality', (req, res) => {
    try {
      const metadata = getCurrentRecordMetadata(db, req.body);
      const stmt = createUpsertStatement(db);
      let lastId = null;
      for (const row of buildWaterItemRows(req.body || {}, metadata)) {
        const info = runUpsert(stmt, row);
        lastId = info.lastInsertRowid;
      }
      res.json({ success: true, id: lastId });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message, error: err.message });
    }
  });

  return router;
};
