# 최종 요약 보고서 (walkthrough.md)

## 개요
이 문서는 `better-sqlite3` 네이티브 모듈 버전 불일치로 인해 서버가 기동하지 않았던 문제의 진단 결과와, 이후 조치 및 인계 지침을 정리합니다.

## 증상(요약)
- 배포된 Electron 앱에서 서버 프로세스가 즉시 종료되며 로그에 `Module version mismatch` 또는 `ERR_DLOPEN_FAILED` 메시지가 남음.
- 일부 `.cjs` 파일이 ANSI(CP949)로 인코딩되어 구문 오류가 발생함.
- 라우트 lazy-loader가 실패 시 무한 재시도로 인해 CPU/메모리 부하를 유발함.

## 원인 분석
1. better-sqlite3 ABI 불일치
   - 원인: 프로젝트에 설치된 `better-sqlite3` 바이너리는 개발 머신의 Node ABI에 맞춰 설치되었고, Electron 런타임의 Node ABI와 달라 `node-abi` mismatch가 발생했습니다.
   - 증거: 런타임 로그(`electron-server.log`)에 다음과 같은 메시지 존재:
     - `The module '\\path\\to\\better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION X. This version of Node requires NODE_MODULE_VERSION Y. Please try re-compiling or re-installing the module (for instance, using `npm rebuild`).`

2. 파일 인코딩 문제
   - 원인: 일부 `.cjs` 파일이 CP949로 저장되어 배포 환경(UTF-8 예상)에서 파싱 실패.
   - 증거: 패키징 후 콘솔에 `Unexpected token` 또는 한글 깨짐 증상.

3. lazy-loader 무한 재시도
   - 원인: `makeLazy()` 구현이 로딩 실패 시 오류 상태를 초기화하지 않아 재시도 루프 발생.

## 수행된 조치
- 서버 로그를 파일로 남기도록 `server/index.cjs`에 파일 스트림을 추가해 `%APPDATA%\Osoo_Handle_App\logs\electron-server.log`에 stdout/stderr를 병기하도록 변경했습니다.
- Electron에서 패키지 환경의 `cwd`를 `process.resourcesPath + '/app.asar.unpacked'`로 고정했습니다.
- `makeLazy()`를 실패 상태로 표시하고 이후 요청에 500 응답을 반환하도록 변경하여 재시도 루프를 차단했습니다.
- `fetch` 직접 호출을 `apiClient`로 전환했고, 불필요한 UI 쉘 파일들을 제거했습니다.

## 재현 및 수리 절차(요약)
1. 로컬에서 클린 설치:

```bash
npm ci
```

2. Electron 타겟으로 네이티브 모듈 재빌드:

```bash
npx electron-rebuild -v 40.6.0
# 또는
npm rebuild --runtime=electron --target=40.6.0 --update-binary
```

3. 빌드/검증:

```bash
npm run build
npm run validate
npm run validate:api
```

4. 패키징:

```bash
npm run electron:build
```

## 로그 수집 방법
- 사용자 환경에서 문제를 재현할 수 있다면, `%APPDATA%\Osoo_Handle_App\logs\electron-server.log` 파일을 확보해 주세요.
- 로그에 포함되어야 하는 핵심 문자열: `Module version mismatch`, `ERR_DLOPEN_FAILED`, `Unexpected token` 등

## 인계 체크리스트
- [ ] `routeRegistry.cjs`의 각 `path` 필드가 실제 API prefix로 적절히 구성되었는지 확인
- [ ] 모든 `server/**/*.cjs` 파일이 UTF-8로 인코딩되어 있는지 확인
- [ ] CI에서 `electron-rebuild` 또는 동등한 네이티브 재빌드 스텝이 존재하는지 확인
- [ ] `electron-builder` 설정(`npmRebuild`) 변경 여부와 그에 따른 CI 빌드 스크립트를 문서화

## 권장 추가 작업
- 배포용 빌드의 검증 자동화를 강화: `validate` 스크립트에 네이티브 모듈 검사 항목 추가
- 빌드 에이전트(Windows)의 빌드 툴체인 상태 문서화(Visual Studio 버전, Python 버전, npm 버전 등)

---

# 도로공사 웹사이트 통합 및 입력도우미 모달 분리 작업 보고서

## 개요
- 기존 워크스페이스 내부에 잘못 구현되어 있었던 입력 도우미(복사 그리드) UI를 완전히 분리하여 모달로 이식하고, 워크스페이스는 도로공사 홈페이지를 렌더링하는 `<webview>` 태그로 가득 채웠습니다.
- 사용자의 수동 입력 편의성을 극대화하고 시야를 방해하지 않기 위해 입력도우미 모달은 기본적으로 노출되지 않도록(`isOpen={false}`) 숨김 처리하였습니다.

## 상세 조치 사항
1. **run-all.cjs 개선**:
   - 포트 계산 버그(`FRONTEND_PORT - BACKEND_PORT_MIN + 1`)를 해결하여 개발 구동 시 기존 프로세스를 확실히 킬하도록 보완했습니다.
   - 윈도우 환경에서 경로명에 공백이 있을 때 발생하던 Electron 기동 에러를 해결하기 위해 경로명 인용부호(`"`) 처리를 추가했습니다.
   - `better-sqlite3` 바이너리의 Electron 런타임 호환성 문제로 인해 일반 Node.js CLI 구동 시 mismatch가 발생하던 구조적 이슈를 해결하기 위해, run-all.cjs에서의 백엔드 직접 실행을 생략하고 Electron 내장 fork 구동으로 일원화하였습니다.
2. **RoadworkHelperView.jsx 리팩토링**:
   - 워크스페이스 메인 전체 영역을 도로공사 포털(`https://ext.ex.co.kr/`)을 가득 채워 렌더링하는 `<webview>` 컨테이너로 교체했습니다.
   - 프리로드 스크립트(`preload-roadwork.cjs`) 경로를 메인 프로세스로부터 동적으로 받아와 웹뷰에 안전하게 바인딩했습니다.
   - 개발 환경일 때는 DOM 구조 분석을 돕기 위해 DevTools가 자동으로 분리 팝업되도록 이벤트 리스너를 연동했습니다.
3. **RoadworkHelperModal.jsx 및 CSS 구현**:
   - 기존에 작성된 날짜 피커, 새로고침, 복사 그리드(`RoadworkCopyGrid`) 로직을 `components/RoadworkHelperModal.jsx`로 통째로 격리 이식했습니다.
   - 수동 데이터 대입을 돕기 위해 반투명 효과 없이 불투명하고 뚜렷한 흰색 다이얼로그 배경 디자인의 모달 CSS를 적용했습니다.
   - 기본 상태에서는 `isOpen={false}`를 마운트하여 화면에 전혀 표시되지 않도록 숨김 처리했습니다.

## 검증 상태
- `npm run dev:all` 명령으로 포트 충돌 없이 깔끔하게 기존 서버 킬 및 신규 Vite/Electron이 기동되는 것을 확인했습니다.
- 도로공사 일지 도우미 메뉴 진입 시 메인 전체에 웹뷰가 빈 공간 없이 차오르는 것을 검증했습니다.
- `Ctrl+Shift+S` 단축키 입력 시 프리로드 스크립트를 거쳐 `scratch/roadwork_dom_dump.html` 파일로 HTML DOM 구조가 바르게 덤핑되는 구조적 격리 설계를 검증했습니다.