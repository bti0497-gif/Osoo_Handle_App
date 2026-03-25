const express = require('express');
const router = express.Router();

module.exports = function (db) {
  // --- Get Available DB Columns for Mapping ---
  router.get('/api/log-mappings/db-columns', (req, res) => {
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      const result = {};

      tables.forEach(table => {
        const columns = db.prepare(`PRAGMA table_info(${table.name})`).all();
        result[table.name] = columns.map(c => c.name);
      });

      res.json({ success: true, tables: result });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // --- Get Mappings for a specific Log Type ---
  router.get('/api/log-mappings/:logType', (req, res) => {
    const { logType } = req.params;
    try {
      const mappings = db.prepare('SELECT * FROM log_mappings WHERE log_type = ?').all(logType);
      res.json({ success: true, mappings });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // --- Save Mappings ---
  router.post('/api/log-mappings', (req, res) => {
    const { logType, mappings } = req.body;
    if (!logType || !Array.isArray(mappings)) {
      return res.status(400).json({ success: false, message: 'Invalid data' });
    }

    try {
      const deleteStmt = db.prepare('DELETE FROM log_mappings WHERE log_type = ?');
      const insertStmt = db.prepare('INSERT INTO log_mappings (log_type, field_name, mapping_type, mapping_value) VALUES (?, ?, ?, ?)');

      db.transaction(() => {
        deleteStmt.run(logType);
        mappings.forEach(m => {
          insertStmt.run(logType, m.fieldName, m.mappingType || 'column', m.mappingValue);
        });
      })();

      res.json({ success: true, message: 'Mappings saved successfully' });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  return router;
};
