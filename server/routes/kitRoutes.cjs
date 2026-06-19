const express = require('express');
const { getCurrentRecordMetadata } = require('../services/syncMetadataService.cjs');
const { recalculateInventoryCascade } = require('../services/inventoryCascadeService.cjs');
const router = express.Router();

const KIT_FIELD_MAP = [
    { kitName: '암모니아성질소(NH3-N)', field: 'nh3_n' },
    { kitName: '질산성질소(NO3-N)', field: 'no3_n' },
    { kitName: '인산염인(PO4-P)', field: 'po4_p' },
    { kitName: '알칼리도(ALK)', field: 'alkalinity' },
];

function normalizeDate(value) {
    const s = String(value || '').trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function isCountableWaterValue(value) {
    if (value === null || value === undefined) return false;
    return String(value).trim() !== '';
}

function aggregateExpectedUsageByDate(db, startDate, endDate, metadata = {}) {
    const siteId = String(metadata?.siteId || '').trim();
    const siteClause = siteId ? ' AND site_id = ?' : '';
    const params = siteId ? [startDate, endDate, siteId] : [startDate, endDate];
    const rows = db.prepare(`
        SELECT date, item_code, result_value
        FROM qntech_water_quality
        WHERE date >= ? AND date <= ?${siteClause}
        ORDER BY date ASC
    `).all(...params);

    const byDate = new Map();
    for (const row of rows) {
        const date = normalizeDate(row.date);
        if (!date) continue;

        const current = byDate.get(date) || {
            '암모니아성질소(NH3-N)': 0,
            '질산성질소(NO3-N)': 0,
            '인산염인(PO4-P)': 0,
            '알칼리도(ALK)': 0,
        };

        for (const { kitName, field } of KIT_FIELD_MAP) {
            if (row.item_code === field && isCountableWaterValue(row.result_value)) {
                current[kitName] += 1;
            }
        }

        byDate.set(date, current);
    }

    return byDate;
}

function recalculateKitInventory(db, kitName, metadata, startDate, explicitDates = new Set()) {
    recalculateInventoryCascade(db, {
        tableName: 'kit_logs',
        nameColumn: 'kit_name',
        itemName: kitName,
        metadata,
        startDate,
        explicitDates,
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

            const touchedByKit = new Map();
            items.forEach((item) => {
                if (!item.kit_name || !item.date) return;
                if (!touchedByKit.has(item.kit_name)) {
                    touchedByKit.set(item.kit_name, { dates: new Set(), explicitDates: new Set() });
                }
                const touched = touchedByKit.get(item.kit_name);
                touched.dates.add(item.date);
                if (item.current_inventory !== null && item.current_inventory !== undefined) {
                    touched.explicitDates.add(item.date);
                }
            });
            db.transaction(() => {
                for (const [kitName, touched] of touchedByKit.entries()) {
                    recalculateKitInventory(
                        db,
                        kitName,
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

    // 구매 저장: 특정 날짜에 키트별 구매량을 upsert하고 재고 재계산
    router.post('/api/kits/purchase', (req, res) => {
        try {
            const { date, items } = req.body; // items: [{ kitName, purchaseAmount }]
            if (!date || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ success: false, error: '날짜와 항목이 필요합니다.' });
            }
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                return res.status(400).json({ success: false, error: '날짜 형식이 올바르지 않습니다.' });
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
                    recalculateKitInventory(db, kitName, metadata, date);
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
                return res.status(400).json({ success: false, error: '시작일은 종료일보다 클 수 없습니다.' });
            }

            const metadata = getCurrentRecordMetadata(db, req.body);
            const expectedByDate = aggregateExpectedUsageByDate(db, startDate, endDate, metadata);
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
                    recalculateKitInventory(db, kitName, metadata, startDate);
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
