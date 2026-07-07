const express = require('express');
// Lazy require wrappers keep startup validation light.
function syncAttendanceLogs(...args) {
  return require('../services/attendanceBigQueryService.cjs').syncAttendanceLogs(...args);
}
function getMembers(...args) {
  return require('../services/membersSheetsService.cjs').getMembers(...args);
}
function upsertMember(...args) {
  return require('../services/membersSheetsService.cjs').upsertMember(...args);
}
function deleteMember(...args) {
  return require('../services/membersSheetsService.cjs').deleteMember(...args);
}
function isSheetsConfigured(...args) {
  return require('../services/membersSheetsService.cjs').isSheetsConfigured(...args);
}
function getMembersFromDriveBackup(...args) {
  return require('../services/membersDriveBackupService.cjs').getMembersFromDriveBackup(...args);
}
function findMemberInDriveBackup(...args) {
  return require('../services/membersDriveBackupService.cjs').findMemberInDriveBackup(...args);
}
function syncMembersBackupToDrive(...args) {
  return require('../services/membersDriveBackupService.cjs').syncMembersBackupToDrive(...args);
}
function detectRemoteSession(...args) {
  return require('../services/remoteSessionDetectService.cjs').detectRemoteSession(...args);
}
function triggerBigQuerySync(...args) {
  return require('../services/bigQueryTriggerService.cjs').triggerSync(...args);
}
function syncRecentCertificateCacheForSite(...args) {
  return require('../services/certificateCacheSyncService.cjs').syncRecentCertificateCacheForSite(...args);
}
function setActiveUser(...args) {
  return require('../services/activeUserSessionService.cjs').setActiveUser(...args);
}
function clearActiveUser(...args) {
  return require('../services/activeUserSessionService.cjs').clearActiveUser(...args);
}

module.exports = (db) => {
    const router = express.Router();

    const pad2 = (value) => String(value).padStart(2, '0');

    // Return today's date using the PC's local clock (YYYY-MM-DD).
    const getTodayLocal = () => {
        const now = new Date();
        return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    };

    // Store attendance time as local wall-clock time, not UTC.
    const getLocalTime = (date = new Date()) => {
        return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
    };

    const buildAutoLogoutTime = () => {
        return '20:00:00';
    };

    const isWithinSiteRadius = (site, lat, lng) => {
        const targetLat = Number(site?.target_lat);
        const targetLng = Number(site?.target_lng);
        const currentLat = Number(lat);
        const currentLng = Number(lng);
        if (![targetLat, targetLng, currentLat, currentLng].every(Number.isFinite)) return false;

        const radiusM = Number.isFinite(Number(site?.radius_m)) ? Number(site.radius_m) : 500;
        const earthRadiusM = 6371e3;
        const phi1 = (currentLat * Math.PI) / 180;
        const phi2 = (targetLat * Math.PI) / 180;
        const deltaPhi = ((targetLat - currentLat) * Math.PI) / 180;
        const deltaLambda = ((targetLng - currentLng) * Math.PI) / 180;
        const a = Math.sin(deltaPhi / 2) ** 2
            + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
        const distanceM = earthRadiusM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return distanceM <= radiusM;
    };

    const closeStaleOpenSessions = (member) => {
        if (!member?.id || String(member.role || 'user') !== 'user') return;
        const today = getTodayLocal();
        const rows = db.prepare(`
            SELECT id, date
            FROM attendance
            WHERE member_id = ?
              AND logout_time IS NULL
              AND date < ?
        `).all(member.id, today);

        if (!rows.length) return;
        const stmt = db.prepare(`
            UPDATE attendance
            SET logout_time = ?, auto_logout = 1, is_synced = 0
            WHERE id = ?
        `);
        db.transaction(() => {
            for (const row of rows) {
                stmt.run(buildAutoLogoutTime(row.date), row.id);
            }
        })();
    };

    const upsertLocalMember = (member) => {
        if (!member?.id || !member?.name) {
            return;
        }

        const role = String(member.role || '').trim();
        const name = String(member.name || '').trim();
        if (role === 'admin' || role === 'group_admin' || name === 'admin') {
            db.prepare('DELETE FROM members WHERE id = ? OR name = ?').run(member.id, member.name);
            return;
        }

        const existing = db.prepare('SELECT id FROM members WHERE id = ? OR name = ?').get(member.id, member.name);
        if (existing) {
            db.prepare('UPDATE members SET name = ?, password = ?, role = ?, site_name1 = ?, phone = ?, notes = ? WHERE id = ?').run(
                member.name,
                member.password || '',
                member.role || 'user',
                member.site_name1 || null,
                member.phone || null,
                member.notes || null,
                existing.id
            );
            return;
        }

        db.prepare('INSERT INTO members (id, name, password, role, site_name1, phone, notes) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            member.id,
            member.name,
            member.password || '',
            member.role || 'user',
            member.site_name1 || null,
            member.phone || null,
            member.notes || null
        );
    };

    const syncLocalMembers = db.transaction((members) => {
        for (const member of members || []) {
            upsertLocalMember(member);
        }
    });

    const getMembersWithDriveFallback = async () => {
        let sheetsError = null;
        if (isSheetsConfigured()) {
            try {
                const members = await getMembers();
                if (Array.isArray(members) && members.length > 0) {
                    syncMembersBackupToDrive(members).catch((backupErr) => {
                        console.warn('[auth] Drive 회원 백업 갱신 실패:', backupErr.message);
                    });
                    return { members, source: 'sheets' };
                }
                console.warn('[auth] Sheets 회원 목록이 비어 있어 Drive JSON 백업으로 재시도합니다.');
            } catch (err) {
                sheetsError = err;
                console.warn('[auth] Sheets 회원 조회 실패, Drive JSON 백업으로 재시도:', err.message);
            }
        }

        const driveMembers = await getMembersFromDriveBackup();
        if (driveMembers.length > 0) {
            return { members: driveMembers, source: 'drive-json', sheetsError };
        }

        if (sheetsError) throw sheetsError;
        return { members: [], source: 'none' };
    };

    const parseSiteNames = (siteName1) => String(siteName1 || '')
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);

    const resolveManagedSitesForMember = (member) => {
        const memberName = String(member?.name || '').trim();
        const matchedByManager = db.prepare(`
            SELECT id, site_name
            FROM sites
            WHERE COALESCE(is_active, 1) = 1 AND manager_name = ?
            ORDER BY site_name ASC
        `).all(memberName);

        const explicitNames = parseSiteNames(member?.site_name1);
        const explicitSites = explicitNames
            .map((siteName) => db.prepare('SELECT id, site_name FROM sites WHERE COALESCE(is_active, 1) = 1 AND site_name = ?').get(siteName))
            .filter(Boolean);

        const merged = [];
        const used = new Set();
        for (const site of [...matchedByManager, ...explicitSites]) {
            const key = String(site.id);
            if (used.has(key)) continue;
            used.add(key);
            merged.push(site);
        }
        return merged;
    };

    const syncMemberSiteLinks = (member) => {
        if (!member?.id || String(member?.role || '') !== 'user') {
            return;
        }

        const targetSites = resolveManagedSitesForMember(member);
        if (targetSites.length === 0) {
            return;
        }

        const now = new Date().toISOString();
        const targetIds = targetSites.map((site) => String(site.id));
        const joinedSiteNames = targetSites.map((site) => site.site_name).join(', ');
        const upsertLink = db.prepare(`
            INSERT INTO member_sites (member_id, site_id, is_primary, can_manage, is_bidirectional, created_at)
            VALUES (?, ?, ?, 1, ?, datetime('now', 'localtime'))
            ON CONFLICT(member_id, site_id) DO UPDATE SET
                is_primary = excluded.is_primary,
                can_manage = excluded.can_manage,
                is_bidirectional = excluded.is_bidirectional
        `);
        const deleteOtherLinks = db.prepare('DELETE FROM member_sites WHERE member_id = ? AND site_id NOT IN (' + targetIds.map(() => '?').join(',') + ')');
        const updateSiteName = db.prepare('UPDATE members SET site_name1 = ?, updated_at = ? WHERE id = ?');

        db.transaction(() => {
            targetSites.forEach((site, index) => {
                upsertLink.run(
                    String(member.id),
                    String(site.id),
                    index === 0 ? 1 : 0,
                    targetSites.length > 1 ? 1 : 0
                );
            });

            if (targetIds.length > 0) {
                deleteOtherLinks.run(String(member.id), ...targetIds);
            }

            updateSiteName.run(joinedSiteNames, now, String(member.id));
        })();
    };

    const getManagedSitesForMember = (member) => {
        if (!member?.id) return [];

        const role = String(member.role || 'user');
        if (role === 'admin' || role === 'group_admin') {
            const allSites = db.prepare(`
                SELECT id, site_name, manager_name, target_lat, target_lng, radius_m
                FROM sites
                WHERE COALESCE(is_active, 1) = 1
                ORDER BY site_name ASC
            `).all();
            return allSites.map((row) => ({
                id: row.id,
                site_name: row.site_name,
                manager_name: row.manager_name || '',
                target_lat: row.target_lat,
                target_lng: row.target_lng,
                radius_m: row.radius_m,
                is_primary: false
            }));
        }

        const rows = db.prepare(`
            SELECT s.id, s.site_name, s.manager_name, s.target_lat, s.target_lng, s.radius_m, ms.is_primary
            FROM member_sites ms
            JOIN sites s ON s.id = ms.site_id
            WHERE ms.member_id = ? AND COALESCE(s.is_active, 1) = 1
            ORDER BY ms.is_primary DESC, s.site_name ASC
        `).all(String(member.id));

        if (rows.length > 0) {
            return rows.map((row) => ({
                id: row.id,
                site_name: row.site_name,
                manager_name: row.manager_name || '',
                target_lat: row.target_lat,
                target_lng: row.target_lng,
                radius_m: row.radius_m,
                is_primary: Boolean(row.is_primary)
            }));
        }

        const name = String(member.site_name1 || '').trim();
        if (!name) return [];

        const byName = db.prepare('SELECT id, site_name, manager_name, target_lat, target_lng, radius_m FROM sites WHERE site_name = ? AND COALESCE(is_active, 1) = 1 LIMIT 1').get(name);
        if (!byName) return [];

        return [{
            id: byName.id,
            site_name: byName.site_name,
            manager_name: byName.manager_name || '',
            target_lat: byName.target_lat,
            target_lng: byName.target_lng,
            radius_m: byName.radius_m,
            is_primary: true
        }];
    };

    const getManagedSitesByManagerName = (member) => {
        const memberName = String(member?.name || '').trim();
        if (!memberName) return [];
        const rows = db.prepare(`
            SELECT id, site_name, manager_name, target_lat, target_lng, radius_m
            FROM sites
            WHERE COALESCE(is_active, 1) = 1
              AND manager_name = ?
            ORDER BY site_name ASC
        `).all(memberName);
        return rows.map((row, idx) => ({
            id: row.id,
            site_name: row.site_name,
            manager_name: row.manager_name || '',
            target_lat: row.target_lat,
            target_lng: row.target_lng,
            radius_m: row.radius_m,
            is_primary: idx === 0
        }));
    };

    const enrichMemberWithSites = (member) => {
        let managedSites = getManagedSitesForMember(member);
        if (managedSites.length === 0 && String(member?.role || 'user') === 'user') {
            managedSites = getManagedSitesByManagerName(member);
        }
        const currentSiteId = db.prepare('SELECT site_id FROM app_settings WHERE id = 1').get()?.site_id || null;

        let activeSite = null;
        if (currentSiteId) {
            activeSite = managedSites.find((site) => String(site.id) === String(currentSiteId)) || null;
        }
        if (!activeSite) {
            activeSite = managedSites.find((site) => site.is_primary) || managedSites[0] || null;
        }

        return {
            ...member,
            site_id: activeSite?.id || null,
            site_name1: activeSite?.site_name || member?.site_name1 || '',
            target_lat: activeSite?.target_lat ?? member?.target_lat ?? null,
            target_lng: activeSite?.target_lng ?? member?.target_lng ?? null,
            radius_m: activeSite?.radius_m ?? member?.radius_m ?? 500,
            managed_sites: managedSites
        };
    };

    const resolveLoginHintName = () => {
        const settings = db.prepare('SELECT site_name, manager_name FROM app_settings WHERE id = 1').get() || {};
        const managerName = String(settings.manager_name || '').trim();
        const siteName = String(settings.site_name || '').trim();

        if (managerName) {
            const exact = db.prepare('SELECT name FROM members WHERE name = ? LIMIT 1').get(managerName);
            if (exact?.name) return String(exact.name);
        }

        if (siteName) {
            const bySite = db.prepare(`
                SELECT name
                FROM members
                WHERE role = 'user'
                  AND REPLACE(COALESCE(site_name1, ''), ' ', '') LIKE '%' || REPLACE(?, ' ', '') || '%'
                ORDER BY updated_at DESC, created_at DESC
                LIMIT 1
            `).get(siteName);
            if (bySite?.name) return String(bySite.name);
        }

        const fallback = db.prepare(`
            SELECT name
            FROM members
            WHERE role = 'user'
            ORDER BY updated_at DESC, created_at DESC
            LIMIT 1
        `).get();
        return String(fallback?.name || '').trim();
    };

    // 1. Local login.
    router.post('/local-login', async (req, res) => {
        const { name, password } = req.body;
        try {
            const member = db.prepare('SELECT * FROM members WHERE name = ? AND password = ?').get(name, password);
            if (member) {
                if (String(member.role || '').trim() === 'admin' || String(member.role || '').trim() === 'group_admin' || String(member.name || '').trim() === 'admin') {
                    db.prepare('DELETE FROM members WHERE id = ? OR name = ?').run(member.id, member.name);
                    return res.status(401).json({ success: false, message: 'admin 계정은 로컬 캐시 로그인을 사용할 수 없습니다.' });
                }
                setActiveUser(member, 'local-login');
                closeStaleOpenSessions(member);
                try {
                    await syncRecentCertificateCacheForSite({
                        db,
                        siteName: member.site_name1,
                        months: 2,
                    });
                } catch (syncErr) {
                    console.warn('[auth/local-login] certificate cache sync failed (local):', syncErr.message);
                }
                triggerBigQuerySync('login-success:local');
                res.json({ success: true, member: enrichMemberWithSites(member), source: 'local' });
            } else {
                res.status(401).json({ success: false, message: '이름 또는 비밀번호가 일치하지 않습니다.' });
            }
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // Authenticate against the Google Sheets member master.
    // Admin accounts remain remote-only so they can always use the latest credentials.
    router.post('/discovery-login', async (req, res) => {
        const name = String(req.body?.name || '').trim();
        const password = String(req.body?.password || '');

        if (!name || !password) {
            return res.status(400).json({ success: false, message: '이름과 비밀번호를 입력해 주세요.' });
        }

        try {
            const lookup = await getMembersWithDriveFallback();
            const members = lookup.members || [];
            let member = members.find((row) => (
                String(row?.name || '').trim() === name
                && String(row?.password || '') === password
            ));
            let source = lookup.source;
            if (!member) {
                member = await findMemberInDriveBackup(name, password);
                if (member) source = 'drive-json';
            }

            if (!member && lookup.source === 'none') {
                return res.status(503).json({ success: false, message: '회원 조회 설정을 확인할 수 없습니다. Google Sheets 또는 Drive members.json을 확인해 주세요.' });
            }

            if (!member) {
                return res.status(401).json({ success: false, message: '이름 또는 비밀번호가 일치하지 않습니다.' });
            }

            const role = String(member.role || 'user').trim();
            const isAdmin = role === 'admin' || role === 'group_admin' || name === 'admin';
            if (isAdmin) {
                setActiveUser(member, `discovery-login:${source}`);
                return res.json({ success: true, member, source });
            }

            syncLocalMembers([member]);
            syncMemberSiteLinks(member);
            const localMember = db.prepare('SELECT * FROM members WHERE id = ? OR name = ? LIMIT 1').get(member.id, member.name);
            setActiveUser(localMember || member, 'discovery-login');
            closeStaleOpenSessions(localMember || member);
            triggerBigQuerySync('login-success:sheets');

            return res.json({
                success: true,
                member: enrichMemberWithSites(localMember || member),
                source
            });
        } catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    });

    // Provide the default login name for the site manager.
    router.get('/login-hint', (req, res) => {
        try {
            const name = resolveLoginHintName();
            return res.json({ success: true, name });
        } catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    });

    // 2. Sync member data downloaded by admin into the local DB.
    router.post('/sync-member', (req, res) => {
        const { id, name, password, role, site_name1, phone, notes } = req.body;
        try {
            if (name === 'admin') {
                return res.json({ success: true, message: 'admin 계정은 로컬에 저장하지 않습니다.' });
            }

            const existing = db.prepare('SELECT id FROM members WHERE id = ? OR name = ?').get(id, name);
            if (existing) {
                db.prepare('UPDATE members SET name = ?, password = ?, role = ?, site_name1 = ?, phone = ?, notes = ? WHERE id = ?').run(
                    name,
                    password,
                    role,
                    site_name1 || null,
                    phone || null,
                    notes || null,
                    id
                );
            } else {
                db.prepare('INSERT INTO members (id, name, password, role, site_name1, phone, notes) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
                    id,
                    name,
                    password,
                    role,
                    site_name1 || null,
                    phone || null,
                    notes || null
                );
            }
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 3. Find the active attendance session.
    router.post('/session', (req, res) => {
        const { memberId } = req.body;
        const dateKST = getTodayLocal();
        try {
            const activeSession = db.prepare('SELECT * FROM attendance WHERE member_id = ? AND date = ? AND logout_time IS NULL').get(memberId, dateKST);
            res.json({ success: true, session: activeSession || null });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 3b. List attendance logs by date from local SQLite.
    router.get('/attendance', (req, res) => {
        const dateParam = String(req.query.date || '').trim();
        const dateKST = dateParam || getTodayLocal();
        try {
            const rows = db.prepare(`
                SELECT * FROM attendance
                WHERE date = ?
                ORDER BY login_time DESC
            `).all(dateKST);
            res.json({ success: true, logs: rows });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 4. Check-in.
    router.post('/attendance', (req, res) => {
        const { memberId, memberName, lat, lng, locationMatched } = req.body;
        const dateKST = getTodayLocal();
        const loginTime = getLocalTime();

        try {
            const site = db.prepare(`
                SELECT app_settings.site_id, app_settings.site_name, sites.target_lat, sites.target_lng, sites.radius_m
                FROM app_settings
                LEFT JOIN sites ON sites.id = app_settings.site_id
                WHERE app_settings.id = 1
            `).get() || {};
            const remote = detectRemoteSession();
            const siteHasLocation = Number.isFinite(Number(site.target_lat)) && Number.isFinite(Number(site.target_lng));
            const requestHasLocation = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
            const matchedBySite = isWithinSiteRadius(site, lat, lng);
            const effectiveLocationMatched = siteHasLocation && requestHasLocation ? matchedBySite : Boolean(locationMatched);
            const effectiveRemoteDetected = remote.detected || !effectiveLocationMatched;
            const effectiveRemoteType = effectiveLocationMatched ? (remote.sessionType || 'local') : 'abnormal_location';
            const effectiveEvidence = [
                remote.evidence || '',
                siteHasLocation && requestHasLocation && !effectiveLocationMatched ? 'site_location_mismatch' : '',
                siteHasLocation && !requestHasLocation && !locationMatched ? 'site_location_unavailable' : ''
            ].filter(Boolean).join('; ');
            // Reuse an existing active session if one already exists.
            let activeSession = db.prepare('SELECT * FROM attendance WHERE member_id = ? AND date = ? AND logout_time IS NULL').get(memberId, dateKST);

            if (!activeSession) {
                const result = db.prepare(`
          INSERT INTO attendance 
                    (member_id, member_name, site_id, site_name, date, login_time, location_matched, remote_session_detected, remote_session_type, remote_session_evidence) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    memberId,
                    memberName,
                    site.site_id || null,
                    site.site_name || '',
                    dateKST,
                    loginTime,
                    effectiveLocationMatched ? 1 : 0,
                    effectiveRemoteDetected ? 1 : 0,
                    effectiveRemoteType,
                    effectiveEvidence
                );

                activeSession = db.prepare('SELECT * FROM attendance WHERE id = ?').get(result.lastInsertRowid);
            }

            res.json({ success: true, session: activeSession });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 5. Check-out.
    router.post('/logout', (req, res) => {
        const { memberId, autoLogout } = req.body;
        const dateKST = getTodayLocal();
        const logoutTime = getLocalTime();

        try {
            clearActiveUser(memberId);
            db.prepare(`
        UPDATE attendance 
        SET logout_time = ?, auto_logout = ?, is_synced = 0 
        WHERE member_id = ? AND date = ? AND logout_time IS NULL
      `).run(logoutTime, autoLogout ? 1 : 0, memberId, dateKST);

            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    router.post('/logout-current', (req, res) => {
        try {
            clearActiveUser();
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 6. Return unsynced attendance logs from local storage.
    router.get('/unsynced-attendance', (req, res) => {
        try {
            const logs = db.prepare('SELECT * FROM attendance WHERE is_synced = 0 ORDER BY login_time ASC').all();
            res.json({ success: true, logs });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 7. Mark attendance logs as synced.
    router.post('/mark-attendance-synced', (req, res) => {
        const { ids } = req.body; // Array of IDs
        try {
            if (ids && ids.length > 0) {
                const placeholders = ids.map(() => '?').join(',');
                db.prepare(`UPDATE attendance SET is_synced = 1 WHERE id IN (${placeholders})`).run(...ids);
            }
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 8. Sync attendance logs to BigQuery.
    router.post('/sync-attendance-bq', async (req, res) => {
        try {
            const siteRow = db.prepare('SELECT site_id, site_name FROM app_settings WHERE id = 1').get();
            const siteName = siteRow?.site_name || '';
            const siteId = siteRow?.site_id || null;

            const logs = db.prepare('SELECT * FROM attendance WHERE is_synced = 0 ORDER BY login_time ASC').all();
            if (logs.length === 0) return res.json({ success: true, syncedCount: 0 });

            const { syncedIds, errors } = await syncAttendanceLogs(logs, { siteId, siteName });

            if (syncedIds.length > 0) {
                const placeholders = syncedIds.map(() => '?').join(',');
                db.prepare(`UPDATE attendance SET is_synced = 1 WHERE id IN (${placeholders})`).run(...syncedIds);
            }

            res.json({ success: true, syncedCount: syncedIds.length, errors });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 9. List members from Google Sheets.
    router.get('/members', async (req, res) => {
        try {
            if (!isSheetsConfigured()) {
                return res.status(400).json({ success: false, error: 'Google Sheets가 설정되지 않았습니다.' });
            }
            const members = await getMembers();
            res.json({ success: true, members, source: 'sheets' });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 10. Member upsert (Google Sheets)
    router.post('/members', async (req, res) => {
        const member = req.body;
        try {
            if (!isSheetsConfigured()) {
                return res.status(400).json({ success: false, error: 'Google Sheets가 설정되지 않았습니다.' });
            }
            await upsertMember(member);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 11. Delete a member from Google Sheets.
    router.delete('/members/:id', async (req, res) => {
        const { id } = req.params;
        try {
            if (!isSheetsConfigured()) {
                return res.status(400).json({ success: false, error: 'Google Sheets가 설정되지 않았습니다.' });
            }
            const members = await getMembers();
            const matched = members.find((member) => String(member.id) === String(id));
            const target = matched ? { name: matched.name } : null;

            if (!target) {
                return res.status(404).json({ success: false, error: '대상 회원을 찾을 수 없습니다.' });
            }

            if (target.name === 'admin') {
                return res.status(400).json({ success: false, error: '최고관리자(admin) 계정은 삭제할 수 없습니다.' });
            }

            await deleteMember(id);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
};

