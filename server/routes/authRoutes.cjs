const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
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
function isRemoteLoginEnforcementEnabled() {
  return require('../services/remoteSessionDetectService.cjs').REMOTE_LOGIN_ENFORCEMENT_ENABLED === true;
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
function appendRemoteLoginAttemptObservation(...args) {
  return require('../services/remoteSessionObservationSyncService.cjs').appendRemoteLoginAttemptObservation(...args);
}
function cleanupOldDiagnosticsOnVersionStart(...args) {
  return require('../services/diagnosticLogService.cjs').cleanupOldDiagnosticsOnVersionStart(...args);
}

module.exports = (db, appDataPath) => {
    const router = express.Router();
    const detectCurrentRemoteSession = () => detectRemoteSession({
        statePath: path.join(appDataPath, 'runtime', 'remote-session-state.json'),
    });
    const detectEnforcedRemoteSession = () => isRemoteLoginEnforcementEnabled()
        ? detectCurrentRemoteSession()
        : {
            detected: false,
            sessionType: 'local',
            evidence: 'remote-login-enforcement-disabled',
            observedTools: [],
            verificationFailed: false,
        };
    let lastRemoteSignalDiagnosticKey = '';
    let lastRemoteSignalDiagnosticAt = 0;
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

    const recordRemoteAttemptRecord = (db, appDataPath, { name, member, remote, safeClientContext = {} }) => {
        const targetMember = member || (name ? db.prepare('SELECT * FROM members WHERE name = ?').get(name) : null);
        const memberName = targetMember?.name || name || 'unknown';
        const memberId = targetMember?.id || null;

        recordDiagnostic(db, appDataPath, {
            level: 'warn',
            area: 'auth',
            action: 'remote-login-blocked',
            result: 'blocked',
            message: '원격 접속 상태에서 로그인 시도가 차단되었습니다.',
            details: {
                name: memberName,
                memberId,
                remoteSessionType: remote?.sessionType || 'remote',
                remoteEvidence: remote?.evidence || '',
                remoteDetected: Boolean(remote?.detected),
                ...safeClientContext,
            },
        });

        // A rejected login is an attempt, not attendance. Keep its timestamp and
        // evidence in diagnostics without creating an open, login_time=NULL row.

        try {
            uploadPendingDiagnostics(db, appDataPath).catch(() => {});
        } catch (_) {}
    };

    const recordObservedRemoteLoginAttempt = (
        db,
        appDataPath,
        { route, name, member, passwordProvided, remote, safeClientContext = {} }
    ) => {
        const role = String(member?.role || '').trim();
        const sessionState = remote?.detected ? 'active' : remote?.verificationFailed ? 'unknown' : 'clear';
        if (sessionState === 'clear') return false;

        const createdAt = new Date().toISOString();
        const observationId = crypto.randomUUID();
        const tools = Array.isArray(remote?.observedTools)
            ? remote.observedTools.filter((tool) => ['RustDesk', 'Chrome Remote Desktop'].includes(tool))
            : [];
        const enforcementEnabled = isRemoteLoginEnforcementEnabled();
        let inputSignals = { status: 'unavailable', interpretation: 'No fresh input-monitor snapshot was available.' };
        try {
            const snapshot = JSON.parse(fs.readFileSync(path.join(appDataPath, 'runtime', 'remote-input-state.json'), 'utf8'));
            const ageMs = Date.now() - Date.parse(snapshot.checkedAt);
            if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 10000) {
                const numberOrNull = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
                inputSignals = {
                    status: snapshot.keyboardHookReady && snapshot.mouseHookReady ? 'available' : 'partial',
                    snapshotCheckedAt: snapshot.checkedAt || null,
                    ageMs,
                    foregroundIsApp: snapshot.foregroundIsApp === true,
                    keyboardHookReady: snapshot.keyboardHookReady === true,
                    mouseHookReady: snapshot.mouseHookReady === true,
                    keyboardHookError: numberOrNull(snapshot.keyboardHookError),
                    mouseHookError: numberOrNull(snapshot.mouseHookError),
                    windowSeconds: numberOrNull(snapshot.windowSeconds),
                    keyboardInjected: numberOrNull(snapshot.keyboardInjected),
                    keyboardNonInjected: numberOrNull(snapshot.keyboardNonInjected),
                    keyboardInjectedLast5Seconds: numberOrNull(snapshot.keyboardInjectedLast5Seconds),
                    keyboardNonInjectedLast5Seconds: numberOrNull(snapshot.keyboardNonInjectedLast5Seconds),
                    mouseInjected: numberOrNull(snapshot.mouseInjected),
                    mouseNonInjected: numberOrNull(snapshot.mouseNonInjected),
                    mouseInjectedLast5Seconds: numberOrNull(snapshot.mouseInjectedLast5Seconds),
                    mouseNonInjectedLast5Seconds: numberOrNull(snapshot.mouseNonInjectedLast5Seconds),
                    lowerIntegrityInjected: numberOrNull(snapshot.lowerIntegrityInjected),
                    lastInputAgeMs: numberOrNull(snapshot.lastInputAgeMs),
                    lastKeyboardAgeMs: numberOrNull(snapshot.lastKeyboardAgeMs),
                    lastInjectedKeyboardAgeMs: numberOrNull(snapshot.lastInjectedKeyboardAgeMs),
                    lastNonInjectedKeyboardAgeMs: numberOrNull(snapshot.lastNonInjectedKeyboardAgeMs),
                    lastMouseAgeMs: numberOrNull(snapshot.lastMouseAgeMs),
                    lastInjectedMouseAgeMs: numberOrNull(snapshot.lastInjectedMouseAgeMs),
                    lastNonInjectedMouseAgeMs: numberOrNull(snapshot.lastNonInjectedMouseAgeMs),
                    interpretation: 'Windows injection flags are aggregate signals, not proof of input source or remote tool.',
                };
            } else inputSignals = { status: 'stale', ageMs: Number.isFinite(ageMs) ? ageMs : null };
        } catch (_) {}
        try {
            inputSignals.focusToSubmit = require('../services/loginInputIntervalService.cjs')
                .finish(appDataPath, safeClientContext.inputIntervalId);
        } catch (_) { inputSignals.focusToSubmit = { status: 'unavailable' }; }
        const decisionReason = [
            'login-submit',
            `remote-session-${sessionState}`,
            'input-origin-unverified',
            `input-monitor-${inputSignals.status}`,
            enforcementEnabled ? 'policy-enforcement-enabled' : 'policy-observe-only',
        ].join(';');
        const loginAttempt = {
            route,
            attemptId: safeClientContext.loginAttemptId || observationId,
            memberId: member?.id || null,
            memberRole: role || 'unknown',
            attemptedName: String(name || '').slice(0, 120),
            credentialProvided: Boolean(passwordProvided),
            requestPurpose: safeClientContext.requestPurpose || 'unspecified',
            rendererInputSource: safeClientContext.inputSource || 'unknown',
            inputOrigin: 'unverified',
            passwordValueCaptured: false,
        };
        const remoteSession = {
            state: sessionState,
            sessionType: remote?.sessionType || 'unknown',
            evidence: remote?.evidence || '',
            observedTools: tools,
            verificationFailed: Boolean(remote?.verificationFailed),
            stateAgeMs: Number.isFinite(remote?.stateAgeMs) ? remote.stateAgeMs : null,
            watchdogVersion: remote?.watchdogVersion || null,
        };
        const event = {
            observation_id: observationId,
            createdAt,
            version: String(process.env.OSOO_APP_VERSION || ''),
            watchdog_version: String(remote?.watchdogVersion || ''),
            detector_version: String(remote?.detectorVersion || ''),
            action: 'remote-login-attempt',
            result: 'attempt-observed',
            overall_state: sessionState,
            decision_reason: decisionReason,
            rustdesk_state: tools.includes('RustDesk') ? 'active' : sessionState === 'unknown' ? 'unknown' : 'clear',
            rustdesk_evidence: tools.includes('RustDesk') ? 'watchdog-session-active' : 'no-active-session-evidence',
            rustdesk_signal_at: null,
            rustdesk_process_count: null,
            rustdesk_window_detected: null,
            chrome_state: tools.includes('Chrome Remote Desktop') ? 'active' : sessionState === 'unknown' ? 'unknown' : 'clear',
            chrome_evidence: tools.includes('Chrome Remote Desktop') ? 'watchdog-session-active' : 'no-active-session-evidence',
            chrome_event_state: 'not-captured-at-login-submit',
            chrome_event_id: null,
            chrome_event_at: null,
            chrome_signal_age_seconds: null,
            raw_signals: {
                eventKind: 'login-attempt-during-remote-session-state',
                loginAttempt,
                remoteSession,
                inputSignals,
                policy: {
                    enforcementEnabled,
                    blockedByThisObservation: false,
                },
                interpretation: 'A remote session was active or unverifiable when login was submitted; this record does not prove that the input arrived through that remote channel.',
            },
        };

        try {
            appendRemoteLoginAttemptObservation(event, { appDataPath });
        } catch (error) {
            try {
                recordDiagnostic(db, appDataPath, {
                    level: 'error',
                    area: 'auth',
                    action: 'remote-login-attempt-queue',
                    result: 'failed',
                    message: '원격 세션 중 로그인 제출 관측을 동기화 대기열에 기록하지 못했습니다.',
                    details: { errorName: error?.name || 'Error', route, observationId },
                });
            } catch (_) {}
        }

        try {
            recordDiagnostic(db, appDataPath, {
                level: sessionState === 'active' ? 'warn' : 'info',
                area: 'auth',
                action: 'remote-login-attempt-observed',
                result: sessionState === 'active' ? 'remote-session-active-input-origin-unverified' : 'remote-session-state-unknown',
                message: '원격 세션 상태가 활성 또는 미확인인 동안 로그인 제출이 관측되었습니다. 입력 경로는 확인되지 않았습니다.',
                details: {
                    observationId,
                    ...loginAttempt,
                    remoteSession,
                    enforcementEnabled,
                    blocked: false,
                },
            });
        } catch (_) {}
        try {
            uploadPendingDiagnostics(db, appDataPath).catch(() => {});
        } catch (_) {}
        return true;
    };

    router.post('/login-input-interval', (req, res) => {
        // Only anonymous aggregate counters are sampled; no body or input text is read.
        try {
            return res.json(require('../services/loginInputIntervalService.cjs').begin(appDataPath));
        } catch (_) {
            return res.json({ success: true, status: 'monitor-unavailable', intervalId: null });
        }
    });

    router.get('/system-status', (req, res) => {
        res.set('Cache-Control', 'no-store');
        const { memorySnapshot } = require('../services/serverPerformanceDiagnosticService.cjs');
        res.json({ success: true, memory: memorySnapshot().system });
    });

    router.get('/remote-status', (req, res) => {
        try {
            const remote = detectCurrentRemoteSession();
            const signalKey = [remote?.detected ? 'active' : remote?.verificationFailed ? 'unknown' : 'clear', remote?.sessionType, remote?.evidence].join('|');
            const now = Date.now();
            if (signalKey !== lastRemoteSignalDiagnosticKey || now - lastRemoteSignalDiagnosticAt >= 30 * 60 * 1000) {
                lastRemoteSignalDiagnosticKey = signalKey;
                lastRemoteSignalDiagnosticAt = now;
                recordDiagnostic(db, appDataPath, {
                    level: remote?.detected || remote?.verificationFailed ? 'warn' : 'info',
                    area: 'auth',
                    action: 'remote-launcher-signal',
                    result: remote?.detected ? 'active' : remote?.verificationFailed ? 'unknown' : 'clear',
                    message: remote?.detected
                        ? '감시 런처에서 지원 원격 접속의 활성 신호를 받았습니다.'
                        : remote?.verificationFailed
                            ? '감시 런처 원격 접속 신호가 오래됐거나 확인되지 않습니다. 로그인 차단에는 사용하지 않습니다.'
                            : '감시 런처에서 활성 원격 접속이 없음을 확인했습니다.',
                    details: {
                        source: remote?.source || 'watchdog',
                        watchdogVersion: remote?.watchdogVersion || null,
                        sessionType: remote?.sessionType || 'unknown',
                        enforcementEnabled: isRemoteLoginEnforcementEnabled(),
                        stateAgeMs: Number.isFinite(remote?.stateAgeMs) ? remote.stateAgeMs : null,
                        evidence: remote?.evidence || '',
                        observedTools: remote?.observedTools || [],
                        failOpen: Boolean(remote?.verificationFailed),
                    },
                });
            }
            return res.json({
                success: true,
                remote: {
                    detected: Boolean(remote?.detected),
                    enforcementEnabled: isRemoteLoginEnforcementEnabled(),
                    sessionType: remote?.sessionType || 'local',
                    evidence: remote?.evidence || '',
                    observedTools: remote?.observedTools || [],
                    verificationFailed: Boolean(remote?.verificationFailed),
                    watchdogVersion: remote?.watchdogVersion || null,
                    stateAgeMs: Number.isFinite(remote?.stateAgeMs) ? remote.stateAgeMs : null,
                },
            });
        } catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    });

    router.post('/report-remote-attempt', (req, res) => {
        const name = String(req.body?.name || '').trim();
        try {
            const remote = detectEnforcedRemoteSession();
            if (remote.detected && isRemoteLoginEnforcementEnabled()) {
                recordRemoteAttemptRecord(db, appDataPath, { name, remote });
            }
            return res.json({ success: true });
        } catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    });

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
        const safeDuration = (value) => {
            const duration = Number(value);
            return Number.isInteger(duration) && duration >= 0 && duration <= 24 * 60 * 60 * 1000
                ? duration
                : null;
        };
        const requestPurpose = ['login-screen', 'current-entry-verification'].includes(diagnosticContext.requestPurpose)
            ? diagnosticContext.requestPurpose
            : 'unspecified';
        const lastInputResetTrigger = ['none', 'electron-restored', 'window-focus'].includes(diagnosticContext.lastInputResetTrigger)
            ? diagnosticContext.lastInputResetTrigger
            : 'unknown';
        const safeClientContext = {
            requestPurpose,
            inputIntervalId: /^[a-f0-9-]{36}$/i.test(String(diagnosticContext.inputIntervalId || '')) ? diagnosticContext.inputIntervalId : null,
            loginAttemptId: /^[a-z0-9-]{1,64}$/i.test(String(diagnosticContext.loginAttemptId || ''))
                ? String(diagnosticContext.loginAttemptId)
                : null,
            submitSequence: safeCount(diagnosticContext.submitSequence),
            inputSource: diagnosticContext.inputSource === 'native-field'
                ? 'native-field'
                : 'unknown',
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
            lastInputEditAgeMs: safeDuration(diagnosticContext.lastInputEditAgeMs),
            lastInputResetAgeMs: safeDuration(diagnosticContext.lastInputResetAgeMs),
            lastWindowFocusAgeMs: safeDuration(diagnosticContext.lastWindowFocusAgeMs),
        };
        try {
            const namedMember = normalizedName
                ? db.prepare('SELECT * FROM members WHERE name = ?').get(normalizedName)
                : null;
            if (requestPurpose !== 'current-entry-verification') {
                try {
                    const remoteAtSubmit = detectCurrentRemoteSession();
                    recordObservedRemoteLoginAttempt(db, appDataPath, {
                        route: 'local-login',
                        name: normalizedName,
                        member: namedMember,
                        passwordProvided: Boolean(submittedPassword),
                        remote: remoteAtSubmit,
                        safeClientContext,
                    });
                } catch (_) {}
            }
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
            const remote = detectEnforcedRemoteSession();
            if (remote.detected && isRemoteLoginEnforcementEnabled()) {
                recordRemoteAttemptRecord(db, appDataPath, { name: normalizedName, member: namedMember, remote, safeClientContext });
                return res.status(403).json({
                    success: false,
                    code: 'REMOTE_LOGIN_BLOCKED',
                    message: '원격 접속 상태에서는 로그인할 수 없습니다.',
                    error: '원격 접속 상태에서는 로그인할 수 없습니다.',
                    remote: {
                        sessionType: remote.sessionType,
                        evidence: remote.evidence,
                    },
                });
            }
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
                const savedValue = namedMember ? String(namedMember.password || '') : '';
                const mismatchCategory = !namedMember
                    ? 'member-not-found'
                    : !submittedPassword
                        ? 'empty-input'
                        : submittedPassword.length !== savedValue.length
                            ? 'length-mismatch'
                            : 'same-length-value-mismatch';
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
                        savedValuePresent: Boolean(savedValue),
                        savedLength: namedMember ? savedValue.length : null,
                        lengthMatched: namedMember
                            ? submittedPassword.length === savedValue.length
                            : null,
                        sameLengthDifferentValue: Boolean(
                            namedMember
                            && submittedPassword
                            && submittedPassword.length === savedValue.length
                        ),
                        mismatchCategory,
                        clientValueLagDetected: safeClientContext.stateMatchesNative === false,
                        outerWhitespaceDetected:
                            submittedPassword !== submittedPassword.trim(),
                        ...safeClientContext,
                    },
                });
                res.status(401).json({
                    success: false,
                    code: 'LOCAL_CREDENTIAL_MISMATCH',
                    attemptId: safeClientContext.loginAttemptId,
                    message: '이름 또는 비밀번호가 일치하지 않습니다.',
                });
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
        const rawDiagnosticContext = req.body?.diagnosticContext;
        const diagnosticContext = rawDiagnosticContext && typeof rawDiagnosticContext === 'object'
            ? rawDiagnosticContext
            : {};
        const safeClientContext = {
            requestPurpose: 'login-screen',
            inputIntervalId: /^[a-f0-9-]{36}$/i.test(String(diagnosticContext.inputIntervalId || '')) ? diagnosticContext.inputIntervalId : null,
            loginAttemptId: /^[a-z0-9-]{1,64}$/i.test(String(diagnosticContext.loginAttemptId || ''))
                ? String(diagnosticContext.loginAttemptId)
                : null,
            submitSequence: Number.isInteger(Number(diagnosticContext.submitSequence))
                && Number(diagnosticContext.submitSequence) >= 0
                && Number(diagnosticContext.submitSequence) <= 1000
                ? Number(diagnosticContext.submitSequence)
                : null,
            inputSource: diagnosticContext.inputSource === 'native-field' ? 'native-field' : 'unknown',
        };

        let cachedMember = null;
        try {
            cachedMember = name ? db.prepare('SELECT * FROM members WHERE name = ?').get(name) : null;
        } catch (_) {}
        try {
            const remoteAtSubmit = detectCurrentRemoteSession();
            recordObservedRemoteLoginAttempt(db, appDataPath, {
                route: 'discovery-login',
                name,
                member: cachedMember,
                passwordProvided: Boolean(password),
                remote: remoteAtSubmit,
                safeClientContext,
            });
        } catch (_) {}

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

            const remote = detectEnforcedRemoteSession();
            if (remote.detected && isRemoteLoginEnforcementEnabled()) {
                recordRemoteAttemptRecord(db, appDataPath, { name, member, remote });
                return res.status(403).json({
                    success: false,
                    code: 'REMOTE_LOGIN_BLOCKED',
                    message: '원격 접속 상태에서는 로그인할 수 없습니다.',
                    error: '원격 접속 상태에서는 로그인할 수 없습니다.',
                    remote: {
                        sessionType: remote.sessionType,
                        evidence: remote.evidence,
                    },
                });
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
            const remote = detectEnforcedRemoteSession();
            if (remote.detected && isRemoteLoginEnforcementEnabled()) {
                recordRemoteAttemptRecord(db, appDataPath, { name: member.name, member, remote });
                return res.status(403).json({
                    success: false,
                    code: 'REMOTE_LOGIN_BLOCKED',
                    message: '원격 접속 상태에서는 로그인할 수 없습니다.',
                });
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

    // Diagnostic failures must never affect synchronization or its retry policy.
    const recordBackgroundOutcome = (req, taskType, startedAt, evidence) => {
        if (evidence.outcome === 'completed' && Date.now() - startedAt < 10000) return;
        try {
            recordDiagnostic(db, appDataPath, {
                level: evidence.outcome === 'failed' ? 'warn' : 'info',
                area: 'background-sync', action: taskType, result: evidence.outcome,
                siteId: req.siteContext?.siteId || '',
                siteName: req.siteContext?.siteName || undefined,
                message: 'Background synchronization outcome',
                details: { ...evidence, durationMs: Date.now() - startedAt, diagnosticRevision: 1 },
            });
        } catch (_) { /* best-effort evidence only */ }
    };

    router.post('/background-tasks/run-data-sync', async (req, res) => {
        const startedAt = Date.now();
        try {
            const result = await runBigQuerySyncIfIdle('persistent-background-task');
            const { classifyDataSync } = require('../services/backgroundSyncDiagnosticService.cjs');
            recordBackgroundOutcome(req, 'data-sync', startedAt, classifyDataSync(result));
            return res.json({ success: true, result });
        } catch (error) {
            recordBackgroundOutcome(req, 'data-sync', startedAt, { outcome: 'failed', reason: 'execution-error' });
            return res.status(500).json({ success: false, error: error.message });
        }
    });

    router.post('/background-tasks/run-file-sync', async (req, res) => {
        const startedAt = Date.now();
        try {
            const summary = await processPendingBackgroundFileTasks(db, {
                shouldContinue: createUserIdleGuard(),
                limit: 50,
            });
            const { classifyFileSync } = require('../services/backgroundSyncDiagnosticService.cjs');
            recordBackgroundOutcome(req, 'file-sync', startedAt, classifyFileSync(summary));
            return res.json({ success: true, summary });
        } catch (error) {
            recordBackgroundOutcome(req, 'file-sync', startedAt, { outcome: 'failed', reason: 'execution-error' });
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
            const remote = detectEnforcedRemoteSession();
            if (remote.detected) {
                recordDiagnostic(db, appDataPath, {
                    level: 'warn', area: 'auth', action: 'remote-attendance-recorded', result: 'recorded',
                    message: '로그인은 차단 대상이지만 인증된 세션의 출근기록 요청은 허용하고 원격 근거를 함께 기록했습니다.',
                    details: { memberId, remoteSessionType: remote.sessionType, remoteEvidence: remote.evidence },
                });
            }
            const requestedSite = {
                site_id: req.siteContext?.siteId || null,
                site_name: req.siteContext?.siteName || '',
            };
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
            const member = memberId ? db.prepare('SELECT * FROM members WHERE id = ?').get(memberId) : null;
            const isFieldWorker = !member || String(member.role || 'user') === 'user';

            if (isFieldWorker) {
                const remote = detectEnforcedRemoteSession();
                if (remote.detected) {
                    recordDiagnostic(db, appDataPath, {
                        level: 'info',
                        area: 'auth',
                        action: autoLogout ? 'remote-auto-logout-allowed' : 'remote-logout-allowed',
                        result: 'allowed',
                        message: autoLogout
                            ? '원격 접속 감지와 관계없이 예약된 로그아웃을 정상 처리했습니다.'
                            : '원격 접속 감지와 관계없이 사용자의 로그아웃을 허용했습니다.',
                        details: {
                            memberId,
                            memberName: member?.name || 'unknown',
                            remoteSessionType: remote.sessionType,
                            remoteEvidence: remote.evidence,
                            requestedAutoLogout: Boolean(autoLogout),
                        },
                    });
                    db.prepare(`
                        UPDATE attendance
                        SET remote_session_detected = 1,
                            remote_session_type = ?,
                            remote_session_evidence = ?,
                            is_synced = 0,
                            last_modified = datetime('now', 'localtime')
                        WHERE member_id = ? AND date = ? AND logout_time IS NULL AND login_time IS NOT NULL
                    `).run(remote.sessionType || 'remote', remote.evidence || '', memberId, dateKST);
                }
            }

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
            const activeUser = getActiveUser();
            if (activeUser && String(activeUser.role || 'user') === 'user') {
                const remote = detectEnforcedRemoteSession();
                if (remote.detected) {
                    recordDiagnostic(db, appDataPath, {
                        level: 'info', area: 'auth', action: 'remote-session-clear-allowed', result: 'allowed',
                        message: '원격 접속 감지와 관계없이 현장 세션 해제를 허용했습니다.',
                        details: { memberId: activeUser.id, remoteSessionType: remote.sessionType, remoteEvidence: remote.evidence },
                    });
                }
            }
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
