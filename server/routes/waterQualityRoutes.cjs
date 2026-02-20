const express = require('express');
const router = express.Router();

module.exports = function(db) {
  router.get('/api/water-quality', (req, res) => {
    const { date } = req.query;
    const logs = db.prepare('SELECT * FROM water_quality WHERE date = ?').all(date);
    res.json(logs);
  });

  router.post('/api/water-quality', (req, res) => {
    const { date, location, nh3_n, no3_n, po4_p, alkalinity } = req.body;
    try {
      const info = db.prepare(`INSERT OR REPLACE INTO water_quality (date, location, nh3_n, no3_n, po4_p, alkalinity) VALUES (?, ?, ?, ?, ?, ?)`).run(date, location || 'default', nh3_n, no3_n, po4_p, alkalinity);
      res.json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
