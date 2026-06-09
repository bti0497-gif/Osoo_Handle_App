const express = require('express');
const { getCurrentRecordMetadata } = require('../services/syncMetadataService.cjs');
const router = express.Router();

module.exports = function (db) {
  function calculateSludgeYearlyCumulative(targetDate, previousCalculatedFlow, sludgeExport) {
    const currentYear = String(targetDate || '').slice(0, 4);
    const previousCumulative = previousCalculatedFlow ?? 0;

    if (String(targetDate || '').slice(5, 10) === '01-01') {
      return sludgeExport ?? 0;
    }

    return currentYear ? previousCumulative + (sludgeExport ?? 0) : (sludgeExport ?? 0);
  }

  function recalculateFlowTypeCascade(dbConn, type, metadata) {
    const rows = dbConn.prepare(`
      SELECT id, date, raw_value, sludge_export
      FROM flow_readings
      WHERE type = ?
      ORDER BY date ASC, id ASC
    `).all(type);

    const updateStmt = dbConn.prepare(`
      UPDATE flow_readings
      SET calculated_flow = ?,
          site_id = ?,
          site_name = ?,
          author = ?,
          last_modified = ?,
          is_synced = ?
      WHERE id = ?
    `);

    let prevRaw = null;
    let prevSludgeYear = null;
    let prevSludgeCumulative = 0;

    for (const row of rows) {
      const rawNum = row.raw_value == null ? null : Number(row.raw_value);
      const hasRaw = rawNum != null && Number.isFinite(rawNum);
      let flow = null;

      if (type === '슬러지') {
        const sludgeRaw = row.sludge_export ?? row.raw_value;
        const sludgeNum = sludgeRaw == null ? null : Number(sludgeRaw);
        const hasSludge = sludgeNum != null && Number.isFinite(sludgeNum);
        if (hasSludge) {
          const y = String(row.date || '').slice(0, 4);
          if (y !== prevSludgeYear) {
            prevSludgeYear = y;
            prevSludgeCumulative = 0;
          }
          flow = Math.round((prevSludgeCumulative + sludgeNum) * 10) / 10;
          prevSludgeCumulative = flow;
        }
      } else if (hasRaw) {
        if (prevRaw != null && Number.isFinite(prevRaw)) {
          flow = Math.round((rawNum - prevRaw) * 10) / 10;
        }
        prevRaw = rawNum;
      }

      updateStmt.run(
        flow,
        metadata.siteId,
        metadata.siteName,
        metadata.author,
        metadata.lastModified,
        metadata.isSynced,
        row.id
      );
    }
  }

  router.get('/api/flows', (req, res) => {
    const { date, site_id } = req.query;
    const sql = site_id
      ? 'SELECT * FROM flow_readings WHERE date = ? AND site_id = ?'
      : 'SELECT * FROM flow_readings WHERE date = ?';
    const flows = site_id
      ? db.prepare(sql).all(date, String(site_id))
      : db.prepare(sql).all(date);
    res.json(flows);
  });

  router.get('/api/flows/history', (req, res) => {
    try {
      const { site_id } = req.query;
      const dates = site_id
        ? db.prepare('SELECT DISTINCT date FROM flow_readings WHERE site_id = ? ORDER BY date ASC').all(String(site_id))
        : db.prepare('SELECT DISTINCT date FROM flow_readings ORDER BY date ASC').all();
      const allReadings = site_id
        ? db.prepare('SELECT * FROM flow_readings WHERE site_id = ? ORDER BY date ASC, type ASC').all(String(site_id))
        : db.prepare('SELECT * FROM flow_readings ORDER BY date ASC, type ASC').all();

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
      const stmt = db.prepare(`
        INSERT INTO flow_readings (
          date, type, raw_value, calculated_flow, is_reset, is_manual, sludge_export,
          site_id, site_name, author, created_at, last_modified, is_synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date, type) DO UPDATE SET
          raw_value = excluded.raw_value,
          calculated_flow = excluded.calculated_flow,
          is_reset = excluded.is_reset,
          is_manual = excluded.is_manual,
          sludge_export = excluded.sludge_export,
          site_id = excluded.site_id,
          site_name = excluded.site_name,
          author = excluded.author,
          last_modified = excluded.last_modified,
          is_synced = excluded.is_synced
      `);

      const metadata = getCurrentRecordMetadata(db, req.body);
      const insertMany = db.transaction((rows) => {
        for (const item of rows) {
          const { type, raw_value, calculated_flow, sludge_export, is_reset, is_manual } = item;
          const sludgeAmount = type === '슬러지' ? (sludge_export ?? raw_value ?? null) : null;
          // 프론트엔드에서 이미 계산된 flow와 raw를 넘겨주므로 그대로 저장 (수동이든 자동이든)
          stmt.run(
            date,
            type,
            raw_value,
            calculated_flow,
            is_reset ? 1 : 0,
            is_manual ? 1 : 0,
            sludgeAmount,
            metadata.siteId,
            metadata.siteName,
            metadata.author,
            metadata.createdAt,
            metadata.lastModified,
            metadata.isSynced
          );
          results.push({ type, calculated_flow });
        }
      });

      insertMany(items);
      const touchedTypes = new Set(items.map((it) => it.type).filter(Boolean));
      db.transaction(() => {
        for (const type of touchedTypes) {
          recalculateFlowTypeCascade(db, type, metadata);
        }
      })();

      res.json({ success: true, results });
    } catch (err) {
      console.error("Bulk save error:", err, "Payload:", JSON.stringify(req.body, null, 2));
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/api/flows', (req, res) => {
    const { date, type, raw_value, is_reset, is_manual, manual_flow, sludge_export } = req.body;
    try {
      const metadata = getCurrentRecordMetadata(db, req.body);
      const prevReading = db.prepare('SELECT raw_value, calculated_flow, date FROM flow_readings WHERE type = ? AND date < ? ORDER BY date DESC LIMIT 1').get(type, date);

      // 보정 로직 동일 적용
      const effectivePrevRaw = (prevReading?.raw_value === null && prevReading?.calculated_flow > 10000)
        ? prevReading.calculated_flow
        : prevReading?.raw_value;

      if (!is_manual && !is_reset && effectivePrevRaw !== undefined && raw_value < effectivePrevRaw) {
        return res.status(400).json({ success: false, message: '검침값이 어제보다 작을 수 없습니다. 초기화가 필요한 경우 체크해주세요.' });
      }

      let calculated_flow = 0;
      const sludgeAmount = type === '슬러지' ? (sludge_export ?? raw_value ?? null) : null;

      if (type === '슬러지' && !is_manual) {
        const prevSameYearCalculated = prevReading && String(prevReading.date || '').slice(0, 4) === String(date || '').slice(0, 4)
          ? Number(prevReading.calculated_flow || 0)
          : 0;
        calculated_flow = calculateSludgeYearlyCumulative(date, prevSameYearCalculated, sludgeAmount);
      } else if (is_manual) { calculated_flow = manual_flow; }
      else if (!is_reset && effectivePrevRaw !== undefined) { calculated_flow = raw_value - effectivePrevRaw; }

      const info = db.prepare(`
        INSERT INTO flow_readings (
          date, type, raw_value, calculated_flow, is_reset, is_manual, sludge_export,
          site_id, site_name, author, created_at, last_modified, is_synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date, type) DO UPDATE SET
          raw_value = excluded.raw_value,
          calculated_flow = excluded.calculated_flow,
          is_reset = excluded.is_reset,
          is_manual = excluded.is_manual,
          sludge_export = excluded.sludge_export,
          site_id = excluded.site_id,
          site_name = excluded.site_name,
          author = excluded.author,
          last_modified = excluded.last_modified,
          is_synced = excluded.is_synced
      `).run(
        date,
        type,
        raw_value,
        calculated_flow,
        is_reset ? 1 : 0,
        is_manual ? 1 : 0,
        sludgeAmount,
        metadata.siteId,
        metadata.siteName,
        metadata.author,
        metadata.createdAt,
        metadata.lastModified,
        metadata.isSynced
      );
      db.transaction(() => {
        recalculateFlowTypeCascade(db, type, metadata);
      })();
      res.json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
