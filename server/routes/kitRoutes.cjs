const express = require('express');
const { getCurrentRecordMetadata } = require('../services/syncMetadataService.cjs');
const router = express.Router();

module.exports = function (db) {
    router.get('/api/kits/history', (req, res) => {
        try {
            const allRecords = db.prepare('SELECT * FROM kit_logs ORDER BY date ASC').all();
            res.json({ success: true, history: allRecords });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    router.post('/api/kits/bulk', (req, res) => {
        const { items } = req.body;
        try {
            const stmt = db.prepare(`
                INSERT INTO kit_logs (
                    kit_name, date, purchase_amount, usage_amount, current_inventory,
                    site_id, site_name, author, created_at, last_modified, is_synced
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(kit_name, date) DO UPDATE SET
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
                        item.kit_name,
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

    return router;
};
