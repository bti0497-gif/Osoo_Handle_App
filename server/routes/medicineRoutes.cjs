const express = require('express');
const { getCurrentRecordMetadata } = require('../services/syncMetadataService.cjs');
const router = express.Router();

module.exports = function (db) {
  router.get('/api/medicines', (req, res) => {
    const { date } = req.query;
    const logs = db.prepare('SELECT * FROM medicine_logs WHERE date = ?').all(date);
    res.json(logs);
  });

  router.get('/api/medicines/history', (req, res) => {
    try {
      const allRecords = db.prepare('SELECT * FROM medicine_logs ORDER BY date ASC').all();
      res.json({ success: true, history: allRecords });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/api/medicines/bulk', (req, res) => {
    const { items } = req.body;
    try {
      const stmt = db.prepare(`
        INSERT INTO medicine_logs (
          medicine_name, date, purchase_amount, usage_amount, current_inventory,
          site_id, site_name, author, created_at, last_modified, is_synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(medicine_name, date) DO UPDATE SET
          purchase_amount = excluded.purchase_amount,
          usage_amount = excluded.usage_amount,
          current_inventory = excluded.current_inventory,
          site_id = excluded.site_id,
          site_name = excluded.site_name,
          author = excluded.author,
          last_modified = excluded.last_modified,
          is_synced = excluded.is_synced
      `);

      const insertMany = db.transaction((rows) => {
        const metadata = getCurrentRecordMetadata(db);
        for (const item of rows) {
          stmt.run(
            item.medicine_name,
            item.date,
            item.purchase_amount || 0,
            item.usage_amount || 0,
            item.current_inventory || 0,
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
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/api/medicines', (req, res) => {
    const { medicine_name, date, purchase_amount, usage_amount } = req.body;
    try {
      const metadata = getCurrentRecordMetadata(db);
      const prevLog = db.prepare('SELECT current_inventory FROM medicine_logs WHERE medicine_name = ? AND date < ? ORDER BY date DESC LIMIT 1').get(medicine_name, date);
      const startInventory = prevLog ? prevLog.current_inventory : 0;
      const current_inventory = startInventory + (purchase_amount || 0) - (usage_amount || 0);

      const info = db.prepare(`
        INSERT INTO medicine_logs (
          medicine_name, date, purchase_amount, usage_amount, current_inventory,
          site_id, site_name, author, created_at, last_modified, is_synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(medicine_name, date) DO UPDATE SET
          purchase_amount = excluded.purchase_amount,
          usage_amount = excluded.usage_amount,
          current_inventory = excluded.current_inventory,
          site_id = excluded.site_id,
          site_name = excluded.site_name,
          author = excluded.author,
          last_modified = excluded.last_modified,
          is_synced = excluded.is_synced
      `).run(
        medicine_name,
        date,
        purchase_amount || 0,
        usage_amount || 0,
        current_inventory,
        metadata.siteId,
        metadata.siteName,
        metadata.author,
        metadata.createdAt,
        metadata.lastModified,
        metadata.isSynced
      );
      res.json({ success: true, id: info.lastInsertRowid, current_inventory });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
