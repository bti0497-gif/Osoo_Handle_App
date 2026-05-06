const express = require('express');
const { syncAttendanceLogs } = require('../services/attendanceBigQueryService.cjs');
const { getMembers, upsertMember, deleteMember, isSheetsConfigured } = require('../services/membersSheetsService.cjs');
const { detectRemoteSession } = require('../services/remoteSessionDetectService.cjs');
const { triggerSync: triggerBigQuerySync } = require('../services/bigQueryTriggerService.cjs');
const { syncRecentCertificateCacheForSite } = require('../services/certificateCacheSyncService.cjs');

module.exports = (db) => {
    const router = express.Router();

    // ?꾩옱 ?좎쭨 KST 湲곗??쇰줈 援ы븯湲?(YYYY-MM-DD)
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

    const getManagedSitesByManagerName = (member) => {
        const memberName = String(member?.name || '').trim();
        if (!memberName) return [];
        const rows = db.prepare(`
            SELECT id, site_name, manager_name
            FROM sites
            WHERE COALESCE(is_active, 1) = 1
              AND manager_name = ?
            ORDER BY site_name ASC
        `).all(memberName);
        return rows.map((row, idx) => ({
            id: row.id,
            site_name: row.site_name,
            manager_name: row.manager_name || '',
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

    // 1. 濡쒖뺄 濡쒓렇??
    router.post('/local-login', async (req, res) => {
        const { name, password } = req.body;
        try {
            if (isSheetsConfigured()) {
                try {
                    const members = await getMembers();
                    const member = members.find((item) => item.name === name && item.password === password);
                    if (member) {
                        // ?⑤씪??泥?濡쒓렇???뺤긽 濡쒓렇????濡쒖뺄 罹먯떆 媛깆떊
                        upsertLocalMember(member);
                        try {
                            await syncRecentCertificateCacheForSite({
                                db,
                                siteName: member.site_name1,
                                months: 2,
                            });
                        } catch (syncErr) {
                            console.warn('[auth/local-login] ?깆쟻??罹먯떆 ?숆린???ㅽ뙣(sheets):', syncErr.message);
                        }
                        triggerBigQuerySync('login-success:sheets');
                        return res.json({ success: true, member: enrichMemberWithSites(member), source: 'sheets' });
                    }
                } catch (sheetErr) {
                    // ?쒗듃 議고쉶 ?ㅽ뙣(?ㅽ듃?뚰겕/沅뚰븳 ?ㅻ쪟) ??濡쒖뺄 罹먯떆濡??먮룞 fallback
                    console.warn('[auth/local-login] Sheets 議고쉶 ?ㅽ뙣, 濡쒖뺄 罹먯떆 濡쒓렇?몄쑝濡?fallback:', sheetErr.message);
                }
            }

            const member = db.prepare('SELECT * FROM members WHERE name = ? AND password = ?').get(name, password);
            if (member) {
                try {
                    await syncRecentCertificateCacheForSite({
                        db,
                        siteName: member.site_name1,
                        months: 2,
                    });
                } catch (syncErr) {
                    console.warn('[auth/local-login] ?깆쟻??罹먯떆 ?숆린???ㅽ뙣(local):', syncErr.message);
                }
                triggerBigQuerySync('login-success:local');
                res.json({ success: true, member: enrichMemberWithSites(member) });
            } else {
                res.status(401).json({ success: false, message: '?대쫫 ?먮뒗 鍮꾨?踰덊샇媛 ?쇱튂?섏? ?딆뒿?덈떎.' });
            }
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 濡쒓렇???붾㈃ 湲곕낯媛??꾩옣愿由ъ옄 ?대쫫) ?쒓났
    router.get('/login-hint', (req, res) => {
        try {
            const name = resolveLoginHintName();
            return res.json({ success: true, name });
        } catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    });

    // 2. 愿由ъ옄媛 ?대젮諛쏆? ?ъ슜???곗씠?곕? 濡쒖뺄 DB??????숆린??
    router.post('/sync-member', (req, res) => {
        const { id, name, password, role, site_name1, phone, notes } = req.body;
        try {
            if (name === 'admin') {
                return res.json({ success: true, message: 'admin? 濡쒖뺄????ν븯吏 ?딆뒿?덈떎.' });
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

    // 3. ?쒖꽦 ?몄뀡(吏꾪뻾 以묒씤 異쒓렐 湲곕줉) 李얘린
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

    // 3b. ?쇱옄蹂?異쒓껐 紐⑸줉 (濡쒖뺄 SQLite)
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

    // 4. 異쒓렐 泥섎━
    router.post('/attendance', (req, res) => {
        const { memberId, memberName, lat, lng, locationMatched } = req.body;
        const dateKST = getTodayKST();
        const loginTime = new Date().toISOString();

        try {
            const site = db.prepare('SELECT site_id, site_name FROM app_settings WHERE id = 1').get() || {};
            const remote = detectRemoteSession();
            // ?대? ?쒖꽦 ?몄뀡???덈뒗吏 ?뺤씤
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

    // 5. ?닿렐 泥섎━
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

    // 6. 濡쒖뺄????λ맂 誘몃룞湲고솕 異쒓껐 湲곕줉 紐⑸줉 諛섑솚
    router.get('/unsynced-attendance', (req, res) => {
        try {
            const logs = db.prepare('SELECT * FROM attendance WHERE is_synced = 0 ORDER BY login_time ASC').all();
            res.json({ success: true, logs });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 7. ?숆린???꾨즺 留덊궧
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

    // 8. 異쒓껐 湲곕줉 ??BigQuery ?숆린??
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

    // 9. ?뚯썝 紐⑸줉 議고쉶 (Google Sheets)
    router.get('/members', async (req, res) => {
        try {
            if (!isSheetsConfigured()) {
                return res.status(400).json({ success: false, error: 'Google Sheets媛 ?ㅼ젙?섏? ?딆븯?듬땲??' });
            }
            const members = await getMembers();
            res.json({ success: true, members, source: 'sheets' });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 10. ?뚯썝 upsert (Google Sheets)
    router.post('/members', async (req, res) => {
        const member = req.body;
        try {
            if (!isSheetsConfigured()) {
                return res.status(400).json({ success: false, error: 'Google Sheets媛 ?ㅼ젙?섏? ?딆븯?듬땲??' });
            }
            await upsertMember(member);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 11. ?뚯썝 ??젣 (Google Sheets)
    router.delete('/members/:id', async (req, res) => {
        const { id } = req.params;
        try {
            if (!isSheetsConfigured()) {
                return res.status(400).json({ success: false, error: 'Google Sheets媛 ?ㅼ젙?섏? ?딆븯?듬땲??' });
            }
            const members = await getMembers();
            const matched = members.find((member) => String(member.id) === String(id));
            const target = matched ? { name: matched.name } : null;

            if (!target) {
                return res.status(404).json({ success: false, error: '????뚯썝??李얠쓣 ???놁뒿?덈떎.' });
            }

            if (target.name === 'admin') {
                return res.status(400).json({ success: false, error: '理쒓퀬愿由ъ옄(admin) 怨꾩젙? ??젣?????놁뒿?덈떎.' });
            }

            await deleteMember(id);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
};
