const express = require('express');
const { getCurrentRecordMetadata } = require('../services/syncMetadataService.cjs');
const router = express.Router();

module.exports = function(db) {
  // 전체 목록 조회 (검색, 최신순)
  router.get('/api/facilities', (req, res) => {
    const { q } = req.query;
    let sql = 'SELECT * FROM facility_logs';
    let params = [];
    if (q && q.trim()) {
      sql += ' WHERE (location LIKE ? OR facility_name LIKE ? OR content LIKE ? OR notes LIKE ?)';
      const like = `%${q.trim()}%`;
      params = [like, like, like, like];
    }
    sql += ' ORDER BY date DESC, id DESC';
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  });

  // 등록
  router.post('/api/facilities', (req, res) => {
    const { date, location, facility_name, content, notes } = req.body;
    try {
      const metadata = getCurrentRecordMetadata(db);
      const info = db.prepare(`
        INSERT INTO facility_logs (
          date, location, facility_name, content, notes,
          site_id, site_name, author, created_at, last_modified, is_synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        date, location || '', facility_name || '', content || '', notes || '',
        metadata.siteId, metadata.siteName, metadata.author,
        metadata.createdAt, metadata.lastModified, metadata.isSynced
      );
      res.json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 수정
  router.put('/api/facilities/:id', (req, res) => {
    const { id } = req.params;
    const { date, location, facility_name, content, notes } = req.body;
    try {
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE facility_logs
        SET date = ?, location = ?, facility_name = ?, content = ?, notes = ?,
            last_modified = ?, is_synced = 0
        WHERE id = ?
      `).run(date, location || '', facility_name || '', content || '', notes || '', now, id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 삭제
  router.delete('/api/facilities/:id', (req, res) => {
    const { id } = req.params;
    try {
      db.prepare('DELETE FROM facility_logs WHERE id = ?').run(id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
