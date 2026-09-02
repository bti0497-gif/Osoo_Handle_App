'use strict';

/**
 * photo-date-compat 시나리오: 큐앤테크 사진 날짜 호환(YYYYDDMM/새 YYYYMMDD) 계약을
 * 실제 앱 코드로 검증한다 — 2026-09 사고(저장/검색 파일명 계약 불일치)의 자동 방어.
 *
 * 검증 경로(외부 큐앤테크·Drive 차단 상태, fixture 재현):
 *   로컬 사진 파일(두 포맷 + 오답 날짜 + 비이미지) seed
 *   -> 실제 resolveRoadworkPhotos(electron/roadworkDumpHelper.cjs)로 검색
 *   -> 항목 키워드 판정(공사입력도우미 자동 첨부 대상)
 *   -> background_file_tasks Drive 업로드 큐 계약(등록·중복 리셋)
 *
 * 주의: resolver는 electron 모듈이므로 스텁 'electron'으로 require한다.
 * require 시점 부작용이 없음(함수 내부에서만 electron API 사용)을 전제로 하며,
 * 모듈 상단에 부작용이 추가되면 load 단계가 실패하며 알려준다.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');

/** electron 스텽을 주입해 roadworkDumpHelper에서 실제 resolver를 꺼낸다. */
function loadPhotoResolver() {
  const Module = require('module');
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') return { session: {}, webContents: { fromId: () => null } };
    return originalLoad.apply(this, [request, parent, isMain]);
  };
  try {
    const helper = require(path.join(PROJECT_ROOT, 'electron', 'roadworkDumpHelper.cjs'));
    return helper.resolveRoadworkPhotos;
  } finally {
    Module._load = originalLoad;
  }
}

function writeFixture(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  // 내용은 이미지일 필요가 없다 — resolver는 확장자/파일명만 본다.
  fs.writeFileSync(file, 'diagnostic-fixture', 'utf8');
  return file;
}

module.exports = {
  id: 'photo-date-compat',
    covers: ["water"],
  version: '0.1.0',
  status: 'implemented',
  async run({ ctx, fixtures, dbPath, expected }) {
    const date = fixtures.dataset.fixedDate; // 2026-08-28
    const appData = path.dirname(dbPath);
    const photoRoot = path.join(appData, '사진관리', '수질분석');
    const monthDir = path.join(photoRoot, date.slice(0, 4), date.slice(5, 7), '데이타불러오기');

    await ctx.step('load-real-resolver', async () => {
      const resolver = loadPhotoResolver();
      ctx.assert(typeof resolver === 'function',
        'electron/roadworkDumpHelper.cjs가 resolveRoadworkPhotos를 export하지 않습니다(또는 모듈 상단에 부작용이 생겼습니다).',
        'RESOLVER_NOT_EXPORTED');
      return typeof resolver;
    });

    await ctx.step('seed-photos-both-formats', async () => {
      // 새 포맷(YYYYMMDD) 저장 규격: <rowId>_<stamp>_<항목>.<ext>
      const modern = writeFixture(monthDir, '1_20260828_알칼리도.jpg');
      // 과거 포맷(YYYYDDMM = 2026-28-08): 정책 교정 전 현장 PC에 남은 이름
      const legacy = writeFixture(monthDir, '2_20262808_암모니아성질소.jpg');
      // 오답: 다른 날짜 스탬프 — 절대 매칭되면 안 된다(과매칭 방어)
      const wrongDate = writeFixture(monthDir, '3_20270102_인산염인.jpg');
      // 비이미지: 무시되어야 한다
      const nonImage = writeFixture(monthDir, '4_20260828_메모.txt');
      return { modern: path.basename(modern), legacy: path.basename(legacy), wrongDate: path.basename(wrongDate), nonImage: path.basename(nonImage) };
    });

    await ctx.step('resolve-matches-both-formats', async () => {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath);
      db.pragma('busy_timeout = 10000');
      try {
        // 절대 경로 사진 루트를 설정해 스텁 app/APPDATA 환경과 무관하게 만든다.
        db.prepare('UPDATE app_settings SET qntech_photo_root = ? WHERE id = 1').run(photoRoot);
        const resolver = loadPhotoResolver();
        const resolved = resolver(db, { getPath: () => appData }, date, expected.siteId);
        const byKey = Object.fromEntries(resolved.map((item) => [item.key, item]));

        ctx.assert(Object.keys(byKey).length >= 4, '첨부 대상 항목 수가 예상(4)보다 적습니다.', 'ITEM_SET_CHANGED', Object.keys(byKey));
        ctx.assert(byKey.alkalinity && path.basename(byKey.alkalinity.filePath || '') === '1_20260828_알칼리도.jpg',
          '새 포맷(YYYYMMDD) 사진이 매칭되지 않습니다.', 'MODERN_FORMAT_MISS', byKey.alkalinity);
        ctx.assert(byKey.nh3_n && path.basename(byKey.nh3_n.filePath || '') === '2_20262808_암모니아성질소.jpg',
          '과거 포맷(YYYYDDMM) 사진이 매칭되지 않습니다.', 'LEGACY_FORMAT_MISS', byKey.nh3_n);
        ctx.assert(!byKey.po4_p || byKey.po4_p.filePath === '',
          '다른 날짜의 사진이 매칭되었습니다(과매칭).', 'WRONG_DATE_MATCHED', byKey.po4_p);
        ctx.assert(!byKey.no3_n || byKey.no3_n.filePath === '',
          '존재하지 않는 항목이 매칭되었습니다.', 'UNEXPECTED_MATCH', byKey.no3_n);
        return { matched: ['알칼리도(신규형식)', '암모니아성질소(과거형식)'], rejected: ['타날짜', '비이미지'] };
      } finally {
        db.close();
      }
    });

    await ctx.step('drive-queue-contract', async () => {
      // 사진 저장 흐름이 의존하는 Drive 업로드 큐 계약: 등록은 pending,
      // 같은 dedupe_key 재등록은 attempts/last_error를 리셋하고 행을 늘리지 않는다.
      const Database = require('better-sqlite3');
      const db = new Database(dbPath);
      db.pragma('busy_timeout = 10000');
      try {
        const { enqueueBackgroundFileTask } = require(path.join(PROJECT_ROOT, 'server', 'services', 'backgroundFileTaskService.cjs'));
        enqueueBackgroundFileTask(db, {
          taskType: 'management-photo-drive',
          dedupeKey: 'diag:photo-date-compat',
          payload: { localPath: path.join(monthDir, '1_20260828_알칼리도.jpg'), itemLabel: '수질분석_진단' },
        });
        const first = db.prepare("SELECT status, attempts FROM background_file_tasks WHERE dedupe_key = 'diag:photo-date-compat'").get();
        ctx.assert(first && first.status === 'pending' && first.attempts === 0, '큐 등록이 pending/attempts=0이 아닙니다.', 'QUEUE_INSERT_CONTRACT', first);

        db.prepare("UPDATE background_file_tasks SET attempts = 3, last_error = 'diag' WHERE dedupe_key = 'diag:photo-date-compat'").run();
        enqueueBackgroundFileTask(db, {
          taskType: 'management-photo-drive',
          dedupeKey: 'diag:photo-date-compat',
          payload: { localPath: 'x', itemLabel: 'y' },
        });
        const rows = db.prepare("SELECT status, attempts, last_error FROM background_file_tasks WHERE dedupe_key = 'diag:photo-date-compat'").all();
        ctx.assert(rows.length === 1, '같은 dedupe_key 재등록이 행을 늘렸습니다.', 'QUEUE_DEDUPE_BROKEN', rows);
        ctx.assert(rows[0].attempts === 0 && rows[0].last_error === null, '재등록이 attempts/last_error를 리셋하지 않았습니다.', 'QUEUE_RESET_BROKEN', rows[0]);

        // 시나리오 간 격리: 검증용 큐 행을 치운다(뒤 실행되는 qntech-photo의 잔여 검사 보호).
        db.prepare("DELETE FROM background_file_tasks WHERE dedupe_key = 'diag:photo-date-compat'").run();

      // 시나리오 간 격리: seed한 fixture를 치운다.
      fs.rmSync(monthDir, { recursive: true, force: true });
      } finally {
        db.close();
      }
    });
  },
};
