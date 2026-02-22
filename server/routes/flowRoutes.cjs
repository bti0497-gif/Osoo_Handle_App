const express = require('express');
const router = express.Router();

module.exports = function (db) {
  router.get('/api/flows', (req, res) => {
    const { date } = req.query;
    const flows = db.prepare('SELECT * FROM flow_readings WHERE date = ?').all(date);
    res.json(flows);
  });

  router.get('/api/flows/history', (req, res) => {
    try {
      const dates = db.prepare('SELECT DISTINCT date FROM flow_readings ORDER BY date ASC').all();
      const allReadings = db.prepare('SELECT * FROM flow_readings ORDER BY date ASC, type ASC').all();

      const history = dates.map(d => {
        const row = { date: d.date };
        const dayReadings = allReadings.filter(r => r.date === d.date);
        dayReadings.forEach(r => {
          row[r.type] = {
            raw: r.raw_value,
            diff: r.calculated_flow
          };
        });
        return row;
      });

      res.json({ success: true, history });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/api/flows/bulk', (req, res) => {
    const { date, items } = req.body; // items: [{type, raw_value, calculated_flow, is_manual, is_reset}]
    try {
      const results = [];
      const stmt = db.prepare(`INSERT OR REPLACE INTO flow_readings (date, type, raw_value, calculated_flow, is_reset, is_manual, sludge_export) VALUES (?, ?, ?, ?, ?, ?, ?)`);

      const insertMany = db.transaction((rows) => {
        for (const item of rows) {
          const { type, raw_value, calculated_flow, is_reset, is_manual } = item;
          // 프론트엔드에서 이미 계산된 flow와 raw를 넘겨주므로 그대로 저장 (수동이든 자동이든)
          stmt.run(date, type, raw_value, calculated_flow, is_reset ? 1 : 0, is_manual ? 1 : 0, null);
          results.push({ type, calculated_flow });
        }
      });

      insertMany(items);

      res.json({ success: true, results });
    } catch (err) {
      console.error("Bulk save error:", err, "Payload:", JSON.stringify(req.body, null, 2));
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/api/flows', (req, res) => {
    const { date, type, raw_value, is_reset, is_manual, manual_flow, sludge_export } = req.body;
    try {
      const prevReading = db.prepare('SELECT raw_value, calculated_flow FROM flow_readings WHERE type = ? AND date < ? ORDER BY date DESC LIMIT 1').get(type, date);

      // 보정 로직 동일 적용
      const effectivePrevRaw = (prevReading?.raw_value === null && prevReading?.calculated_flow > 10000)
        ? prevReading.calculated_flow
        : prevReading?.raw_value;

      if (!is_manual && !is_reset && effectivePrevRaw !== undefined && raw_value < effectivePrevRaw) {
        return res.status(400).json({ success: false, message: '검침값이 어제보다 작을 수 없습니다. 초기화가 필요한 경우 체크해주세요.' });
      }

      let calculated_flow = 0;
      if (is_manual) { calculated_flow = manual_flow; }
      else if (!is_reset && effectivePrevRaw !== undefined) { calculated_flow = raw_value - effectivePrevRaw; }

      const info = db.prepare(`INSERT OR REPLACE INTO flow_readings (date, type, raw_value, calculated_flow, is_reset, is_manual, sludge_export) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(date, type, raw_value, calculated_flow, is_reset ? 1 : 0, is_manual ? 1 : 0, sludge_export);
      res.json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
