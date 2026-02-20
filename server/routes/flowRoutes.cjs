const express = require('express');
const router = express.Router();

module.exports = function(db) {
  router.get('/api/flows', (req, res) => {
    const { date } = req.query;
    const flows = db.prepare('SELECT * FROM flow_readings WHERE date = ?').all(date);
    res.json(flows);
  });

  router.post('/api/flows', (req, res) => {
    const { date, type, raw_value, is_reset, is_manual, manual_flow, sludge_export } = req.body;
    try {
      const prevReading = db.prepare('SELECT raw_value FROM flow_readings WHERE type = ? AND date < ? ORDER BY date DESC LIMIT 1').get(type, date);
      if (!is_reset && prevReading && raw_value < prevReading.raw_value) {
        return res.status(400).json({ success: false, message: '검침값이 어제보다 작을 수 없습니다. 초기화가 필요한 경우 체크해주세요.' });
      }
      let calculated_flow = 0;
      if (is_manual) { calculated_flow = manual_flow; }
      else if (!is_reset && prevReading) { calculated_flow = raw_value - prevReading.raw_value; }

      const info = db.prepare(`INSERT OR REPLACE INTO flow_readings (date, type, raw_value, calculated_flow, is_reset, is_manual, sludge_export) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(date, type, raw_value, calculated_flow, is_reset ? 1 : 0, is_manual ? 1 : 0, sludge_export);
      res.json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
