const express = require('express');
const router = express.Router();

function normalizeDate(value) {
  const s = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : new Date().toISOString().slice(0, 10);
}

function addDays(date, offset) {
  const [year, month, day] = String(date || '').split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + offset);
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

  // app_settings 정보 가져오기
  const settings = db.prepare('SELECT method, series, flow_option FROM app_settings WHERE id = 1').get() || {};
  const method = String(settings.method || '').trim().toUpperCase(); // 'MBR', 'A2O'
  const series = String(settings.series || '').trim();
  const flowOption = settings.flow_option ? String(settings.flow_option).trim() : (series === '2계열' ? 'combined' : 'single1');

  // 1. 전체 유량 타입 가져오기
  let rawTypes = db.prepare(`
    SELECT DISTINCT type
    FROM flow_readings
    WHERE type IS NOT NULL
      AND TRIM(type) <> ''
      ${scope.clause}
    ORDER BY type ASC
  `).all(...scope.params).map((row) => row.type).filter(Boolean);

  // 전력 타입 제외
  rawTypes = rawTypes.filter((type) => !isPowerType(type));

  // MBR 공법의 경우 외부반송 제외
  if (method === 'MBR') {
    rawTypes = rawTypes.filter((type) => !type.includes('외부반송') && !type.includes('외부'));
  }

  const todayStmt = db.prepare(`SELECT raw_value, calculated_flow, sludge_export FROM flow_readings WHERE date = ? AND type = ?${scope.clause}`);
  const prevStmt = db.prepare(`SELECT raw_value FROM flow_readings WHERE date = ? AND type = ?${scope.clause} LIMIT 1`);
  const sumStmt = db.prepare(`SELECT COALESCE(SUM(calculated_flow), 0) AS total FROM flow_readings WHERE type = ? AND date BETWEEN ? AND ?${scope.clause}`);
  const sludgeSumStmt = db.prepare(`SELECT COALESCE(SUM(COALESCE(sludge_export, raw_value)), 0) AS total FROM flow_readings WHERE type = ? AND date BETWEEN ? AND ?${scope.clause}`);

  // 각 rawType의 세부 데이터 미리 쿼리
  const allRows = rawTypes.map((type) => {
    const today = todayStmt.get(date, type, ...scope.params) || {};
    const prev = prevStmt.get(prevDate, type, ...scope.params) || {};
    const hasTodayReading = today.raw_value !== null && today.raw_value !== undefined && today.raw_value !== '';
    const isSludge = String(type || '').includes('슬러지');
    const todayFlow = isSludge
      ? (today.sludge_export ?? today.raw_value ?? null)
      : today.calculated_flow != null
        ? toNumber(today.calculated_flow)
        : hasTodayReading
          ? toNumber(today.raw_value) - toNumber(prev.raw_value)
          : null;
    const totalStmt = isSludge ? sludgeSumStmt : sumStmt;
    return {
      item: type,
      previousReading: isSludge ? null : (prev.raw_value ?? null),
      todayReading: isSludge ? null : (today.raw_value ?? null),
      todayFlow: todayFlow === null ? null : round1(todayFlow),
      monthTotal: round1(totalStmt.get(type, startMonth, date, ...scope.params)?.total),
      yearTotal: round1(totalStmt.get(type, startYear, date, ...scope.params)?.total),
    };
  });

  // 이제 flowOption에 맞게 병합 및 필터링 수행
  const processedRows = [];

  // 반송이 아닌 일반 유량계들 (유입, 방류, 슬러지 등) 처리
  const normalRows = allRows.filter(r => !r.item.includes('내부반송') && !r.item.includes('외부반송'));
  processedRows.push(...normalRows);

  // 반송 유량계 (내부반송, 외부반송) 그룹화 처리 함수
  const mergeReturnFlow = (keyword, targetName) => {
    const series1 = allRows.find(r => r.item.includes(keyword) && !r.item.endsWith('2'));
    const series2 = allRows.find(r => r.item.includes(keyword) && r.item.endsWith('2'));

    if (!series1 && !series2) return;

    if (flowOption === 'single1') {
      if (series1) {
        processedRows.push({ ...series1, item: targetName });
      }
    } else if (flowOption === 'single2') {
      if (series2) {
        processedRows.push({ ...series2, item: targetName });
      } else if (series1) {
        processedRows.push({ ...series1, item: targetName });
      }
    } else if (flowOption === 'combined') {
      if (series1 && series2) {
        const sumFlow = (val1, val2) => {
          if (val1 === null && val2 === null) return null;
          return toNumber(val1) + toNumber(val2);
        };
        processedRows.push({
          item: targetName,
          previousReading: sumFlow(series1.previousReading, series2.previousReading),
          todayReading: sumFlow(series1.todayReading, series2.todayReading),
          todayFlow: sumFlow(series1.todayFlow, series2.todayFlow) !== null ? round1(toNumber(series1.todayFlow) + toNumber(series2.todayFlow)) : null,
          monthTotal: round1(toNumber(series1.monthTotal) + toNumber(series2.monthTotal)),
          yearTotal: round1(toNumber(series1.yearTotal) + toNumber(series2.yearTotal)),
        });
      } else {
        const existing = series1 || series2;
        processedRows.push({ ...existing, item: targetName });
      }
    } else {
      if (series1) processedRows.push(series1);
      if (series2) processedRows.push(series2);
    }
  };

  mergeReturnFlow('내부반송', '내부반송유량계');

  if (method !== 'MBR') {
    mergeReturnFlow('외부반송', '외부반송유량계');
  }

  return processedRows;
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
  const prevStmt = db.prepare(`SELECT raw_value FROM flow_readings WHERE date = ? AND type = ?${scope.clause} LIMIT 1`);

  return targetTypes.map((type) => {
    const today = todayStmt.get(date, type, ...scope.params) || {};
    const prev = prevStmt.get(prevDate, type, ...scope.params) || {};
    const hasTodayReading = today.raw_value !== null && today.raw_value !== undefined && today.raw_value !== '';
    const usage = today.calculated_flow != null
      ? toNumber(today.calculated_flow)
      : hasTodayReading
        ? toNumber(today.raw_value) - toNumber(prev.raw_value)
        : null;
    return {
      item: type === '전력량' ? '전력량' : type,
      previousReading: prev.raw_value ?? null,
      todayReading: today.raw_value ?? null,
      usage: usage === null ? null : round1(usage),
    };
  });
}

function getInventoryRows(db, date, category, tableName, nameColumn, scope) {
  const startMonth = monthStart(date);
  const startYear = yearStart(date);
  let names = getActiveNames(db, category, nameColumn, tableName, scope);
  if (category === 'medicine') {
    const roadworkMedicineNames = new Set(['포도당', '중탄산나트륨', '팩(PAC)', '응집제']);
    names = names.filter((name) => roadworkMedicineNames.has(String(name || '').trim()));
  }

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

module.exports = function (db) {
  router.get('/api/roadwork-helper/all', async (req, res) => {
    try {
      const date = normalizeDate(req.query.date);
      const scope = buildScope(db);
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
