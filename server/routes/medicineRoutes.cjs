const express = require('express');
const { getCurrentRecordMetadata } = require('../services/syncMetadataService.cjs');
const router = express.Router();

function recalculateMedicineInventory(db, medicineName, metadata) {
  const rows = db.prepare(`
    SELECT id, COALESCE(purchase_amount, 0) AS purchase_amount, COALESCE(usage_amount, 0) AS usage_amount
    FROM medicine_logs
    WHERE medicine_name = ?
    ORDER BY date ASC, id ASC
  `).all(medicineName);

  const updateStmt = db.prepare(`
    UPDATE medicine_logs
    SET current_inventory = ?,
        site_id = ?,
        site_name = ?,
        author = ?,
        last_modified = ?,
        is_synced = ?
    WHERE id = ?
  `);

  let runningInventory = 0;
  rows.forEach((row) => {
    runningInventory = Math.round((runningInventory + Number(row.purchase_amount || 0) - Number(row.usage_amount || 0)) * 10) / 10;
    updateStmt.run(
      runningInventory,
      metadata.siteId,
      metadata.siteName,
      metadata.author,
      metadata.lastModified,
      metadata.isSynced,
      row.id
    );
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

      const touchedNames = new Set(items.map((it) => it.medicine_name).filter(Boolean));
      db.transaction(() => {
        for (const medicineName of touchedNames) {
          recalculateMedicineInventory(db, medicineName, metadata);
        }
      })();

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /** ?뱀젙 ?좎쭨???쏀뭹蹂??낃퀬???쇨큵 諛섏쁺 ???ш퀬 ?곗뇙 ?ш퀎??(?ㅽ듃 /api/kits/purchase ? ?숈씪 ?⑦꽩) */
  router.post('/api/medicines/purchase', (req, res) => {
    try {
      const { date, items } = req.body;
      if (!date || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: '?좎쭨? ??ぉ???꾩슂?⑸땲??' });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
        return res.status(400).json({ success: false, error: '?좎쭨 ?뺤떇???щ컮瑜댁? ?딆뒿?덈떎.' });
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

      // ?낃퀬 upsert留?癒쇱? 而ㅻ컠?????ш퀬 ?ш퀎?곗쓣 蹂??몃옖??뀡?쇰줈 ?섑뻾?쒕떎.
      // (?숈씪 ?몃옖??뀡 ?덉뿉??INSERT 吏곹썑 SELECT媛 理쒖떊 purchase瑜?紐??쎈뒗 ?섍꼍???쇳븿)
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
          recalculateMedicineInventory(db, medicineName, metadata);
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
