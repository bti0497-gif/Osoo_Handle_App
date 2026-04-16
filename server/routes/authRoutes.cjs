const express = require('express');
const { syncAttendanceLogs } = require('../services/attendanceBigQueryService.cjs');
const { getMembers, upsertMember, deleteMember, isSheetsConfigured } = require('../services/membersSheetsService.cjs');
const { detectRemoteSession } = require('../services/remoteSessionDetectService.cjs');

module.exports = (db) => {
    const router = express.Router();

    // 현재 날짜 KST 기준으로 구하기 (YYYY-MM-DD)
    const getTodayKST = () => {
        return new Date(new Date().getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
    };

    const upsertLocalMember = (member) => {
        if (!member?.id || !member?.name) {
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
                SELECT id, site_name, manager_name
                FROM sites
                WHERE COALESCE(is_active, 1) = 1
                ORDER BY site_name ASC
            `).all();
            return allSites.map((row) => ({
                id: row.id,
                site_name: row.site_name,
                manager_name: row.manager_name || '',
                is_primary: false
            }));
        }

        const rows = db.prepare(`
            SELECT s.id, s.site_name, s.manager_name, ms.is_primary
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
                is_primary: Boolean(row.is_primary)
            }));
        }

        const name = String(member.site_name1 || '').trim();
        if (!name) return [];

        const byName = db.prepare('SELECT id, site_name, manager_name FROM sites WHERE site_name = ? AND COALESCE(is_active, 1) = 1 LIMIT 1').get(name);
        if (!byName) return [];

        return [{
            id: byName.id,
            site_name: byName.site_name,
            manager_name: byName.manager_name || '',
            is_primary: true
        }];
    };

    const enrichMemberWithSites = (member) => {
        const managedSites = getManagedSitesForMember(member);
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
            managed_sites: managedSites
        };
    };

    // 1. 로컬 로그인
    router.post('/local-login', async (req, res) => {
        const { name, password } = req.body;
        try {
            if (isSheetsConfigured()) {
                try {
                    const members = await getMembers();
                    const member = members.find((item) => item.name === name && item.password === password);
                    if (member) {
                        // 온라인 첫 로그인/정상 로그인 시 로컬 캐시 갱신
                        upsertLocalMember(member);
                        return res.json({ success: true, member: enrichMemberWithSites(member), source: 'sheets' });
                    }
                } catch (sheetErr) {
                    // 시트 조회 실패(네트워크/권한 오류) 시 로컬 캐시로 자동 fallback
                    console.warn('[auth/local-login] Sheets 조회 실패, 로컬 캐시 로그인으로 fallback:', sheetErr.message);
                }
            }

            const member = db.prepare('SELECT * FROM members WHERE name = ? AND password = ?').get(name, password);
            if (member) {
                res.json({ success: true, member: enrichMemberWithSites(member) });
            } else {
                res.status(401).json({ success: false, message: '이름 또는 비밀번호가 일치하지 않습니다.' });
            }
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 2. 관리자가 내려받은 사용자 데이터를 로컬 DB에 저장(동기화)
    router.post('/sync-member', (req, res) => {
        const { id, name, password, role, site_name1, phone, notes } = req.body;
        try {
            if (name === 'admin') {
                return res.json({ success: true, message: 'admin은 로컬에 저장하지 않습니다.' });
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

    // 3. 활성 세션(진행 중인 출근 기록) 찾기
    router.post('/session', (req, res) => {
        const { memberId } = req.body;
        const dateKST = getTodayKST();
        try {
            const activeSession = db.prepare('SELECT * FROM attendance WHERE member_id = ? AND date = ? AND logout_time IS NULL').get(memberId, dateKST);
            res.json({ success: true, session: activeSession || null });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 3b. 일자별 출결 목록 (로컬 SQLite)
    router.get('/attendance', (req, res) => {
        const dateParam = String(req.query.date || '').trim();
        const dateKST = dateParam || getTodayKST();
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

    // 4. 출근 처리
    router.post('/attendance', (req, res) => {
        const { memberId, memberName, lat, lng, locationMatched } = req.body;
        const dateKST = getTodayKST();
        const loginTime = new Date().toISOString();

        try {
            const site = db.prepare('SELECT site_id, site_name FROM app_settings WHERE id = 1').get() || {};
            const remote = detectRemoteSession();
            // 이미 활성 세션이 있는지 확인
            let activeSession = db.prepare('SELECT * FROM attendance WHERE member_id = ? AND date = ? AND logout_time IS NULL').get(memberId, dateKST);

            if (!activeSession) {
                const result = db.prepare(`
          INSERT INTO attendance 
                    (member_id, member_name, site_id, site_name, date, login_time, login_lat, login_lng, location_matched, remote_session_detected, remote_session_type, remote_session_evidence) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    memberId,
                    memberName,
                    site.site_id || null,
                    site.site_name || '',
                    dateKST,
                    loginTime,
                    lat,
                    lng,
                    locationMatched ? 1 : 0,
                    remote.detected ? 1 : 0,
                    remote.sessionType || 'local',
                    remote.evidence || ''
                );

                activeSession = db.prepare('SELECT * FROM attendance WHERE id = ?').get(result.lastInsertRowid);
            }

            res.json({ success: true, session: activeSession });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 5. 퇴근 처리
    router.post('/logout', (req, res) => {
        const { memberId, autoLogout } = req.body;
        const dateKST = getTodayKST();
        const logoutTime = new Date().toISOString();

        try {
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

    // 6. 로컬에 저장된 미동기화 출결 기록 목록 반환
    router.get('/unsynced-attendance', (req, res) => {
        try {
            const logs = db.prepare('SELECT * FROM attendance WHERE is_synced = 0 ORDER BY login_time ASC').all();
            res.json({ success: true, logs });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 7. 동기화 완료 마킹
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

    // 8. 출결 기록 → BigQuery 동기화
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

    // 9. 회원 목록 조회 (Google Sheets)
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

    // 10. 회원 upsert (Google Sheets)
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

    // 11. 회원 삭제 (Google Sheets)
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
