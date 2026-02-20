const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parseAndStoreExcel, getStoredSheets, getStoredRow, getCellValue, hasStoredData, formatDate } = require('../services/excelService.cjs');
const router = express.Router();

let importProgress = { current: 0, total: 0, status: 'idle', result: null };

module.exports = function(db, baseDir) {
  const reportsDir = path.join(baseDir, 'templates', 'reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const reportStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, reportsDir),
    filename: (req, file, cb) => {
      try { cb(null, Buffer.from(file.originalname, 'latin1').toString('utf8')); }
      catch (e) { cb(null, file.originalname); }
    }
  });
  const reportUpload = multer({ storage: reportStorage });

  // ── 설정 조회 ──
  router.get('/api/settings', (req, res) => {
    try {
      const settings = db.prepare('SELECT * FROM app_settings WHERE id = 1').get();
      const configItems = db.prepare('SELECT * FROM config_items ORDER BY category, display_order').all();
      res.json({ success: true, settings, configItems });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── 설정 저장 ──
  router.post('/api/settings', (req, res) => {
    const { settings, configItems } = req.body;
    try {
      const updateTransaction = db.transaction((s, items) => {
        db.prepare('UPDATE app_settings SET site_name = ?, manager_name = ?, method = ?, series = ? WHERE id = 1').run(s.siteName, s.managerName, s.method, s.series);
        const updateConfig = db.prepare('UPDATE config_items SET is_active = ? WHERE category = ? AND item_name = ?');
        const insertConfig = db.prepare('INSERT OR IGNORE INTO config_items (category, item_name, is_active, display_order) VALUES (?, ?, ?, ?)');
        items.forEach((item, idx) => {
          const result = updateConfig.run(item.checked ? 1 : 0, item.category, item.name);
          if (result.changes === 0) insertConfig.run(item.category, item.name, 1, idx);
        });
      });
      updateTransaction(settings, configItems);
      res.json({ success: true, message: 'Settings saved successfully' });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── 설정 항목 즉시 추가 ──
  router.post('/api/settings/add-item', (req, res) => {
    const { category, name } = req.body;
    if (!category || !name) return res.status(400).json({ success: false, message: 'category와 name이 필요합니다.' });
    try {
      const existing = db.prepare('SELECT id FROM config_items WHERE category = ? AND item_name = ?').get(category, name);
      if (existing) return res.status(409).json({ success: false, message: '이미 존재하는 항목입니다.' });
      const maxOrder = db.prepare('SELECT MAX(display_order) as mx FROM config_items WHERE category = ?').get(category);
      const order = (maxOrder?.mx ?? -1) + 1;
      db.prepare('INSERT INTO config_items (category, item_name, is_active, display_order) VALUES (?, ?, 1, ?)').run(category, name, order);
      const item = db.prepare('SELECT * FROM config_items WHERE category = ? AND item_name = ?').get(category, name);
      res.json({ success: true, item });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── 설정 항목 활성/비활성 토글 ──
  router.post('/api/settings/toggle-item', (req, res) => {
    const { category, name, isActive } = req.body;
    if (!category || !name) return res.status(400).json({ success: false, message: 'category와 name이 필요합니다.' });
    try {
      db.prepare('UPDATE config_items SET is_active = ? WHERE category = ? AND item_name = ?').run(isActive ? 1 : 0, category, name);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── 엑셀 상태 (DB에 데이터 있는지 즉시 확인) ──
  router.get('/api/settings/excel-status', (req, res) => {
    try {
      const settings = db.prepare('SELECT excel_template_path FROM app_settings WHERE id = 1').get();
      const fileName = settings?.excel_template_path?.split(/[\/\\]/).pop() || null;

      if (!hasStoredData(db)) {
        if (!fileName) return res.json({ status: 'not-set', fileName: null, sheets: [] });
        return res.json({ status: 'not-imported', fileName, sheets: [] });
      }

      const sheets = getStoredSheets(db);
      res.json({
        status: 'ready',
        fileName,
        sheets: sheets.map(s => s.sheet_name),
        sheetInfo: sheets
      });
    } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
  });

  // ── 엑셀 행 프리뷰 (DB에서 즉시 조회) ──
  router.post('/api/settings/excel-preview', (req, res) => {
    const { sheet, row } = req.body;
    try {
      if (!hasStoredData(db)) return res.json({ success: false, message: '엑셀 데이터가 아직 저장되지 않았습니다.' });
      const data = getStoredRow(db, sheet, row);
      res.json({ success: true, data });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── 임포트 진행 상황 ──
  router.get('/api/settings/import-progress', (req, res) => { res.json(importProgress); });

  // ── 유량 매핑 저장 + DB에서 임포트 ──
  router.post('/api/settings/save-flow-mapping', (req, res) => {
    const { config, mapping } = req.body;
    const { sheet, startRow, endRow, dateCol } = config;
    importProgress = { current: 0, total: endRow - startRow + 1, status: 'processing', result: null };
    try {
      if (!hasStoredData(db)) throw new Error('엑셀 데이터가 아직 저장되지 않았습니다. 먼저 파일을 업로드하세요.');

      db.prepare('UPDATE app_settings SET flow_sheet = ?, flow_start_row = ?, flow_end_row = ?, flow_date_col = ? WHERE id = 1').run(sheet, startRow, endRow, dateCol);
      const upsertStmt = db.prepare("INSERT INTO config_items (category, item_name, excel_cell, is_active, display_order) VALUES ('flow', ?, ?, 1, 0) ON CONFLICT(category, item_name) DO UPDATE SET excel_cell = excluded.excel_cell");
      Object.entries(mapping).forEach(([name, col]) => upsertStmt.run(name, col));

      const insertReading = db.prepare('INSERT OR REPLACE INTO flow_readings (date, type, calculated_flow) VALUES (?, ?, ?)');
      const importedData = [];

      db.transaction(() => {
        for (let r = startRow; r <= endRow; r++) {
          const dateStr = getCellValue(db, sheet, r, dateCol);
          const formatted = formatDate(dateStr) || dateStr;
          if (!formatted) { importProgress.current++; continue; }
          const rowResults = { date: formatted };
          Object.entries(mapping).forEach(([itemName, col]) => {
            if (itemName === '날짜 (Date)') return;
            const val = getCellValue(db, sheet, r, col);
            const num = parseFloat(val);
            if (!isNaN(num)) { const rounded = Math.round(num * 10) / 10; insertReading.run(formatted, itemName, rounded); rowResults[itemName] = rounded; }
          });
          importedData.push(rowResults);
          importProgress.current++;
        }
      })();

      importProgress.status = 'completed';
      importProgress.result = importedData;
      res.json({ success: true, message: '유량 데이터 임포트 완료', count: importedData.length });
    } catch (e) {
      console.error('Flow mapping error:', e);
      importProgress.status = 'error';
      importProgress.result = e.message;
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ── 키트 매핑 저장 + DB에서 임포트 ──
  router.post('/api/settings/save-kit-mapping', (req, res) => {
    const { config, mapping } = req.body;
    const { sheet, startRow, endRow, dateCol } = config;
    importProgress = { current: 0, total: endRow - startRow + 1, status: 'processing', result: null };
    try {
      if (!hasStoredData(db)) throw new Error('엑셀 데이터가 아직 저장되지 않았습니다. 먼저 파일을 업로드하세요.');

      db.prepare('UPDATE app_settings SET kit_sheet = ?, kit_start_row = ?, kit_end_row = ?, kit_date_col = ? WHERE id = 1').run(sheet, startRow, endRow, dateCol);

      const insertKit = db.prepare("INSERT INTO water_quality (date, location, tn, tp, cod, ss) VALUES (?, '기본', ?, ?, ?, ?) ON CONFLICT(date, location) DO UPDATE SET tn = COALESCE(excluded.tn, tn), tp = COALESCE(excluded.tp, tp), cod = COALESCE(excluded.cod, cod), ss = COALESCE(excluded.ss, ss)");
      const importedData = [];

      db.transaction(() => {
        for (let r = startRow; r <= endRow; r++) {
          const dateStr = getCellValue(db, sheet, r, dateCol);
          const formatted = formatDate(dateStr) || dateStr;
          if (!formatted) { importProgress.current++; continue; }
          const getVal = (mKey) => { const v = parseFloat(getCellValue(db, sheet, r, mapping[mKey] || '') || ''); return isNaN(v) ? 0 : Math.round(v * 10) / 10; };
          const kitData = { tn: getVal('T-N (총질소)'), tp: getVal('T-P (총인)'), cod: getVal('COD (화학적산소요구량)'), ss: getVal('SS (부유물질)') };
          insertKit.run(formatted, kitData.tn, kitData.tp, kitData.cod, kitData.ss);
          importedData.push({ date: formatted, ...kitData });
          importProgress.current++;
        }
      })();

      importProgress.status = 'completed';
      importProgress.result = importedData;
      res.json({ success: true, message: '키트 데이터 임포트 완료', count: importedData.length });
    } catch (e) {
      console.error('Kit mapping error:', e);
      importProgress.status = 'error';
      importProgress.result = e.message;
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ── 약품 매핑 저장 + DB에서 임포트 ──
  // mapping 키 형식: "약품명_purchase", "약품명_usage", "약품명_inventory"
  router.post('/api/settings/save-medicine-mapping', (req, res) => {
    const { config, mapping } = req.body;
    const { sheet, startRow, endRow, dateCol } = config;
    importProgress = { current: 0, total: endRow - startRow + 1, status: 'processing', result: null };
    try {
      if (!hasStoredData(db)) throw new Error('엑셀 데이터가 아직 저장되지 않았습니다. 먼저 파일을 업로드하세요.');

      db.prepare('UPDATE app_settings SET med_sheet = ?, med_start_row = ?, med_end_row = ?, med_date_col = ? WHERE id = 1').run(sheet, startRow, endRow, dateCol);
      const upsertStmt = db.prepare("INSERT INTO config_items (category, item_name, excel_cell, is_active, display_order) VALUES ('medicine', ?, ?, 1, 0) ON CONFLICT(category, item_name) DO UPDATE SET excel_cell = excluded.excel_cell");
      Object.entries(mapping).forEach(([key, col]) => upsertStmt.run(key, col));

      const medicines = {};
      Object.keys(mapping).forEach(key => {
        const lastUnderscore = key.lastIndexOf('_');
        if (lastUnderscore === -1) return;
        const name = key.substring(0, lastUnderscore);
        const field = key.substring(lastUnderscore + 1);
        if (!medicines[name]) medicines[name] = {};
        medicines[name][field] = mapping[key];
      });

      const insertMed = db.prepare('INSERT INTO medicine_logs (medicine_name, date, purchase_amount, usage_amount, current_inventory) VALUES (?, ?, ?, ?, ?) ON CONFLICT(medicine_name, date) DO UPDATE SET purchase_amount = excluded.purchase_amount, usage_amount = excluded.usage_amount, current_inventory = excluded.current_inventory');
      const importedData = [];

      db.transaction(() => {
        for (let r = startRow; r <= endRow; r++) {
          const dateStr = getCellValue(db, sheet, r, dateCol);
          const formatted = formatDate(dateStr) || dateStr;
          if (!formatted) { importProgress.current++; continue; }
          const rowResults = { date: formatted };
          Object.entries(medicines).forEach(([medName, cols]) => {
            const rawP = parseFloat(getCellValue(db, sheet, r, cols.purchase || '') || '');
            const rawU = parseFloat(getCellValue(db, sheet, r, cols.usage || '') || '');
            const rawI = parseFloat(getCellValue(db, sheet, r, cols.inventory || '') || '');
            const purchase = isNaN(rawP) ? 0 : Math.round(rawP * 10) / 10;
            const usage = isNaN(rawU) ? 0 : Math.round(rawU * 10) / 10;
            const inventory = isNaN(rawI) ? 0 : Math.round(rawI * 10) / 10;
            if (purchase || usage || inventory) {
              insertMed.run(medName, formatted, purchase, usage, inventory);
              rowResults[`${medName}_구매`] = purchase;
              rowResults[`${medName}_사용`] = usage;
              rowResults[`${medName}_재고`] = inventory;
            }
          });
          importedData.push(rowResults);
          importProgress.current++;
        }
      })();

      importProgress.status = 'completed';
      importProgress.result = importedData;
      res.json({ success: true, message: '약품 데이터 임포트 완료', count: importedData.length });
    } catch (e) {
      console.error('Medicine mapping error:', e);
      importProgress.status = 'error';
      importProgress.result = e.message;
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ── 파일 업로드 (엑셀 원본 → 즉시 파싱 → DB 저장) ──
  router.post('/api/settings/upload', reportUpload.fields([
    { name: 'excel_original', maxCount: 1 },
    { name: 'report_templates' }
  ]), async (req, res) => {
    try {
      const files = req.files;
      let result = { originalPath: null, sheets: [] };

      if (files['excel_original']) {
        const original = files['excel_original'][0];
        const originalPath = `templates/reports/${original.filename}`;
        db.prepare('UPDATE app_settings SET excel_template_path = ? WHERE id = 1').run(originalPath);

        const filePath = path.join(baseDir, originalPath);
        const sheets = await parseAndStoreExcel(db, filePath);
        result.originalPath = originalPath;
        result.sheets = sheets;
      }

      res.json({ success: true, message: '파일 업로드 및 데이터 저장 완료', ...result });
    } catch (err) {
      console.error('Upload error:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  });

  return router;
};
