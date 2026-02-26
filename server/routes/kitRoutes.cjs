const express = require('express');
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
            const stmt = db.prepare(`INSERT OR REPLACE INTO kit_logs (kit_name, date, purchase_amount, usage_amount, current_inventory) VALUES (?, ?, ?, ?, ?)`);

            const insertMany = db.transaction((rows) => {
                for (const item of rows) {
                    stmt.run(item.kit_name, item.date, item.purchase_amount || 0, item.usage_amount || 0, item.current_inventory || 0);
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
