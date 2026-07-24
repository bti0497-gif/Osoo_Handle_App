const crypto = require('crypto');
const {
  isSheetsConfigured,
  getSites: getSitesFromSheets,
  upsertSite: upsertSiteToSheets,
  deleteSite: deleteSiteFromSheets,
} = require('../sitesSheetsService.cjs');
const { ensureSiteMemberTables, upsertSiteMemberSnapshot } = require('../siteMemberBigQueryService.cjs');
const { syncSiteCredentialsToLocal } = require('./externalCredentialService.cjs');

function upsertLocalSite(db, site) {
  if (!site?.id || !site?.site_name) {
    return;
  }

  const normalizedSiteName = String(site.site_name || '').trim();
  const existingByName = db.prepare('SELECT id FROM sites WHERE site_name = ? LIMIT 1').get(normalizedSiteName);
  const localId = String(existingByName?.id || site.id);
  const targetLat = site.target_lat != null && site.target_lat !== '' ? Number(site.target_lat) : null;
  const targetLng = site.target_lng != null && site.target_lng !== '' ? Number(site.target_lng) : null;
  const radiusM = site.radius_m != null && site.radius_m !== '' ? Number(site.radius_m) : null;

  db.prepare(`
    INSERT INTO sites (id, site_name, manager_name, method, series, target_lat, target_lng, radius_m, qntech_site_id, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
    ON CONFLICT(id) DO UPDATE SET
      site_name = excluded.site_name,
      manager_name = excluded.manager_name,
      method = excluded.method,
      series = excluded.series,
      target_lat = COALESCE(excluded.target_lat, sites.target_lat),
      target_lng = COALESCE(excluded.target_lng, sites.target_lng),
      radius_m = COALESCE(excluded.radius_m, sites.radius_m, 500),
      qntech_site_id = COALESCE(NULLIF(excluded.qntech_site_id, ''), sites.qntech_site_id),
      is_active = excluded.is_active,
      updated_at = datetime('now', 'localtime')
  `).run(
    localId,
    normalizedSiteName,
    String(site.manager_name || '').trim(),
    String(site.method || 'A2O').trim(),
    String(site.series || '1계열').trim(),
    Number.isFinite(targetLat) ? targetLat : null,
    Number.isFinite(targetLng) ? targetLng : null,
    Number.isFinite(radiusM) ? radiusM : null,
    String(site.qntech_site_id || '').trim() || null,
    site.is_active === 0 ? 0 : 1
  );
  db.prepare('UPDATE sites SET radius_m = COALESCE(radius_m, 500) WHERE id = ?').run(localId);
}

function syncLocalSites(db, sites) {
  db.transaction((list) => {
    for (const site of list || []) {
      upsertLocalSite(db, site);
    }
  })(sites);
}

function getLocalActiveSites(db) {
  return db.prepare(`
    SELECT id, site_name, manager_name, method, series, target_lat, target_lng, radius_m, qntech_site_id, is_active
    FROM sites
    WHERE is_active = 1
    ORDER BY COALESCE(created_at, updated_at, '') ASC, id ASC
  `).all();
}

function getFlowOptionForSite(db, series) {
  const prev = db.prepare('SELECT flow_option FROM app_settings WHERE id = 1').get();
  const prevOpt = prev?.flow_option != null ? String(prev.flow_option).trim() : '';
  if (series === '2계열') {
    return prevOpt || 'combined';
  }
  return 'single1';
}

async function listSites(db) {
  let sites = [];
  let source = 'local';

  if (isSheetsConfigured()) {
    try {
      const sheetSites = await getSitesFromSheets();
      const activeSheetSites = sheetSites
        .filter((site) => site.is_active !== 0)
        .map((site) => ({
          id: site.id,
          site_name: site.site_name,
          manager_name: site.manager_name,
          method: site.method,
          series: site.series,
          target_lat: site.target_lat,
          target_lng: site.target_lng,
          radius_m: site.radius_m,
          qntech_site_id: site.qntech_site_id,
          is_active: site.is_active
        }));

      if (activeSheetSites.length > 0) {
        syncLocalSites(db, activeSheetSites);
        sites = getLocalActiveSites(db);
        source = 'sheets';
      }
    } catch (sheetErr) {
      console.warn('[Settings] Sites sheets lookup failed, fallback to local DB:', sheetErr.message);
    }
  }

  if (sites.length === 0) {
    sites = getLocalActiveSites(db);
    source = 'local';
  }

  const koreanSiteNameCollator = new Intl.Collator('ko-KR', {
    usage: 'sort',
    sensitivity: 'base',
    numeric: true,
  });
  sites.sort((left, right) => koreanSiteNameCollator.compare(
    String(left?.site_name || '').trim(),
    String(right?.site_name || '').trim()
  ));

  const current = db.prepare('SELECT site_id FROM app_settings WHERE id = 1').get();
  const currentSiteId = String(current?.site_id || '').trim();

  // 신규 설치(site_id가 비어있는 상태)에서는 자동으로 첫 번째 현장을 할당하지 않는다.
  // 기존 현장이 확정된 DB에서만 현장 매칭과 fallback을 수행한다.
  if (currentSiteId) {
    const matchedSite = sites.find((site) => String(site.id) === currentSiteId);
    if (matchedSite) {
      return { sites, currentSiteId: matchedSite.id, source };
    }
    // 확정 현장이 사이트 목록에서 사라진 경우에만 fallback
    const fallbackSite = sites[0] || null;
    if (fallbackSite) {
      const series = String(fallbackSite.series || '').trim() || '1계열';
      const flowOption = getFlowOptionForSite(db, series);
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
      return { sites, currentSiteId: fallbackSite.id, source };
    }
  }

  return { sites, currentSiteId: currentSiteId || null, source };
}

async function saveSite(payload = {}) {
  const { siteName, managerName, method, series, isActive, siteId } = payload;
  if (!siteName) {
    const err = new Error('siteName이 필요합니다');
    err.statusCode = 400;
    throw err;
  }

  if (!isSheetsConfigured()) {
    const err = new Error('Google Sheets가 설정되지 않았습니다 (GOOGLE_MEMBERS_SHEET_ID)');
    err.statusCode = 400;
    throw err;
  }

  const site = {
    id: String(siteId || crypto.randomUUID()),
    site_name: String(siteName).trim(),
    manager_name: String(managerName || '').trim(),
    method: String(method || 'A2O').trim(),
    series: String(series || '1계열').trim(),
    is_active: isActive === false ? 0 : 1
  };

  await upsertSiteToSheets(site);
  return site;
}

async function deleteSite(db, siteId) {
  const normalizedSiteId = String(siteId || '').trim();
  if (!normalizedSiteId) {
    const err = new Error('siteId가 필요합니다');
    err.statusCode = 400;
    throw err;
  }

  if (!isSheetsConfigured()) {
    const err = new Error('Google Sheets가 설정되지 않았습니다 (GOOGLE_MEMBERS_SHEET_ID)');
    err.statusCode = 400;
    throw err;
  }

  const sheetSites = await getSitesFromSheets();
  const target = sheetSites.find((site) => String(site.id) === normalizedSiteId && site.is_active !== 0);
  if (!target) {
    const err = new Error('해당 사이트를 찾을 수 없습니다.');
    err.statusCode = 404;
    throw err;
  }

  await deleteSiteFromSheets(normalizedSiteId);

  db.transaction(() => {
    db.prepare(`
      UPDATE sites
      SET is_active = 0, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(normalizedSiteId);

    const current = db.prepare('SELECT site_id FROM app_settings WHERE id = 1').get();
    if (current?.site_id === normalizedSiteId) {
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
        fallback?.series || '1계열'
      );
    }
  })();

  return normalizedSiteId;
}

async function selectSite(db, siteId) {
  const normalizedSiteId = String(siteId || '').trim();
  if (!normalizedSiteId) {
    const err = new Error('siteId가 필요합니다');
    err.statusCode = 400;
    throw err;
  }

  let site = null;

  if (isSheetsConfigured()) {
    try {
      const sheetSites = await getSitesFromSheets();
      const matched = sheetSites.find((item) => String(item.id) === normalizedSiteId && item.is_active !== 0);
      if (matched) {
        syncSiteCredentialsToLocal(db, matched);
        site = {
          id: matched.id,
          site_name: matched.site_name,
          manager_name: matched.manager_name,
          method: matched.method,
          series: matched.series,
          target_lat: matched.target_lat,
          target_lng: matched.target_lng,
          radius_m: matched.radius_m,
          qntech_site_id: matched.qntech_site_id
        };
        upsertLocalSite(db, site);
      }
    } catch (sheetErr) {
      console.warn('[Settings] Site select via sheets failed, fallback to local DB:', sheetErr.message);
    }
  }

  if (!site) {
    const localSite = db.prepare(`
      SELECT id, site_name, manager_name, method, series, target_lat, target_lng, radius_m, qntech_site_id
      FROM sites
      WHERE id = ? AND is_active = 1
      LIMIT 1
    `).get(normalizedSiteId);

    if (localSite) {
      site = {
        id: localSite.id,
        site_name: localSite.site_name,
        manager_name: localSite.manager_name,
        method: localSite.method,
        series: localSite.series,
        target_lat: localSite.target_lat,
        target_lng: localSite.target_lng,
        radius_m: localSite.radius_m,
        qntech_site_id: localSite.qntech_site_id
      };
    }
  }

  if (!site) {
    const err = new Error('해당 사이트를 찾을 수 없습니다.');
    err.statusCode = 404;
    throw err;
  }

  const series = String(site.series || '').trim() || '1계열';
  const flowOption = getFlowOptionForSite(db, series);

  db.prepare(`
    UPDATE app_settings
    SET site_id = ?, site_name = ?, manager_name = ?, method = ?, series = ?, flow_option = ?, qntech_site_id = ?
    WHERE id = 1
  `).run(
    site.id,
    site.site_name || '',
    site.manager_name || '',
    site.method || 'A2O',
    series,
    flowOption,
    String(site.qntech_site_id || '').trim() || null
  );

  const localSite = db.prepare(`
    SELECT id, site_name, manager_name, method, series, target_lat, target_lng, radius_m, qntech_site_id
    FROM sites
    WHERE id = ?
    LIMIT 1
  `).get(site.id);

  return localSite || site;
}

async function bootstrapSiteMember(db, {
  site,
  member,
  link,
  syncToBigQuery,
  enableBigQuerySync,
} = {}) {
  if (!site?.siteName || !member?.name || !member?.password) {
    const err = new Error('사이트명 사원명 비밀번호가 필수입니다');
    err.statusCode = 400;
    throw err;
  }

  const appSetting = db.prepare('SELECT site_id FROM app_settings WHERE id = 1').get();
  const siteId = String(site?.id || appSetting?.site_id || crypto.randomUUID());
  const memberId = String(member.id || crypto.randomUUID());
  const now = new Date().toISOString();

  db.transaction(() => {
    const bootSeries = String(site.series || '1계열').trim() || '1계열';
    const bootFlowOpt = bootSeries === '2계열' ? 'combined' : 'single1';
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
      INSERT INTO sites (id, site_name, manager_name, method, series, target_lat, target_lng, radius_m, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now', 'localtime'), datetime('now', 'localtime'))
      ON CONFLICT(id) DO UPDATE SET
        site_name = excluded.site_name,
        manager_name = excluded.manager_name,
        method = excluded.method,
        series = excluded.series,
        target_lat = COALESCE(excluded.target_lat, sites.target_lat),
        target_lng = COALESCE(excluded.target_lng, sites.target_lng),
        radius_m = COALESCE(excluded.radius_m, sites.radius_m, 500),
        updated_at = datetime('now', 'localtime')
    `).run(
      siteId,
      String(site.siteName || '').trim(),
      String(site.managerName || '').trim(),
      String(site.method || 'A2O').trim(),
      String(site.series || '1계열').trim(),
      site.target_lat != null && site.target_lat !== '' ? Number(site.target_lat) : null,
      site.target_lng != null && site.target_lng !== '' ? Number(site.target_lng) : null,
      site.radius_m != null && site.radius_m !== '' ? Number(site.radius_m) : null
    );
    db.prepare('UPDATE sites SET radius_m = COALESCE(radius_m, 500) WHERE id = ?').run(siteId);

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

  let bigQuery = { success: false, message: '동기화 비활성화(ENABLE_SITE_MEMBER_BIGQUERY_SYNC != true)' };
  if (enableBigQuerySync && syncToBigQuery === true) {
    await ensureSiteMemberTables();
    bigQuery = await upsertSiteMemberSnapshot({
      site: {
        id: siteId,
        site_name: String(site.siteName || '').trim(),
        manager_name: String(site.managerName || '').trim(),
        method: String(site.method || 'A2O').trim(),
        series: String(site.series || '1계열').trim(),
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

  return { siteId, memberId, bigQuery };
}

module.exports = {
  upsertLocalSite,
  syncLocalSites,
  getLocalActiveSites,
  listSites,
  saveSite,
  deleteSite,
  selectSite,
  bootstrapSiteMember,
};
