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

function getSettingsOverview(db, baseDir, appDataPath, requestedSiteId = '') {
  const legacySettings = db.prepare(`
    SELECT
      app_settings.*,
      sites.target_lat,
      sites.target_lng,
      sites.radius_m
    FROM app_settings
    LEFT JOIN sites ON sites.id = app_settings.site_id
    WHERE app_settings.id = 1
  `).get();
  const siteId = String(requestedSiteId || legacySettings?.site_id || '').trim();
  const site = siteId
    ? db.prepare('SELECT id, site_name, manager_name, method, series, target_lat, target_lng, radius_m FROM sites WHERE id = ?').get(siteId)
    : null;
  const siteSettings = siteId
    ? db.prepare('SELECT * FROM site_settings WHERE site_id = ?').get(siteId)
    : null;
  const settings = {
    ...legacySettings,
    ...(siteSettings || {}),
    ...(site ? {
      site_id: site.id,
      site_name: site.site_name,
      manager_name: site.manager_name,
      method: site.method,
      series: site.series,
      target_lat: site.target_lat,
      target_lng: site.target_lng,
      radius_m: site.radius_m,
    } : {}),
  };
  const sludgeExportSettings = siteId
    ? db.prepare('SELECT company_name, default_amount FROM site_sludge_export_settings WHERE site_id = ?').get(siteId)
    : db.prepare('SELECT company_name, default_amount FROM sludge_export_settings WHERE id = 1').get();
  const configItems = siteId
    ? db.prepare('SELECT * FROM site_config_items WHERE site_id = ? ORDER BY category, display_order').all(siteId)
    : db.prepare('SELECT * FROM config_items ORDER BY category, display_order').all();
  const credentials = db.prepare('SELECT service_key, service_name, service_url, user_id, password, updated_at FROM web_app_credentials ORDER BY id').all();
  const reportTemplates = listReportTemplates(baseDir, appDataPath);

  return { settings, sludgeExportSettings, configItems, credentials, reportTemplates };
}

async function saveSettings(db, payload, siteStorageRoot, requestedSiteId = '') {
  const { settings, configItems } = payload || {};
  if (!settings) {
    const error = new Error('settings가 필요합니다');
    error.statusCode = 400;
    throw error;
  }

  const items = Array.isArray(configItems) ? configItems : [];
  const updateTransaction = db.transaction((s, configRows) => {
    const siteId = String(requestedSiteId || s.siteId || s.site_id || '').trim();
    if (!siteId) throw new Error('설정을 저장할 현장이 선택되지 않았습니다.');

    db.prepare(`
      INSERT INTO sites (id, site_name, manager_name, method, series, is_active, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, datetime('now', 'localtime'))
      ON CONFLICT(id) DO UPDATE SET
        site_name = excluded.site_name,
        manager_name = excluded.manager_name,
        method = excluded.method,
        series = excluded.series,
        updated_at = excluded.updated_at
    `).run(
      siteId,
      s.siteName,
      s.managerName,
      s.method,
      s.series
    );
    const legacySiteId = String(db.prepare('SELECT site_id FROM app_settings WHERE id = 1').get()?.site_id || '').trim();
    const shouldMirrorLegacy = !legacySiteId || legacySiteId === siteId;
    if (shouldMirrorLegacy) {
      db.prepare(`
        UPDATE app_settings
        SET site_id = ?, site_name = ?, manager_name = ?, method = ?, series = ?
        WHERE id = 1
      `).run(siteId, s.siteName, s.managerName, s.method, s.series);
    }

    const updateConfig = db.prepare('UPDATE site_config_items SET is_active = ?, display_order = ?, updated_at = datetime(\'now\', \'localtime\') WHERE site_id = ? AND category = ? AND item_name = ?');
    const insertConfig = db.prepare('INSERT OR IGNORE INTO site_config_items (site_id, category, item_name, is_active, display_order) VALUES (?, ?, ?, ?, ?)');
    const deleteConfig = db.prepare('DELETE FROM site_config_items WHERE site_id = ? AND category = ? AND item_name = ?');
    const upsertLegacyConfig = db.prepare(`
      INSERT INTO config_items (category, item_name, is_active, display_order)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(category, item_name) DO UPDATE SET
        is_active = excluded.is_active,
        display_order = excluded.display_order
    `);
    const deleteLegacyConfig = db.prepare('DELETE FROM config_items WHERE category = ? AND item_name = ?');
    configRows.forEach((item, idx) => {
      const result = updateConfig.run(item.checked ? 1 : 0, idx, siteId, item.category, item.name);
      if (result.changes === 0) insertConfig.run(siteId, item.category, item.name, item.checked ? 1 : 0, idx);
      if (shouldMirrorLegacy) upsertLegacyConfig.run(item.category, item.name, item.checked ? 1 : 0, idx);
    });

    const flowNames = new Set(configRows.filter((item) => item.category === 'flow').map((item) => item.name));
    db.prepare("SELECT item_name FROM site_config_items WHERE site_id = ? AND category = 'flow' AND item_name NOT LIKE '%\\_raw' ESCAPE '\\' AND item_name NOT LIKE '%\\_flow' ESCAPE '\\'")
      .all(siteId)
      .forEach((row) => {
        if (!flowNames.has(row.item_name)) {
          deleteConfig.run(siteId, 'flow', row.item_name);
          if (shouldMirrorLegacy) deleteLegacyConfig.run('flow', row.item_name);
        }
      });

    const savedSeries = String(s.series || '').trim() || '1계열';
    db.prepare(`
      INSERT INTO site_settings (site_id, flow_option, updated_at)
      VALUES (?, ?, datetime('now', 'localtime'))
      ON CONFLICT(site_id) DO UPDATE SET
        flow_option = CASE
          WHEN ? = '2계열' THEN COALESCE(NULLIF(site_settings.flow_option, ''), 'combined')
          ELSE 'single1'
        END,
        updated_at = excluded.updated_at
    `).run(siteId, savedSeries === '2계열' ? 'combined' : 'single1', savedSeries);

    const persisted = db.prepare(`
      SELECT s.id AS site_id, s.site_name, s.manager_name, s.method, s.series, ss.flow_option
      FROM sites s LEFT JOIN site_settings ss ON ss.site_id = s.id
      WHERE s.id = ?
    `).get(siteId);
    if (shouldMirrorLegacy) {
      db.prepare('UPDATE app_settings SET flow_option = ? WHERE id = 1')
        .run(persisted?.flow_option || 'single1');
    }
    const expected = {
      site_id: siteId,
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
    const verifySiteConfig = db.prepare(`
      SELECT is_active, display_order FROM site_config_items
      WHERE site_id = ? AND category = ? AND item_name = ?
    `);
    configRows.forEach((item, idx) => {
      const row = verifySiteConfig.get(siteId, item.category, item.name);
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

function splitDirectionalSiteName(siteName) {
  const normalized = String(siteName || '').replace(/\s+/g, ' ').trim();
  const directionMatch = normalized.match(/([가-힣A-Za-z0-9]+방향)/);
  const direction = directionMatch?.[1] || '';
  const baseName = normalized
    .replace(/[([][^)\]]*방향[^)\]]*[)\]]/g, '')
    .replace(direction, '')
    .replace(/\s+/g, '')
    .trim();
  return { baseName, direction };
}

function findOppositeSite(db, currentSiteId) {
  const current = db.prepare(`
    SELECT id, site_name FROM sites
    WHERE id = ? AND COALESCE(is_active, 1) = 1
  `).get(currentSiteId);
  if (!current) return null;

  const currentName = splitDirectionalSiteName(current.site_name);
  if (!currentName.baseName || !currentName.direction) return null;

  const candidates = db.prepare(`
    SELECT id, site_name FROM sites
    WHERE id <> ? AND COALESCE(is_active, 1) = 1
  `).all(currentSiteId).filter((site) => {
    const parsed = splitDirectionalSiteName(site.site_name);
    return parsed.baseName === currentName.baseName
      && parsed.direction
      && parsed.direction !== currentName.direction;
  });

  return candidates.length === 1 ? candidates[0] : null;
}

function saveMultiSiteMode(db, enabled) {
  const normalizedEnabled = enabled === true || enabled === 1 || enabled === '1';
  const saveTransaction = db.transaction(() => {
    const current = db.prepare(`
      SELECT site_id, multi_site_enabled, primary_site_id, secondary_site_id
      FROM app_settings
      WHERE id = 1
    `).get();
    const currentSiteId = String(current?.site_id || '').trim();

    if (normalizedEnabled && !currentSiteId) {
      const error = new Error('양방향 통합관리를 사용하려면 먼저 기본 현장을 저장해야 합니다.');
      error.statusCode = 400;
      throw error;
    }
    const oppositeSite = normalizedEnabled ? findOppositeSite(db, currentSiteId) : null;
    if (normalizedEnabled && !oppositeSite) {
      const error = new Error('\uD604\uC7AC \uD604\uC7A5\uACFC \uC9DD\uC774 \uB418\uB294 \uBC18\uB300\uBC29\uD5A5 \uD604\uC7A5\uC744 \uC720\uC77C\uD558\uAC8C \uD655\uC815\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uD604\uC7A5 \uBAA9\uB85D\uC758 \uC774\uB984\uACFC \uBC29\uD5A5\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.');
      error.statusCode = 409;
      throw error;
    }
    if (normalizedEnabled && oppositeSite) {
      db.prepare(`
        INSERT INTO site_settings (
          site_id, excel_template_path,
          flow_sheet, flow_start_row, flow_end_row, flow_date_col,
          med_sheet, med_start_row, med_end_row, med_date_col,
          water_sheet, water_start_row, water_end_row, water_date_col,
          kit_sheet, kit_start_row, kit_end_row, kit_date_col,
          qntech_photo_root, qntech_sample_mappings, flow_option
        )
        SELECT ?, excel_template_path,
          flow_sheet, flow_start_row, flow_end_row, flow_date_col,
          med_sheet, med_start_row, med_end_row, med_date_col,
          water_sheet, water_start_row, water_end_row, water_date_col,
          kit_sheet, kit_start_row, kit_end_row, kit_date_col,
          qntech_photo_root, qntech_sample_mappings, flow_option
        FROM site_settings
        WHERE site_id = ?
          AND NOT EXISTS (SELECT 1 FROM site_settings WHERE site_id = ?)
      `).run(oppositeSite.id, currentSiteId, oppositeSite.id);
      db.prepare(`
        INSERT INTO site_config_items (
          site_id, category, item_name, is_active, display_order, excel_cell, default_amount
        )
        SELECT ?, category, item_name, is_active, display_order, excel_cell, default_amount
        FROM site_config_items
        WHERE site_id = ?
          AND NOT EXISTS (SELECT 1 FROM site_config_items WHERE site_id = ?)
      `).run(oppositeSite.id, currentSiteId, oppositeSite.id);
      db.prepare(`
        INSERT INTO site_sludge_export_settings (site_id, company_name, default_amount)
        SELECT ?, company_name, default_amount
        FROM site_sludge_export_settings
        WHERE site_id = ?
          AND NOT EXISTS (SELECT 1 FROM site_sludge_export_settings WHERE site_id = ?)
      `).run(oppositeSite.id, currentSiteId, oppositeSite.id);
    }

    db.prepare(`
      UPDATE app_settings
      SET multi_site_enabled = ?,
          primary_site_id = CASE
            WHEN ? = 1 THEN NULLIF(site_id, '')
            ELSE primary_site_id
          END,
          secondary_site_id = CASE
            WHEN ? = 1 THEN ?
            ELSE secondary_site_id
          END
      WHERE id = 1
    `).run(
      normalizedEnabled ? 1 : 0,
      normalizedEnabled ? 1 : 0,
      normalizedEnabled ? 1 : 0,
      oppositeSite?.id || null
    );

    const saved = db.prepare(`
      SELECT multi_site_enabled, primary_site_id, secondary_site_id
      FROM app_settings
      WHERE id = 1
    `).get();
    if (Number(saved?.multi_site_enabled || 0) !== (normalizedEnabled ? 1 : 0)) {
      throw new Error('양방향 통합관리 설정 저장 검증에 실패했습니다.');
    }
    if (normalizedEnabled && String(saved?.primary_site_id || '').trim() !== currentSiteId) {
      throw new Error('양방향 통합관리 기본 현장 저장 검증에 실패했습니다.');
    }
    if (normalizedEnabled && String(saved?.secondary_site_id || '').trim() !== String(oppositeSite?.id || '').trim()) {
      throw new Error('\uC591\uBC29\uD5A5 \uD1B5\uD569\uAD00\uB9AC \uBC18\uB300\uBC29\uD5A5 \uD604\uC7A5 \uC800\uC7A5 \uAC80\uC99D\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.');
    }

    return {
      enabled: Number(saved.multi_site_enabled) === 1,
      primarySiteId: String(saved.primary_site_id || '').trim(),
      secondarySiteId: String(saved.secondary_site_id || '').trim(),
      primarySiteName: normalizedEnabled
        ? db.prepare('SELECT site_name FROM sites WHERE id = ?').get(saved.primary_site_id)?.site_name || ''
        : '',
      secondarySiteName: normalizedEnabled
        ? db.prepare('SELECT site_name FROM sites WHERE id = ?').get(saved.secondary_site_id)?.site_name || ''
        : '',
    };
  });

  return saveTransaction();
}

function saveFlowOption(db, flowOption, requestedSiteId = '') {
  if (!flowOption) {
    const error = new Error('flowOption이 필요합니다');
    error.statusCode = 400;
    throw error;
  }

  const siteId = String(requestedSiteId || db.prepare('SELECT site_id FROM app_settings WHERE id = 1').get()?.site_id || '').trim();
  if (!siteId) throw new Error('흐름 매핑 설정을 저장할 현장이 선택되지 않았습니다.');
  db.prepare(`
    INSERT INTO site_settings (site_id, flow_option, updated_at)
    VALUES (?, ?, datetime('now', 'localtime'))
    ON CONFLICT(site_id) DO UPDATE SET flow_option = excluded.flow_option, updated_at = excluded.updated_at
  `).run(siteId, flowOption);
  const legacySiteId = String(db.prepare('SELECT site_id FROM app_settings WHERE id = 1').get()?.site_id || '').trim();
  if (legacySiteId === siteId) db.prepare('UPDATE app_settings SET flow_option = ? WHERE id = 1').run(flowOption);
}

function addConfigItem(db, payload, requestedSiteId = '') {
  const { category, name } = payload || {};
  if (!category || !name) {
    const error = new Error('category와 name이 필요합니다');
    error.statusCode = 400;
    throw error;
  }

  const siteId = String(requestedSiteId || '').trim();
  if (!siteId) throw new Error('설정 항목을 추가할 현장이 선택되지 않았습니다.');
  const existing = db.prepare('SELECT id FROM site_config_items WHERE site_id = ? AND category = ? AND item_name = ?').get(siteId, category, name);
  if (existing) {
    const error = new Error('이미 존재하는 항목입니다');
    error.statusCode = 409;
    throw error;
  }

  const maxOrder = db.prepare('SELECT MAX(display_order) as mx FROM site_config_items WHERE site_id = ? AND category = ?').get(siteId, category);
  const order = (maxOrder?.mx ?? -1) + 1;
  db.prepare('INSERT INTO site_config_items (site_id, category, item_name, is_active, display_order) VALUES (?, ?, ?, 1, ?)').run(siteId, category, name, order);
  return db.prepare('SELECT * FROM site_config_items WHERE site_id = ? AND category = ? AND item_name = ?').get(siteId, category, name);
}

function toggleConfigItem(db, payload, requestedSiteId = '') {
  const { category, name, isActive } = payload || {};
  if (!category || !name) {
    const error = new Error('category와 name이 필요합니다');
    error.statusCode = 400;
    throw error;
  }

  const siteId = String(requestedSiteId || '').trim();
  if (!siteId) throw new Error('설정 항목을 변경할 현장이 선택되지 않았습니다.');
  db.prepare('UPDATE site_config_items SET is_active = ?, updated_at = datetime(\'now\', \'localtime\') WHERE site_id = ? AND category = ? AND item_name = ?')
    .run(isActive ? 1 : 0, siteId, category, name);
}

function getExcelStatus(db, requestedSiteId = '') {
  const siteId = String(requestedSiteId || '').trim();
  const settings = siteId
    ? db.prepare('SELECT excel_template_path FROM site_settings WHERE site_id = ?').get(siteId)
    : db.prepare('SELECT excel_template_path FROM app_settings WHERE id = 1').get();
  const fileName = settings?.excel_template_path?.split(/[\/\\]/).pop() || null;

  if (!hasStoredData(db, siteId)) {
    if (!fileName) return { status: 'not-set', fileName: null, sheets: [] };
    return { status: 'not-imported', fileName, sheets: [] };
  }

  const sheets = getStoredSheets(db, siteId);
  return {
    status: 'ready',
    fileName,
    sheets: sheets.map((sheet) => sheet.sheet_name),
    sheetInfo: sheets,
  };
}

async function getExcelPreview(db, appDataPath, payload, requestedSiteId = '') {
  const { sheet, row } = payload || {};
  const siteId = String(requestedSiteId || '').trim();
  if (!hasStoredData(db, siteId)) {
    return { success: false, message: '엑셀 데이터가 아직 준비되지 않았습니다' };
  }

  const data = await readExcelRow(db, appDataPath, sheet, row, 52, siteId);
  return { success: true, data };
}

module.exports = {
  getSettingsOverview,
  saveSettings,
  saveSiteLocation,
  saveMultiSiteMode,
  saveFlowOption,
  addConfigItem,
  toggleConfigItem,
  getExcelStatus,
  getExcelPreview,
};
