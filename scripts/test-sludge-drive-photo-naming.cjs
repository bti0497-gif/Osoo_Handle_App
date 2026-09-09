'use strict';
const assert = require('node:assert/strict');
const { sludgeManagementPhotoName, managementPhotoName } = require('../server/services/drivePathService.cjs');

assert.equal(
  sludgeManagementPhotoName('2026-09-09', '동명휴게소(춘천방향)', '2026-09-09 08:35:42'),
  '2026-09-09_083542_동명휴게소(춘천방향)_슬러지반출.jpg'
);
assert.equal(
  sludgeManagementPhotoName('2026-09-09', '동명휴게소(춘천방향)', '2026-09-09T08:35:42+09:00', 1),
  '2026-09-09_083542_동명휴게소(춘천방향)_슬러지반출-2.jpg'
);
assert.equal(
  managementPhotoName('2026-09-09', '동명휴게소(춘천방향)', '청소필증', 0),
  '2026-09-09_동명휴게소(춘천방향)_청소필증.jpg'
);
console.log('PASS: 슬러지 반출사진 시간명·동일 초 충돌명·청소필증 기존명 계약');
