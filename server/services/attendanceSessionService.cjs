'use strict';

function resolveAttendanceSites(db, requestedSite = {}) {
  const multiSite = db.prepare(`
    SELECT multi_site_enabled, primary_site_id, secondary_site_id
    FROM app_settings
    WHERE id = 1
  `).get() || {};

  if (Number(multiSite.multi_site_enabled || 0) !== 1) {
    return [{
      site_id: String(requestedSite.site_id || '').trim() || null,
      site_name: String(requestedSite.site_name || '').trim(),
    }];
  }

  const sites = [multiSite.primary_site_id, multiSite.secondary_site_id]
    .map((siteId) => String(siteId || '').trim())
    .filter(Boolean)
    .map((siteId) => db.prepare(`
      SELECT id AS site_id, site_name
      FROM sites
      WHERE id = ? AND COALESCE(is_active, 1) = 1
    `).get(siteId))
    .filter(Boolean);

  if (sites.length !== 2) {
    const error = new Error('양방향 출결을 기록할 두 현장 정보를 확인하지 못했습니다.');
    error.code = 'ATTENDANCE_SITE_PAIR_INCOMPLETE';
    throw error;
  }
  return sites;
}

function recordAttendanceSessions(db, {
  memberId,
  memberName,
  date,
  loginTime,
  requestedSite = {},
  remote = {},
} = {}) {
  const attendanceSites = resolveAttendanceSites(db, requestedSite);
  const remoteDetected = Boolean(remote.detected);
  const remoteType = remote.sessionType || 'local';
  const remoteEvidence = remote.evidence || '';

  return db.transaction(() => attendanceSites.map((site) => {
    let activeSession = db.prepare(`
      SELECT * FROM attendance
      WHERE member_id = ? AND date = ? AND site_id = ? AND logout_time IS NULL
    `).get(memberId, date, site.site_id);

    if (!activeSession) {
      const result = db.prepare(`
        INSERT INTO attendance
          (member_id, member_name, site_id, site_name, date, login_time, location_matched,
           remote_session_detected, remote_session_type, remote_session_evidence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        memberId,
        memberName,
        site.site_id,
        site.site_name || '',
        date,
        loginTime,
        1,
        remoteDetected ? 1 : 0,
        remoteType,
        remoteEvidence
      );
      activeSession = db.prepare('SELECT * FROM attendance WHERE id = ?').get(result.lastInsertRowid);
    } else {
      db.prepare(`
        UPDATE attendance
        SET site_name = ?,
            remote_session_detected = ?,
            remote_session_type = ?,
            remote_session_evidence = ?,
            is_synced = 0,
            last_modified = datetime('now', 'localtime')
        WHERE id = ?
      `).run(
        site.site_name || '',
        remoteDetected ? 1 : 0,
        remoteType,
        remoteEvidence,
        activeSession.id
      );
      activeSession = db.prepare('SELECT * FROM attendance WHERE id = ?').get(activeSession.id);
    }
    return activeSession;
  }))();
}

module.exports = {
  resolveAttendanceSites,
  recordAttendanceSessions,
};
