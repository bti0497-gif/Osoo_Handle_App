const express = require('express');
const { getCurrentRecordMetadata } = require('../services/syncMetadataService.cjs');
const router = express.Router();

module.exports = function(db) {
  router.get('/api/facilities', (req, res) => {
    const { date } = req.query;
    const logs = db.prepare('SELECT * FROM facility_logs WHERE date = ?').all(date);
    res.json(logs);
  });

  router.post('/api/facilities', (req, res) => {
    const { date, facility_name, content, company, price, notes } = req.body;
    try {
      const metadata = getCurrentRecordMetadata(db);
      const info = db.prepare(`
        INSERT INTO facility_logs (
          date, facility_name, content, company, price, notes,
          site_name, author, created_at, last_modified, is_synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        date,
        facility_name,
        content,
        company,
        price,
        notes,
        metadata.siteName,
        metadata.author,
        metadata.createdAt,
        metadata.lastModified,
        metadata.isSynced
      );
      res.json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
