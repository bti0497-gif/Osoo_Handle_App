const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getCurrentRecordMetadata } = require('../services/syncMetadataService.cjs');
const { parseAndStoreExcel, getStoredSheets, getStoredRow, getCellValue, hasStoredData, formatDate } = require('../services/excelService.cjs');
const { normalizeBaseUrl, invalidateQntechSessionCache } = require('../services/qntechAuthService.cjs');
const { getCustomReportTemplatesDir, listReportTemplates, syncBundledTemplatesToAppData } = require('../services/reportTemplateService.cjs');
const router = express.Router();

let importProgress = { current: 0, total: 0, status: 'idle', result: null };

module.exports = function (db, baseDir, appDataPath) {
  const reportsDir = getCustomReportTemplatesDir(appDataPath);
  const excelOriginalsDir = path.join(appDataPath, 'templates', 'excel-originals');
  if (!fs.existsSync(excelOriginalsDir)) fs.mkdirSync(excelOriginalsDir, { recursive: true });
  syncBundledTemplatesToAppData(baseDir, appDataPath);

  const reportStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, file.fieldname === 'excel_original' ? excelOriginalsDir : reportsDir),
    filename: (req, file, cb) => {
      try { cb(null, Buffer.from(file.originalname, 'latin1').toString('utf8')); }
      catch (e) { cb(null, file.originalname); }
    }
  });
  const reportUpload = multer({ storage: reportStorage });

  // ── 설정 조회 ──
  router.get('/api/settings', (req, res) => {
    try {
      const reportTemplates = listReportTemplates(baseDir, appDataPath);
      const settings = db.prepare('SELECT * FROM app_settings WHERE id = 1').get();
      const configItems = db.prepare('SELECT * FROM config_items ORDER BY category, display_order').all();
      const credentials = db.prepare('SELECT service_key, service_name, service_url, user_id, password, updated_at FROM web_app_credentials ORDER BY id').all();
      res.json({ success: true, settings, configItems, credentials, reportTemplates });
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

  router.post('/api/settings/web-app-credentials', (req, res) => {
    const { serviceKey, serviceUrl, userId, password } = req.body || {};
    if (!serviceKey) {
      return res.status(400).json({ success: false, message: 'serviceKey가 필요합니다.' });
    }

    try {
      const normalizedServiceUrl = serviceKey === 'water_analysis_app'
        ? normalizeBaseUrl(serviceUrl || '')
        : (serviceUrl || '');

      const result = db.prepare('UPDATE web_app_credentials SET service_url = ?, user_id = ?, password = ?, updated_at = CURRENT_TIMESTAMP WHERE service_key = ?').run(normalizedServiceUrl, userId || '', password || '', serviceKey);
      if (result.changes === 0) {
        return res.status(404).json({ success: false, message: '대상 설정을 찾을 수 없습니다.' });
      }

      if (serviceKey === 'water_analysis_app') {
        invalidateQntechSessionCache('water_analysis_app credentials updated');
      }

      const credential = db.prepare('SELECT service_key, service_name, service_url, user_id, password, updated_at FROM web_app_credentials WHERE service_key = ?').get(serviceKey);
      res.json({ success: true, credential, message: '웹/앱 설정이 저장되었습니다.' });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  router.post('/api/settings/qntech-import-settings', (req, res) => {
    const { photoRoot, sampleMappings } = req.body || {};

    try {
      const serializedMappings = JSON.stringify(Array.isArray(sampleMappings) ? sampleMappings : []);
      db.prepare(`
        UPDATE app_settings
        SET qntech_photo_root = ?, qntech_sample_mappings = ?
        WHERE id = 1
      `).run(photoRoot || '사진관리/수질분석', serializedMappings);

      const settings = db.prepare('SELECT qntech_photo_root, qntech_sample_mappings FROM app_settings WHERE id = 1').get();
      res.json({ success: true, settings, message: 'QnTECH 불러오기 설정이 저장되었습니다.' });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
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

      console.log('[FlowMapping] Received mapping:', JSON.stringify(mapping, null, 2));

      db.prepare('UPDATE app_settings SET flow_sheet = ?, flow_start_row = ?, flow_end_row = ?, flow_date_col = ? WHERE id = 1').run(sheet, startRow, endRow, dateCol);

      // config_items에 _raw/_flow 접미사가 있는 매핑만 저장 (기본 항목 키는 별도 관리되므로 제외)
      const upsertStmt = db.prepare("INSERT INTO config_items (category, item_name, excel_cell, is_active, display_order) VALUES ('flow', ?, ?, 1, 0) ON CONFLICT(category, item_name) DO UPDATE SET excel_cell = excluded.excel_cell");
      Object.entries(mapping).forEach(([name, col]) => {
        if (name.endsWith('_raw') || name.endsWith('_flow')) {
          console.log(`[FlowMapping] Saving config: ${name} -> ${col}`);
          upsertStmt.run(name, col);
        }
      });

      // 기존 flow_readings 전체 삭제 후 재임포트
      db.prepare('DELETE FROM flow_readings').run();
      console.log('[FlowMapping] Cleared all flow_readings for clean re-import');

      const insertReading = db.prepare('INSERT INTO flow_readings (date, type, raw_value, calculated_flow) VALUES (?, ?, ?, ?) ON CONFLICT(date, type) DO UPDATE SET raw_value = COALESCE(excluded.raw_value, raw_value), calculated_flow = COALESCE(excluded.calculated_flow, calculated_flow)');
      const importedData = [];

      // mapping에서 _raw/_flow 키만 파싱하여 유량계별 컬럼 매핑 구성
      const flows = {};
      Object.keys(mapping).forEach(key => {
        if (!key.endsWith('_raw') && !key.endsWith('_flow')) return; // 기본 항목 키 무시
        const lastUnderscore = key.lastIndexOf('_');
        const name = key.substring(0, lastUnderscore);
        const field = key.substring(lastUnderscore + 1); // 'raw' or 'flow'
        if (!flows[name]) flows[name] = {};
        flows[name][field] = mapping[key];
      });

      console.log('[FlowMapping] Parsed flow types:', JSON.stringify(flows, null, 2));

      let debugRow = startRow; // 첫 행 디버그 출력용
      db.transaction(() => {
        for (let r = startRow; r <= endRow; r++) {
          const dateStr = getCellValue(db, sheet, r, dateCol);
          const formatted = formatDate(dateStr) || dateStr;
          if (!formatted) { importProgress.current++; continue; }
          const rowResults = { date: formatted };
          Object.entries(flows).forEach(([itemName, cols]) => {
            const rawCellVal = getCellValue(db, sheet, r, cols.raw || '');
            const flowCellVal = getCellValue(db, sheet, r, cols.flow || '');
            const rawR = parseFloat(rawCellVal || '');
            const rawF = parseFloat(flowCellVal || '');
            const rawValue = isNaN(rawR) ? null : Math.round(rawR * 10) / 10;
            const calcFlow = isNaN(rawF) ? null : Math.round(rawF * 10) / 10;

            if (r === debugRow) {
              console.log(`[FlowMapping] Row ${r} (${formatted}): ${itemName} => raw col=${cols.raw}(${rawCellVal}→${rawValue}), flow col=${cols.flow}(${flowCellVal}→${calcFlow})`);
            }

            if (rawValue !== null || calcFlow !== null) {
              insertReading.run(formatted, itemName, rawValue, calcFlow);
              if (rawValue !== null) rowResults[`${itemName}_적산`] = rawValue;
              if (calcFlow !== null) rowResults[`${itemName}_누계`] = calcFlow;
            }
          });
          if (Object.keys(rowResults).length > 1) importedData.push(rowResults);
          importProgress.current++;
        }
      })();

      importProgress.status = 'completed';
      importProgress.result = importedData;
      console.log(`[FlowMapping] Import completed: ${importedData.length} rows`);
      res.json({ success: true, message: '유량 데이터 임포트 완료', count: importedData.length });
    } catch (e) {
      console.error('Flow mapping error:', e);
      importProgress.status = 'error';
      importProgress.result = e.message;
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ── 키트 매핑 저장 + DB에서 임포트 ──
  // mapping 키 형식: "키트명_purchase", "키트명_usage", "키트명_inventory"
  router.post('/api/settings/save-kit-mapping', (req, res) => {
    const { config, mapping } = req.body;
    const { sheet, startRow, endRow, dateCol } = config;
    importProgress = { current: 0, total: endRow - startRow + 1, status: 'processing', result: null };
    try {
      if (!hasStoredData(db)) throw new Error('엑셀 데이터가 아직 저장되지 않았습니다. 먼저 파일을 업로드하세요.');

      db.prepare('UPDATE app_settings SET kit_sheet = ?, kit_start_row = ?, kit_end_row = ?, kit_date_col = ? WHERE id = 1').run(sheet, startRow, endRow, dateCol);

      const upsertStmt = db.prepare("INSERT INTO config_items (category, item_name, excel_cell, is_active, display_order) VALUES ('kit', ?, ?, 1, 0) ON CONFLICT(category, item_name) DO UPDATE SET excel_cell = excluded.excel_cell");
      Object.entries(mapping).forEach(([key, col]) => upsertStmt.run(key, col));

      // 키트명별 purchase/usage/inventory 열 그룹화
      const kits = {};
      Object.keys(mapping).forEach(key => {
        const lastUnderscore = key.lastIndexOf('_');
        if (lastUnderscore === -1) return;
        const name = key.substring(0, lastUnderscore);
        const field = key.substring(lastUnderscore + 1);
        if (!kits[name]) kits[name] = {};
        kits[name][field] = mapping[key];
      });

      const insertKit = db.prepare('INSERT INTO kit_logs (kit_name, date, purchase_amount, usage_amount, current_inventory) VALUES (?, ?, ?, ?, ?) ON CONFLICT(kit_name, date) DO UPDATE SET purchase_amount = excluded.purchase_amount, usage_amount = excluded.usage_amount, current_inventory = excluded.current_inventory');
      const importedData = [];

      db.transaction(() => {
        for (let r = startRow; r <= endRow; r++) {
          const dateStr = getCellValue(db, sheet, r, dateCol);
          const formatted = formatDate(dateStr) || dateStr;
          if (!formatted) { importProgress.current++; continue; }
          const rowResults = { date: formatted };
          Object.entries(kits).forEach(([kitName, cols]) => {
            const rawP = parseFloat(getCellValue(db, sheet, r, cols.purchase || '') || '');
            const rawU = parseFloat(getCellValue(db, sheet, r, cols.usage || '') || '');
            const rawI = parseFloat(getCellValue(db, sheet, r, cols.inventory || '') || '');
            const purchase = isNaN(rawP) ? 0 : Math.round(rawP * 10) / 10;
            const usage = isNaN(rawU) ? 0 : Math.round(rawU * 10) / 10;
            const inventory = isNaN(rawI) ? 0 : Math.round(rawI * 10) / 10;
            if (purchase || usage || inventory) {
              insertKit.run(kitName, formatted, purchase, usage, inventory);
              rowResults[`${kitName}_구매`] = purchase;
              rowResults[`${kitName}_사용`] = usage;
              rowResults[`${kitName}_재고`] = inventory;
            }
          });
          importedData.push(rowResults);
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

  // ── 수질 매핑 저장 + DB에서 임포트 ──
  router.post('/api/settings/save-water-mapping', (req, res) => {
    const { config, mapping } = req.body;
    const { sheet, startRow, endRow, dateCol } = config;
    importProgress = { current: 0, total: endRow - startRow + 1, status: 'processing', result: null };
    try {
      if (!hasStoredData(db)) throw new Error('엑셀 데이터가 아직 저장되지 않았습니다. 먼저 파일을 업로드하세요.');

      db.prepare('UPDATE app_settings SET water_sheet = ?, water_start_row = ?, water_end_row = ?, water_date_col = ? WHERE id = 1').run(sheet, startRow, endRow, dateCol);

      // 매핑 정보는 'water_mapping' 카테고리에 저장하여 기본 항목('water')과 분리
      const upsertStmt = db.prepare("INSERT INTO config_items (category, item_name, excel_cell, is_active, display_order) VALUES ('water_mapping', ?, ?, 1, 0) ON CONFLICT(category, item_name) DO UPDATE SET excel_cell = excluded.excel_cell");
      Object.entries(mapping).forEach(([key, col]) => {
        if (key !== 'date') {
          upsertStmt.run(key, col);
        }
      });

      // mapping: { "암모니아성질소_유량조정조": "C", ... }
      const baseParams = { '암모니아성질소': 'nh3_n', '질산성질소': 'no3_n', '인산염인': 'po4_p', '알칼리도': 'alkalinity' };

      // 그룹화 기준: location name
      const locations = {};
      Object.entries(mapping).forEach(([key, col]) => {
        if (key === 'date') return;

        const lastUnderscore = key.lastIndexOf('_');
        if (lastUnderscore === -1) return;

        const paramName = key.substring(0, lastUnderscore);
        const locName = key.substring(lastUnderscore + 1);

        if (baseParams[paramName]) {
          if (!locations[locName]) locations[locName] = {};
          locations[locName][baseParams[paramName]] = col;
        }
      });

      const insertWater = db.prepare(`
        INSERT INTO water_quality (
          date, location, nh3_n, no3_n, po4_p, alkalinity, tn, tp, cod, ss,
          site_name, author, created_at, last_modified, is_synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) 
        ON CONFLICT(date, location) DO UPDATE SET 
          nh3_n = excluded.nh3_n, no3_n = excluded.no3_n, 
          po4_p = excluded.po4_p, alkalinity = excluded.alkalinity,
          site_name = excluded.site_name,
          author = excluded.author,
          last_modified = excluded.last_modified,
          is_synced = excluded.is_synced
      `);

      const importedData = [];

      db.transaction(() => {
        const metadata = getCurrentRecordMetadata(db);
        for (let r = startRow; r <= endRow; r++) {
          const dateStr = getCellValue(db, sheet, r, dateCol);
          const formatted = formatDate(dateStr) || dateStr;
          if (!formatted) { importProgress.current++; continue; }

          const rowResults = { date: formatted };

          // Default location if no locations are mapped (fallback to '기본')
          if (Object.keys(locations).length === 0) {
            insertWater.run(formatted, '기본', null, null, null, null, null, null, null, null, metadata.siteName, metadata.author, metadata.createdAt, metadata.lastModified, metadata.isSynced);
            importedData.push({ date: formatted, location: '기본' });
          } else {
            Object.entries(locations).forEach(([locName, cols]) => {
              const vals = { nh3_n: null, no3_n: null, po4_p: null, alkalinity: null };
              ['nh3_n', 'no3_n', 'po4_p', 'alkalinity'].forEach(dbCol => {
                const col = cols[dbCol];
                if (col) {
                  const v = parseFloat(getCellValue(db, sheet, r, col) || '');
                  vals[dbCol] = isNaN(v) ? null : Math.round(v * 10) / 10;
                }
              });

              // tn, tp, cod, ss는 키트 분석 항목이 아니므로 null로 저장
              insertWater.run(formatted, locName, vals.nh3_n, vals.no3_n, vals.po4_p, vals.alkalinity, null, null, null, null, metadata.siteName, metadata.author, metadata.createdAt, metadata.lastModified, metadata.isSynced);

              rowResults[`${locName}_nh3_n`] = vals.nh3_n;
            });
            importedData.push(rowResults);
          }
          importProgress.current++;
        }
      })();

      importProgress.status = 'completed';
      importProgress.result = importedData;
      res.json({ success: true, message: '수질 데이터 임포트 완료', count: importedData.length });
    } catch (e) {
      console.error('Water mapping error:', e);
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
        const originalPath = `appdata/templates/excel-originals/${original.filename}`;
        db.prepare('UPDATE app_settings SET excel_template_path = ? WHERE id = 1').run(originalPath);

        const filePath = path.join(excelOriginalsDir, original.filename);
        const sheets = await parseAndStoreExcel(db, filePath);
        result.originalPath = originalPath;
        result.sheets = sheets;
      }

      result.reportTemplates = listReportTemplates(baseDir, appDataPath);

      res.json({ success: true, message: '파일 업로드 및 데이터 저장 완료', ...result });
    } catch (err) {
      console.error('Upload error:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  });

  return router;
};
