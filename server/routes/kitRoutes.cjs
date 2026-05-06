const express = require('express');
const { getCurrentRecordMetadata } = require('../services/syncMetadataService.cjs');
const router = express.Router();

const KIT_FIELD_MAP = [
    { kitName: '?붾え?덉븘?깆쭏??NH3-N)', field: 'nh3_n' },
    { kitName: '吏덉궛?깆쭏??NO3-N)', field: 'no3_n' },
    { kitName: '?몄궛?쇱씤(PO4-P)', field: 'po4_p' },
    { kitName: '?뚯뭡由щ룄(ALK)', field: 'alkalinity' },
];

function normalizeDate(value) {
    const s = String(value || '').trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function isCountableWaterValue(value) {
    if (value === null || value === undefined) return false;
    return String(value).trim() !== '';
}

function aggregateExpectedUsageByDate(db, startDate, endDate) {
    const rows = db.prepare(`
        SELECT date, nh3_n, no3_n, po4_p, alkalinity
        FROM water_quality
        WHERE date >= ? AND date <= ? AND source_type = 'qntech'
        ORDER BY date ASC
    `).all(startDate, endDate);

    const byDate = new Map();
    for (const row of rows) {
        const date = normalizeDate(row.date);
        if (!date) continue;

        const current = byDate.get(date) || {
            '?붾え?덉븘?깆쭏??NH3-N)': 0,
            '吏덉궛?깆쭏??NO3-N)': 0,
            '?몄궛?쇱씤(PO4-P)': 0,
            '?뚯뭡由щ룄(ALK)': 0,
        };

        for (const { kitName, field } of KIT_FIELD_MAP) {
            if (isCountableWaterValue(row[field])) {
                current[kitName] += 1;
            }
        }

        byDate.set(date, current);
    }

    return byDate;
}

function recalculateKitInventory(db, kitName, metadata) {
    const rows = db.prepare(`
        SELECT id, COALESCE(purchase_amount, 0) AS purchase_amount, COALESCE(usage_amount, 0) AS usage_amount
        FROM kit_logs
        WHERE kit_name = ?
        ORDER BY date ASC, id ASC
    `).all(kitName);

    const updateStmt = db.prepare(`
        UPDATE kit_logs
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
    router.get('/api/kits/history', (req, res) => {
        try {
            const { site_id } = req.query;
            const allRecords = site_id
                ? db.prepare('SELECT * FROM kit_logs WHERE site_id = ? ORDER BY date ASC').all(String(site_id))
                : db.prepare('SELECT * FROM kit_logs ORDER BY date ASC').all();
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

            const metadata = getCurrentRecordMetadata(db, req.body);
            const insertMany = db.transaction((rows) => {
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

            const touchedKits = new Set(items.map((it) => it.kit_name).filter(Boolean));
            db.transaction(() => {
                for (const kitName of touchedKits) {
                    recalculateKitInventory(db, kitName, metadata);
                }
            })();

            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 援щℓ ??? ?뱀젙 ?좎쭨???ㅽ듃蹂?援щℓ?됱쓣 upsert?섍퀬 ?ш퀬 ?ш퀎??
    router.post('/api/kits/purchase', (req, res) => {
        try {
            const { date, items } = req.body; // items: [{ kitName, purchaseAmount }]
            if (!date || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ success: false, error: '?좎쭨? ??ぉ???꾩슂?⑸땲??' });
            }
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                return res.status(400).json({ success: false, error: '?좎쭨 ?뺤떇???щ컮瑜댁? ?딆뒿?덈떎.' });
            }

            const metadata = getCurrentRecordMetadata(db, req.body);
            const upsertStmt = db.prepare(`
                INSERT INTO kit_logs (
                    kit_name, date, purchase_amount, usage_amount, current_inventory,
                    site_id, site_name, author, created_at, last_modified, is_synced
                ) VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(kit_name, date) DO UPDATE SET
                    purchase_amount = excluded.purchase_amount,
                    site_id = excluded.site_id,
                    site_name = excluded.site_name,
                    author = excluded.author,
                    last_modified = excluded.last_modified,
                    is_synced = excluded.is_synced
            `);

            const affectedKits = new Set();

            db.transaction(() => {
                for (const item of items) {
                    const kitName = item.kitName;
                    if (!kitName) continue;
                    const amount = Number(item.purchaseAmount ?? 0);
                    upsertStmt.run(
                        kitName, date, amount,
                        metadata.siteId, metadata.siteName, metadata.author,
                        metadata.createdAt, metadata.lastModified, metadata.isSynced
                    );
                    affectedKits.add(kitName);
                }
            })();

            db.transaction(() => {
                for (const kitName of affectedKits) {
                    recalculateKitInventory(db, kitName, metadata);
                }
            })();

            res.json({ success: true, date, savedKitCount: affectedKits.size });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    router.post('/api/kits/sync-analysis-usage', (req, res) => {
        try {
            const today = new Date();
            const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

            const bodyStart = normalizeDate(req.body?.startDate);
            const bodyEnd = normalizeDate(req.body?.endDate);
            const startDate = bodyStart || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
            const endDate = bodyEnd || todayStr;

            if (startDate > endDate) {
                return res.status(400).json({ success: false, error: '?쒖옉?쇱? 醫낅즺?쇰낫????쓣 ???놁뒿?덈떎.' });
            }

            const expectedByDate = aggregateExpectedUsageByDate(db, startDate, endDate);
            const metadata = getCurrentRecordMetadata(db, req.body);
            const unsyncedDates = new Set();
            const changedKits = new Set();
            let updatedCellCount = 0;
            let alreadyMatchedCellCount = 0;

            const selectUsageStmt = db.prepare('SELECT COALESCE(usage_amount, 0) AS usage_amount FROM kit_logs WHERE kit_name = ? AND date = ?');
            const upsertUsageStmt = db.prepare(`
                INSERT INTO kit_logs (
                    kit_name, date, purchase_amount, usage_amount, current_inventory,
                    site_id, site_name, author, created_at, last_modified, is_synced
                ) VALUES (?, ?, 0, ?, 0, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(kit_name, date) DO UPDATE SET
                    usage_amount = excluded.usage_amount,
                    site_id = excluded.site_id,
                    site_name = excluded.site_name,
                    author = excluded.author,
                    last_modified = excluded.last_modified,
                    is_synced = excluded.is_synced
            `);

            db.transaction(() => {
                for (const [date, expected] of expectedByDate.entries()) {
                    for (const { kitName } of KIT_FIELD_MAP) {
                        const targetUsage = Number(expected[kitName] || 0);
                        const currentUsage = Number(selectUsageStmt.get(kitName, date)?.usage_amount || 0);
                        if (currentUsage === targetUsage) {
                            alreadyMatchedCellCount += 1;
                            continue;
                        }

                        upsertUsageStmt.run(
                            kitName,
                            date,
                            targetUsage,
                            metadata.siteId,
                            metadata.siteName,
                            metadata.author,
                            metadata.createdAt,
                            metadata.lastModified,
                            metadata.isSynced
                        );
                        unsyncedDates.add(date);
                        changedKits.add(kitName);
                        updatedCellCount += 1;
                    }
                }

                changedKits.forEach((kitName) => {
                    recalculateKitInventory(db, kitName, metadata);
                });
            })();

            const sortedDates = Array.from(unsyncedDates).sort((a, b) => a.localeCompare(b));
            res.json({
                success: true,
                startDate,
                endDate,
                summary: {
                    checkedDateCount: expectedByDate.size,
                    unsyncedDateCount: sortedDates.length,
                    updatedCellCount,
                    alreadyMatchedCellCount,
                    recalculatedKitCount: changedKits.size,
                },
                unsyncedDates: sortedDates,
            });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
};
