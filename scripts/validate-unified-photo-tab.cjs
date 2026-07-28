const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const modal = fs.readFileSync(path.join(root, 'src/features/records/UnifiedRecordModal.jsx'), 'utf8');
const tab = fs.readFileSync(path.join(root, 'src/features/records/photo-management/PhotoManagementTab.jsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/features/records/photo-management/PhotoManagementTab.css'), 'utf8');

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
assert.match(tab, /multiple/);
assert.match(css, /grid-template-columns:\s*190px minmax\(0, 1fr\)/);
assert.match(css, /overflow-y:\s*auto/);
assert.match(css, /flex-wrap:\s*nowrap/);

console.log('✓ 사진관리 5번째 탭은 한 줄 유지·날짜행 분리·내부 스크롤·기존 업로드 재사용 계약을 만족함');
