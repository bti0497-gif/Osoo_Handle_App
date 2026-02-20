const express = require('express');
const router = express.Router();

module.exports = function(db) {
  router.get('/api/medicines', (req, res) => {
    const { date } = req.query;
    const logs = db.prepare('SELECT * FROM medicine_logs WHERE date = ?').all(date);
    res.json(logs);
  });

  router.post('/api/medicines', (req, res) => {
    const { medicine_name, date, purchase_amount, usage_amount } = req.body;
    try {
      const prevLog = db.prepare('SELECT current_inventory FROM medicine_logs WHERE medicine_name = ? AND date < ? ORDER BY date DESC LIMIT 1').get(medicine_name, date);
      const startInventory = prevLog ? prevLog.current_inventory : 0;
      const current_inventory = startInventory + (purchase_amount || 0) - (usage_amount || 0);

      const info = db.prepare(`INSERT OR REPLACE INTO medicine_logs (medicine_name, date, purchase_amount, usage_amount, current_inventory) VALUES (?, ?, ?, ?, ?)`).run(medicine_name, date, purchase_amount || 0, usage_amount || 0, current_inventory);
      res.json({ success: true, id: info.lastInsertRowid, current_inventory });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
