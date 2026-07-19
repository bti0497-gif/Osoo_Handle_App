const express = require('express');
const { getCurrentRecordMetadata } = require('../services/syncMetadataService.cjs');

function normalizeDate(value) {
  return String(value || '').trim().slice(0, 10);
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function resolveSiteFilter(req, db) {
  const siteId = String(req.query.site_id || req.query.siteId || '').trim();
  const siteName = String(req.query.site_name || req.query.siteName || '').trim();
  if (siteId) return { clause: ' AND site_id = ?', params: [siteId] };
  if (siteName) return { clause: ' AND site_name = ?', params: [siteName] };

  const row = db.prepare('SELECT site_id, site_name FROM app_settings WHERE id = 1').get() || {};
  if (row.site_id) return { clause: ' AND site_id = ?', params: [row.site_id] };
  if (row.site_name) return { clause: ' AND site_name = ?', params: [row.site_name] };
  return { clause: '', params: [] };
}

module.exports = function operationStatusRoutes(db) {
  const router = express.Router();

  router.get('/api/operation-status', (req, res) => {
    try {
      const date = normalizeDate(req.query.date);
      if (!date) return res.status(400).json({ success: false, error: 'date가 필요합니다.' });

      const filter = resolveSiteFilter(req, db);
      const row = db.prepare(`
        SELECT *
        FROM operation_status_logs
        WHERE date = ?${filter.clause}
        ORDER BY last_modified DESC, id DESC
        LIMIT 1
      `).get(date, ...filter.params);

      return res.json({ success: true, record: row || null });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/api/operation-status/history', (req, res) => {
    try {
      const filter = resolveSiteFilter(req, db);
      const rows = db.prepare(`
        SELECT *
        FROM operation_status_logs
        WHERE 1 = 1${filter.clause}
        ORDER BY date ASC, id ASC
      `).all(...filter.params);

      return res.json({ success: true, history: rows });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/api/operation-status', (req, res) => {
    try {
      const date = normalizeDate(req.body?.date);
      if (!date) return res.status(400).json({ success: false, error: 'date가 필요합니다.' });

      const metadata = getCurrentRecordMetadata(db, req.body || {});
      const siteId = String(metadata.siteId || '').trim();
      if (!siteId) return res.status(400).json({ success: false, error: 'site_id가 필요합니다.' });

      const stmt = db.prepare(`
        INSERT INTO operation_status_logs (
          date, site_id, site_name, ph, do_value, svi, author, created_at, last_modified, is_synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(date, site_id) DO UPDATE SET
          site_name = excluded.site_name,
          ph = excluded.ph,
          do_value = excluded.do_value,
          svi = excluded.svi,
          author = excluded.author,
          last_modified = excluded.last_modified,
          is_synced = 0
      `);

      stmt.run(
        date,
        siteId,
        metadata.siteName || '',
        toNullableNumber(req.body?.ph),
        toNullableNumber(req.body?.do_value),
        toNullableNumber(req.body?.svi),
        metadata.author || '',
        metadata.createdAt,
        metadata.lastModified
      );

      const record = db.prepare('SELECT * FROM operation_status_logs WHERE date = ? AND site_id = ?').get(date, siteId);
      return res.json({ success: true, record });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
