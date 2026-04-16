const express = require('express');
const { importQntechWaterValues, importQntechWaterPhotos, importQntechWaterAll, importQntechWaterRange } = require('../services/qntechWaterImportService.cjs');
const { getCurrentRecordMetadata } = require('../services/syncMetadataService.cjs');
const router = express.Router();

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
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.floor(numeric);
  }
  return 1;
}

function normalizeSourceType(item = {}) {
  const sourceType = String(item.source_type || '').trim();
  if (sourceType) return sourceType;
  return item.qntech_project_id ? 'qntech' : 'manual';
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
    const logs = site_id
      ? db.prepare('SELECT * FROM water_quality WHERE date = ? AND site_id = ? ORDER BY measurement_order ASC, created_at ASC, id ASC, location ASC').all(date, String(site_id))
      : db.prepare('SELECT * FROM water_quality WHERE date = ? ORDER BY measurement_order ASC, created_at ASC, id ASC, location ASC').all(date);
    res.json(logs);
  });

  router.get('/api/water-quality/history', (req, res) => {
    try {
      const { site_id } = req.query;
      const allRecords = site_id
        ? db.prepare('SELECT * FROM water_quality WHERE site_id = ? ORDER BY date ASC, measurement_order ASC, created_at ASC, id ASC, location ASC').all(String(site_id))
        : db.prepare('SELECT * FROM water_quality ORDER BY date ASC, measurement_order ASC, created_at ASC, id ASC, location ASC').all();
      res.json({ success: true, history: allRecords });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message, error: err.message });
    }
  });

  router.get('/api/water-quality/import-range-progress', (req, res) => {
    res.json({ success: true, progress: rangeImportProgress });
  });

  router.post('/api/water-quality/bulk', (req, res) => {
    const { items } = req.body;
    try {
      const metadata = getCurrentRecordMetadata(db, req.body);
      const stmt = db.prepare(`
        INSERT INTO water_quality (
          date, measurement_group, measurement_order, source_type, source_label, qntech_project_id,
          location, nh3_n, no3_n, po4_p, alkalinity, tn, tp, cod, ss,
          site_id, site_name, author, created_at, last_modified, is_synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date, measurement_group, location) DO UPDATE SET
          measurement_order = excluded.measurement_order,
          source_type = excluded.source_type,
          source_label = excluded.source_label,
          qntech_project_id = excluded.qntech_project_id,
          nh3_n = COALESCE(excluded.nh3_n, nh3_n),
          no3_n = COALESCE(excluded.no3_n, no3_n),
          po4_p = COALESCE(excluded.po4_p, po4_p),
          alkalinity = COALESCE(excluded.alkalinity, alkalinity),
          tn = COALESCE(excluded.tn, tn),
          tp = COALESCE(excluded.tp, tp),
          cod = COALESCE(excluded.cod, cod),
          ss = COALESCE(excluded.ss, ss),
          site_id = excluded.site_id,
          site_name = excluded.site_name,
          author = excluded.author,
          last_modified = excluded.last_modified,
          is_synced = excluded.is_synced
      `);

      const insertMany = db.transaction((rows) => {
        for (const item of rows) {
          const measurementGroup = normalizeMeasurementGroup(item);
          stmt.run(
            item.date,
            measurementGroup,
            normalizeMeasurementOrder(item),
            normalizeSourceType(item),
            item.source_label ?? null,
            item.qntech_project_id ?? null,
            item.location || '유입수',
            item.nh3_n ?? null,
            item.no3_n ?? null,
            item.po4_p ?? null,
            item.alkalinity ?? null,
            item.tn ?? null,
            item.tp ?? null,
            item.cod ?? null,
            item.ss ?? null,
            metadata.siteId,
            metadata.siteName,
            metadata.author,
            metadata.createdAt,
            metadata.lastModified,
            metadata.isSynced
          );
        }
      });

      insertMany(items);
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
          rangeImportProgress = {
            ...rangeImportProgress,
            ...progress
          };
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
    const { date, location, nh3_n, no3_n, po4_p, alkalinity, tn, tp, cod, ss } = req.body;
    try {
      const metadata = getCurrentRecordMetadata(db, req.body);
      const measurementGroup = normalizeMeasurementGroup(req.body);
      const info = db.prepare(`
        INSERT INTO water_quality (
          date, measurement_group, measurement_order, source_type, source_label, qntech_project_id,
          location, nh3_n, no3_n, po4_p, alkalinity, tn, tp, cod, ss,
          site_id, site_name, author, created_at, last_modified, is_synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date, measurement_group, location) DO UPDATE SET
          measurement_order = excluded.measurement_order,
          source_type = excluded.source_type,
          source_label = excluded.source_label,
          qntech_project_id = excluded.qntech_project_id,
          nh3_n = COALESCE(excluded.nh3_n, nh3_n),
          no3_n = COALESCE(excluded.no3_n, no3_n),
          po4_p = COALESCE(excluded.po4_p, po4_p),
          alkalinity = COALESCE(excluded.alkalinity, alkalinity),
          tn = COALESCE(excluded.tn, tn),
          tp = COALESCE(excluded.tp, tp),
          cod = COALESCE(excluded.cod, cod),
          ss = COALESCE(excluded.ss, ss),
          site_id = excluded.site_id,
          site_name = excluded.site_name,
          author = excluded.author,
          last_modified = excluded.last_modified,
          is_synced = excluded.is_synced
      `).run(
        date,
        measurementGroup,
        normalizeMeasurementOrder(req.body),
        normalizeSourceType(req.body),
        req.body.source_label ?? null,
        req.body.qntech_project_id ?? null,
        location || '유입수',
        nh3_n ?? null,
        no3_n ?? null,
        po4_p ?? null,
        alkalinity ?? null,
        tn ?? null,
        tp ?? null,
        cod ?? null,
        ss ?? null,
        metadata.siteId,
        metadata.siteName,
        metadata.author,
        metadata.createdAt,
        metadata.lastModified,
        metadata.isSynced
      );
      res.json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message, error: err.message });
    }
  });

  return router;
};
