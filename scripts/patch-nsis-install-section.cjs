/**
 * electron-builder NSIS 템플릿 `installSection.nsh`는 비-무음 설치에서
 * `SetDetailsPrint none` 이라 진행 화면 아래가 비어 있음.
 * 설치 중 DetailPrint / (가능한 경우) 플러그인 로그가 보이도록 `both`로 바꿉니다.
 *
 * npm ci 후에도 한 번 실행되도록 `beforePack`에서 호출합니다.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const MARKER = '; OSOO: installSection detail log patch';

function patchInstallSection() {
  const dest = path.join(__dirname, '..', 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'installSection.nsh');
  if (!fs.existsSync(dest)) {
    console.warn('[patch-nsis-install-section] 파일 없음:', dest);
    return;
  }

  let s = fs.readFileSync(dest, 'utf8');
  if (s.includes(MARKER)) {
    return;
  }

  // SetDetailsPrint none → both 로 변경 + 상세 안내 DetailPrint 추가
  const re = /(\$\{IfNot\} \$\{Silent\}\s*\r?\n)\s*SetDetailsPrint none(\s*\r?\n\$\{endif\})/;
  if (!re.test(s)) {
    console.warn('[patch-nsis-install-section] 예상 패턴 없음(SetDetailsPrint none). app-builder-lib 버전 확인.');
    return;
  }

  s = s.replace(
    re,
    `$1  ${MARKER}
  SetDetailsPrint both
  DetailPrint "========================================"
  DetailPrint "Osoo Handle App 설치 중..."
  DetailPrint "========================================"
  DetailPrint ""
  DetailPrint "[1/4] 앱 패키지(7z) 압축 해제 중..."
  DetailPrint "  - 약 30,000개 이상의 파일을 해제합니다."
  DetailPrint "  - node_modules (라이브러리)가 대부분을 차지합니다."
  DetailPrint "  - 이 단계는 수 분 소요될 수 있습니다."
  DetailPrint ""
  DetailPrint "[2/4] Windows 보안/백신 검사 중..."
  DetailPrint "  - Windows Defender가 실시간으로 파일을 검사합니다."
  DetailPrint "  - CPU 성능에 따라 속도가 크게 달라집니다."
  DetailPrint ""
  DetailPrint "[3/4] 파일 복사 및 레지스트리 등록 중..."
  DetailPrint ""
  DetailPrint "[4/4] 바로가기 생성 및 마무리 중..."
  DetailPrint ""
  DetailPrint "※ 진행 막대가 멈춘 것처럼 보여도 정상입니다."
  DetailPrint "※ 설치 창을 닫지 말고 기다려 주세요."
  DetailPrint ""$2`
  );

  fs.writeFileSync(dest, s, 'utf8');
  console.log('[patch-nsis-install-section] installSection.nsh → SetDetailsPrint both + 상세 안내 DetailPrint');
}

module.exports = { patchInstallSection };

module.exports.default = async function beforePack() {
  patchInstallSection();
};

if (require.main === module) {
  patchInstallSection();
}
