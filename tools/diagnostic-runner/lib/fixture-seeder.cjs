'use strict';

/**
 * fixture seed와 DB 정합성 검사 모듈.
 *
 * - readiness 확인 뒤 임시 osoo.db에 직접 연결해 트랜잭션으로 seed 한다(§Phase 2).
 *   운영 서버에 테스트 전용 fixture API를 추가하지 않는다.
 * - auth 계약: local-login은 members.password 와 평문 비교하며, admin 계정은 거부된다.
 * - site 계약: app_settings(id=1)의 site_id 가 기본 현장이며 sites 행이 활성 상태여야 한다.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 러너는 루트 node_modules 의 better-sqlite3 를 사용한다(독립 의존성 추가 금지 계약과 무관:
// better-sqlite3 는 루트 프로덕션 의존성이다).
// require 경로는 tools/diagnostic-runner/lib -> 루트 node_modules 로 올라가며 해결된다.
const Database = require('better-sqlite3');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadFixtures(runnerRoot) {
  return {
    dataset: readJson(path.join(runnerRoot, 'fixtures', 'base-dataset.json')),
    users: readJson(path.join(runnerRoot, 'fixtures', 'users.json')),
  };
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
}

/**
 * 임시 osoo.db에 기본 dataset(현장, 설정, 멤버)을 seed 한다.
 * 서버가 readiness 이전에 스키마·마이그레이션을 마치므로, seed는 readiness 뒤에만 수행한다.
 */
function seedFixtures({ dbPath, fixtures }) {
  const { dataset, users } = fixtures;
  const db = new Database(dbPath);
  // 서버 초기화(마이그레이션/백업)와 경합할 수 있으므로 잠금 대기를 허용한다.
  db.pragma('busy_timeout = 10000');
  try {
    const seed = db.transaction(() => {
      const siteColumns = tableColumns(db, 'sites');
      const site = dataset.site;
      if (!siteColumns.includes('id') || !siteColumns.includes('site_name')) {
        throw new Error('sites 테이블 스키마가 예상과 다릅니다.');
      }
      db.prepare(`
        INSERT INTO sites (id, site_name, manager_name, method, series, is_active)
        VALUES (@id, @site_name, @manager_name, @method, @series, @is_active)
        ON CONFLICT(id) DO UPDATE SET
          site_name = excluded.site_name,
          manager_name = excluded.manager_name,
          is_active = excluded.is_active
      `).run(site);

      const settingsColumns = tableColumns(db, 'app_settings');
      if (!settingsColumns.includes('site_id')) {
        throw new Error('app_settings.site_id 컬럼이 없습니다. 서버 마이그레이션이 완료되지 않았을 수 있습니다.');
      }
      const settingsAssign = ['site_id', 'multi_site_enabled', 'primary_site_id', 'secondary_site_id']
        .filter((column) => settingsColumns.includes(column));
      const existing = db.prepare('SELECT id FROM app_settings WHERE id = 1').get();
      const values = {
        site_id: site.id,
        multi_site_enabled: dataset.settings.multi_site_enabled,
        primary_site_id: null,
        secondary_site_id: null,
      };
      if (existing) {
        const assignSql = settingsAssign.map((column) => `${column} = @${column}`).join(', ');
        db.prepare(`UPDATE app_settings SET ${assignSql} WHERE id = 1`).run(values);
      } else {
        const columns = ['id', ...settingsAssign].join(', ');
        const params = settingsAssign.map((column) => `@${column}`).join(', ');
        db.prepare(`INSERT INTO app_settings (${columns}) VALUES (1, ${params})`).run(values);
      }

      for (const user of users.users) {
        db.prepare(`
          INSERT INTO members (id, name, password, role)
          VALUES (@id, @name, @password, @role)
          ON CONFLICT(name) DO UPDATE SET password = excluded.password, role = excluded.role
        `).run({ id: user.id, name: user.name, password: user.password, role: user.role });

        db.prepare(`
          INSERT INTO member_sites (member_id, site_id, is_primary, can_manage, is_bidirectional)
          VALUES (@member_id, @site_id, @is_primary, @can_manage, @is_bidirectional)
          ON CONFLICT(member_id, site_id) DO UPDATE SET is_primary = excluded.is_primary
        `).run({
          member_id: user.id,
          site_id: site.id,
          is_primary: dataset.memberSites.is_primary,
          can_manage: dataset.memberSites.can_manage,
          is_bidirectional: dataset.memberSites.is_bidirectional,
        });
      }
    });
    seed();
  } finally {
    db.close();
  }
  return {
    siteId: dataset.site.id,
    siteName: dataset.site.site_name,
    fixedDate: dataset.fixedDate,
    users: users.users.map((user) => ({ name: user.name, role: user.role, localLoginAllowed: user.localLoginAllowed })),
  };
}

/** SQLite quick_check 와 seed 데이터 정합성 요약. 실패 실행 보존 분석에도 사용한다. */
function inspectDatabase({ dbPath, expected }) {
  const db = new Database(dbPath, { readonly: true });
  db.pragma('busy_timeout = 10000');
  try {
    const quickCheck = db.prepare('PRAGMA quick_check').all().map((row) => Object.values(row)[0]);
    const counts = {};
    for (const table of ['sites', 'members', 'member_sites', 'flow_readings']) {
      try {
        counts[table] = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
      } catch (_) {
        counts[table] = null;
      }
    }
    let fixtureIntegrity = 'passed';
    const messages = [];
    if (expected) {
      const site = db.prepare('SELECT id, is_active FROM sites WHERE id = ?').get(expected.siteId);
      if (!site) { fixtureIntegrity = 'failed'; messages.push('seed한 현장이 sites에 없음'); }
      else if (Number(site.is_active) !== 1) { fixtureIntegrity = 'failed'; messages.push('seed한 현장이 비활성 상태'); }
      const settings = db.prepare('SELECT site_id FROM app_settings WHERE id = 1').get();
      if (!settings || settings.site_id !== expected.siteId) {
        fixtureIntegrity = 'failed';
        messages.push('app_settings 기본 현장이 seed 값과 다름');
      }
    }
    return {
      integrityCheck: quickCheck.length === 1 && quickCheck[0] === 'ok' ? 'passed' : 'failed',
      quickCheck,
      counts,
      fixtureIntegrity,
      fixtureMessages: messages,
    };
  } finally {
    db.close();
  }
}

/** 동일 UUID가 실행마다 바뀌지 않도록 진단 전용 결정론적 UUID 생성(필요 시 사용). */
function deterministicUuid(seedText) {
  const hash = crypto.createHash('sha256').update(seedText).digest('hex');
  return [hash.slice(0, 8), hash.slice(8, 12), `4${hash.slice(13, 16)}`, hash.slice(16, 20), hash.slice(20, 32)].join('-');
}

module.exports = { loadFixtures, seedFixtures, inspectDatabase, deterministicUuid };
