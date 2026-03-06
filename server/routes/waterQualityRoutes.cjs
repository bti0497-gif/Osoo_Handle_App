const express = require('express');
const { importQntechWaterValues, importQntechWaterPhotos, importQntechWaterAll, importQntechWaterRange } = require('../services/qntechWaterImportService.cjs');
const router = express.Router();

module.exports = function (db, baseDir) {
  let rangeImportProgress = {
    status: 'idle',
    totalDates: 0,
    completedDates: 0,
    currentDate: null,
    message: ''
  };

  router.get('/api/water-quality', (req, res) => {
    const { date } = req.query;
    const logs = db.prepare('SELECT * FROM water_quality WHERE date = ?').all(date);
    res.json(logs);
  });

  router.get('/api/water-quality/history', (req, res) => {
    try {
      const allRecords = db.prepare('SELECT * FROM water_quality ORDER BY date ASC').all();
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
      const stmt = db.prepare(`
        INSERT INTO water_quality (date, location, nh3_n, no3_n, po4_p, alkalinity, tn, tp, cod, ss) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date, location) DO UPDATE SET
          nh3_n = COALESCE(excluded.nh3_n, nh3_n),
          no3_n = COALESCE(excluded.no3_n, no3_n),
          po4_p = COALESCE(excluded.po4_p, po4_p),
          alkalinity = COALESCE(excluded.alkalinity, alkalinity),
          tn = COALESCE(excluded.tn, tn),
          tp = COALESCE(excluded.tp, tp),
          cod = COALESCE(excluded.cod, cod),
          ss = COALESCE(excluded.ss, ss)
      `);

      const insertMany = db.transaction((rows) => {
        for (const item of rows) {
          stmt.run(
            item.date,
            item.location || '유입수',
            item.nh3_n ?? null,
            item.no3_n ?? null,
            item.po4_p ?? null,
            item.alkalinity ?? null,
            item.tn ?? null,
            item.tp ?? null,
            item.cod ?? null,
            item.ss ?? null
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
      const info = db.prepare(`
        INSERT INTO water_quality (date, location, nh3_n, no3_n, po4_p, alkalinity, tn, tp, cod, ss) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date, location) DO UPDATE SET
          nh3_n = COALESCE(excluded.nh3_n, nh3_n),
          no3_n = COALESCE(excluded.no3_n, no3_n),
          po4_p = COALESCE(excluded.po4_p, po4_p),
          alkalinity = COALESCE(excluded.alkalinity, alkalinity),
          tn = COALESCE(excluded.tn, tn),
          tp = COALESCE(excluded.tp, tp),
          cod = COALESCE(excluded.cod, cod),
          ss = COALESCE(excluded.ss, ss)
      `).run(
        date,
        location || '유입수',
        nh3_n ?? null,
        no3_n ?? null,
        po4_p ?? null,
        alkalinity ?? null,
        tn ?? null,
        tp ?? null,
        cod ?? null,
        ss ?? null
      );
      res.json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message, error: err.message });
    }
  });

  return router;
};
