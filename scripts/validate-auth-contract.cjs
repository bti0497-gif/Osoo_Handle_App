#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const BASE_DIR = path.join(__dirname, '..');
let failed = 0;
let passed = 0;

function read(relativePath) {
  const filePath = path.join(BASE_DIR, relativePath);
  if (!fs.existsSync(filePath)) {
    fail(`${relativePath} is missing`);
    return '';
  }
  return fs.readFileSync(filePath, 'utf8');
}

function pass(message) {
  passed += 1;
  console.log(`[AUTH PASS] ${message}`);
}

function fail(message) {
  failed += 1;
  console.error(`[AUTH FAIL] ${message}`);
}

function check(condition, passMessage, failMessage) {
  if (condition) pass(passMessage);
  else fail(failMessage);
}

function containsAll(text, tokens) {
  return tokens.every((token) => text.includes(token));
}

const contractText = read('AUTH_SESSION_CONTRACT.md');
const authRoutesText = read('server/routes/authRoutes.cjs');
const authModelText = read('src/features/auth/AuthModel.js');
const authVmText = read('src/features/auth/useAuthViewModel.js');
const sessionRestoreText = read('src/features/auth/sessionRestoreFlow.js');
const activeUserText = read('server/services/activeUserSessionService.cjs');
const attendanceBqText = read('server/services/attendanceBigQueryService.cjs');
const appText = read('src/App.jsx');

check(
  containsAll(contractText, [
    'must authenticate through remote discovery only',
    'Field workers try local login first, then remote discovery fallback',
    'Attendance write failure must not block a successful field worker login',
    'Attendance BigQuery sync may mark local rows synced only after BigQuery succeeds',
  ]),
  'contract document covers login/session/attendance invariants',
  'AUTH_SESSION_CONTRACT.md is missing required invariants'
);

check(
  containsAll(authRoutesText, [
    'function getMembersFromDriveBackup',
    'function findMemberInDriveBackup',
    'getMembersWithDriveFallback',
    "return { members, source: 'sheets' }",
    "return { members: driveMembers, source: 'drive-json', sheetsError }",
  ]),
  'remote login keeps Sheets primary with Drive JSON fallback',
  'remote login fallback chain was changed or removed'
);

check(
  containsAll(authRoutesText, [
    "router.post('/local-login'",
    "role === 'admin' || role === 'group_admin' || name === 'admin'",
    'DELETE FROM members WHERE id = ? OR name = ?',
    'return res.status(401)',
  ]),
  'admin local-login cache is rejected and purged',
  'admin local-login rejection/purge contract was changed'
);

check(
  containsAll(authRoutesText, [
    "router.post('/discovery-login'",
    'const isAdmin = role ===',
    'if (isAdmin) {',
    'setActiveUser(member, `discovery-login:${source}`)',
    'return res.json({ success: true, member, source })',
  ]),
  'admin discovery-login remains remote-only',
  'admin discovery-login remote-only contract was changed'
);

check(
  containsAll(authRoutesText, [
    'syncLocalMembers([member])',
    'syncMemberSiteLinks(member)',
    'setActiveUser(localMember || member,',
    'closeStaleOpenSessions(localMember || member)',
    "triggerBigQuerySync('login-success:sheets')",
  ]),
  'field worker discovery-login refreshes local cache, site links, active user, and sync trigger',
  'field worker discovery-login side effects were changed'
);

check(
  containsAll(authRoutesText, [
    "router.post('/attendance'",
    'SELECT * FROM attendance WHERE member_id = ? AND date = ? AND logout_time IS NULL',
    'if (!activeSession) {',
    'INSERT INTO attendance',
    'res.json({ success: true, session: activeSession })',
  ]),
  'attendance login reuses open same-day session before inserting',
  'attendance duplicate-session prevention was changed'
);

check(
  containsAll(authRoutesText, [
    "router.post('/logout'",
    'clearActiveUser(memberId)',
    'SET logout_time = ?, auto_logout = ?, is_synced = 0',
    'WHERE member_id = ? AND date = ? AND logout_time IS NULL',
  ]),
  'logout closes open session and marks it unsynced',
  'logout attendance close contract was changed'
);

check(
  containsAll(authRoutesText, [
    "router.post('/sync-attendance-bq'",
    'SELECT * FROM attendance WHERE is_synced = 0',
    'const { syncedIds, errors } = await syncAttendanceLogs',
    'UPDATE attendance SET is_synced = 1 WHERE id IN',
  ]),
  'attendance BigQuery route only marks rows synced after sync result',
  'attendance BigQuery sync marking contract was changed'
);

check(
  containsAll(authModelText, [
    "const SESSION_KEY = 'osoo_user_session'",
    'const ADMIN_ROLES',
    'if (isAdminUser(userData))',
    'localStorage.removeItem(SESSION_KEY)',
    'now.toDateString() !== savedAt.toDateString()',
    'this.clearSession()',
  ]),
  'AuthModel persists field sessions only and clears stale/admin sessions',
  'AuthModel session persistence contract was changed'
);

check(
  containsAll(authVmText, [
    'const isPrimaryAdminLogin',
    '? await AuthModel.discoveryLogin(normalizedName, password)',
    ': await AuthModel.localLogin(normalizedName, password)',
    'if (!userData && !isPrimaryAdminLogin)',
    'userData = await AuthModel.discoveryLogin(normalizedName, password)',
  ]),
  'login order remains admin remote-first and field local-then-remote',
  'login source ordering was changed'
);

check(
  containsAll(authVmText, [
    'try {',
    'await AuthModel.recordAttendance',
    'catch (attErr)',
    'setUser(enrichedUser)',
    'return { success: true, user: enrichedUser',
  ]),
  'field login continues even if attendance write fails',
  'attendance write may now block field login'
);

check(
  containsAll(sessionRestoreText, [
    'checkVersionChanged',
    'AuthModel.clearSession()',
    'const freshData = await AuthModel.localLogin',
    'const activeSession = await AuthModel.findActiveSession',
    'AuthModel.saveSession(restoredUser)',
  ]),
  'stored session restore revalidates and clears on version change',
  'stored session restore revalidation/version contract was changed'
);

check(
  containsAll(activeUserText, [
    "const ADMIN_ROLES = new Set(['admin', 'group_admin', 'super_admin', 'central_admin'])",
    'function setActiveUser',
    'function clearActiveUser',
    'function isAdminSessionActive',
    'module.exports',
  ]),
  'server active user service keeps admin/session primitives',
  'active user service contract was changed'
);

check(
  containsAll(attendanceBqText, [
    'DELETE FROM \\`${DATASET_ID}.attendance\\`',
    'INSERT INTO \\`${DATASET_ID}.attendance\\`',
    'syncedIds.push(...logs.map',
    'errors.push(msg)',
  ]),
  'attendance BigQuery sync preserves success/error split',
  'attendance BigQuery sync success/error contract was changed'
);

check(
  containsAll(appText, [
    'useAuthViewModel',
    '<LoginView onLogin={login} loginHintName={loginHintName} />',
    'onLogout={handleLogout}',
  ]),
  'App remains wired through auth ViewModel and LoginView',
  'App auth wiring was changed'
);

console.log(`[AUTH SUMMARY] pass=${passed} fail=${failed}`);
if (failed > 0) process.exit(1);
