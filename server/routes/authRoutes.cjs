const express = require('express');
const { issueLocalSessionToken, verifyLocalSessionToken } = require('../services/localSessionTokenService.cjs');
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
function detectRemoteSession(...args) {
  return require('../services/remoteSessionDetectService.cjs').detectRemoteSession(...args);
}
function recordAttendanceSessions(...args) {
  return require('../services/attendanceSessionService.cjs').recordAttendanceSessions(...args);
}
function notifyBigQueryUserActivity(...args) {
  return require('../services/bigQueryTriggerService.cjs').notifyUserActivity(...args);
}
function runBigQuerySyncIfIdle(...args) {
  return require('../services/bigQueryTriggerService.cjs').runSyncIfIdle(...args);
}
function createUserIdleGuard(...args) {
  return require('../services/bigQueryTriggerService.cjs').createUserIdleGuard(...args);
}
function processPendingBackgroundFileTasks(...args) {
  return require('../services/backgroundFileTaskService.cjs').processPendingBackgroundFileTasks(...args);
}
function setActiveUser(...args) {
  return require('../services/activeUserSessionService.cjs').setActiveUser(...args);
}
function clearActiveUser(...args) {
  return require('../services/activeUserSessionService.cjs').clearActiveUser(...args);
}
function getActiveUser(...args) {
  return require('../services/activeUserSessionService.cjs').getActiveUser(...args);
}
function recordDiagnostic(...args) {
  return require('../services/diagnosticLogService.cjs').recordDiagnostic(...args);
}
function uploadPendingDiagnostics(...args) {
  return require('../services/diagnosticLogService.cjs').uploadPendingDiagnostics(...args);
}
function cleanupOldDiagnosticsOnVersionStart(...args) {
  return require('../services/diagnosticLogService.cjs').cleanupOldDiagnosticsOnVersionStart(...args);
}

module.exports = (db, appDataPath) => {
    const router = express.Router();
    const toSessionMember = (member) => {
        const { password, ...safeMember } = member || {};
        return safeMember;
    };
    const buildFieldLoginResponse = (member, source) => ({
        success: true,
        member: toSessionMember(enrichMemberWithSites(member)),
        sessionToken: issueLocalSessionToken(member),
        source,
    });
    const BACKGROUND_TASK_TYPES = new Set([
        'attendance-sync',
        'data-sync',
        'file-sync',
        'certificate-cache',
        'board-cache',
        'diagnostic-sync',
        'update-check',
    ]);
    const normalizeBackgroundTaskType = (value) => {
        const taskType = String(value || '').trim();
        return BACKGROUND_TASK_TYPES.has(taskType) ? taskType : '';
    };
    const requireBackgroundFieldSession = (req, res, next) => {
        const activeUser = getActiveUser();
        if (!activeUser) return res.status(401).json({ success: false, error: 'active field session required' });
        const role = String(activeUser.role || '').trim();
        if (role === 'admin' || role === 'group_admin' || role === 'super_admin' || role === 'central_admin') {
            return res.status(403).json({ success: false, error: 'background field sync is disabled for admin sessions' });
        }
        req.backgroundActiveUser = activeUser;
        return next();
    };

    db.exec(`
      CREATE TABLE IF NOT EXISTS background_tasks (
        task_type TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_run_at TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      UPDATE background_tasks
      SET status = 'pending', updated_at = CURRENT_TIMESTAMP
      WHERE status = 'running';
    `);

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

    const MEMBER_SHEETS_LOOKUP_TIMEOUT_MS = 8000;
    const getMembersWithTimeout = () => new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            callback(value);
        };
        const timer = setTimeout(() => {
            finish(reject, new Error(`Google Sheets 회원 조회 시간 초과 (${MEMBER_SHEETS_LOOKUP_TIMEOUT_MS}ms)`));
        }, MEMBER_SHEETS_LOOKUP_TIMEOUT_MS);
        timer.unref?.();
        Promise.resolve()
            .then(() => getMembers())
            .then((members) => finish(resolve, members))
            .catch((error) => finish(reject, error));
    });

    const getMembersWithDriveFallback = async () => {
        let sheetsError = null;
        if (isSheetsConfigured()) {
            try {
                const members = await getMembersWithTimeout();
                if (Array.isArray(members) && members.length > 0) {
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
        const multiSiteSettings = db.prepare(`
            SELECT site_id, multi_site_enabled, primary_site_id, secondary_site_id
            FROM app_settings WHERE id = 1
        `).get() || {};
        if (Number(multiSiteSettings.multi_site_enabled || 0) === 1) {
            const pairIds = [multiSiteSettings.primary_site_id, multiSiteSettings.secondary_site_id]
                .map((value) => String(value || '').trim())
                .filter(Boolean);
            for (const pairId of pairIds) {
                if (managedSites.some((site) => String(site.id) === pairId)) continue;
                const pairSite = db.prepare(`
                    SELECT id, site_name, manager_name, target_lat, target_lng, radius_m
                    FROM sites WHERE id = ? AND COALESCE(is_active, 1) = 1
                `).get(pairId);
                if (pairSite) {
                    managedSites.push({
                        ...pairSite,
                        manager_name: pairSite.manager_name || '',
                        is_primary: pairId === String(multiSiteSettings.primary_site_id || ''),
                    });
                }
            }
        }
        const currentSiteId = multiSiteSettings.site_id || null;

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
            managed_sites: managedSites,
            multi_site_enabled: Number(multiSiteSettings.multi_site_enabled || 0) === 1,
            primary_site_id: multiSiteSettings.primary_site_id || null,
            secondary_site_id: multiSiteSettings.secondary_site_id || null
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
        const normalizedName = String(req.body?.name || '').trim();
        const submittedPassword = String(req.body?.password || '');
        const rawDiagnosticContext = req.body?.diagnosticContext;
        const diagnosticContext = rawDiagnosticContext && typeof rawDiagnosticContext === 'object'
            ? rawDiagnosticContext
            : {};
        const safeCount = (value) => {
            const count = Number(value);
            return Number.isInteger(count) && count >= 0 && count <= 1000 ? count : null;
        };
        const requestPurpose = ['login-screen', 'current-entry-verification'].includes(diagnosticContext.requestPurpose)
            ? diagnosticContext.requestPurpose
            : 'unspecified';
        const lastInputResetTrigger = ['none', 'electron-restored', 'window-focus'].includes(diagnosticContext.lastInputResetTrigger)
            ? diagnosticContext.lastInputResetTrigger
            : 'unknown';
        const safeClientContext = {
            requestPurpose,
            clientStateLength: safeCount(diagnosticContext.clientStateLength),
            nativeFieldLength: safeCount(diagnosticContext.nativeFieldLength),
            stateMatchesNative: typeof diagnosticContext.stateMatchesNative === 'boolean'
                ? diagnosticContext.stateMatchesNative
                : null,
            windowFocused: typeof diagnosticContext.windowFocused === 'boolean'
                ? diagnosticContext.windowFocused
                : null,
            inputResetCount: safeCount(diagnosticContext.inputResetCount),
            lastInputResetTrigger,
        };
        try {
            recordDiagnostic(db, appDataPath, {
                level: 'info',
                area: 'auth',
                action: 'local-login',
                result: 'received',
                message: 'local field login request received',
                details: {
                    nameProvided: Boolean(normalizedName),
                    passwordProvided: Boolean(submittedPassword),
                    inputPresent: Boolean(submittedPassword),
                    inputLength: submittedPassword.length,
                    ...safeClientContext,
                },
            });
            const namedMember = db.prepare('SELECT * FROM members WHERE name = ?').get(normalizedName);
            const member = namedMember
                && String(namedMember.password || '') === submittedPassword
                ? namedMember
                : null;
            if (member) {
                if (String(member.role || '').trim() === 'admin' || String(member.role || '').trim() === 'group_admin' || String(member.name || '').trim() === 'admin') {
                    db.prepare('DELETE FROM members WHERE id = ? OR name = ?').run(member.id, member.name);
                    return res.status(401).json({ success: false, message: 'admin 계정은 로컬 캐시 로그인을 사용할 수 없습니다.' });
                }
                setActiveUser(member, 'local-login');
                closeStaleOpenSessions(member);
                recordDiagnostic(db, appDataPath, {
                    level: 'info',
                    area: 'auth',
                    action: 'local-login',
                    result: 'accepted',
                    message: 'local field login credential verified',
                    details: {
                        memberId: member.id,
                        role: member.role || 'user',
                        ...safeClientContext,
                    },
                });
                res.json(buildFieldLoginResponse(member, 'local'));
                // 로그인 응답은 로컬 자격 확인만으로 즉시 끝낸다. Drive/BigQuery는
                // 응답 이후 별도 작업으로 넘겨 외부 장애가 업무 화면 진입을 막지 않게 한다.
            } else {
                recordDiagnostic(db, appDataPath, {
                    level: 'warn',
                    area: 'auth',
                    action: 'local-login',
                    result: 'rejected',
                    message: 'local field login credential rejected',
                    details: {
                        nameMatched: Boolean(namedMember),
                        submittedPasswordLength: submittedPassword.length,
                        storedPasswordLength: namedMember
                            ? String(namedMember.password || '').length
                            : null,
                        submittedHasOuterWhitespace:
                            submittedPassword !== submittedPassword.trim(),
                        inputPresent: Boolean(submittedPassword),
                        inputLength: submittedPassword.length,
                        savedLength: namedMember
                            ? String(namedMember.password || '').length
                            : null,
                        lengthMatched: namedMember
                            ? submittedPassword.length === String(namedMember.password || '').length
                            : null,
                        outerWhitespaceDetected:
                            submittedPassword !== submittedPassword.trim(),
                        ...safeClientContext,
                    },
                });
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
                return res.json({ success: true, member: enrichMemberWithSites(member), source });
            }

            syncLocalMembers([member]);
            syncMemberSiteLinks(member);
            const localMember = db.prepare('SELECT * FROM members WHERE id = ? OR name = ? LIMIT 1').get(member.id, member.name);
            setActiveUser(localMember || member, 'discovery-login');
            closeStaleOpenSessions(localMember || member);
            res.json(buildFieldLoginResponse(localMember || member, source));
            return undefined;
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

    // 로그인 UI 입력 상태 진단. 이름과 비밀번호 등 실제 입력값은 받지 않는다.
    router.post('/ui-diagnostic', (req, res) => {
        const event = String(req.body?.event || '').trim().slice(0, 80);
        if (!event) {
            return res.status(400).json({ success: false, message: '진단 이벤트가 필요합니다.' });
        }
        const details = req.body?.details && typeof req.body.details === 'object'
            ? req.body.details
            : {};
        const id = recordDiagnostic(db, appDataPath, {
            level: 'info',
            area: 'focus',
            action: event,
            result: String(details.result || 'observed').slice(0, 40),
            message: '입력 및 창 포커스 상태 진단',
            details,
        });
        return res.json({ success: true, id });
    });

    // A same-day field session is restored with an opaque signed token, never
    // by keeping or resubmitting a password from renderer storage.
    router.post('/restore-session', (req, res) => {
        try {
            const token = String(req.body?.sessionToken || '');
            const encodedPayload = token.split('.')[0] || '';
            const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
            const memberId = String(payload?.memberId || '').trim();
            const member = memberId
                ? db.prepare('SELECT * FROM members WHERE id = ? LIMIT 1').get(memberId)
                : null;
            if (!member || !verifyLocalSessionToken(token, member)) {
                return res.json({ success: false, message: '저장된 로그인 세션이 만료되었습니다.' });
            }
            if (String(member.role || '').trim() === 'admin' || String(member.name || '').trim() === 'admin') {
                return res.json({ success: false, message: '관리자 세션은 저장할 수 없습니다.' });
            }
            setActiveUser(member, 'session-token-restore');
            return res.json({
                success: true,
                member: toSessionMember(enrichMemberWithSites(member)),
                sessionToken: token,
            });
        } catch (_) {
            return res.json({ success: false, message: '저장된 로그인 세션이 유효하지 않습니다.' });
        }
    });

    router.post('/user-activity', (req, res) => {
        const state = notifyBigQueryUserActivity('renderer-input');
        return res.json({ success: true, ...state });
    });

    router.use('/background-tasks', requireBackgroundFieldSession);

    router.post('/background-tasks/prepare', (req, res) => {
        const taskTypes = Array.isArray(req.body?.taskTypes) ? req.body.taskTypes : [];
        const now = new Date().toISOString();
        const insert = db.prepare(`
          INSERT INTO background_tasks (task_type, status, attempts, next_run_at, updated_at)
          VALUES (?, 'pending', 0, ?, ?)
          ON CONFLICT(task_type) DO UPDATE SET
            status = CASE
              WHEN background_tasks.status = 'completed'
               AND COALESCE(background_tasks.next_run_at, '') <= excluded.next_run_at
              THEN 'pending' ELSE background_tasks.status END,
            updated_at = excluded.updated_at
        `);
        db.transaction(() => {
            taskTypes.map(normalizeBackgroundTaskType).filter(Boolean)
                .forEach((taskType) => insert.run(taskType, now, now));
        })();
        return res.json({ success: true });
    });

    router.get('/background-tasks/pending', (req, res) => {
        const now = new Date().toISOString();
        db.prepare(`
          UPDATE background_tasks SET status = 'pending', updated_at = ?
          WHERE status = 'completed' AND COALESCE(next_run_at, '') <= ?
        `).run(now, now);
        const tasks = db.prepare(`
          SELECT * FROM background_tasks
          WHERE status = 'pending' AND COALESCE(next_run_at, '') <= ?
          ORDER BY updated_at ASC
        `).all(now);
        return res.json({ success: true, tasks });
    });

    router.post('/background-tasks/claim', (req, res) => {
        const taskType = normalizeBackgroundTaskType(req.body?.taskType);
        if (!taskType) return res.status(400).json({ success: false, error: 'invalid background task type' });
        const result = db.prepare(`
          UPDATE background_tasks
          SET status = 'running', attempts = attempts + 1, updated_at = ?
          WHERE task_type = ? AND status = 'pending'
        `).run(new Date().toISOString(), taskType);
        return res.json({ success: true, claimed: result.changes > 0 });
    });

    router.post('/background-tasks/complete', (req, res) => {
        const taskType = normalizeBackgroundTaskType(req.body?.taskType);
        if (!taskType) return res.status(400).json({ success: false, error: 'invalid background task type' });
        const delayMs = Math.max(60000, Number(req.body?.delayMs) || 60 * 60 * 1000);
        const now = new Date();
        db.prepare(`
          UPDATE background_tasks
          SET status = 'completed', last_error = NULL, next_run_at = ?, updated_at = ?
          WHERE task_type = ?
        `).run(new Date(now.getTime() + delayMs).toISOString(), now.toISOString(), taskType);
        return res.json({ success: true });
    });

    router.post('/background-tasks/fail', (req, res) => {
        const taskType = normalizeBackgroundTaskType(req.body?.taskType);
        if (!taskType) return res.status(400).json({ success: false, error: 'invalid background task type' });
        const now = new Date();
        db.prepare(`
          UPDATE background_tasks
          SET status = 'pending', last_error = ?, next_run_at = ?, updated_at = ?
          WHERE task_type = ?
        `).run(
            String(req.body?.error || '').slice(0, 1000),
            new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
            now.toISOString(),
            taskType
        );
        return res.json({ success: true });
    });

    router.post('/background-tasks/run-data-sync', async (req, res) => {
        try {
            const result = await runBigQuerySyncIfIdle('persistent-background-task');
            return res.json({ success: true, result });
        } catch (error) {
            return res.status(500).json({ success: false, error: error.message });
        }
    });

    router.post('/background-tasks/run-file-sync', async (req, res) => {
        try {
            const summary = await processPendingBackgroundFileTasks(db, {
                shouldContinue: createUserIdleGuard(),
                limit: 50,
            });
            return res.json({ success: true, summary });
        } catch (error) {
            return res.status(500).json({ success: false, error: error.message });
        }
    });

    router.post('/background-tasks/run-diagnostic-sync', async (req, res) => {
        try {
            const guard = createUserIdleGuard();
            if (!guard()) return res.json({ success: true, paused: true });
            const cleanup = await cleanupOldDiagnosticsOnVersionStart(db, appDataPath)
                .catch((error) => ({ failed: true, error: error.message }));
            if (!guard()) return res.json({ success: true, paused: true, cleanup });
            const upload = await uploadPendingDiagnostics(db, appDataPath);
            return res.json({ success: true, cleanup, upload });
        } catch (error) {
            return res.status(500).json({ success: false, error: error.message });
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
            const siteId = String(req.siteContext?.siteId || '').trim();
            const activeSession = siteId
                ? db.prepare('SELECT * FROM attendance WHERE member_id = ? AND date = ? AND site_id = ? AND logout_time IS NULL').get(memberId, dateKST, siteId)
                : db.prepare('SELECT * FROM attendance WHERE member_id = ? AND date = ? AND logout_time IS NULL').get(memberId, dateKST);
            if (activeSession) {
                const member = db.prepare('SELECT * FROM members WHERE id = ? LIMIT 1').get(memberId);
                if (member) setActiveUser(member, 'session-restore');
            }
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
        const { memberId, memberName } = req.body;
        const dateKST = getTodayLocal();
        const loginTime = getLocalTime();

        try {
            const requestedSite = {
                site_id: req.siteContext?.siteId || null,
                site_name: req.siteContext?.siteName || '',
            };
            const remote = detectRemoteSession();
            const sessions = recordAttendanceSessions(db, {
                memberId,
                memberName,
                date: dateKST,
                loginTime,
                requestedSite,
                remote,
            });
            const activeSession = sessions.find((session) => String(session.site_id || '') === String(requestedSite.site_id || ''))
                || sessions[0]
                || null;

            res.json({ success: true, session: activeSession, sessions });
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
    router.post('/sync-attendance-bq', requireBackgroundFieldSession, async (req, res) => {
        try {
            if (!createUserIdleGuard()()) {
                return res.status(409).json({ success: false, paused: true, error: 'waiting-for-idle' });
            }
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

