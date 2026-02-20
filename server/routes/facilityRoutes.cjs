const express = require('express');
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
      const info = db.prepare(`INSERT INTO facility_logs (date, facility_name, content, company, price, notes) VALUES (?, ?, ?, ?, ?, ?)`).run(date, facility_name, content, company, price, notes);
      res.json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
