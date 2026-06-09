const express = require('express');
const { restoreOperationalData } = require('../services/bigQueryRestoreService.cjs');

const router = express.Router();

function normalizeDate(value) {
  const s = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : new Date().toISOString().slice(0, 10);
}

function addDays(date, offset) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function monthStart(date) {
  return `${date.slice(0, 7)}-01`;
}

function yearStart(date) {
  return `${date.slice(0, 4)}-01-01`;
}

function buildScope(db) {
  const row = db.prepare('SELECT site_id, site_name FROM app_settings WHERE id = 1').get() || {};
  const siteId = String(row.site_id || '').trim();
  const siteName = String(row.site_name || '').trim();
  const params = [];
  const clauses = [];
  if (siteId) {
    clauses.push('site_id = ?');
    params.push(siteId);
  }
  if (siteName) {
    clauses.push('site_name = ?');
    params.push(siteName);
  }
  return {
    siteId,
    siteName,
    clause: clauses.length ? ` AND (${clauses.join(' OR ')})` : '',
    params,
  };
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round1(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

function getActiveNames(db, category, nameColumn, tableName, scope) {
  const configured = db.prepare(`
    SELECT item_name
    FROM config_items
    WHERE category = ?
      AND is_active = 1
      AND item_name NOT LIKE '%\\_purchase' ESCAPE '\\'
      AND item_name NOT LIKE '%\\_usage' ESCAPE '\\'
      AND item_name NOT LIKE '%\\_inventory' ESCAPE '\\'
    ORDER BY display_order ASC, item_name ASC
  `).all(category).map((row) => row.item_name).filter(Boolean);

  const logged = db.prepare(`
    SELECT DISTINCT ${nameColumn} AS item_name
    FROM ${tableName}
    WHERE ${nameColumn} IS NOT NULL
      AND TRIM(${nameColumn}) <> ''
      ${scope.clause}
    ORDER BY ${nameColumn} ASC
  `).all(...scope.params).map((row) => row.item_name).filter(Boolean);

  return [...new Set([...configured, ...logged])];
}

function isPowerType(type) {
  return String(type || '').includes('전력');
}

function getFlowRows(db, date, scope) {
  const prevDate = addDays(date, -1);
  const startMonth = monthStart(date);
  const startYear = yearStart(date);

  const types = db.prepare(`
    SELECT DISTINCT type
    FROM flow_readings
    WHERE type IS NOT NULL
      AND TRIM(type) <> ''
      ${scope.clause}
    ORDER BY type ASC
  `).all(...scope.params).map((row) => row.type).filter(Boolean);

  const todayStmt = db.prepare(`SELECT raw_value, calculated_flow FROM flow_readings WHERE date = ? AND type = ?${scope.clause}`);
  const prevStmt = db.prepare(`SELECT raw_value FROM flow_readings WHERE date <= ? AND type = ?${scope.clause} ORDER BY date DESC LIMIT 1`);
  const sumStmt = db.prepare(`SELECT COALESCE(SUM(calculated_flow), 0) AS total FROM flow_readings WHERE type = ? AND date BETWEEN ? AND ?${scope.clause}`);

  return types.filter((type) => !isPowerType(type)).map((type) => {
    const today = todayStmt.get(date, type, ...scope.params) || {};
    const prev = prevStmt.get(prevDate, type, ...scope.params) || {};
    const todayFlow = today.calculated_flow != null
      ? toNumber(today.calculated_flow)
      : toNumber(today.raw_value) - toNumber(prev.raw_value);
    return {
      item: type,
      previousReading: prev.raw_value ?? null,
      todayReading: today.raw_value ?? null,
      todayFlow: round1(todayFlow),
      monthTotal: round1(sumStmt.get(type, startMonth, date, ...scope.params)?.total),
      yearTotal: round1(sumStmt.get(type, startYear, date, ...scope.params)?.total),
    };
  });
}

function getElectricityRows(db, date, scope) {
  const prevDate = addDays(date, -1);
  const types = db.prepare(`
    SELECT DISTINCT type
    FROM flow_readings
    WHERE type IS NOT NULL
      AND TRIM(type) <> ''
      AND type LIKE '%전력%'
      ${scope.clause}
    ORDER BY type ASC
  `).all(...scope.params).map((row) => row.type).filter(Boolean);

  const targetTypes = types.length ? types : ['전력량'];
  const todayStmt = db.prepare(`SELECT raw_value, calculated_flow FROM flow_readings WHERE date = ? AND type = ?${scope.clause}`);
  const prevStmt = db.prepare(`SELECT raw_value FROM flow_readings WHERE date <= ? AND type = ?${scope.clause} ORDER BY date DESC LIMIT 1`);

  return targetTypes.map((type) => {
    const today = todayStmt.get(date, type, ...scope.params) || {};
    const prev = prevStmt.get(prevDate, type, ...scope.params) || {};
    const usage = today.calculated_flow != null
      ? toNumber(today.calculated_flow)
      : toNumber(today.raw_value) - toNumber(prev.raw_value);
    return {
      item: type === '전력량' ? '전력량' : type,
      previousReading: prev.raw_value ?? null,
      todayReading: today.raw_value ?? null,
      usage: round1(usage),
    };
  });
}

function getInventoryRows(db, date, category, tableName, nameColumn, scope) {
  const startMonth = monthStart(date);
  const startYear = yearStart(date);
  const names = getActiveNames(db, category, nameColumn, tableName, scope);

  const todayStmt = db.prepare(`SELECT purchase_amount, usage_amount, current_inventory FROM ${tableName} WHERE date = ? AND ${nameColumn} = ?${scope.clause}`);
  const latestStmt = db.prepare(`SELECT current_inventory FROM ${tableName} WHERE date <= ? AND ${nameColumn} = ?${scope.clause} ORDER BY date DESC LIMIT 1`);
  const sumStmt = db.prepare(`SELECT COALESCE(SUM(usage_amount), 0) AS total FROM ${tableName} WHERE ${nameColumn} = ? AND date BETWEEN ? AND ?${scope.clause}`);

  return names.map((name) => {
    const today = todayStmt.get(date, name, ...scope.params) || {};
    const latest = latestStmt.get(date, name, ...scope.params) || {};
    return {
      item: name,
      purchase: round1(today.purchase_amount),
      usage: round1(today.usage_amount),
      inventory: latest.current_inventory ?? today.current_inventory ?? null,
      monthUsage: round1(sumStmt.get(name, startMonth, date, ...scope.params)?.total),
      yearUsage: round1(sumStmt.get(name, startYear, date, ...scope.params)?.total),
    };
  });
}

async function restoreForDate(db, date, scope) {
  try {
    await restoreOperationalData(db, {
      startDate: yearStart(date),
      endDate: date,
      tables: ['flow_readings', 'medicine_logs', 'kit_logs'],
      siteId: scope.siteId,
      siteName: scope.siteName,
    });
  } catch (err) {
    console.warn('[roadwork-helper restore]', err.message);
  }
}

module.exports = function (db) {
  router.get('/api/roadwork-helper/all', async (req, res) => {
    try {
      const date = normalizeDate(req.query.date);
      const scope = buildScope(db);
      await restoreForDate(db, date, scope);
      return res.json({
        success: true,
        date,
        flow: getFlowRows(db, date, scope),
        electricity: getElectricityRows(db, date, scope),
        medicine: getInventoryRows(db, date, 'medicine', 'medicine_logs', 'medicine_name', scope),
        kit: getInventoryRows(db, date, 'kit', 'kit_logs', 'kit_name', scope),
      });
    } catch (err) {
      console.error('[roadwork-helper all]', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  router.get('/api/roadwork-helper/flow', async (req, res) => {
    try {
      const date = normalizeDate(req.query.date);
      const scope = buildScope(db);
      await restoreForDate(db, date, scope);
      return res.json({ success: true, date, rows: getFlowRows(db, date, scope) });
    } catch (err) {
      console.error('[roadwork-helper flow]', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  router.get('/api/roadwork-helper/electricity', async (req, res) => {
    try {
      const date = normalizeDate(req.query.date);
      const scope = buildScope(db);
      await restoreForDate(db, date, scope);
      return res.json({ success: true, date, rows: getElectricityRows(db, date, scope) });
    } catch (err) {
      console.error('[roadwork-helper electricity]', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  router.get('/api/roadwork-helper/medicine', async (req, res) => {
    try {
      const date = normalizeDate(req.query.date);
      const scope = buildScope(db);
      await restoreForDate(db, date, scope);
      return res.json({ success: true, date, rows: getInventoryRows(db, date, 'medicine', 'medicine_logs', 'medicine_name', scope) });
    } catch (err) {
      console.error('[roadwork-helper medicine]', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  router.get('/api/roadwork-helper/kit', async (req, res) => {
    try {
      const date = normalizeDate(req.query.date);
      const scope = buildScope(db);
      await restoreForDate(db, date, scope);
      return res.json({ success: true, date, rows: getInventoryRows(db, date, 'kit', 'kit_logs', 'kit_name', scope) });
    } catch (err) {
      console.error('[roadwork-helper kit]', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  return router;
};
