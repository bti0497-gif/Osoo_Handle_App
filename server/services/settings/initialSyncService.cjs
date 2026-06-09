const { upsertSite: upsertSiteToSheets } = require('../sitesSheetsService.cjs');
const { isSheetsConfigured: isMembersSheetsConfigured, upsertMember: upsertMemberToSheets } = require('../membersSheetsService.cjs');

async function syncInitialToSheets(db, { enabled } = {}) {
  if (!enabled) {
    const err = new Error('초기 동기화 기능이 비활성화되어 있습니다. (ENABLE_INITIAL_SYNC_TO_SHEETS != true)');
    err.statusCode = 403;
    throw err;
  }

  if (!isMembersSheetsConfigured()) {
    const err = new Error('Google Sheets가 설정되지 않았습니다 (GOOGLE_MEMBERS_SHEET_ID)');
    err.statusCode = 400;
    throw err;
  }

  const members = db.prepare('SELECT * FROM members').all();
  const sites = db.prepare('SELECT * FROM sites WHERE is_active = 1').all();

  let memberCount = 0;
  let siteCount = 0;
  const errors = [];

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
      errors.push(`사원 동기화 실패 (${member.name}): ${err.message}`);
    }
  }

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
      errors.push(`사이트 동기화 실패 (${site.site_name}): ${err.message}`);
    }
  }

  return {
    success: errors.length === 0,
    message: errors.length === 0 ? '초기 동기화 완료' : '초기 동기화 중 오류',
    memberCount,
    siteCount,
    totalCount: memberCount + siteCount,
    errors: errors.length > 0 ? errors : null
  };
}

module.exports = {
  syncInitialToSheets,
};
