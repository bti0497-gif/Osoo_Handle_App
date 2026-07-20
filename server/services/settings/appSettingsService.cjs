const fs = require('fs');
const path = require('path');
const { getStoredSheets, hasStoredData, readExcelRow } = require('../excelService.cjs');
const { isDriveConfigured, getDriveRootFolderId, getOrCreateFolder } = require('../driveService.cjs');
const { DRIVE_CATEGORY } = require('../drivePathService.cjs');
const { listReportTemplates } = require('../reportTemplateService.cjs');

const DEFAULT_SITE_SUBFOLDERS = [
  '게시판첨부파일',
  '약품입고일지_사진',
  '슬러지사진대장_사진',
  '수질분석_데이타불러오기_사진',
  '성적서',
];

function getSettingsOverview(db, baseDir, appDataPath) {
  const settings = db.prepare(`
    SELECT
      app_settings.*,
      sites.target_lat,
      sites.target_lng,
      sites.radius_m
    FROM app_settings
    LEFT JOIN sites ON sites.id = app_settings.site_id
    WHERE app_settings.id = 1
  `).get();
  const sludgeExportSettings = db.prepare('SELECT company_name, default_amount FROM sludge_export_settings WHERE id = 1').get();
  const configItems = db.prepare('SELECT * FROM config_items ORDER BY category, display_order').all();
  const credentials = db.prepare('SELECT service_key, service_name, service_url, user_id, password, updated_at FROM web_app_credentials ORDER BY id').all();
  const reportTemplates = listReportTemplates(baseDir, appDataPath);

  return { settings, sludgeExportSettings, configItems, credentials, reportTemplates };
}

async function saveSettings(db, payload, siteStorageRoot) {
  const { settings, configItems } = payload || {};
  if (!settings) {
    const error = new Error('settings가 필요합니다');
    error.statusCode = 400;
    throw error;
  }

  const items = Array.isArray(configItems) ? configItems : [];
  const updateTransaction = db.transaction((s, configRows) => {
    db.prepare(`
      UPDATE app_settings
      SET site_id = COALESCE(NULLIF(?, ''), site_id),
          site_name = ?,
          manager_name = ?,
          method = ?,
          series = ?
      WHERE id = 1
    `).run(
      s.siteId || s.site_id || '',
      s.siteName,
      s.managerName,
      s.method,
      s.series
    );

    const updateConfig = db.prepare('UPDATE config_items SET is_active = ?, display_order = ? WHERE category = ? AND item_name = ?');
    const insertConfig = db.prepare('INSERT OR IGNORE INTO config_items (category, item_name, is_active, display_order) VALUES (?, ?, ?, ?)');
    const deleteConfig = db.prepare('DELETE FROM config_items WHERE category = ? AND item_name = ?');
    configRows.forEach((item, idx) => {
      const result = updateConfig.run(item.checked ? 1 : 0, idx, item.category, item.name);
      if (result.changes === 0) insertConfig.run(item.category, item.name, item.checked ? 1 : 0, idx);
    });

    const flowNames = new Set(configRows.filter((item) => item.category === 'flow').map((item) => item.name));
    db.prepare("SELECT item_name FROM config_items WHERE category = 'flow' AND item_name NOT LIKE '%\\_raw' ESCAPE '\\' AND item_name NOT LIKE '%\\_flow' ESCAPE '\\'")
      .all()
      .forEach((row) => {
        if (!flowNames.has(row.item_name)) deleteConfig.run('flow', row.item_name);
      });

    const savedSeries = String(s.series || '').trim() || '1계열';
    if (savedSeries === '2계열') {
      db.prepare(`
        UPDATE app_settings SET flow_option = CASE
          WHEN flow_option IS NULL OR TRIM(flow_option) = '' THEN 'combined'
          ELSE flow_option
        END WHERE id = 1
      `).run();
    } else {
      db.prepare("UPDATE app_settings SET flow_option = 'single1' WHERE id = 1").run();
    }

    const persisted = db.prepare(`
      SELECT site_id, site_name, manager_name, method, series, flow_option
      FROM app_settings WHERE id = 1
    `).get();
    const expected = {
      site_id: String(s.siteId || s.site_id || persisted?.site_id || '').trim(),
      site_name: String(s.siteName || ''),
      manager_name: String(s.managerName || ''),
      method: String(s.method || ''),
      series: String(s.series || ''),
    };
    for (const [field, value] of Object.entries(expected)) {
      if (String(persisted?.[field] ?? '') !== value) {
        throw new Error(`설정 저장 검증 실패: ${field}`);
      }
    }
    const verifyConfig = db.prepare(`
      SELECT is_active, display_order FROM config_items
      WHERE category = ? AND item_name = ?
    `);
    configRows.forEach((item, idx) => {
      const row = verifyConfig.get(item.category, item.name);
      if (!row || Number(row.is_active) !== (item.checked ? 1 : 0) || Number(row.display_order) !== idx) {
        throw new Error(`설정 항목 저장 검증 실패: ${item.category}/${item.name}`);
      }
    });
    return persisted;
  });

  const savedSettings = updateTransaction(settings, items);
  try {
    const storage = await ensureSiteStorageFolders(db, settings, siteStorageRoot);
    return { ...storage, savedSettings };
  } catch (error) {
    console.warn('[Settings] 설정은 저장되었으나 보조 폴더 준비 실패:', error.message);
    return {
      savedSettings,
      storageWarning: `설정은 저장되었지만 보조 폴더를 준비하지 못했습니다: ${error.message}`,
    };
  }
}

async function ensureSiteStorageFolders(db, settings, siteStorageRoot) {
  let driveSiteFolder = null;
  const driveSubFolders = [];
  let localSiteFolder = null;
  const localSubFolders = [];

  const currentSiteId = db.prepare('SELECT site_id FROM app_settings WHERE id = 1').get()?.site_id || '';
  const folderNameBySite = String(settings.siteName || '').trim() || String(currentSiteId || '').trim();

  if (folderNameBySite) {
    const localSitePath = path.join(siteStorageRoot, folderNameBySite);
    fs.mkdirSync(localSitePath, { recursive: true });
    localSiteFolder = { name: folderNameBySite, path: localSitePath };

    for (const folderName of DEFAULT_SITE_SUBFOLDERS) {
      const childPath = path.join(localSitePath, folderName);
      fs.mkdirSync(childPath, { recursive: true });
      localSubFolders.push({ name: folderName, path: childPath });
    }
  }

  if (isDriveConfigured()) {
    try {
      if (folderNameBySite) {
        driveSiteFolder = await getOrCreateFolder(
          getDriveRootFolderId(),
          DRIVE_CATEGORY.MANAGEMENT_PHOTO
        );
      }
    } catch (driveErr) {
      console.error('[Settings] Drive 사이트/기본폴더 생성 실패:', driveErr.message);
    }
  }

  return {
    ...(localSiteFolder ? { localSiteFolder } : {}),
    ...(localSubFolders.length > 0 ? { localSubFolders } : {}),
    ...(driveSiteFolder ? { driveSiteFolder: { id: driveSiteFolder.id, name: driveSiteFolder.name, url: driveSiteFolder.webViewLink } } : {}),
    ...(driveSubFolders.length > 0 ? { driveSubFolders } : {}),
  };
}

function saveSiteLocation(db, targetLat, targetLng) {
  const lat = Number(targetLat);
  const lng = Number(targetLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const error = new Error('유효한 위도/경도 값이 필요합니다');
    error.statusCode = 400;
    throw error;
  }

  const current = db.prepare('SELECT site_id FROM app_settings WHERE id = 1').get();
  const siteId = String(current?.site_id || '').trim();
  if (!siteId) {
    const error = new Error('먼저 현장을 선택해야 위치를 저장할 수 있습니다.');
    error.statusCode = 400;
    throw error;
  }

  const result = db.prepare(`
    UPDATE sites
    SET target_lat = ?,
        target_lng = ?,
        radius_m = COALESCE(radius_m, 500),
        updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(lat, lng, siteId);

  if (result.changes === 0) {
    const error = new Error('선택된 현장을 로컬 DB에서 찾을 수 없습니다.');
    error.statusCode = 404;
    throw error;
  }

  const saved = db.prepare('SELECT target_lat, target_lng, radius_m FROM sites WHERE id = ?').get(siteId);
  return { targetLat: saved.target_lat, targetLng: saved.target_lng, radiusM: saved.radius_m };
}

function saveFlowOption(db, flowOption) {
  if (!flowOption) {
    const error = new Error('flowOption이 필요합니다');
    error.statusCode = 400;
    throw error;
  }

  db.prepare('UPDATE app_settings SET flow_option = ? WHERE id = 1').run(flowOption);
}

function addConfigItem(db, payload) {
  const { category, name } = payload || {};
  if (!category || !name) {
    const error = new Error('category와 name이 필요합니다');
    error.statusCode = 400;
    throw error;
  }

  const existing = db.prepare('SELECT id FROM config_items WHERE category = ? AND item_name = ?').get(category, name);
  if (existing) {
    const error = new Error('이미 존재하는 항목입니다');
    error.statusCode = 409;
    throw error;
  }

  const maxOrder = db.prepare('SELECT MAX(display_order) as mx FROM config_items WHERE category = ?').get(category);
  const order = (maxOrder?.mx ?? -1) + 1;
  db.prepare('INSERT INTO config_items (category, item_name, is_active, display_order) VALUES (?, ?, 1, ?)').run(category, name, order);
  return db.prepare('SELECT * FROM config_items WHERE category = ? AND item_name = ?').get(category, name);
}

function toggleConfigItem(db, payload) {
  const { category, name, isActive } = payload || {};
  if (!category || !name) {
    const error = new Error('category와 name이 필요합니다');
    error.statusCode = 400;
    throw error;
  }

  db.prepare('UPDATE config_items SET is_active = ? WHERE category = ? AND item_name = ?').run(isActive ? 1 : 0, category, name);
}

function getExcelStatus(db) {
  const settings = db.prepare('SELECT excel_template_path FROM app_settings WHERE id = 1').get();
  const fileName = settings?.excel_template_path?.split(/[\/\\]/).pop() || null;

  if (!hasStoredData(db)) {
    if (!fileName) return { status: 'not-set', fileName: null, sheets: [] };
    return { status: 'not-imported', fileName, sheets: [] };
  }

  const sheets = getStoredSheets(db);
  return {
    status: 'ready',
    fileName,
    sheets: sheets.map((sheet) => sheet.sheet_name),
    sheetInfo: sheets,
  };
}

async function getExcelPreview(db, appDataPath, payload) {
  const { sheet, row } = payload || {};
  if (!hasStoredData(db)) {
    return { success: false, message: '엑셀 데이터가 아직 준비되지 않았습니다' };
  }

  const data = await readExcelRow(db, appDataPath, sheet, row);
  return { success: true, data };
}

module.exports = {
  getSettingsOverview,
  saveSettings,
  saveSiteLocation,
  saveFlowOption,
  addConfigItem,
  toggleConfigItem,
  getExcelStatus,
  getExcelPreview,
};
