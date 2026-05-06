const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getCurrentRecordMetadata } = require('../services/syncMetadataService.cjs');
const { ensureSiteMemberTables, upsertSiteMemberSnapshot } = require('../services/siteMemberBigQueryService.cjs');
const { parseAndStoreExcel, getStoredSheets, getStoredRow, getCellValue, hasStoredData, formatDate } = require('../services/excelService.cjs');
const { normalizeBaseUrl, invalidateQntechSessionCache } = require('../services/qntechAuthService.cjs');
const { isDriveConfigured, getDriveRootFolderId, getOrCreateFolder } = require('../services/driveService.cjs');
const { isSheetsConfigured: isSitesSheetsConfigured, getSites: getSitesFromSheets, upsertSite: upsertSiteToSheets, deleteSite: deleteSiteFromSheets } = require('../services/sitesSheetsService.cjs');
const { isSheetsConfigured: isMembersSheetsConfigured, upsertMember: upsertMemberToSheets } = require('../services/membersSheetsService.cjs');
const {
  ALLOWED_REPORT_TEMPLATE_NAMES,
  getCustomReportTemplatesDir,
  isAllowedReportTemplateName,
  listReportTemplates,
  syncBundledTemplatesToAppData,
} = require('../services/reportTemplateService.cjs');
const router = express.Router();

// 湲곕낯 ?뺤콉: ?뚯썝/?꾩옣 留덉뒪?곕뒗 以묒븰?먯꽌 吏곸젒 愿由ы븯誘濡??깆쓽 ?몃? ?숆린?붾뒗 鍮꾪솢??
const ENABLE_SITE_SYNC_TO_SHEETS = process.env.ENABLE_SITE_SYNC_TO_SHEETS === 'true';
const ENABLE_INITIAL_SYNC_TO_SHEETS = process.env.ENABLE_INITIAL_SYNC_TO_SHEETS === 'true';
const ENABLE_SITE_MEMBER_BIGQUERY_SYNC = process.env.ENABLE_SITE_MEMBER_BIGQUERY_SYNC === 'true';

let importProgress = { current: 0, total: 0, status: 'idle', result: null };

function cleanupDisallowedReportTemplates(reportsDir) {
  const entries = fs.readdirSync(reportsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

  for (const fileName of entries) {
    if (isAllowedReportTemplateName(fileName)) {
      continue;
    }

    const fullPath = path.join(reportsDir, fileName);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }
}

module.exports = function (db, baseDir, appDataPath) {
  const defaultQntechPhotoRoot = path.join(appDataPath, '사진관리', '수질분석');
  const reportsDir = getCustomReportTemplatesDir(appDataPath);
  const excelOriginalsDir = path.join(appDataPath, 'templates', 'excel-originals');
  const siteStorageRoot = path.join(appDataPath, 'storage-sites');
  if (!fs.existsSync(siteStorageRoot)) fs.mkdirSync(siteStorageRoot, { recursive: true });
  if (!fs.existsSync(excelOriginalsDir)) fs.mkdirSync(excelOriginalsDir, { recursive: true });
  syncBundledTemplatesToAppData(baseDir, appDataPath);

  const upsertLocalSite = (site) => {
    if (!site?.id || !site?.site_name) {
      return;
    }
    const normalizedSiteName = String(site.site_name || '').trim();
    const existingByName = db.prepare('SELECT id FROM sites WHERE site_name = ? LIMIT 1').get(normalizedSiteName);
    const localId = String(existingByName?.id || site.id);

    db.prepare(`
      INSERT INTO sites (id, site_name, manager_name, method, series, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
      ON CONFLICT(id) DO UPDATE SET
        site_name = excluded.site_name,
        manager_name = excluded.manager_name,
        method = excluded.method,
        series = excluded.series,
        is_active = excluded.is_active,
        updated_at = datetime('now', 'localtime')
    `).run(
      localId,
      normalizedSiteName,
      String(site.manager_name || '').trim(),
      String(site.method || 'A2O').trim(),
      String(site.series || '1怨꾩뿴').trim(),
      site.is_active === 0 ? 0 : 1
    );
  };

  const syncLocalSites = db.transaction((sites) => {
    for (const site of sites || []) {
      upsertLocalSite(site);
    }
  });

  const reportStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, file.fieldname === 'excel_original' ? excelOriginalsDir : reportsDir),
    filename: (req, file, cb) => {
      try {
        const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8');
        cb(null, decoded.normalize('NFC'));
      } catch (e) {
        cb(null, String(file.originalname || '').normalize('NFC'));
      }
    }
  });
  const reportUpload = multer({ storage: reportStorage });

  // ?? ?ㅼ젙 議고쉶 ??
  router.get('/api/settings', (req, res) => {
    try {
      cleanupDisallowedReportTemplates(reportsDir);
      const reportTemplates = listReportTemplates(baseDir, appDataPath);
      const settings = db.prepare('SELECT * FROM app_settings WHERE id = 1').get();
      const sludgeExportSettings = db.prepare('SELECT company_name, default_amount FROM sludge_export_settings WHERE id = 1').get();
      const configItems = db.prepare('SELECT * FROM config_items ORDER BY category, display_order').all();
      const credentials = db.prepare('SELECT service_key, service_name, service_url, user_id, password, updated_at FROM web_app_credentials ORDER BY id').all();
      res.json({ success: true, settings, sludgeExportSettings, configItems, credentials, reportTemplates });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ?? ?ㅼ젙 ?????
  router.post('/api/settings', async (req, res) => {
    const { settings, configItems } = req.body;
    try {
      const updateTransaction = db.transaction((s, items) => {
        db.prepare(`
          UPDATE app_settings
          SET site_name = ?, manager_name = ?, method = ?, series = ?,
              target_lat = COALESCE(?, target_lat),
              target_lng = COALESCE(?, target_lng)
          WHERE id = 1
        `).run(
          s.siteName,
          s.managerName,
          s.method,
          s.series,
          s.targetLat ?? null,
          s.targetLng ?? null
        );
        const updateConfig = db.prepare('UPDATE config_items SET is_active = ? WHERE category = ? AND item_name = ?');
        const insertConfig = db.prepare('INSERT OR IGNORE INTO config_items (category, item_name, is_active, display_order) VALUES (?, ?, ?, ?)');
        items.forEach((item, idx) => {
          const result = updateConfig.run(item.checked ? 1 : 0, item.category, item.name);
          if (result.changes === 0) insertConfig.run(item.category, item.name, 1, idx);
        });
      });
      updateTransaction(settings, configItems);

      const savedSeries = String(settings.series || '').trim() || '1怨꾩뿴';
      if (savedSeries === '2怨꾩뿴') {
        db.prepare(`
          UPDATE app_settings SET flow_option = CASE
            WHEN flow_option IS NULL OR TRIM(flow_option) = '' THEN 'combined'
            ELSE flow_option
          END WHERE id = 1
        `).run();
      } else {
        db.prepare(`UPDATE app_settings SET flow_option = 'single1' WHERE id = 1`).run();
      }

      // Drive媛 ?ㅼ젙???덉쑝硫??꾩옣 ?대뜑 + 湲곕낯 ?섏쐞 ?대뜑瑜??앹꽦?쒕떎.
      let driveSiteFolder = null;
      let driveSubFolders = [];
      let localSiteFolder = null;
      let localSubFolders = [];
      const defaultSubFolderNames = [
        '寃뚯떆?먯꺼遺?뚯씪',
        '?쏀뭹?낃퀬?쇱?_?ъ쭊',
        '슬러지?ъ쭊????ъ쭊',
        '?섏쭏遺꾩꽍_데이타불러오기_?ъ쭊',
        '?깆쟻??,
      ];

      const currentSiteId = db.prepare('SELECT site_id FROM app_settings WHERE id = 1').get()?.site_id || '';
      const folderNameBySite = String(settings.siteName || '').trim() || String(currentSiteId || '').trim();

      // 濡쒖뺄(AppData)???숈씪??湲곕낯 ?대뜑 ?명듃瑜???긽 蹂댁옣?쒕떎.
      if (folderNameBySite) {
        const localSitePath = path.join(siteStorageRoot, folderNameBySite);
        fs.mkdirSync(localSitePath, { recursive: true });
        localSiteFolder = { name: folderNameBySite, path: localSitePath };
        for (const folderName of defaultSubFolderNames) {
          const childPath = path.join(localSitePath, folderName);
          fs.mkdirSync(childPath, { recursive: true });
          localSubFolders.push({ name: folderName, path: childPath });
        }
      }

      if (isDriveConfigured()) {
        try {
          if (folderNameBySite) {
            driveSiteFolder = await getOrCreateFolder(getDriveRootFolderId(), folderNameBySite);
            for (const folderName of defaultSubFolderNames) {
              const child = await getOrCreateFolder(driveSiteFolder.id, folderName);
              driveSubFolders.push({
                id: child.id,
                name: child.name,
                url: child.webViewLink,
              });
            }
          }
        } catch (driveErr) {
          console.error('[Settings] Drive ?꾩옣/湲곕낯?대뜑 ?앹꽦 ?ㅽ뙣:', driveErr.message);
          // Drive ?ㅻ쪟媛 ?ㅼ젙 ??μ쓣 留됱? ?딅룄濡?臾댁떆
        }
      }

      res.json({
        success: true,
        message: 'Settings saved successfully',
        ...(localSiteFolder ? { localSiteFolder } : {}),
        ...(localSubFolders.length > 0 ? { localSubFolders } : {}),
        ...(driveSiteFolder ? { driveSiteFolder: { id: driveSiteFolder.id, name: driveSiteFolder.name, url: driveSiteFolder.webViewLink } } : {}),
        ...(driveSubFolders.length > 0 ? { driveSubFolders } : {})
      });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ?? 湲곕낯?ㅼ젙 ?꾩옣 ?꾩튂 ???(利됱떆 ??? ??
  router.post('/api/settings/site-location', (req, res) => {
    const { targetLat, targetLng } = req.body || {};
    const lat = Number(targetLat);
    const lng = Number(targetLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ success: false, message: '?좏슚???꾨룄/寃쎈룄 媛믪씠 ?꾩슂?⑸땲??' });
    }
    try {
      db.prepare('UPDATE app_settings SET target_lat = ?, target_lng = ? WHERE id = 1').run(lat, lng);
      res.json({ success: true, targetLat: lat, targetLng: lng });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ?? ?꾩옣 紐⑸줉 議고쉶 ??
  router.get('/api/settings/sites', async (req, res) => {
    try {
      if (!isSitesSheetsConfigured()) {
        return res.status(400).json({ success: false, message: 'Google Sheets???ㅼ젙?섏? ?딆븯?듬땲?? (GOOGLE_MEMBERS_SHEET_ID)' });
      }
      const sheetSites = await getSitesFromSheets();
      const sites = sheetSites
        .filter((site) => site.is_active !== 0)
        .map((site) => ({
          id: site.id,
          site_name: site.site_name,
          manager_name: site.manager_name,
          method: site.method,
          series: site.series,
          is_active: site.is_active
        }));
      const current = db.prepare('SELECT site_id FROM app_settings WHERE id = 1').get();
      const fallbackSite = sites.find((site) => String(site.id) === String(current?.site_id)) || sites[0] || null;

      if (fallbackSite && String(current?.site_id || '') !== String(fallbackSite.id)) {
        const series = String(fallbackSite.series || '').trim() || '1怨꾩뿴';
        const prev = db.prepare('SELECT flow_option FROM app_settings WHERE id = 1').get();
        const prevOpt = prev?.flow_option != null ? String(prev.flow_option).trim() : '';
        let flowOption = prevOpt;
        if (series === '2怨꾩뿴') {
          if (!flowOption) flowOption = 'combined';
        } else {
          flowOption = 'single1';
        }
        db.prepare(`
          UPDATE app_settings
          SET site_id = ?, site_name = ?, manager_name = ?, method = ?, series = ?, flow_option = ?
          WHERE id = 1
        `).run(
          fallbackSite.id,
          fallbackSite.site_name || '',
          fallbackSite.manager_name || '',
          fallbackSite.method || 'A2O',
          series,
          flowOption
        );
      }

      res.json({ success: true, sites, currentSiteId: fallbackSite?.id || null, source: 'sheets' });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ?? ?꾩옣 異붽?/?섏젙 ??
  router.post('/api/settings/sites', async (req, res) => {
    const { siteName, managerName, method, series, isActive, siteId } = req.body || {};
    if (!siteName) {
      return res.status(400).json({ success: false, message: 'siteName???꾩슂?⑸땲??' });
    }

    try {
      const id = String(siteId || crypto.randomUUID());
      if (!isSitesSheetsConfigured()) {
        return res.status(400).json({ success: false, message: 'Google Sheets???ㅼ젙?섏? ?딆븯?듬땲?? (GOOGLE_MEMBERS_SHEET_ID)' });
      }
      const site = {
        id,
        site_name: String(siteName).trim(),
        manager_name: String(managerName || '').trim(),
        method: String(method || 'A2O').trim(),
        series: String(series || '1怨꾩뿴').trim(),
        is_active: isActive === false ? 0 : 1
      };
      await upsertSiteToSheets(site);

      res.json({ success: true, site });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ?? ?꾩옣 ??젣(鍮꾪솢?? ??
  router.delete('/api/settings/sites/:siteId', async (req, res) => {
    const siteId = String(req.params.siteId || '').trim();
    if (!siteId) {
      return res.status(400).json({ success: false, message: 'siteId媛 ?꾩슂?⑸땲??' });
    }

    try {
      if (!isSitesSheetsConfigured()) {
        return res.status(400).json({ success: false, message: 'Google Sheets???ㅼ젙?섏? ?딆븯?듬땲?? (GOOGLE_MEMBERS_SHEET_ID)' });
      }
      const sheetSites = await getSitesFromSheets();
      const target = sheetSites.find((site) => String(site.id) === String(siteId) && site.is_active !== 0);
      if (!target) {
        return res.status(404).json({ success: false, message: '????꾩옣??李얠쓣 ???놁뒿?덈떎.' });
      }

      await deleteSiteFromSheets(siteId);

      db.transaction(() => {
        db.prepare(`
          UPDATE sites
          SET is_active = 0, updated_at = datetime('now', 'localtime')
          WHERE id = ?
        `).run(siteId);

        const current = db.prepare('SELECT site_id FROM app_settings WHERE id = 1').get();
        if (current?.site_id === siteId) {
          const fallback = db.prepare(`
            SELECT id, site_name, manager_name, method, series
            FROM sites
            WHERE is_active = 1
            ORDER BY COALESCE(created_at, updated_at, '') ASC, id ASC
            LIMIT 1
          `).get();

          db.prepare(`
            UPDATE app_settings
            SET site_id = ?, site_name = ?, manager_name = ?, method = ?, series = ?
            WHERE id = 1
          `).run(
            fallback?.id || null,
            fallback?.site_name || '',
            fallback?.manager_name || '',
            fallback?.method || 'A2O',
            fallback?.series || '1怨꾩뿴'
          );
        }
      })();

      res.json({ success: true, deletedSiteId: siteId });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ?? ?꾩옱 濡쒖뺄 ?꾩옣 ?좏깮 ??
  router.post('/api/settings/select-site', async (req, res) => {
    const { siteId } = req.body || {};
    if (!siteId) {
      return res.status(400).json({ success: false, message: 'siteId媛 ?꾩슂?⑸땲??' });
    }

    try {
      let site = null;
      if (!isSitesSheetsConfigured()) {
        return res.status(400).json({ success: false, message: 'Google Sheets???ㅼ젙?섏? ?딆븯?듬땲?? (GOOGLE_MEMBERS_SHEET_ID)' });
      }
      if (isSitesSheetsConfigured()) {
        const sheetSites = await getSitesFromSheets();
        const matched = sheetSites.find((item) => String(item.id) === String(siteId) && item.is_active !== 0);
        if (matched) {
          site = {
            id: matched.id,
            site_name: matched.site_name,
            manager_name: matched.manager_name,
            method: matched.method,
            series: matched.series
          };
        }
      }

      if (!site) {
        return res.status(404).json({ success: false, message: '????꾩옣??李얠쓣 ???놁뒿?덈떎.' });
      }

      const series = String(site.series || '').trim() || '1怨꾩뿴';
      const prev = db.prepare('SELECT flow_option FROM app_settings WHERE id = 1').get();
      const prevOpt = prev?.flow_option != null ? String(prev.flow_option).trim() : '';
      let flowOption = prevOpt;
      if (series === '2怨꾩뿴') {
        if (!flowOption) flowOption = 'combined';
      } else {
        flowOption = 'single1';
      }

      db.prepare(`
        UPDATE app_settings
        SET site_id = ?, site_name = ?, manager_name = ?, method = ?, series = ?, flow_option = ?
        WHERE id = 1
      `).run(site.id, site.site_name || '', site.manager_name || '', site.method || 'A2O', series, flowOption);

      res.json({ success: true, site });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ?? ?꾩옣/?뚯썝 ?숈떆 ???(濡쒖뺄 + BigQuery 以鍮? ??
  router.post('/api/settings/bootstrap-site-member', async (req, res) => {
    const { site, member, link, syncToBigQuery } = req.body || {};

    if (!site?.siteName || !member?.name || !member?.password) {
      return res.status(400).json({ success: false, message: '?꾩옣紐? ?뚯썝紐? 鍮꾨?踰덊샇???꾩닔?낅땲??' });
    }

    try {
      const appSetting = db.prepare('SELECT site_id FROM app_settings WHERE id = 1').get();
      const siteId = String(site?.id || appSetting?.site_id || crypto.randomUUID());
      const memberId = String(member.id || crypto.randomUUID());
      const now = new Date().toISOString();

      db.transaction(() => {
        const bootSeries = String(site.series || '1怨꾩뿴').trim() || '1怨꾩뿴';
        const bootFlowOpt = bootSeries === '2怨꾩뿴' ? 'combined' : 'single1';
        db.prepare(`
          UPDATE app_settings
          SET site_id = ?, site_name = ?, manager_name = ?, method = ?, series = ?, flow_option = ?
          WHERE id = 1
        `).run(
          siteId,
          String(site.siteName || '').trim(),
          String(site.managerName || '').trim(),
          String(site.method || 'A2O').trim(),
          bootSeries,
          bootFlowOpt
        );

        db.prepare(`
          INSERT INTO sites (id, site_name, manager_name, method, series, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, datetime('now', 'localtime'), datetime('now', 'localtime'))
          ON CONFLICT(id) DO UPDATE SET
            site_name = excluded.site_name,
            manager_name = excluded.manager_name,
            method = excluded.method,
            series = excluded.series,
            updated_at = datetime('now', 'localtime')
        `).run(
          siteId,
          String(site.siteName || '').trim(),
          String(site.managerName || '').trim(),
          String(site.method || 'A2O').trim(),
          String(site.series || '1怨꾩뿴').trim()
        );

        db.prepare(`
          INSERT INTO members (
            id, name, password, role, phone, target_lat, target_lng, radius_m, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            password = excluded.password,
            role = excluded.role,
            phone = excluded.phone,
            target_lat = excluded.target_lat,
            target_lng = excluded.target_lng,
            radius_m = excluded.radius_m,
            notes = excluded.notes,
            updated_at = datetime('now', 'localtime')
        `).run(
          memberId,
          String(member.name || '').trim(),
          String(member.password || ''),
          String(member.role || 'admin'),
          String(member.phone || '').trim(),
          member.target_lat != null && member.target_lat !== '' ? Number(member.target_lat) : null,
          member.target_lng != null && member.target_lng !== '' ? Number(member.target_lng) : null,
          member.radius_m != null && member.radius_m !== '' ? Number(member.radius_m) : 500,
          String(member.notes || '').trim()
        );

        db.prepare(`
          INSERT INTO member_sites (member_id, site_id, is_primary, can_manage, is_bidirectional, created_at)
          VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
          ON CONFLICT(member_id, site_id) DO UPDATE SET
            is_primary = excluded.is_primary,
            can_manage = excluded.can_manage,
            is_bidirectional = excluded.is_bidirectional
        `).run(
          memberId,
          siteId,
          link?.isPrimary ? 1 : 0,
          link?.canManage === false ? 0 : 1,
          link?.isBidirectional ? 1 : 0
        );

        if (link?.isPrimary) {
          db.prepare('UPDATE member_sites SET is_primary = 0 WHERE member_id = ? AND site_id != ?').run(memberId, siteId);
        }
      })();

      let bigQuery = { success: false, message: '?숆린??鍮꾪솢?깊솕(ENABLE_SITE_MEMBER_BIGQUERY_SYNC != true)' };
      if (ENABLE_SITE_MEMBER_BIGQUERY_SYNC && syncToBigQuery === true) {
        await ensureSiteMemberTables();
        bigQuery = await upsertSiteMemberSnapshot({
          site: {
            id: siteId,
            site_name: String(site.siteName || '').trim(),
            manager_name: String(site.managerName || '').trim(),
            method: String(site.method || 'A2O').trim(),
            series: String(site.series || '1怨꾩뿴').trim(),
            is_active: 1,
            updated_at: now
          },
          member: {
            id: memberId,
            name: String(member.name || '').trim(),
            role: String(member.role || 'admin'),
            phone: String(member.phone || '').trim(),
            target_lat: member.target_lat != null && member.target_lat !== '' ? Number(member.target_lat) : null,
            target_lng: member.target_lng != null && member.target_lng !== '' ? Number(member.target_lng) : null,
            radius_m: member.radius_m != null && member.radius_m !== '' ? Number(member.radius_m) : 500,
            notes: String(member.notes || '').trim(),
            updated_at: now
          },
          link: {
            member_id: memberId,
            site_id: siteId,
            is_primary: Boolean(link?.isPrimary),
            can_manage: link?.canManage === false ? false : true,
            is_bidirectional: Boolean(link?.isBidirectional),
            updated_at: now
          }
        });
      }

      res.json({
        success: true,
        siteId,
        memberId,
        bigQuery
      });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ?? ?좊웾 留ㅽ븨 ?듭뀡 ?????
  router.post('/api/settings/save-flow-option', (req, res) => {
    const { flowOption } = req.body;
    if (!flowOption) return res.status(400).json({ success: false, message: 'flowOption???꾩슂?⑸땲??' });
    try {
      db.prepare('UPDATE app_settings SET flow_option = ? WHERE id = 1').run(flowOption);
      res.json({ success: true, message: '?좊웾 留ㅽ븨 ?듭뀡????λ릺?덉뒿?덈떎.' });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  router.post('/api/settings/web-app-credentials', (req, res) => {
    const { serviceKey, serviceUrl, userId, password } = req.body || {};
    if (!serviceKey) {
      return res.status(400).json({ success: false, message: 'serviceKey媛 ?꾩슂?⑸땲??' });
    }

    try {
      const normalizedServiceUrl = serviceKey === 'water_analysis_app'
        ? normalizeBaseUrl(serviceUrl || '')
        : (serviceUrl || '');

      const result = db.prepare('UPDATE web_app_credentials SET service_url = ?, user_id = ?, password = ?, updated_at = CURRENT_TIMESTAMP WHERE service_key = ?').run(normalizedServiceUrl, userId || '', password || '', serviceKey);
      if (result.changes === 0) {
        return res.status(404).json({ success: false, message: '????ㅼ젙??李얠쓣 ???놁뒿?덈떎.' });
      }

      if (serviceKey === 'water_analysis_app') {
        invalidateQntechSessionCache('water_analysis_app credentials updated');
      }

      const credential = db.prepare('SELECT service_key, service_name, service_url, user_id, password, updated_at FROM web_app_credentials WHERE service_key = ?').get(serviceKey);
      res.json({ success: true, credential, message: '?????ㅼ젙????λ릺?덉뒿?덈떎.' });
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
      `).run(photoRoot || defaultQntechPhotoRoot, serializedMappings);

      const settings = db.prepare('SELECT qntech_photo_root, qntech_sample_mappings FROM app_settings WHERE id = 1').get();
      res.json({ success: true, settings, message: 'QnTECH 遺덈윭?ㅺ린 ?ㅼ젙????λ릺?덉뒿?덈떎.' });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ?? ?ㅼ젙 ??ぉ 利됱떆 異붽? ??
  router.post('/api/settings/add-item', (req, res) => {
    const { category, name } = req.body;
    if (!category || !name) return res.status(400).json({ success: false, message: 'category? name???꾩슂?⑸땲??' });
    try {
      const existing = db.prepare('SELECT id FROM config_items WHERE category = ? AND item_name = ?').get(category, name);
      if (existing) return res.status(409).json({ success: false, message: '?대? 議댁옱?섎뒗 ??ぉ?낅땲??' });
      const maxOrder = db.prepare('SELECT MAX(display_order) as mx FROM config_items WHERE category = ?').get(category);
      const order = (maxOrder?.mx ?? -1) + 1;
      db.prepare('INSERT INTO config_items (category, item_name, is_active, display_order) VALUES (?, ?, 1, ?)').run(category, name, order);
      const item = db.prepare('SELECT * FROM config_items WHERE category = ? AND item_name = ?').get(category, name);
      res.json({ success: true, item });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ?? ?ㅼ젙 ??ぉ ?쒖꽦/鍮꾪솢???좉? ??
  router.post('/api/settings/toggle-item', (req, res) => {
    const { category, name, isActive } = req.body;
    if (!category || !name) return res.status(400).json({ success: false, message: 'category? name???꾩슂?⑸땲??' });
    try {
      db.prepare('UPDATE config_items SET is_active = ? WHERE category = ? AND item_name = ?').run(isActive ? 1 : 0, category, name);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ?? ?묒? ?곹깭 (DB???곗씠???덈뒗吏 利됱떆 ?뺤씤) ??
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

  // ?? ?묒? ???꾨━酉?(DB?먯꽌 利됱떆 議고쉶) ??
  router.post('/api/settings/excel-preview', (req, res) => {
    const { sheet, row } = req.body;
    try {
      if (!hasStoredData(db)) return res.json({ success: false, message: '?묒? ?곗씠?곌? ?꾩쭅 ??λ릺吏 ?딆븯?듬땲??' });
      const data = getStoredRow(db, sheet, row);
      res.json({ success: true, data });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ?? ?꾪룷??吏꾪뻾 ?곹솴 ??
  router.get('/api/settings/import-progress', (req, res) => { res.json(importProgress); });

  // ?? ?좊웾 留ㅽ븨 ???+ DB?먯꽌 ?꾪룷????
  router.post('/api/settings/save-flow-mapping', (req, res) => {
    const { config, mapping } = req.body;
    const { sheet, startRow, endRow, dateCol } = config;
    importProgress = { current: 0, total: endRow - startRow + 1, status: 'processing', result: null };
    try {
      if (!hasStoredData(db)) throw new Error('?묒? ?곗씠?곌? ?꾩쭅 ??λ릺吏 ?딆븯?듬땲?? 癒쇱? ?뚯씪???낅줈?쒗븯?몄슂.');

      console.log('[FlowMapping] Received mapping:', JSON.stringify(mapping, null, 2));

      db.prepare('UPDATE app_settings SET flow_sheet = ?, flow_start_row = ?, flow_end_row = ?, flow_date_col = ? WHERE id = 1').run(sheet, startRow, endRow, dateCol);

      // config_items??_raw/_flow ?묐??ш? ?덈뒗 留ㅽ븨留????(湲곕낯 ??ぉ ?ㅻ뒗 蹂꾨룄 愿由щ릺誘濡??쒖쇅)
      const upsertStmt = db.prepare("INSERT INTO config_items (category, item_name, excel_cell, is_active, display_order) VALUES ('flow', ?, ?, 1, 0) ON CONFLICT(category, item_name) DO UPDATE SET excel_cell = excluded.excel_cell");
      Object.entries(mapping).forEach(([name, col]) => {
        if (name.endsWith('_raw') || name.endsWith('_flow')) {
          console.log(`[FlowMapping] Saving config: ${name} -> ${col}`);
          upsertStmt.run(name, col);
        }
      });

      // 湲곗〈 flow_readings ?꾩껜 ??젣 ???ъ엫?ы듃
      db.prepare('DELETE FROM flow_readings').run();
      console.log('[FlowMapping] Cleared all flow_readings for clean re-import');

      const metadata = getCurrentRecordMetadata(db, config || {});
      const insertReading = db.prepare(`
        INSERT INTO flow_readings (
          date, type, raw_value, calculated_flow, site_id, site_name, author, created_at, last_modified, is_synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date, type) DO UPDATE SET
          raw_value = COALESCE(excluded.raw_value, raw_value),
          calculated_flow = COALESCE(excluded.calculated_flow, calculated_flow),
          site_id = excluded.site_id,
          site_name = excluded.site_name,
          author = excluded.author,
          last_modified = excluded.last_modified,
          is_synced = excluded.is_synced
      `);
      const importedData = [];

      // mapping?먯꽌 _raw/_flow ?ㅻ쭔 ?뚯떛?섏뿬 ?좊웾怨꾨퀎 而щ읆 留ㅽ븨 援ъ꽦
      const flows = {};
      Object.keys(mapping).forEach(key => {
        if (!key.endsWith('_raw') && !key.endsWith('_flow')) return; // 湲곕낯 ??ぉ ??臾댁떆
        const lastUnderscore = key.lastIndexOf('_');
        const name = key.substring(0, lastUnderscore);
        const field = key.substring(lastUnderscore + 1); // 'raw' or 'flow'
        if (!flows[name]) flows[name] = {};
        flows[name][field] = mapping[key];
      });

      console.log('[FlowMapping] Parsed flow types:', JSON.stringify(flows, null, 2));

      let debugRow = startRow; // 泥????붾쾭洹?異쒕젰??
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
              console.log(`[FlowMapping] Row ${r} (${formatted}): ${itemName} => raw col=${cols.raw}(${rawCellVal}??{rawValue}), flow col=${cols.flow}(${flowCellVal}??{calcFlow})`);
            }

            if (rawValue !== null || calcFlow !== null) {
              insertReading.run(
                formatted,
                itemName,
                rawValue,
                calcFlow,
                metadata.siteId,
                metadata.siteName,
                metadata.author,
                metadata.createdAt,
                metadata.lastModified,
                metadata.isSynced
              );
              if (rawValue !== null) rowResults[`${itemName}_?곸궛`] = rawValue;
              if (calcFlow !== null) rowResults[`${itemName}_?꾧퀎`] = calcFlow;
            }
          });
          if (Object.keys(rowResults).length > 1) importedData.push(rowResults);
          importProgress.current++;
        }
      })();

      importProgress.status = 'completed';
      importProgress.result = importedData;
      console.log(`[FlowMapping] Import completed: ${importedData.length} rows`);
      res.json({ success: true, message: '?좊웾 ?곗씠???꾪룷???꾨즺', count: importedData.length });
    } catch (e) {
      console.error('Flow mapping error:', e);
      importProgress.status = 'error';
      importProgress.result = e.message;
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ?? ?ㅽ듃 留ㅽ븨 ???+ DB?먯꽌 ?꾪룷????
  // mapping ???뺤떇: "?ㅽ듃紐?purchase", "?ㅽ듃紐?usage", "?ㅽ듃紐?inventory"
  router.post('/api/settings/save-kit-mapping', (req, res) => {
    const { config, mapping } = req.body;
    const { sheet, startRow, endRow, dateCol } = config;
    importProgress = { current: 0, total: endRow - startRow + 1, status: 'processing', result: null };
    try {
      if (!hasStoredData(db)) throw new Error('?묒? ?곗씠?곌? ?꾩쭅 ??λ릺吏 ?딆븯?듬땲?? 癒쇱? ?뚯씪???낅줈?쒗븯?몄슂.');

      db.prepare('UPDATE app_settings SET kit_sheet = ?, kit_start_row = ?, kit_end_row = ?, kit_date_col = ? WHERE id = 1').run(sheet, startRow, endRow, dateCol);

      const upsertStmt = db.prepare("INSERT INTO config_items (category, item_name, excel_cell, is_active, display_order) VALUES ('kit', ?, ?, 1, 0) ON CONFLICT(category, item_name) DO UPDATE SET excel_cell = excluded.excel_cell");
      Object.entries(mapping).forEach(([key, col]) => upsertStmt.run(key, col));

      // ?ㅽ듃紐낅퀎 purchase/usage/inventory ??洹몃９??
      const kits = {};
      Object.keys(mapping).forEach(key => {
        const lastUnderscore = key.lastIndexOf('_');
        if (lastUnderscore === -1) return;
        const name = key.substring(0, lastUnderscore);
        const field = key.substring(lastUnderscore + 1);
        if (!kits[name]) kits[name] = {};
        kits[name][field] = mapping[key];
      });

      const metadata = getCurrentRecordMetadata(db, config || {});
      const insertKit = db.prepare(`
        INSERT INTO kit_logs (
          kit_name, date, purchase_amount, usage_amount, current_inventory, site_id, site_name, author, created_at, last_modified, is_synced
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
              insertKit.run(
                kitName,
                formatted,
                purchase,
                usage,
                inventory,
                metadata.siteId,
                metadata.siteName,
                metadata.author,
                metadata.createdAt,
                metadata.lastModified,
                metadata.isSynced
              );
              rowResults[`${kitName}_援щℓ`] = purchase;
              rowResults[`${kitName}_?ъ슜`] = usage;
              rowResults[`${kitName}_?ш퀬`] = inventory;
            }
          });
          importedData.push(rowResults);
          importProgress.current++;
        }
      })();

      importProgress.status = 'completed';
      importProgress.result = importedData;
      res.json({ success: true, message: '?ㅽ듃 ?곗씠???꾪룷???꾨즺', count: importedData.length });
    } catch (e) {
      console.error('Kit mapping error:', e);
      importProgress.status = 'error';
      importProgress.result = e.message;
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ?? ?쏀뭹 留ㅽ븨 ???+ DB?먯꽌 ?꾪룷????
  // mapping ???뺤떇: "?쏀뭹紐?purchase", "?쏀뭹紐?usage", "?쏀뭹紐?inventory"
  router.post('/api/settings/save-medicine-mapping', (req, res) => {
    const { config, mapping } = req.body;
    const { sheet, startRow, endRow, dateCol } = config;
    importProgress = { current: 0, total: endRow - startRow + 1, status: 'processing', result: null };
    try {
      if (!hasStoredData(db)) throw new Error('?묒? ?곗씠?곌? ?꾩쭅 ??λ릺吏 ?딆븯?듬땲?? 癒쇱? ?뚯씪???낅줈?쒗븯?몄슂.');

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

      const metadata = getCurrentRecordMetadata(db, config || {});
      const insertMed = db.prepare(`
        INSERT INTO medicine_logs (
          medicine_name, date, purchase_amount, usage_amount, current_inventory, site_id, site_name, author, created_at, last_modified, is_synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(medicine_name, date) DO UPDATE SET
          purchase_amount = excluded.purchase_amount,
          usage_amount = excluded.usage_amount,
          current_inventory = excluded.current_inventory,
          site_id = excluded.site_id,
          site_name = excluded.site_name,
          author = excluded.author,
          last_modified = excluded.last_modified,
          is_synced = excluded.is_synced
      `);
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
              insertMed.run(
                medName,
                formatted,
                purchase,
                usage,
                inventory,
                metadata.siteId,
                metadata.siteName,
                metadata.author,
                metadata.createdAt,
                metadata.lastModified,
                metadata.isSynced
              );
              rowResults[`${medName}_援щℓ`] = purchase;
              rowResults[`${medName}_?ъ슜`] = usage;
              rowResults[`${medName}_?ш퀬`] = inventory;
            }
          });
          importedData.push(rowResults);
          importProgress.current++;
        }
      })();

      importProgress.status = 'completed';
      importProgress.result = importedData;
      res.json({ success: true, message: '?쏀뭹 ?곗씠???꾪룷???꾨즺', count: importedData.length });
    } catch (e) {
      console.error('Medicine mapping error:', e);
      importProgress.status = 'error';
      importProgress.result = e.message;
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ?? ?섏쭏 留ㅽ븨 ???+ DB?먯꽌 ?꾪룷????
  router.post('/api/settings/save-water-mapping', (req, res) => {
    const { config, mapping } = req.body;
    const { sheet, startRow, endRow, dateCol } = config;
    importProgress = { current: 0, total: endRow - startRow + 1, status: 'processing', result: null };
    try {
      if (!hasStoredData(db)) throw new Error('?묒? ?곗씠?곌? ?꾩쭅 ??λ릺吏 ?딆븯?듬땲?? 癒쇱? ?뚯씪???낅줈?쒗븯?몄슂.');

      db.prepare('UPDATE app_settings SET water_sheet = ?, water_start_row = ?, water_end_row = ?, water_date_col = ? WHERE id = 1').run(sheet, startRow, endRow, dateCol);

      // 留ㅽ븨 ?뺣낫??'water_mapping' 移댄뀒怨좊━????ν븯??湲곕낯 ??ぉ('water')怨?遺꾨━
      const upsertStmt = db.prepare("INSERT INTO config_items (category, item_name, excel_cell, is_active, display_order) VALUES ('water_mapping', ?, ?, 1, 0) ON CONFLICT(category, item_name) DO UPDATE SET excel_cell = excluded.excel_cell");
      Object.entries(mapping).forEach(([key, col]) => {
        if (key !== 'date') {
          upsertStmt.run(key, col);
        }
      });

      // mapping: { "?붾え?덉븘?깆쭏???좊웾議곗젙議?: "C", ... }
      const baseParams = { '?붾え?덉븘?깆쭏??: 'nh3_n', '吏덉궛?깆쭏??: 'no3_n', '?몄궛?쇱씤': 'po4_p', '?뚯뭡由щ룄': 'alkalinity' };

      // 洹몃９??湲곗?: location name
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
          date, measurement_group, measurement_order, source_type, source_label,
          location, nh3_n, no3_n, po4_p, alkalinity, tn, tp, cod, ss,
          site_id, site_name, author, created_at, last_modified, is_synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) 
        ON CONFLICT(date, measurement_group, location) DO UPDATE SET 
          measurement_order = excluded.measurement_order,
          source_type = excluded.source_type,
          source_label = excluded.source_label,
          nh3_n = excluded.nh3_n, no3_n = excluded.no3_n, 
          po4_p = excluded.po4_p, alkalinity = excluded.alkalinity,
          site_id = excluded.site_id,
          site_name = excluded.site_name,
          author = excluded.author,
          last_modified = excluded.last_modified,
          is_synced = excluded.is_synced
      `);

      const importedData = [];

      db.transaction(() => {
        const metadata = getCurrentRecordMetadata(db, config || {});
        // TODO(site-id): ?ㅼ쨷?꾩옣 ?꾪솚 ??date + site_id 踰붿쐞濡??뺣━?섎룄濡?蹂寃?
        const deleteImportedByDate = db.prepare("DELETE FROM water_quality WHERE date = ? AND (source_type = 'excel' OR measurement_group = '')");
        const cleanedDates = new Set();
        const dateOrderCounter = new Map();

        for (let r = startRow; r <= endRow; r++) {
          const dateStr = getCellValue(db, sheet, r, dateCol);
          const formatted = formatDate(dateStr) || dateStr;
          if (!formatted) { importProgress.current++; continue; }

          if (!cleanedDates.has(formatted)) {
            deleteImportedByDate.run(formatted);
            cleanedDates.add(formatted);
          }

          const nextOrder = (dateOrderCounter.get(formatted) || 0) + 1;
          dateOrderCounter.set(formatted, nextOrder);
          const measurementGroup = `excel:${formatted}:${String(nextOrder).padStart(3, '0')}`;

          const rowResults = { date: formatted, measurement_group: measurementGroup };

          // Default location if no locations are mapped (fallback to '湲곕낯')
          if (Object.keys(locations).length === 0) {
            insertWater.run(
              formatted,
              measurementGroup,
              nextOrder,
              'excel',
              sheet,
              '湲곕낯',
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              metadata.siteId,
              metadata.siteName,
              metadata.author,
              metadata.createdAt,
              metadata.lastModified,
              metadata.isSynced
            );
            importedData.push({ date: formatted, measurement_group: measurementGroup, location: '湲곕낯' });
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

              // tn, tp, cod, ss???ㅽ듃 遺꾩꽍 ??ぉ???꾨땲誘濡?null濡????
              insertWater.run(
                formatted,
                measurementGroup,
                nextOrder,
                'excel',
                sheet,
                locName,
                vals.nh3_n,
                vals.no3_n,
                vals.po4_p,
                vals.alkalinity,
                null,
                null,
                null,
                null,
                metadata.siteId,
                metadata.siteName,
                metadata.author,
                metadata.createdAt,
                metadata.lastModified,
                metadata.isSynced
              );

              rowResults[`${locName}_nh3_n`] = vals.nh3_n;
            });
            importedData.push(rowResults);
          }
          importProgress.current++;
        }
      })();

      importProgress.status = 'completed';
      importProgress.result = importedData;
      res.json({ success: true, message: '?섏쭏 ?곗씠???꾪룷???꾨즺', count: importedData.length });
    } catch (e) {
      console.error('Water mapping error:', e);
      importProgress.status = 'error';
      importProgress.result = e.message;
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ?? ?뚯씪 ?낅줈??(?묒? ?먮낯 ??利됱떆 ?뚯떛 ??DB ??? ??
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

      const reportTemplates = files['report_templates'] || [];
      const replacedTemplates = [];

      cleanupDisallowedReportTemplates(reportsDir);

      const invalidTemplateFiles = reportTemplates
        .map((templateFile) => String(templateFile.filename || '').normalize('NFC'))
        .filter((fileName) => !isAllowedReportTemplateName(fileName));

      if (invalidTemplateFiles.length) {
        for (const templateFile of reportTemplates) {
          const uploadedPath = path.join(reportsDir, String(templateFile.filename || '').normalize('NFC'));
          if (fs.existsSync(uploadedPath)) {
            fs.unlinkSync(uploadedPath);
          }
        }

        return res.status(400).json({
          success: false,
          code: 'INVALID_REPORT_TEMPLATE_NAME',
          message: '???뚯씪? ?묒떇?쇰줈 ??ν븷 ???놁뒿?덈떎.',
          userMessage: `???뚯씪? ?묒떇?쇰줈 ??ν븷 ???놁뒿?덈떎.\n?덉슜???묒떇 ?대쫫: ${ALLOWED_REPORT_TEMPLATE_NAMES.join(', ')}`,
          invalidFiles: invalidTemplateFiles,
        });
      }

      for (const templateFile of reportTemplates) {
        const uploadedName = String(templateFile.filename || '').normalize('NFC');
        const uploadedIdentity = path.parse(uploadedName).name.normalize('NFC').trim().toLowerCase();

        // ?꾩옱 ?붾젆?좊━??紐⑤뱺 ?뚯씪???뺤씤?섏뿬, ?앸퀎?먭? 媛숈? 紐⑤뱺 ?뚯씪????젣?쒕떎.
        // (Multer媛 諛⑷툑 ??ν븳 ?뚯씪? ?쒖쇅?섍퀬, ?섎㉧吏???뺤옣?먯? ?곴??놁씠 ??젣)
        const currentFiles = fs.readdirSync(reportsDir, { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name);

        for (const existingName of currentFiles) {
          if (existingName === uploadedName) {
            continue;
          }

          const existingIdentity = path.parse(existingName).name.normalize('NFC').trim().toLowerCase();
          if (existingIdentity === uploadedIdentity) {
            const existingPath = path.join(reportsDir, existingName);
            if (fs.existsSync(existingPath)) {
              fs.unlinkSync(existingPath);
              replacedTemplates.push({
                template: uploadedIdentity,
                removedFile: existingName,
                appliedFile: uploadedName,
              });
            }
          }
        }
      }

      result.replacedTemplates = replacedTemplates;

      result.reportTemplates = listReportTemplates(baseDir, appDataPath);

      res.json({ success: true, message: '?뚯씪 ?낅줈??諛??곗씠??????꾨즺', ...result });
    } catch (err) {
      console.error('Upload error:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // ?? ?쏀뭹 湲곕낯 ?낃퀬??議고쉶 ??
  router.get('/api/settings/medicine-defaults', (req, res) => {
    try {
      const items = db.prepare(
        "SELECT item_name, COALESCE(default_amount, 0) AS default_amount FROM config_items WHERE category = 'medicine' AND item_name NOT LIKE '%\\_purchase' ESCAPE '\\' AND item_name NOT LIKE '%\\_usage' ESCAPE '\\' AND item_name NOT LIKE '%\\_inventory' ESCAPE '\\' ORDER BY display_order ASC"
      ).all();
      res.json({ success: true, items });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ?? ?쏀뭹 湲곕낯 ?낃퀬???????
  router.post('/api/settings/medicine-defaults', (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ success: false, message: 'items 諛곗뿴???꾩슂?⑸땲??' });
    }
    try {
      const stmt = db.prepare(
        "UPDATE config_items SET default_amount = ? WHERE category = 'medicine' AND item_name = ?"
      );
      const rows = items.filter((it) => it && String(it.name ?? '').trim());
      let totalChanges = 0;
      db.transaction((list) => {
        for (const it of list) {
          const name = String(it.name ?? '').trim();
          if (!name) continue;
          const raw = it.defaultAmount ?? it.default_amount ?? 0;
          const amt = Number(raw);
          const safeAmt = Number.isFinite(amt) ? amt : 0;
          totalChanges += stmt.run(safeAmt, name).changes;
        }
      })(rows);

      if (rows.length > 0 && totalChanges === 0) {
        return res.json({
          success: false,
          message:
            'DB???쏀뭹 ??ぉ怨??대쫫???섎굹??留욎? ?딆븘 ??λ릺吏 ?딆븯?듬땲?? ?ㅼ젙 > ?쏀뭹 ??뿉???쏀뭹 紐⑸줉??癒쇱? ?곸슜 ??ν븳 ?? 湲곕낯 ?낃퀬?됱쓣 ?ㅼ떆 ??ν빐 二쇱꽭??',
          updatedCount: 0,
        });
      }

      const skipped = rows.length - totalChanges;
      res.json({
        success: true,
        updatedCount: totalChanges,
        ...(skipped > 0
          ? {
              warning: `${skipped}媛???ぉ? config_items ?쏀뭹紐낃낵 ?쇱튂?섏? ?딆븘 諛섏쁺?섏? ?딆븯?듬땲??`,
            }
          : {}),
      });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ?? ?ㅽ듃 湲곕낯 ?낃퀬??議고쉶 ??
  router.get('/api/settings/kit-defaults', (req, res) => {
    try {
      const BASE_KITS = ['?붾え?덉븘?깆쭏??NH3-N)', '吏덉궛?깆쭏??NO3-N)', '?몄궛?쇱씤(PO4-P)', '?뚯뭡由щ룄(ALK)'];
      const rows = db.prepare(
        "SELECT item_name, COALESCE(default_amount, 0) AS default_amount FROM config_items WHERE category = 'kit'"
      ).all();
      const rowMap = Object.fromEntries(rows.map(r => [r.item_name, r.default_amount]));
      const items = BASE_KITS.map(name => ({ item_name: name, default_amount: rowMap[name] ?? 0 }));
      res.json({ success: true, items });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ?? ?ㅽ듃 湲곕낯 ?낃퀬???????
  router.post('/api/settings/kit-defaults', (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ success: false, message: 'items 諛곗뿴???꾩슂?⑸땲??' });
    }
    try {
      const stmt = db.prepare(
        "UPDATE config_items SET default_amount = ? WHERE category = 'kit' AND item_name = ?"
      );
      const rows = items.filter((it) => it && String(it.name ?? '').trim());
      let totalChanges = 0;
      db.transaction((list) => {
        for (const it of list) {
          const name = String(it.name ?? '').trim();
          if (!name) continue;
          const raw = it.defaultAmount ?? it.default_amount ?? 0;
          const amt = Number(raw);
          const safeAmt = Number.isFinite(amt) ? amt : 0;
          totalChanges += stmt.run(safeAmt, name).changes;
        }
      })(rows);

      if (rows.length > 0 && totalChanges === 0) {
        return res.json({
          success: false,
          message:
            'DB???ㅽ듃 ??ぉ怨??대쫫???섎굹??留욎? ?딆븘 ??λ릺吏 ?딆븯?듬땲?? ?ㅼ젙 > ?ㅽ듃 ??뿉???ㅽ듃 紐⑸줉??癒쇱? ?곸슜 ??ν븳 ???ㅼ떆 ?쒕룄??二쇱꽭??',
          updatedCount: 0,
        });
      }

      const skipped = rows.length - totalChanges;
      res.json({
        success: true,
        updatedCount: totalChanges,
        ...(skipped > 0
          ? {
              warning: `${skipped}媛???ぉ? config_items ?ㅽ듃紐낃낵 ?쇱튂?섏? ?딆븘 諛섏쁺?섏? ?딆븯?듬땲??`,
            }
          : {}),
      });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ?? 슬러지 諛섏텧愿由щ???湲곕낯?ㅼ젙 議고쉶/?????
  router.get('/api/settings/sludge-export-settings', (req, res) => {
    try {
      const row = db.prepare('SELECT company_name, default_amount FROM sludge_export_settings WHERE id = 1').get();
      res.json({ success: true, settings: row || { company_name: '', default_amount: 0 } });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  router.post('/api/settings/sludge-export-settings', (req, res) => {
    const { companyName, defaultAmount } = req.body || {};
    try {
      db.prepare(`
        INSERT INTO sludge_export_settings (id, company_name, default_amount, updated_at)
        VALUES (1, ?, ?, datetime('now', 'localtime'))
        ON CONFLICT(id) DO UPDATE SET
          company_name = excluded.company_name,
          default_amount = excluded.default_amount,
          updated_at = excluded.updated_at
      `).run(String(companyName || ''), Number(defaultAmount) || 0);

      const row = db.prepare('SELECT company_name, default_amount FROM sludge_export_settings WHERE id = 1').get();
      res.json({ success: true, settings: row });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ?? 珥덇린 ?숆린?? 濡쒖뺄 DB??紐⑤뱺 ?뚯썝/?꾩옣 ??Google Sheets ??
  router.post('/api/settings/sync-initial-to-sheets', async (req, res) => {
    try {
      if (!ENABLE_INITIAL_SYNC_TO_SHEETS) {
        return res.status(403).json({
          success: false,
          message: '珥덇린 ?숆린??湲곕뒫??鍮꾪솢?깊솕?섏뼱 ?덉뒿?덈떎. (ENABLE_INITIAL_SYNC_TO_SHEETS != true)'
        });
      }

      if (!isMembersSheetsConfigured()) {
        return res.status(400).json({ success: false, message: 'Google Sheets???ㅼ젙?섏? ?딆븯?듬땲?? (GOOGLE_MEMBERS_SHEET_ID)' });
      }

      const members = db.prepare('SELECT * FROM members').all();
      const sites = db.prepare('SELECT * FROM sites WHERE is_active = 1').all();

      let memberCount = 0;
      let siteCount = 0;
      const errors = [];

      // ?뚯썝 ?숆린??
      for (const member of members) {
        try {
          await upsertMemberToSheets({
            id: member.id,
            name: member.name,
            password: member.password,
            role: member.role,
            site_name1: member.site_name1,
            phone: member.phone,
            target_lat: member.target_lat,
            target_lng: member.target_lng,
            radius_m: member.radius_m,
            notes: member.notes
          });
          memberCount++;
        } catch (err) {
          errors.push(`?뚯썝 ?숆린???ㅽ뙣 (${member.name}): ${err.message}`);
        }
      }

      // ?꾩옣 ?숆린??
      for (const site of sites) {
        try {
          await upsertSiteToSheets({
            id: site.id,
            site_name: site.site_name,
            manager_name: site.manager_name,
            method: site.method,
            series: site.series,
            is_active: site.is_active
          });
          siteCount++;
        } catch (err) {
          errors.push(`?꾩옣 ?숆린???ㅽ뙣 (${site.site_name}): ${err.message}`);
        }
      }

      res.json({
        success: errors.length === 0,
        message: errors.length === 0 ? '珥덇린 ?숆린???꾨즺' : '珥덇린 ?숆린???쇰? ?ㅽ뙣',
        memberCount,
        siteCount,
        totalCount: memberCount + siteCount,
        errors: errors.length > 0 ? errors : null
      });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  return router;
};
