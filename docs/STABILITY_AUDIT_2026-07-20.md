# 현장 앱 안정화 및 WinForms 전환 준비 감사

감사일: 2026-07-20
기준 버전: 1.1.6 / `main`
범위: 로그인·서버 초기화·SQLite·동기화·통합입력·일지/파일 출력·게시판·업데이트·패키징·WinForms 전환 경계

## 결론

현재 앱은 현장 핵심 기능별 보호계약과 릴리스 검증이 많이 축적되어 있으며, 빌드·네이티브 SQLite 패키지 실행·주요 회귀계약은 통과한다. 다만 보호의 상당 부분이 소스 문자열 존재 검사이므로 실제 API 동작과 데이터 결과를 보장하는 수준까지는 아니다. 다음 안정화의 중심은 기능 추가가 아니라 API 계약, 실제 DB 시나리오 테스트, 보안 경계와 패키지 재현성을 강화하는 것이다.

## 확인된 강점

- 로그인/세션/출결, 통합입력, QnTECH, 공사입력 도우미, 양방향 일지, 템플릿 보호 등의 계약 문서가 존재한다.
- 로컬 SQLite를 운영 원본으로 두고 BigQuery를 동기화·복구 보조로 제한하는 원칙이 문서화되어 있다.
- GitHub Release는 Electron ABI 재빌드 → 패키징 → better-sqlite3 실제 로드 검사 → 게시 순서를 갖는다.
- 서비스 계정 파일은 Git에서 무시되고 일반 자동업데이트 패키지에서 제외된다.
- 패키지된 1.1.6의 Electron/Express/better-sqlite3 실행 검증은 통과했다.
- 현재 프로덕션 프런트 빌드와 릴리스 계약 검증은 통과한다.

## P0: 다음 기능 확장 전에 막아야 할 항목

### 1. 게시판 HTML 표시 보안

`BoardView.jsx`가 게시글 본문을 `dangerouslySetInnerHTML`로 표시하지만 전용 HTML sanitizer와 CSP가 없다. 중앙관리자 앱과 Firebase에서 들어오는 HTML은 현장 Electron 렌더러에서 실행 가능한 입력으로 취급해야 한다.

완료(2026-07-20): 서버 저장 시와 클라이언트 표시 시 동일한 허용목록 기반 정화를 적용했다. 스크립트·이벤트 속성·위험 URL·iframe/object/embed를 제거하고, 표·이미지·기본 서식을 보존하는 행동 검사를 릴리스 검증에 추가했다. CSP는 앱 자체 코드와 로컬 API만 기본 허용하며 공사입력 도우미의 지정 HTTPS 웹뷰만 예외로 유지한다.

조치:

- 허용 태그/속성 기반 sanitizer를 저장 시 서버와 표시 시 클라이언트 양쪽에 둔다.
- `script`, 이벤트 속성(`on*`), `javascript:` URL, 위험한 iframe/object/embed를 제거한다.
- 앱 `index.html`에 실제 동작 가능한 CSP를 적용한다.
- 본문 복사/붙여넣기, 이미지, 표는 유지되는 회귀 테스트를 만든다.

### 2. 로컬 API의 신뢰 경계

서버는 127.0.0.1에만 바인딩되지만 CORS가 전체 허용이고 여러 권한 API가 요청 body/query의 `_user` 역할을 신뢰한다. 같은 PC의 다른 프로세스나 브라우저 페이지가 로컬 포트를 호출하면 역할 위조 가능성이 있다. `/api/ping`의 선택적 serverToken은 현재 API 인증 경계로 사용되지 않는다.

완료(2026-07-20): Electron 클린부팅 때 생성하는 인스턴스 토큰을 ping 이외의 전체 로컬 API가 요구하도록 승격했다. 토큰은 ping에서 제거하고 격리된 preload IPC를 통해서만 프런트 요청 헤더에 넣는다. CORS는 앱의 로컬 개발 출처와 Electron의 null origin만 허용한다. 세션 복원 시 서버 활성 사용자도 복구하며, 게시판 권한은 요청 역할 문자열을 무시하고 서버 활성 세션을 사용하고 설정 변경은 실제 admin 세션만 허용한다.

조치:

- Electron 시작 시 임의 capability token을 생성하고 preload/apiClient를 통해 모든 API 요청 헤더에 넣는다.
- 서버는 `/api/ping` 이외 API에서 토큰을 검증하고, ping 응답에 토큰을 노출하지 않는다.
- 게시판·설정·삭제·복구 권한은 요청 role 문자열이 아니라 서버 active session을 기준으로 판정한다.
- WinForms 클라이언트도 같은 토큰/세션 계약을 사용한다.

### 3. 운영 의존성 보안 업데이트

2026-07-20 `npm audit --omit=dev` 기준 운영 의존성에서 총 23건(critical 1, high 7, moderate 12, low 3)이 보고되었다. 특히 업로드 경로의 직접 의존성 `multer 2.0.2`는 수정 가능한 고위험 항목이다. Firebase/ExcelJS는 무리한 일괄 변경 시 호환성 위험이 있으므로 분리한다.

1차 완료(2026-07-20): `multer 2.2.0`과 현재 버전 범위 안의 Express/Google 하위 의존성 패치를 잠금파일에 반영했다. 운영 취약점은 11건으로 감소했고 critical/high는 0건이다. 남은 low/moderate는 Firebase 14 메이저 변경, ExcelJS 다운그레이드 또는 Quill 변경을 요구하므로 기능 회귀검증 없이 강제 적용하지 않는다. CI에는 운영 high 이상이 다시 유입되면 실패하는 게이트를 추가했다.

조치 순서:

1. 별도 브랜치에서 audit의 비파괴적 업데이트 후보(`multer`, `path-to-regexp`, `protobufjs`, `websocket-driver`, `tmp` 등)를 적용한다.
2. 업로드·Firebase 게시판·Google API·Excel/HWPX 출력 회귀를 실행한다.
3. `firebase-admin` 메이저 업데이트와 ExcelJS 강제 다운그레이드 제안은 별도 PoC 없이는 적용하지 않는다.
4. CI에 `npm audit --omit=dev --audit-level=high`을 처음에는 보고 모드로 넣고, 정리 후 차단 게이트로 전환한다.

### 4. 런타임 자격증명 취급

실제 서비스 계정 키는 Git ignore 및 패키지 제외 상태지만 프로젝트 작업 폴더 안에 존재하므로 전체 텍스트 검색, 진단 수집, 화면 공유 도구에서 노출될 수 있다.

완료(2026-07-20): 실제 자격증명은 현재 Git 추적 대상이 아니며 일반 Electron 릴리즈에서도 제외됨을 확인했다. 과거 기록의 키는 이미 교체되었으므로 경고만 유지한다. 독립 검증을 추가해 새 자격증명 파일이 현재 Git 추적 대상이나 일반 패키지 규칙에 다시 들어오면 릴리스 검증을 실패시킨다. 진단로그는 객체 키뿐 아니라 오류 문자열 안의 Bearer/OAuth 토큰, Google API 키, URL 쿼리 자격증명과 PEM 개인키도 저장 전에 마스킹한다.

조치:

- 개발 원본도 가능하면 프로젝트 밖의 전용 secrets 폴더 또는 Windows Credential Manager로 이동한다.
- 진단 sanitizer가 `private_key`, token, password, client secret을 값까지 제거하는 테스트를 둔다.
- 과거 Git 기록과 GitHub Actions artifact에 키가 없음을 주기적으로 검사한다.
- 노출이 의심되는 키는 회전한다.

## P1: 현장 데이터 손상을 막는 보호 보강

### 1. API 명세가 실제의 절반 미만

서버 라우트 정의는 135개인데 `server/api-spec.cjs`에는 63개만 등록되어 있다. 현재 API 검증은 일부 필수 경로의 존재만 확인하므로 WinForms 전환 시 누락·응답 차이를 막지 못한다.

1차 완료(2026-07-20): 기존 135개 업무 라우트 구현을 변경하지 않고 소스에서 메서드·전체 경로·소유 모듈·tier·BigQuery 동기화 감시 여부를 자동 추출하는 인벤토리를 추가했다. 19개 라우트 모듈의 레지스트리 누락·중복과 135개 경로의 추가·삭제·이동·메서드 변경을 기준선과 비교해 릴리스 검증에서 차단한다. 요청/응답 JSON schema와 세부 오류 code 문서화는 다음 계약 고도화 단계로 남긴다.

조치:

- 실제 라우트 135개를 전부 API 명세에 등록한다.
- 요청/응답 JSON schema, 오류 code, timeout, 권한, 부작용, 동기화 여부를 기록한다.
- 명세와 Express 라우트를 자동 비교하여 누락 시 CI를 실패시킨다.
- 이후 `/api/v1` 계약을 고정하고 Electron과 WinForms가 같은 SDK를 사용하게 한다.

### 2. 문자열 검증에서 행동 검증으로 전환

`validate-release.cjs`의 많은 보호는 특정 코드 문자열이 존재하는지 검사한다. 리팩터링에 취약하고 실제 계산값을 보장하지 않는다.

우선 행동 테스트:

- 인증: 기본 비밀번호, 변경 비밀번호, 같은 날 세션 복원, 업데이트 재시작, admin 로컬 캐시 거부.
- 통합입력: 유량/MWh/슬러지 월·연 누계/약품·키트 재고 cascade/수질 저장을 임시 SQLite에서 검증.
- QnTECH: 버튼 → 서버 작업 생성 → 진행 조회 → 날짜별 성공/실패 카운트.
- 게시판: 전체/특정 현장 가시성, 댓글 권한, 팝업 1~7일 만료.
- 일지: 원본 양식 해시 불변, 이름 범위 바인딩, 수식·인쇄영역 유지.
- 업데이트: 다운로드 상태 → 앱 종료 → 재시작 → 세션 복원 모의 테스트.

### 3. SQLite 운영 정책

현재 DB 초기화에는 많은 인라인 ALTER/복구 로직이 있으나 명시적 schema version migration 체계와 시작 시 quick check가 약하다.

1차 완료(2026-07-20): 기존 운영 DB는 어떤 스키마 변경보다 먼저 `quick_check`, 쓰기 잠금 가능 여부, `foreign_keys`, `busy_timeout`을 검사한다. 앱 버전별 사전 마이그레이션 백업을 SQLite `VACUUM INTO`로 생성하고 별도 연결로 다시 열어 무결성을 검증하며, 실패하면 마이그레이션을 시작하지 않는다. 향후 순차 migration을 위한 `schema_migrations` 기준 테이블과 임시 DB 행동 검사를 추가했다. WAL 전환과 기존 인라인 ALTER의 일괄 재작성은 현장 호환성 검증 전까지 보류한다.

조치:

- `schema_migrations` 테이블과 순차·재실행 안전 migration을 도입한다.
- 시작 시 `PRAGMA quick_check`, `foreign_keys`, `busy_timeout`을 기록하고 실패 시 쓰기 작업을 막은 복구 화면으로 진입한다.
- WAL 도입은 백업·Excel/HWPX·업데이트 종료 시나리오를 검증한 뒤 결정한다.
- 버전 업데이트 직전 DB 백업 및 백업 파일의 실제 open/quick_check 테스트를 추가한다.

### 4. 업로드 자원 제한

일부 multer memory storage와 이미지 업로드 경로에 서버 측 file size/files/type 제한이 없거나 프런트 제한에만 의존한다.

완료(2026-07-20): 게시판 첨부는 1개·50MB와 문서/이미지 허용목록, 사진은 파일당 20MB·경로별 개수와 이미지 MIME/확장자, 설정 양식은 최대 21개·파일당 50MB와 Excel/HWPX 허용목록을 서버에서 강제한다. 이미지 디코딩은 5천만 픽셀을 상한으로 두고, 거부 사유는 공통 JSON 오류로 반환한다. 실행파일·스크립트형 첨부는 서버에서 차단하며 행동 검사를 릴리스 검증에 추가했다.

조치:

- 모든 업로드 라우트에 크기, 파일 수, MIME과 실제 magic bytes 검증을 둔다.
- abort/실패 시 임시 파일을 정리한다.
- 이미지 디코딩 전에 픽셀 수 제한을 둔다.

## P2: 유지보수성과 장애 격리

### 대형 파일 분리

다음 파일은 변경 영향 범위가 너무 크다.

- `UnifiedRecordModal.jsx` 약 1,553줄
- `dailyWorkLogService.cjs` 약 1,203줄
- `certificateRoutes.cjs` 약 1,141줄
- `sludgePhotoRoutes.cjs` 약 1,137줄
- `AdvancedDataGrid.jsx` 약 1,083줄
- `database.cjs` 약 974줄

분리 원칙:

- UI를 먼저 쪼개지 말고 계산·검증·파일생성·DB 쿼리를 순수 서비스로 추출한다.
- 추출 전 현재 행동 테스트를 만든다.
- 라우트는 입력검증·권한·서비스 호출·응답 변환만 담당한다.
- 기능별 DTO와 오류 code를 고정한다.

### 관측 가능성

- 진단로그에 `operationId`, 앱 버전, DB 경로 식별자, route, duration, result code를 공통으로 넣는다.
- QnTECH·BigQuery·Drive·Firebase 작업은 시작/완료/실패가 같은 operationId로 연결되어야 한다.
- 사용자 화면 오류와 진단로그 이벤트 code를 일치시킨다.
- 로그 보존/삭제 정책은 현재 날짜 기반 외에 실패 로그 최소 보존기간을 별도로 검토한다.

## WinForms 전환 준비 게이트

현재 계획의 ‘Node/Express 재사용’ 방향은 타당하다. 다만 UI 교체 전에 다음 네 가지가 완료되어야 한다.

1. API Gate: 135개 전체 API 명세와 핵심 API 행동 테스트.
2. Domain Gate: 유량·전력·슬러지·재고 계산을 React Hook에서 서버/공통 도메인 서비스로 이동.
3. Data Gate: schema migration, 백업·복원, quick_check 자동화.
4. Security Gate: localhost capability token, 서버 세션 권한, HTML sanitizer/CSP.

WinForms는 이 게이트 이후 로그인 → 유량 → 약품/키트 → 수질 → 일지 순으로 붙인다. Electron과 WinForms가 동시에 같은 AppData SQLite를 열어 쓰는 병행 실행은 금지하고 단일 writer 잠금 정책을 먼저 정해야 한다.

## 이번 감사에서 즉시 보강한 항목

- `package:field-installer`의 낡은 `-AppVersion 1.1.4` 고정값을 제거했다.
- 통합 설치 스크립트가 `package.json`의 현재 버전을 자동 사용하도록 했다.
- 릴리스 검증에서 고정 `-AppVersion`이 다시 들어오면 실패하도록 보호했다.

## 검증 결과 요약

- `npm run lint`: 오류 0, 기존 Hook 경고 5.
- `npm run build`: 통과.
- `npm run validate`: 163개 계약 통과(팝업 공지 작업 포함 시점).
- `npm run validate:native`: 패키지 Electron/Express/better-sqlite3 실제 실행 통과.
- `npm run validate:field-installer`: 현재 1.1.6 통합 설치파일이 없어 실패. 코드 실행 실패가 아니라 산출물 부재이며, 고정 버전 결함은 이번 감사에서 제거했다.
- 운영 의존성 감사: 총 23건. 별도 호환성 브랜치에서 단계적 정리가 필요하다.

## 권장 다음 작업 순서

1. localhost API capability token과 서버 active-session 권한 통일.
2. multer 및 비파괴 audit 업데이트 + 업로드 제한.
3. 실제 135개 API inventory/contract 자동 생성.
4. 로그인·통합입력·QnTECH·일지의 임시 DB 행동 테스트.
5. schema migration/quick_check/백업 검증.
6. 대형 파일의 도메인 로직 추출.
7. WinForms 로그인/유량 PoC 시작.
