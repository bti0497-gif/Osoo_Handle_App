'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');

const remoteDetector = require('../server/services/remoteSessionDetectService.cjs');
const diagnostics = require('../server/services/diagnosticLogService.cjs');
const activeSession = require('../server/services/activeUserSessionService.cjs');
const { closeDueAttendance } = require('../server/services/attendanceAutoLogoutService.cjs');

async function main() {
  const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'osoo-remote-attendance-test-'));
  const db = new Database(':memory:');
  const remoteStatePath = path.join(testDataDir, 'remote-session-state.json');
  const writeRemoteState = (state, checkedAt = new Date().toISOString(), version = '1.0.9') => {
    fs.writeFileSync(remoteStatePath, JSON.stringify({
      version,
      checkedAt,
      state,
      sessionType: state === 'active' ? 'RustDesk' : state === 'unknown' ? 'unknown' : 'local',
      evidence: state === 'active' ? 'rustdesk:visible-remote-session-window' : state,
      observedTools: state === 'active' ? ['RustDesk', 'TeamViewer'] : [],
    }));
  };
  writeRemoteState('active');
  const freshActiveRemote = remoteDetector.detectRemoteSession({ statePath: remoteStatePath });
  assert.equal(freshActiveRemote.detected, true);
  assert.equal(remoteDetector.REMOTE_LOGIN_ENFORCEMENT_ENABLED, false, '원격 로그인 차단은 새 판정 기준이 마련될 때까지 비활성화되어야 합니다.');
  assert.deepEqual(freshActiveRemote.observedTools, ['RustDesk'], '지원하지 않는 도구 이름은 앱 신호에서 제외해야 합니다.');
  writeRemoteState('clear');
  assert.equal(remoteDetector.detectRemoteSession({ statePath: remoteStatePath }).detected, false);
  writeRemoteState('active', new Date(Date.now() - 60_000).toISOString());
  const staleRemote = remoteDetector.detectRemoteSession({ statePath: remoteStatePath });
  assert.equal(staleRemote.detected, false, '오래된 런처 신호는 원격 로그인 차단 근거가 되면 안 됩니다.');
  assert.equal(staleRemote.verificationFailed, true);
  writeRemoteState('active', new Date().toISOString(), '1.0.7');
  assert.equal(remoteDetector.detectRemoteSession({ statePath: remoteStatePath }).verificationFailed, true);

  db.exec(`
    CREATE TABLE members (id TEXT PRIMARY KEY, name TEXT, password TEXT, role TEXT, site_name1 TEXT);
    CREATE TABLE sites (id TEXT PRIMARY KEY, site_name TEXT, manager_name TEXT, target_lat REAL, target_lng REAL, radius_m REAL, is_active INTEGER);
    CREATE TABLE member_sites (member_id TEXT, site_id TEXT, is_primary INTEGER);
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, site_id TEXT, site_name TEXT, multi_site_enabled INTEGER, primary_site_id TEXT, secondary_site_id TEXT);
    CREATE TABLE attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT, member_id TEXT, member_name TEXT, site_id TEXT, site_name TEXT,
      date TEXT, login_time TEXT, logout_time TEXT, location_matched INTEGER DEFAULT 0,
      remote_session_detected INTEGER DEFAULT 0, remote_session_type TEXT, remote_session_evidence TEXT,
      auto_logout INTEGER DEFAULT 0, is_synced INTEGER DEFAULT 0, last_modified TEXT
    );
    CREATE TABLE app_diagnostic_logs (
      id INTEGER PRIMARY KEY, created_at TEXT, level TEXT, area TEXT, action TEXT, result TEXT,
      message TEXT, details_json TEXT, site_id TEXT, site_name TEXT, app_version TEXT
    );
    INSERT INTO members VALUES ('worker-1', '현장근로자', 'test-password', 'user', '시험현장');
    INSERT INTO sites VALUES ('site-1', '시험현장', '현장근로자', NULL, NULL, 500, 1);
    INSERT INTO member_sites VALUES ('worker-1', 'site-1', 1);
    INSERT INTO app_settings VALUES (1, 'site-1', '시험현장', 0, NULL, NULL);
  `);

  let remote = { detected: true, sessionType: 'RustDesk', evidence: 'rustdesk:visible-remote-session-window', observedTools: ['RustDesk'] };
  const detectionOptions = [];
  const originalDetect = remoteDetector.detectRemoteSession;
  const originalUpload = diagnostics.uploadPendingDiagnostics;
  remoteDetector.detectRemoteSession = (options) => {
    detectionOptions.push(options);
    return remote;
  };
  diagnostics.uploadPendingDiagnostics = async () => ({ success: true, count: 0 });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.siteContext = { siteId: 'site-1', siteName: '시험현장' };
    next();
  });
  app.use('/api/auth', require('../server/routes/authRoutes.cjs')(db, testDataDir));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });

  const request = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const countAttendance = () => db.prepare('SELECT COUNT(*) AS n FROM attendance').get().n;
  const countLog = (action) => db.prepare('SELECT COUNT(*) AS n FROM app_diagnostic_logs WHERE action = ?').get(action).n;

  try {
    const unblockedLogin = await request('local-login', { name: '현장근로자', password: 'test-password' });
    assert.equal(detectionOptions.length, 0, '로그인 차단이 비활성화된 동안 로그인은 원격 탐지기를 호출하지 않아야 합니다.');
    assert.equal(unblockedLogin.status, 200, '감지기가 active여도 비활성화 상태에서는 현장 로그인을 막지 않습니다.');
    assert.equal(countAttendance(), 0, '로그인 자체와 출근 기록은 기존처럼 분리되어야 합니다.');
    assert.equal(countLog('remote-login-blocked'), 0);
    assert.ok(activeSession.getActiveUser());

    const payload = { v: 1, memberId: 'worker-1', issuedAt: Date.now(), expiresAt: Date.now() + 3600000, nonce: 'test' };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', 'worker-1\ntest-password').update(encoded).digest('base64url');
    const allowedRestore = await request('restore-session', { sessionToken: `${encoded}.${signature}` });
    assert.equal(detectionOptions.length, 0, '로그인 차단이 비활성화된 동안 세션 복원은 원격 탐지기를 호출하지 않아야 합니다.');
    assert.equal(allowedRestore.status, 200, '감지기가 active여도 세션 복원은 계속 허용해야 합니다.');
    assert.equal(countAttendance(), 0);

    const allowedAttendance = await request('attendance', { memberId: 'worker-1', memberName: '현장근로자' });
    assert.equal(detectionOptions.length, 0, '로그인 차단이 비활성화된 동안 출근기록에 원격 탐지기를 호출하지 않아야 합니다.');
    assert.equal(allowedAttendance.status, 200, '로그인 이후의 출근기록은 원격 신호로 차단하지 않습니다.');
    assert.equal(countAttendance(), 1);
    assert.equal(countLog('remote-attendance-recorded'), 0, '비활성화된 감지 신호를 근태 기록에 귀속하지 않습니다.');
    assert.equal(db.prepare('SELECT remote_session_detected FROM attendance').get().remote_session_detected, 0);

    remote = { detected: false, sessionType: 'local', evidence: '', observedTools: [] };
    const localLogin = await request('local-login', { name: '현장근로자', password: 'test-password' });
    assert.equal(localLogin.status, 200);
    const localAttendance = await request('attendance', { memberId: 'worker-1', memberName: '현장근로자' });
    assert.equal(localAttendance.status, 200);
    assert.equal(countAttendance(), 1);
    assert.ok(db.prepare('SELECT login_time FROM attendance').get().login_time);

    remote = { detected: true, sessionType: 'RustDesk', evidence: 'rustdesk:visible-remote-session-window', observedTools: ['RustDesk'] };
    const manualLogout = await request('logout', { memberId: 'worker-1', autoLogout: false });
    assert.equal(manualLogout.status, 200, '원격 감지로 수동 로그아웃을 막으면 안 됩니다.');
    assert.ok(db.prepare('SELECT logout_time FROM attendance').get().logout_time);
    assert.equal(countLog('remote-logout-allowed'), 0, '비활성화된 감지 신호를 로그아웃 근태 정보에 추가하지 않습니다.');
    assert.equal(db.prepare('SELECT remote_session_detected FROM attendance').get().remote_session_detected, 0);

    db.prepare('UPDATE attendance SET logout_time = NULL, auto_logout = 0').run();
    activeSession.setActiveUser({ id: 'worker-1', name: '현장근로자', role: 'user' }, 'test-session');
    const scheduledLogout = await request('logout', { memberId: 'worker-1', autoLogout: true });
    assert.equal(scheduledLogout.status, 200, '원격 감지 중에도 자동 로그아웃을 완료해야 합니다.');
    assert.equal(db.prepare('SELECT auto_logout FROM attendance').get().auto_logout, 1);
    assert.equal(countLog('remote-auto-logout-allowed'), 0);

    activeSession.setActiveUser({ id: 'worker-1', name: '현장근로자', role: 'user' }, 'test-session');
    const allowedClear = await request('logout-current', {});
    assert.equal(allowedClear.status, 200, '원격 감지로 현장 세션 해제를 막으면 안 됩니다.');
    assert.equal(activeSession.getActiveUser(), null);
    assert.equal(countLog('remote-session-clear-allowed'), 0);

    remote = { detected: false, sessionType: 'local', evidence: '', observedTools: [] };
    const repeatedAttendance = await request('attendance', { memberId: 'worker-1', memberName: '현장근로자' });
    assert.equal(repeatedAttendance.status, 200);
    assert.equal(countAttendance(), 2);
    assert.equal(db.prepare('SELECT remote_session_detected FROM attendance').get().remote_session_detected, 0);

    const date = '2026-09-28';
    db.prepare('UPDATE attendance SET date = ?, logout_time = NULL').run(date);
    assert.equal(closeDueAttendance(db, new Date('2026-09-28T10:59:00Z')), 0);
    assert.equal(closeDueAttendance(db, new Date('2026-09-28T11:00:00Z')), 2);
    assert.deepEqual(db.prepare('SELECT DISTINCT logout_time, auto_logout FROM attendance').all(), [
      { logout_time: '20:00:00', auto_logout: 1 },
    ]);
    console.log('PASS: 원격 신호 관측은 유지, 로그인·세션 복원 차단 비활성화, 출퇴근 원격 플래그 미기록, 서버 20:00 마감');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    remoteDetector.detectRemoteSession = originalDetect;
    diagnostics.uploadPendingDiagnostics = originalUpload;
    activeSession.clearActiveUser();
    db.close();
    assert.ok(testDataDir.startsWith(os.tmpdir() + path.sep));
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
