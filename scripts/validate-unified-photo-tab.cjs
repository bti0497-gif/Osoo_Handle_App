const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const modal = fs.readFileSync(path.join(root, 'src/features/records/UnifiedRecordModal.jsx'), 'utf8');
const tab = fs.readFileSync(path.join(root, 'src/features/records/photo-management/PhotoManagementTab.jsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/features/records/photo-management/PhotoManagementTab.css'), 'utf8');
const backgroundFileTasks = fs.readFileSync(path.join(root, 'server/services/backgroundFileTaskService.cjs'), 'utf8');
const sludgePhotoRoutes = fs.readFileSync(path.join(root, 'server/routes/sludgePhotoRoutes.cjs'), 'utf8');

assert.match(modal, /\{ id: 'photos', label: '사진관리' \}/);
assert.match(modal, /overflowX: 'auto'/, '좁은 화면에서 탭 줄은 가로 스크롤을 제공해야 합니다.');
assert.match(modal, /whiteSpace: 'nowrap'/, '탭 버튼 텍스트는 두 줄로 접히면 안 됩니다.');
assert.match(modal, /flex: '0 0 auto'/, '탭 버튼 폭이 압축되어 두 줄이 되면 안 됩니다.');
assert.match(modal, /gridTemplateColumns: 'minmax\(170px, 1fr\) auto'/);
assert.ok(
  modal.indexOf('<DateOnlyInput') < modal.indexOf('{TAB_META.map'),
  '날짜 선택기와 탭 목록은 서로 다른 헤더 행이어야 합니다.'
);
assert.match(tab, /SludgePhotoModel\.uploadPhoto/);
assert.match(tab, /MedicineInModel\.uploadPhoto/);
assert.match(tab, /MedicineInModel\.deletePhoto/);
assert.match(tab, /SludgePhotoModel\.deletePhoto/);
assert.match(tab, /const deletePreviewPhoto = async/);
assert.match(tab, /className="is-danger"/);
assert.match(backgroundFileTasks, /task\.task_type === 'management-photo-delete'/);
assert.ok((tab.match(/\bmultiple\b/g) || []).length >= 5, '반출·청소필증·거래명세서·약품·키트 사진은 모두 다중 선택을 지원해야 합니다.');
assert.match(tab, /certificate_photo_urls/);
assert.match(tab, /onFiles=\{\(files\) => uploadSludge\(row, 'certificate', files\)\}/);
assert.match(tab, /onFiles=\{\(files\) => uploadInventory\(rows\[0\], files, false, '거래명세서'\)\}/);
assert.match(modal, /certificateFiles: \[\]/);
assert.match(modal, /onFiles=\{handleCertificatePhotoFiles\}/);
assert.match(sludgePhotoRoutes, /certificate_photo_urls/);
assert.match(sludgePhotoRoutes, /buildCertificateFileName\(date, certificateIndex\)/);
assert.match(css, /grid-template-columns:\s*190px minmax\(0, 1fr\)/);
assert.match(css, /overflow-y:\s*auto/);
assert.match(css, /flex-wrap:\s*nowrap/);

console.log('✓ 사진관리 5번째 탭은 한 줄 유지·날짜행 분리·내부 스크롤·기존 업로드 재사용 계약을 만족함');
