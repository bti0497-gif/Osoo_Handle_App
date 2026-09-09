'use strict';

/**
 * photo-date-compat 시나리오: 수질 불러오기에서 확정한 siteId+날짜 명세만
 * 공사입력도우미가 소비하는지 검증한다. 폴더/파일명 추측이 다시 들어오거나
 * 양방향 현장의 같은 날짜 사진이 섞이면 이 시나리오가 실패한다.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');

function loadPhotoHelper() {
  const Module = require('module');
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') return { session: {}, webContents: { fromId: () => null } };
    return originalLoad.apply(this, [request, parent, isMain]);
  };
  try {
    return require(path.join(PROJECT_ROOT, 'electron', 'roadworkDumpHelper.cjs'));
  } finally {
    Module._load = originalLoad;
  }
}

function writeFixture(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, 'diagnostic-fixture', 'utf8');
  return file;
}

module.exports = {
  id: 'photo-date-compat',
  covers: ['water'],
  version: '0.2.0',
  status: 'implemented',
  async run({ ctx, fixtures, dbPath, expected }) {
    const date = fixtures.dataset.fixedDate;
    const noImportDate = '2026-08-27';
    const appData = path.dirname(dbPath);
    const photoRoot = path.join(appData, '사진관리', '수질분석');
    const monthDir = path.join(photoRoot, date.slice(0, 4), date.slice(5, 7), '데이타불러오기');
    const secondarySiteId = 'diagnostic-secondary-site';
    const helper = loadPhotoHelper();
    const { writePhotoPreparationManifest } = require(path.join(
      PROJECT_ROOT,
      'server',
      'services',
      'qntechWaterPhotoManifestService.cjs',
    ));

    await ctx.step('load-real-manifest-resolver', async () => {
      ctx.assert(typeof helper.resolveRoadworkPhotoPreparation === 'function',
        '공사입력도우미의 사진 준비 명세 resolver가 export되지 않았습니다.',
        'MANIFEST_RESOLVER_NOT_EXPORTED');
      return 'loaded';
    });

    await ctx.step('select-only-one-photo-per-item-from-first-round', async () => {
      const { selectFirstRoundPreparedPhotos } = require(path.join(
        PROJECT_ROOT,
        'server',
        'services',
        'qntechWaterPhotoImportService.cjs',
      ));
      const selected = selectFirstRoundPreparedPhotos([
        { projectIndex: 0, itemName: '알칼리도', savedPath: 'first-alkalinity.jpg' },
        { projectIndex: 0, itemName: '알칼리도', savedPath: 'duplicate-alkalinity.jpg' },
        { projectIndex: 0, itemName: '암모니아성 질소', savedPath: 'first-ammonia.jpg' },
        { projectIndex: 1, itemName: '질산성 질소', savedPath: 'second-round-nitrate.jpg' },
      ]);
      ctx.assert(selected.length === 2,
        '첫 회차의 항목별 첫 사진만 선택되지 않았습니다.', 'FIRST_ROUND_SELECTION_COUNT_WRONG', selected);
      ctx.assert(selected.find((item) => item.key === 'alkalinity')?.filePath === 'first-alkalinity.jpg',
        '같은 항목의 첫 사진 대신 뒤 사진이 선택됐습니다.', 'FIRST_ITEM_PHOTO_REPLACED', selected);
      ctx.assert(!selected.some((item) => item.key === 'no3_n'),
        '두 번째 분석 회차 사진이 공사입력도우미 대상으로 섞였습니다.', 'LATER_ROUND_PHOTO_SELECTED', selected);
      return selected;
    });

    const seeded = {};
    await ctx.step('seed-isolated-photo-manifests', async () => {
      const primaryAlkalinity = writeFixture(monthDir, '101_20260828_알칼리도.jpg');
      const primaryAmmonia = writeFixture(monthDir, '101_20260828_암모니아성질소.jpg');
      const secondaryAlkalinity = writeFixture(monthDir, '202_20260828_알칼리도.jpg');
      const unreferencedLegacy = writeFixture(monthDir, '999_20262808_질산성질소.jpg');
      const unreferencedNoImportDate = writeFixture(monthDir, '999_20260827_오르토인산염.jpg');

      writePhotoPreparationManifest({
        photoRoot,
        siteId: expected.siteId,
        siteName: expected.siteName,
        date,
        status: 'partial',
        projectCount: 2,
        selectedProjectId: 'first-project',
        selectedProjectIndex: 0,
        identifiedPhotoCount: 2,
        savedPhotoCount: 2,
        items: [
          { key: 'alkalinity', filePath: primaryAlkalinity },
          { key: 'nh3_n', filePath: primaryAmmonia },
        ],
      });
      writePhotoPreparationManifest({
        photoRoot,
        siteId: secondarySiteId,
        siteName: '진단 보조 방향',
        date,
        status: 'partial',
        projectCount: 1,
        selectedProjectId: 'secondary-project',
        selectedProjectIndex: 0,
        identifiedPhotoCount: 1,
        savedPhotoCount: 1,
        items: [{ key: 'alkalinity', filePath: secondaryAlkalinity }],
      });
      Object.assign(seeded, {
        primaryAlkalinity,
        primaryAmmonia,
        secondaryAlkalinity,
        unreferencedLegacy,
        unreferencedNoImportDate,
      });
      return seeded;
    });

    await ctx.step('resolve-only-explicit-first-round', async () => {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath);
      try {
        db.prepare('UPDATE app_settings SET qntech_photo_root = ? WHERE id = 1').run(photoRoot);
        const result = helper.resolveRoadworkPhotoPreparation(db, { getPath: () => appData }, date, expected.siteId);
        const byKey = Object.fromEntries(result.photos.map((item) => [item.key, item]));
        ctx.assert(result.preparationStatus === 'partial', '사진 준비 상태가 명세와 다릅니다.', 'MANIFEST_STATUS_MISMATCH', result);
        ctx.assert(path.basename(byKey.alkalinity.filePath || '') === path.basename(seeded.primaryAlkalinity),
          '첫 분석 회차 알칼리도 사진을 찾지 못했습니다.', 'FIRST_ROUND_PHOTO_MISS', byKey.alkalinity);
        ctx.assert(path.basename(byKey.nh3_n.filePath || '') === '101_20260828_암모니아성질소.jpg',
          '첫 분석 회차 암모니아 사진을 찾지 못했습니다.', 'FIRST_ROUND_PHOTO_MISS', byKey.nh3_n);
        ctx.assert(!byKey.no3_n.available,
          '명세에 없는 과거 YYYYDDMM 사진을 폴더검색으로 잘못 선택했습니다.', 'UNREFERENCED_PHOTO_MATCHED', byKey.no3_n);
        return { status: result.preparationStatus, readyPhotoCount: result.readyPhotoCount };
      } finally {
        db.close();
      }
    });

    await ctx.step('keep-directional-site-manifests-isolated', async () => {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath);
      try {
        const primary = helper.resolveRoadworkPhotoPreparation(db, { getPath: () => appData }, date, expected.siteId);
        const secondary = helper.resolveRoadworkPhotoPreparation(db, { getPath: () => appData }, date, secondarySiteId);
        const primaryFile = primary.photos.find((item) => item.key === 'alkalinity')?.filePath;
        const secondaryFile = secondary.photos.find((item) => item.key === 'alkalinity')?.filePath;
        ctx.assert(path.basename(primaryFile || '') === path.basename(seeded.primaryAlkalinity),
          '기본 방향 사진 명세가 바뀌었습니다.', 'PRIMARY_MANIFEST_MISMATCH');
        ctx.assert(path.basename(secondaryFile || '') === path.basename(seeded.secondaryAlkalinity),
          '보조 방향 사진 명세가 바뀌었습니다.', 'SECONDARY_MANIFEST_MISMATCH');
        ctx.assert(primaryFile !== secondaryFile, '양방향 사진 경로가 섞였습니다.', 'DIRECTIONAL_PHOTO_LEAK');
        return { isolated: true };
      } finally {
        db.close();
      }
    });

    await ctx.step('do-not-search-without-import-manifest', async () => {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath);
      try {
        const result = helper.resolveRoadworkPhotoPreparation(db, { getPath: () => appData }, noImportDate, expected.siteId);
        ctx.assert(result.preparationStatus === 'not-imported',
          '수질 불러오기 명세가 없는 날짜를 not-imported로 판정하지 않았습니다.', 'NO_IMPORT_STATUS_WRONG', result);
        ctx.assert(result.photos.every((item) => !item.available),
          '명세 없는 날짜의 폴더 사진을 임의로 선택했습니다.', 'FOLDER_SCAN_REINTRODUCED', result.photos);
        return { status: result.preparationStatus };
      } finally {
        db.close();
      }
    });

    await ctx.step('detect-prepared-file-loss', async () => {
      fs.rmSync(seeded.primaryAlkalinity, { force: true });
      const Database = require('better-sqlite3');
      const db = new Database(dbPath);
      try {
        const result = helper.resolveRoadworkPhotoPreparation(db, { getPath: () => appData }, date, expected.siteId);
        const alkalinity = result.photos.find((item) => item.key === 'alkalinity');
        ctx.assert(!alkalinity.available && alkalinity.availabilityReason === 'prepared-file-missing',
          '준비 후 사라진 파일을 별도 원인으로 판정하지 못했습니다.', 'PREPARED_FILE_LOSS_MISSED', alkalinity);
        return { reason: alkalinity.availabilityReason };
      } finally {
        db.close();
      }
    });

    await ctx.step('drive-queue-contract', async () => {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath);
      db.pragma('busy_timeout = 10000');
      try {
        const { enqueueBackgroundFileTask } = require(path.join(PROJECT_ROOT, 'server', 'services', 'backgroundFileTaskService.cjs'));
        enqueueBackgroundFileTask(db, {
          taskType: 'management-photo-drive',
          dedupeKey: 'diag:photo-date-compat',
          payload: { localPath: seeded.secondaryAlkalinity, itemLabel: '수질분석_진단' },
        });
        const first = db.prepare("SELECT status, attempts FROM background_file_tasks WHERE dedupe_key = 'diag:photo-date-compat'").get();
        ctx.assert(first && first.status === 'pending' && first.attempts === 0,
          '큐 등록이 pending/attempts=0이 아닙니다.', 'QUEUE_INSERT_CONTRACT', first);
        db.prepare("UPDATE background_file_tasks SET attempts = 3, last_error = 'diag' WHERE dedupe_key = 'diag:photo-date-compat'").run();
        enqueueBackgroundFileTask(db, {
          taskType: 'management-photo-drive',
          dedupeKey: 'diag:photo-date-compat',
          payload: { localPath: 'x', itemLabel: 'y' },
        });
        const rows = db.prepare("SELECT status, attempts, last_error FROM background_file_tasks WHERE dedupe_key = 'diag:photo-date-compat'").all();
        ctx.assert(rows.length === 1, '같은 dedupe_key 재등록이 행을 늘렸습니다.', 'QUEUE_DEDUPE_BROKEN', rows);
        ctx.assert(rows[0].attempts === 0 && rows[0].last_error === null,
          '재등록이 attempts/last_error를 리셋하지 않았습니다.', 'QUEUE_RESET_BROKEN', rows[0]);
        db.prepare("DELETE FROM background_file_tasks WHERE dedupe_key = 'diag:photo-date-compat'").run();
        // The isolated server can still be observing this queued file. The runner
        // removes its whole run directory after server shutdown; deleting the
        // shared photo root here races that worker and can produce ENOTEMPTY.
        return { deduped: true };
      } finally {
        db.close();
      }
    });
  },
};
