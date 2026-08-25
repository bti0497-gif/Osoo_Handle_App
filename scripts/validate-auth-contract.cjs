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
const loginViewText = read('src/features/auth/LoginView.jsx');
const sessionRestoreText = read('src/features/auth/sessionRestoreFlow.js');
const activeUserText = read('server/services/activeUserSessionService.cjs');
const attendanceBqText = read('server/services/attendanceBigQueryService.cjs');
const attendanceSessionText = read('server/services/attendanceSessionService.cjs');
const remoteSessionDetectText = read('server/services/remoteSessionDetectService.cjs');
const databaseText = read('server/database.cjs');
const appText = read('src/App.jsx');
const mainText = read('src/main.jsx');
const statusBarText = read('src/components/StatusBar.jsx');
const electronMainText = read('electron/main.cjs');
const electronPreloadText = read('electron/preload.cjs');
const updaterText = read('electron/updater.cjs');
const { sanitize: sanitizeDiagnostic } = require('../server/services/diagnosticLogService.cjs');

check(
  containsAll(loginViewText, [
    'type="password"',
    'autoComplete="current-password"',
    "setPass('')",
    'window.requestAnimationFrame(() => passRef.current?.focus())',
    "setError('')",
    'const nativeInput = String(passRef.current?.value || \'\')',
    'await onLogin(name, nativeInput, {',
    "inputSource: 'native-field'",
    'lastInputEditAgeMs:',
    'lastInputResetAgeMs:',
    'lastWindowFocusAgeMs:',
  ]) &&
    !loginViewText.includes('WebkitTextSecurity') &&
    !loginViewText.includes('passRef.current?.select()'),
  'rejected login clears a native password field before retry',
  'login may preserve a stale hidden password or use CSS-only masking'
);

check(
  authModelText.includes("e?.data?.code !== 'LOCAL_API_UNAUTHORIZED'") &&
    authVmText.includes("err?.data?.code !== 'LOCAL_API_UNAUTHORIZED'"),
  'local API authorization failure is not mislabeled as a bad password',
  'local API authorization failure may be shown as an incorrect password'
);

check(
  containsAll(authRoutesText, [
    "const submittedPassword = String(req.body?.password || '')",
    'submittedPasswordLength: submittedPassword.length',
    'storedPasswordLength:',
    'submittedHasOuterWhitespace:',
    'inputLength: submittedPassword.length',
    'savedLength:',
    'lengthMatched:',
    'requestPurpose,',
    'stateMatchesNative:',
    'lastInputResetTrigger,',
    'mismatchCategory,',
    'clientValueLagDetected:',
    "code: 'LOCAL_CREDENTIAL_MISMATCH'",
    'loginAttemptId:',
    'inputSource:',
    'lastInputEditAgeMs:',
    "result: 'rejected'",
  ]) &&
    !authRoutesText.includes('submittedPassword: submittedPassword') &&
    !authRoutesText.includes('passwordValue:'),
  'local-login rejection records safe mismatch metadata without a raw password',
  'local-login rejection diagnostics are missing or may expose a raw password'
);

const sanitizedLoginDiagnostic = sanitizeDiagnostic({
  password: 'must-not-appear',
  inputLength: 0,
  savedLength: 4,
  lengthMatched: false,
  mismatchCategory: 'empty-input',
  clientValueLagDetected: true,
  loginAttemptId: 'attempt-1',
});
check(
  sanitizedLoginDiagnostic.password === '<redacted>' &&
    sanitizedLoginDiagnostic.inputLength === 0 &&
    sanitizedLoginDiagnostic.savedLength === 4 &&
    sanitizedLoginDiagnostic.lengthMatched === false &&
    sanitizedLoginDiagnostic.mismatchCategory === 'empty-input' &&
    sanitizedLoginDiagnostic.clientValueLagDetected === true &&
    sanitizedLoginDiagnostic.loginAttemptId === 'attempt-1',
  'login 401 diagnostics preserve safe cause fields while redacting the raw password',
  'login 401 diagnostic sanitization hides required cause fields or exposes the raw password'
);

check(
  containsAll(contractText, [
    'must authenticate through remote discovery only',
    'Field workers authenticate only against the member information provisioned into the local DB',
    'must not request or compare PC coordinates',
    'must depend only on confirmed remote-session evidence',
    'must not by itself classify the login as remote',
    'store the connection method or program name in `remote_session_type`',
    'Attendance write failure must not block a successful field worker login',
    'must enter the workspace without waiting for location lookup or attendance recording',
    'run in the background after workspace entry',
    'startup shows the existing branded animation while server discovery and session restore run',
    'The login screen and any saved-session restore must remain hidden until that authenticated readiness probe succeeds',
    'must never bypass it',
    'do not expose a login form that can time out before the local API is usable',
    'Record-grid preloading continues in the background and must not block the dashboard',
    'An app update must preserve a same-day field worker session',
    'must be acknowledged and cleared without deleting the saved field worker session',
    'Attendance BigQuery sync may mark local rows synced only after BigQuery succeeds',
  ]),
  'contract document covers login/session/attendance invariants',
  'AUTH_SESSION_CONTRACT.md is missing required invariants'
);

check(
  containsAll(databaseText, [
    "remote_session_evidence, '') LIKE '%tool_running:%'",
    "remote_session_detected = 0",
    "remote_session_type = 'local'",
    'is_synced = 0',
  ]),
  'legacy tray-process attendance false positives are queued for correction',
  'legacy tray-process attendance false positives may remain visible in central monitoring'
);

check(
  containsAll(authRoutesText, [
    'function getMembersFromDriveBackup',
    'function findMemberInDriveBackup',
    'getMembersWithDriveFallback',
    'MEMBER_SHEETS_LOOKUP_TIMEOUT_MS = 8000',
    'getMembersWithTimeout',
    "return { members, source: 'sheets' }",
    "return { members: driveMembers, source: 'drive-json', sheetsError }",
  ]),
  'remote login keeps Sheets primary with Drive JSON fallback',
  'remote login fallback chain was changed or removed'
);

check(
  containsAll(authVmText, [
    'const startBackgroundAttendance = useCallback',
    'const attendance = await AuthModel.recordAttendance(userData)',
    'const isRemote = Boolean(attendance?.remote_session_detected)',
  ]) && containsAll(sessionRestoreText, [
    'const attendance = await AuthModel.recordAttendance(freshData)',
  ]) && !authVmText.includes("'/api/location/current'") && containsAll(attendanceSessionText, [
    'const remoteDetected = Boolean(remote.detected)',
    "const remoteType = remote.sessionType || 'local'",
  ]) && !authRoutesText.includes('effectiveRemoteDetected = remote.detected || !effectiveLocationMatched'),
  'field attendance uses confirmed remote-session evidence without geolocation',
  'field attendance may request coordinates or infer remote access from location failure'
);

check(
  containsAll(remoteSessionDetectText, [
    "sessionType = 'Windows RDP'",
    "sessionType = 'SSH'",
    'const detected = confirmedIndicators.length > 0',
    'evidence: confirmedIndicators.join',
    'observedTools',
  ]) &&
    !remoteSessionDetectText.includes('const detected = indicators.length > 0') &&
    !remoteSessionDetectText.includes('observedIndicators.push'),
  'remote detector separates confirmed sessions from running tray tools',
  'a running remote-control tray process may be misclassified as an active remote session'
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
    'return res.json({ success: true, member: enrichMemberWithSites(member), source })',
  ]),
  'admin discovery-login remains remote-only and receives local multi-site metadata',
  'admin discovery-login remote-only or multi-site metadata contract was changed'
);

check(
  containsAll(authRoutesText, [
    'syncLocalMembers([member])',
    'syncMemberSiteLinks(member)',
    'setActiveUser(localMember || member,',
    'closeStaleOpenSessions(localMember || member)',
  ]),
  'field worker discovery-login refreshes local cache and site links without remote sync',
  'field worker discovery-login side effects were changed'
);

check(
  containsAll(authRoutesText, [
    "router.post('/attendance'",
    'recordAttendanceSessions(db, {',
    'res.json({ success: true, session: activeSession, sessions })',
  ]),
  'attendance login creates or reuses site-isolated same-day sessions',
  'attendance site isolation or duplicate-session prevention was changed'
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
    'isAdminUser(userData) || !sessionToken',
    'localStorage.removeItem(SESSION_KEY)',
    'now.toDateString() !== savedAt.toDateString()',
    'sessionToken',
    'this.clearSession()',
  ]),
  'AuthModel persists only field session tokens and clears stale/admin sessions',
  'AuthModel session persistence contract was changed'
);

check(
  containsAll(authVmText, [
    'AuthModel.saveSession(enrichedUser, AuthModel.loadSession()?.sessionToken)',
    'AuthModel.saveSession(updated, AuthModel.loadSession()?.sessionToken)',
  ]),
  'background attendance and site switching preserve the existing user token',
  'background attendance or site switching may erase the saved user token'
);

check(
  containsAll(authVmText, [
    'resetGlobalElectronSession',
    'onGlobalSessionReset',
  ]) && containsAll(electronPreloadText, [
    "resetGlobalAuthenticatedSession: (options) => ipcRenderer.invoke('auth:resetGlobalSession', options)",
    "ipcRenderer.on('app:global-session-reset', listener)",
  ]) && containsAll(electronMainText, [
    "ipcMain.handle('auth:resetGlobalSession'",
    'sharedAuthenticatedUser = null',
    'siteWindow.close()',
    "mainWindow.webContents.send('app:global-session-reset')",
    'const hideMain = options?.hideMain === true',
    'mainWindow.hide()',
  ]),
  'global logout clears shared authentication, closes site windows, and resets the main renderer',
  'global logout may leave a shared user or an authenticated secondary site window open'
);

check(
  containsAll(authVmText, [
    'const isPrimaryAdminLogin',
    '? await AuthModel.discoveryLogin(normalizedName, password)',
    ': await AuthModel.localLogin(normalizedName, password, {',
    "requestPurpose: 'login-screen'",
  ]) &&
    !authVmText.includes('if (!userData && !isPrimaryAdminLogin)') &&
    !authVmText.includes('userData = await AuthModel.discoveryLogin(normalizedName, password)'),
  'login sources remain admin remote-only and field local-only',
  'login source ordering was changed'
);

check(
  containsAll(authVmText, [
    'startBackgroundAttendance(enrichedUser)',
    'setUser(enrichedUser)',
    'return { success: true, user: enrichedUser',
  ]) && !authVmText.includes('const currentCoords = LOGIN_GEO_CHECK_ENABLED ? await getCurrentCoords() : null;\n\n            const normalizedName'),
  'field login enters immediately and continues attendance in background',
  'location or attendance work may block field login again'
);

check(
  containsAll(authVmText, [
    "setLocationStatus({ status: 'checking', message: '접속 환경 확인 중...' })",
    "setLocationStatus({ status: 'warning', message: `원격 접속: ${remoteName}` })",
    "setLocationStatus({ status: 'error', message: '접속 환경·출근 기록 저장 실패' })",
  ]) && containsAll(appText, [
    'locationStatus={locationStatus}',
  ]) && containsAll(read('src/components/StatusBar.jsx'), [
    "locationStatus.status !== 'idle'",
    'locationStatus.message',
  ]),
  'background connection environment and attendance state is exposed in the existing status bar',
  'background connection environment status UI wiring was removed'
);

check(
  containsAll(authVmText, [
    'checkVersionChanged',
    'clearVersionMarker',
    'AuthModel.restoreSession(savedSession.sessionToken)',
    'const activeSession = await AuthModel.findActiveSession',
    'AuthModel.saveSession(restoredUser, restored.sessionToken)',
  ]) && containsAll(sessionRestoreText, [
    '같은 날 현장관리자 세션 재검증',
    'const savedSession = AuthModel.loadSession()',
  ]) && !sessionRestoreText.includes('버전 변경 감지 → 새로운 로그인 필요'),
  'app update preserves and token-revalidates same-day field sessions',
  'an app update may clear the saved field session or bypass local revalidation'
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

check(
  containsAll(authVmText, [
    'const restoreServerSession = useCallback',
    'AuthModel.restoreSession(savedSession.sessionToken)',
    "new CustomEvent('osoo:server-session-invalid')",
  ]) && containsAll(appText, [
    'onServerRecoveryProgress',
    'restoreServerSession()',
    '서버 연결을 복구하고 있습니다. 현재 화면과 입력 내용은 유지됩니다.',
    '저장된 업무 세션을 안전하게 복원하고 있습니다...',
  ]),
  'embedded server restart restores the signed field session while preserving the mounted app',
  'embedded-server recovery may leave the renderer authenticated but the server session missing'
);

check(
  containsAll(appText, [
    'if (isLoading)',
    '<SplashLoadingView percent={0} label="" showProgress={false} />',
    'preloadRecordGridData().finally',
  ]) && containsAll(mainText, [
    "import SplashLoadingView from './components/SplashLoadingView.jsx'",
    '<SplashLoadingView percent={0} label="앱을 준비하고 있습니다..." showProgress={false} />',
    'await initServerConfig({ waitForReady: true })',
    'window.setTimeout(bootstrapApplication, 2000)',
  ]) &&
    mainText.indexOf('<SplashLoadingView percent={0} label="앱을 준비하고 있습니다..." showProgress={false} />') <
      mainText.indexOf('await initServerConfig({ waitForReady: true })') &&
    !mainText.includes('서버 연결 중...') &&
    !appText.includes('세션 복원 중...') &&
    !appText.includes('if (recordPreloadState.active)') &&
    containsAll(read('src/core/api/serverConfig.js'), [
      'async function probeLoginReady(port)',
      '/api/auth/login-hint',
      'waitForReady ? probeLoginReady(port) : pingPort(port)',
      'if (await probeLoginReady(port)) return true',
    ]),
  'startup animation waits for a ready local server before session restore and dashboard entry',
  'startup/server-ready/session ordering contract was changed'
);

check(
  containsAll(statusBarText, [
    "label: '새 버전 확인'",
    "label: '새 버전 확인됨'",
    '업데이트가 준비되었습니다.',
    'onClick={handleUpdateClick}',
    "api.checkForUpdates?.('status-bar')",
  ]),
  'status bar keeps manual new-version check and ready message',
  'status bar update button or required Korean status messages were removed'
);

check(
  containsAll(appText, [
    "taskType === 'update-check'",
    "checkForUpdates?.('idle')",
    "getUpdateStatus?.()",
  ]) && containsAll(electronMainText, [
    "'Osoo_Handle_App', 'logs', 'electron-updater.log'",
  ]) && containsAll(updaterText, [
    "writeUpdateLog('check-requested'",
    "writeUpdateLog('check-completed'",
    "writeUpdateLog('check-failed'",
    "writeUpdateLog('update-downloaded'",
    "writeUpdateLog('install-started'",
  ]),
  'idle update check and dedicated updater log contract',
  'idle update check or updater diagnostic logging contract was removed'
);

console.log(`[AUTH SUMMARY] pass=${passed} fail=${failed}`);
if (failed > 0) process.exit(1);
