const express = require('express');
const { getCurrentRecordMetadata } = require('../services/syncMetadataService.cjs');
const router = express.Router();

module.exports = function (db) {
  function recalculateFlowTypeCascade(dbConn, type, metadata, startDate, explicitDates = new Set()) {
    const previousRaw = startDate
      ? dbConn.prepare(`
          SELECT date, raw_value
          FROM flow_readings
          WHERE type = ? AND date < ? AND raw_value IS NOT NULL
          ORDER BY date DESC, id DESC
          LIMIT 1
        `).get(type, startDate)
      : null;
    const startYear = String(startDate || '').slice(0, 4);
    const previousSludge = startDate && type === '슬러지'
      ? dbConn.prepare(`
          SELECT date, calculated_flow
          FROM flow_readings
          WHERE type = ?
            AND date < ?
            AND date >= ?
            AND calculated_flow IS NOT NULL
          ORDER BY date DESC, id DESC
          LIMIT 1
        `).get(type, startDate, `${startYear}-01-01`)
      : null;
    const rows = dbConn.prepare(`
      SELECT id, date, raw_value, sludge_export, calculated_flow,
             is_reset, is_manual, is_synced, last_modified, input_status
      FROM flow_readings
      WHERE type = ? AND (? IS NULL OR date >= ?)
      ORDER BY date ASC, id ASC
    `).all(type, startDate || null, startDate || null);

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

    let prevRaw = previousRaw?.raw_value == null ? null : Number(previousRaw.raw_value);
    let prevSludgeYear = previousSludge
      ? String(previousSludge.date || '').slice(0, 4)
      : startYear || null;
    let prevSludgeCumulative = previousSludge?.calculated_flow == null
      ? 0
      : Number(previousSludge.calculated_flow);

    for (const row of rows) {
      const rawNum = row.raw_value == null ? null : Number(row.raw_value);
      const hasRaw = rawNum != null && Number.isFinite(rawNum);
      let flow = null;
      const inputStatus = String(row.input_status || '').trim().toLowerCase();
      const shouldPreserveStoredFlow = (inputStatus === 'imported' || inputStatus === 'baseline');

      if (type === '슬러지') {
        const sludgeRaw = row.sludge_export ?? row.raw_value;
        const sludgeNum = sludgeRaw == null ? null : Number(sludgeRaw);
        const hasSludge = sludgeNum != null && Number.isFinite(sludgeNum);
        const storedFlow = row.calculated_flow == null ? null : Number(row.calculated_flow);
        const hasStoredFlow = storedFlow != null && Number.isFinite(storedFlow);
        const year = String(row.date || '').slice(0, 4);
        if (year !== prevSludgeYear) {
          prevSludgeYear = year;
          prevSludgeCumulative = 0;
        }
        if (shouldPreserveStoredFlow) {
          flow = hasStoredFlow ? storedFlow : null;
          if (hasStoredFlow) {
            prevSludgeCumulative = flow;
          }
        } else if (hasSludge) {
          // 슬러지 반출량은 연간 누적 계산이므로, 반출량이 바뀌면
          // prevSludgeCumulative 기준으로 재계산한다.
          flow = Math.round((prevSludgeCumulative + sludgeNum) * 10) / 10;
          prevSludgeCumulative = flow;
        }
      } else if (hasRaw) {
        const storedFlow = row.calculated_flow == null ? null : Number(row.calculated_flow);
        // 검침값(raw)은 자동 계산 대상이므로, raw가 바뀌면 calculated_flow도
        // prevRaw 기준으로 재계산한다. 단 사용자가 직접 유량을 지정한(is_manual),
        // 리셋 지점(is_reset), 엑셀 임포트/관리자 지정(imported/baseline)은 보존.
        if ((shouldPreserveStoredFlow || row.is_manual || row.is_reset) && storedFlow != null) {
          flow = storedFlow;
        } else if (prevRaw != null && Number.isFinite(prevRaw)) {
          // 검침값은 누적이므로 어제보다 작을 수 없다. 작아지면(마이너스) 0으로
          // 클램프한다. 필요하면 전날 검침값을 먼저 수정하거나 '초기화'로 처리한다.
          const diff = rawNum - prevRaw;
          flow = Math.round(diff * 10) / 10;
          if (flow < 0) flow = 0;
        }
        prevRaw = rawNum;
      }

      const prevFlow = row.calculated_flow == null ? null : Number(row.calculated_flow);
      const isFlowChanged = flow !== prevFlow;
      const nextSynced = isFlowChanged ? metadata.isSynced : (row.is_synced ?? 0);

      updateStmt.run(
        flow,
        metadata.siteId,
        metadata.siteName,
        metadata.author,
        isFlowChanged ? metadata.lastModified : (row.last_modified || metadata.lastModified),
        nextSynced,
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
            diff: r.calculated_flow,
            input_status: r.input_status || 'manual'
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
          input_status, site_id, site_name, author, created_at, last_modified, is_synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date, type) DO UPDATE SET
          raw_value = excluded.raw_value,
          calculated_flow = excluded.calculated_flow,
          is_reset = excluded.is_reset,
          is_manual = excluded.is_manual,
          sludge_export = excluded.sludge_export,
          input_status = excluded.input_status,
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
            String(item.input_status || item.inputStatus || 'manual').trim() || 'manual',
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
      const touchedByType = new Map();
      items.forEach((item) => {
        if (!item.type || !date) return;
        if (!touchedByType.has(item.type)) touchedByType.set(item.type, new Set());
        touchedByType.get(item.type).add(date);
      });
      db.transaction(() => {
        for (const [type, dates] of touchedByType.entries()) {
          recalculateFlowTypeCascade(db, type, metadata, [...dates].sort()[0], dates);
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
        calculated_flow = Math.round((prevSameYearCalculated + Number(sludgeAmount || 0)) * 10) / 10;
      } else if (is_manual) { calculated_flow = manual_flow; }
      else if (!is_reset && effectivePrevRaw !== undefined) { calculated_flow = raw_value - effectivePrevRaw; }

      const info = db.prepare(`
        INSERT INTO flow_readings (
          date, type, raw_value, calculated_flow, is_reset, is_manual, sludge_export,
          input_status, site_id, site_name, author, created_at, last_modified, is_synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date, type) DO UPDATE SET
          raw_value = excluded.raw_value,
          calculated_flow = excluded.calculated_flow,
          is_reset = excluded.is_reset,
          is_manual = excluded.is_manual,
          sludge_export = excluded.sludge_export,
          input_status = excluded.input_status,
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
        String(req.body.input_status || req.body.inputStatus || 'manual').trim() || 'manual',
        metadata.siteId,
        metadata.siteName,
        metadata.author,
        metadata.createdAt,
        metadata.lastModified,
        metadata.isSynced
      );
      db.transaction(() => {
        recalculateFlowTypeCascade(db, type, metadata, date, new Set([date]));
      })();
      res.json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
