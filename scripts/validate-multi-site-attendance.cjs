'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const { recordAttendanceSessions } = require('../server/services/attendanceSessionService.cjs');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY,
    multi_site_enabled INTEGER,
    primary_site_id TEXT,
    secondary_site_id TEXT
  );
  CREATE TABLE sites (
    id TEXT PRIMARY KEY,
    site_name TEXT,
    is_active INTEGER DEFAULT 1
  );
  CREATE TABLE attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id TEXT NOT NULL,
    member_name TEXT NOT NULL,
    site_id TEXT,
    site_name TEXT,
    date TEXT NOT NULL,
    login_time TEXT,
    logout_time TEXT,
    location_matched INTEGER DEFAULT 0,
    remote_session_detected INTEGER DEFAULT 0,
    remote_session_type TEXT,
    remote_session_evidence TEXT,
    auto_logout INTEGER DEFAULT 0,
    is_synced INTEGER DEFAULT 0,
    last_modified TEXT
  );
  INSERT INTO sites (id, site_name) VALUES
    ('site-primary', '동명휴게소(부산방향)'),
    ('site-secondary', '동명휴게소(춘천방향)');
  INSERT INTO app_settings (id, multi_site_enabled, primary_site_id, secondary_site_id)
  VALUES (1, 1, 'site-primary', 'site-secondary');
`);

const payload = {
  memberId: 'worker-1',
  memberName: '현장관리자',
  date: '2026-07-28',
  loginTime: '08:00:00',
  requestedSite: { site_id: 'site-primary', site_name: '동명휴게소(부산방향)' },
  remote: { detected: false, sessionType: 'local', evidence: '' },
};

const first = recordAttendanceSessions(db, payload);
assert.strictEqual(first.length, 2);
assert.deepStrictEqual(first.map((row) => row.site_id).sort(), ['site-primary', 'site-secondary']);

const second = recordAttendanceSessions(db, payload);
assert.strictEqual(second.length, 2);
assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM attendance').get().count, 2);

db.prepare(`
  UPDATE attendance
  SET logout_time = '20:00:00', is_synced = 0
  WHERE member_id = ? AND date = ? AND logout_time IS NULL
`).run(payload.memberId, payload.date);
assert.strictEqual(
  db.prepare('SELECT COUNT(*) AS count FROM attendance WHERE logout_time = ?').get('20:00:00').count,
  2
);

db.close();
console.log('✓ 양방향 로그인은 현장별 출결 2건을 만들고 재호출 시 중복하지 않으며 함께 로그아웃됨');
