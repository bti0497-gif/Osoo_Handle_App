const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const medicineRouter = require('../server/routes/medicineInRoutes.cjs');
const {
  managementPhotoName,
  managementPhotoSegments,
} = require('../server/services/drivePathService.cjs');

const {
  getMedicinePhotoYearDir,
  getMedicinePhotoRelativePath,
  scanMedicinePhotos,
} = medicineRouter.__photoIsolationTest;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osoo-photo-isolation-'));
try {
  const primary = { multiSiteEnabled: true, siteId: 'SITE-A', isPrimary: true };
  const secondary = { multiSiteEnabled: true, siteId: 'SITE-B', isPrimary: false };
  const single = { multiSiteEnabled: false, siteId: 'SITE-A', isPrimary: true };

  assert.notStrictEqual(
    getMedicinePhotoYearDir(root, 2026, primary),
    getMedicinePhotoYearDir(root, 2026, secondary),
    '양방향 현장의 로컬 사진 폴더는 site_id별로 달라야 합니다.'
  );
  assert.strictEqual(
    getMedicinePhotoYearDir(root, 2026, single),
    path.join(root, '사진관리', '약품입고', '2026'),
    '단방향 현장의 기존 로컬 사진 경로는 유지해야 합니다.'
  );

  const fileName = '20260728+포도당.jpg';
  const primaryDir = getMedicinePhotoYearDir(root, 2026, primary);
  const secondaryDir = getMedicinePhotoYearDir(root, 2026, secondary);
  fs.mkdirSync(primaryDir, { recursive: true });
  fs.mkdirSync(secondaryDir, { recursive: true });
  fs.writeFileSync(path.join(primaryDir, fileName), 'primary');
  fs.writeFileSync(path.join(secondaryDir, fileName), 'secondary');

  const primaryMap = scanMedicinePhotos(root, 2026, '07', primary);
  const secondaryMap = scanMedicinePhotos(root, 2026, '07', secondary);
  assert.strictEqual(fs.readFileSync(primaryMap['포도당'].localPath, 'utf8'), 'primary');
  assert.strictEqual(fs.readFileSync(secondaryMap['포도당'].localPath, 'utf8'), 'secondary');
  assert.match(getMedicinePhotoRelativePath(2026, fileName, primary), /^SITE-A\/2026\//);
  assert.match(getMedicinePhotoRelativePath(2026, fileName, secondary), /^SITE-B\/2026\//);
  assert.deepStrictEqual(managementPhotoSegments('2026-07-28'), ['관리사진', '2026', '07']);
  assert.notStrictEqual(
    managementPhotoName('2026-07-28', '동명휴게소(춘천방향)', '키트입고', 0),
    managementPhotoName('2026-07-28', '동명휴게소(부산방향)', '키트입고', 0),
    '중앙 월정산용 Drive 파일명에는 현장 방향이 포함되어야 합니다.'
  );
  assert.notStrictEqual(
    managementPhotoName('2026-07-28', '동명휴게소(춘천방향)', '키트입고', 0),
    managementPhotoName('2026-07-28', '동명휴게소(춘천방향)', '키트입고', 1),
    '여러 장의 키트 사진은 Drive에서도 순번으로 분리되어야 합니다.'
  );

  console.log('✓ 약품·키트 로컬 사진은 양방향 site_id별로 격리되고 단방향 레거시 경로는 유지됨');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
