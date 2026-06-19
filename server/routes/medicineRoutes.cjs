const express = require('express');
const { getCurrentRecordMetadata } = require('../services/syncMetadataService.cjs');
const { recalculateInventoryCascade } = require('../services/inventoryCascadeService.cjs');
const router = express.Router();

function recalculateMedicineInventory(db, medicineName, metadata, startDate, explicitDates = new Set()) {
  recalculateInventoryCascade(db, {
    tableName: 'medicine_logs',
    nameColumn: 'medicine_name',
    itemName: medicineName,
    metadata,
    startDate,
    explicitDates,
  });
}

module.exports = function (db) {
  router.get('/api/medicines', (req, res) => {
    const { date, site_id } = req.query;
    const logs = site_id
      ? db.prepare('SELECT * FROM medicine_logs WHERE date = ? AND site_id = ?').all(date, String(site_id))
      : db.prepare('SELECT * FROM medicine_logs WHERE date = ?').all(date);
    res.json(logs);
  });

  router.get('/api/medicines/history', (req, res) => {
    try {
      const { site_id } = req.query;
      const allRecords = site_id
        ? db.prepare('SELECT * FROM medicine_logs WHERE site_id = ? ORDER BY date ASC').all(String(site_id))
        : db.prepare('SELECT * FROM medicine_logs ORDER BY date ASC').all();
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

      const metadata = getCurrentRecordMetadata(db, req.body);
      const insertMany = db.transaction((rows) => {
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

      const touchedByName = new Map();
      items.forEach((item) => {
        if (!item.medicine_name || !item.date) return;
        if (!touchedByName.has(item.medicine_name)) {
          touchedByName.set(item.medicine_name, { dates: new Set(), explicitDates: new Set() });
        }
        const touched = touchedByName.get(item.medicine_name);
        touched.dates.add(item.date);
        if (item.current_inventory !== null && item.current_inventory !== undefined) {
          touched.explicitDates.add(item.date);
        }
      });
      db.transaction(() => {
        for (const [medicineName, touched] of touchedByName.entries()) {
          recalculateMedicineInventory(
            db,
            medicineName,
            metadata,
            [...touched.dates].sort()[0],
            touched.explicitDates
          );
        }
      })();

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /** 특정 날짜에 약품별 입고량 일괄 반영 후 재고 연쇄 재계산 (키트 /api/kits/purchase 와 동일 패턴) */
  router.post('/api/medicines/purchase', (req, res) => {
    try {
      const { date, items } = req.body;
      if (!date || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: '날짜와 항목이 필요합니다.' });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
        return res.status(400).json({ success: false, error: '날짜와 항목이 필요합니다.' });
      }

      const metadata = getCurrentRecordMetadata(db, req.body);
      const upsertStmt = db.prepare(`
        INSERT INTO medicine_logs (
          medicine_name, date, purchase_amount, usage_amount, current_inventory,
          site_id, site_name, author, created_at, last_modified, is_synced
        ) VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(medicine_name, date) DO UPDATE SET
          purchase_amount = excluded.purchase_amount,
          site_id = excluded.site_id,
          site_name = excluded.site_name,
          author = excluded.author,
          last_modified = excluded.last_modified,
          is_synced = excluded.is_synced
      `);

      const affected = new Set();

      // 입고 upsert만 먼저 커밋한 뒤 재고 재계산을 별 트랜잭션으로 수행한다.
      // (동일 트랜잭션 안에서 INSERT 직후 SELECT가 최신 purchase를 못 읽는 환경을 피함)
      db.transaction(() => {
        for (const item of items) {
          const name = item.medicineName;
          if (!name) continue;
          const amount = Number(item.purchaseAmount ?? 0);
          upsertStmt.run(
            name,
            date,
            amount,
            metadata.siteId,
            metadata.siteName,
            metadata.author,
            metadata.createdAt,
            metadata.lastModified,
            metadata.isSynced
          );
          affected.add(name);
        }
      })();

      db.transaction(() => {
        for (const medicineName of affected) {
          recalculateMedicineInventory(db, medicineName, metadata, date);
        }
      })();

      res.json({ success: true, date, savedCount: affected.size });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/api/medicines', (req, res) => {
    const { medicine_name, date, purchase_amount, usage_amount } = req.body;
    try {
      const metadata = getCurrentRecordMetadata(db, req.body);
      const prevLog = db.prepare('SELECT current_inventory FROM medicine_logs WHERE medicine_name = ? AND date < ? ORDER BY date DESC LIMIT 1').get(medicine_name, date);
      const startInventory = Number(prevLog?.current_inventory || 0);
      const current_inventory = startInventory
        + Number(purchase_amount || 0)
        - Number(usage_amount || 0);

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
      db.transaction(() => {
        recalculateMedicineInventory(db, medicine_name, metadata, date);
      })();
      res.json({ success: true, id: info.lastInsertRowid, current_inventory });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
