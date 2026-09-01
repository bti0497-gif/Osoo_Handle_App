# 업무 시나리오 진단 러너 개발계획

## 1. 문서 목적

긴급 패치 이후 기능 회귀와 UI/CSS 회귀를 빠르게 발견하기 위한 개발·검증 전용 진단 러너의 계획서다.

진단 러너는 다음을 목표로 한다.

- 실제 업무 시나리오를 임시 DB에서 반복 실행한다.
- Google Drive, BigQuery, Firebase 및 기타 외부 서비스 호출을 기본적으로 차단한다.
- 서버 기능, 데이터 정합성, 브라우저 UI, 레이아웃 회귀를 한 번의 실행에서 기록한다.
- 실패 단계, 재현 환경, 스크린샷, 브라우저 오류, DB 상태를 진단 로그로 남긴다.
- Electron 설치파일과 운영 앱 패키지에 진단 도구가 들어가지 않도록 자동 검증한다.
- 작은 수정에는 관련 시나리오만 실행하고, 릴리즈 시점에만 전체 검증을 수행한다.

이 문서는 다른 에이전트가 구현 전에 검토하고, 단계별 작업을 나누어 수행할 수 있도록 작성한다.

## 2. 절대 경계

### 2.1 배포에 포함하지 않는다

진단 러너는 앱의 런타임 기능이 아니라 독립된 개발 도구다.

권장 위치:

```text
tools/diagnostic-runner/
```

다음 위치에는 진단 러너 파일을 만들지 않는다.

- `src/`
- `server/`
- `electron/`
- `scripts/`
- `public/`
- `dist/`
- `release/`

현재 Electron 설정은 `scripts/**/*`를 패키징 입력과 `extraResources`에 포함한다. 따라서 진단 러너를 `scripts/` 아래에 두면 설치파일에 섞일 위험이 있다.

### 2.2 운영 데이터와 설정을 사용하지 않는다

진단 실행은 항상 새 임시 작업 디렉터리와 새 SQLite DB를 사용한다. DB 경로만 임시화하면
`runtimeConfig.cjs`가 프로젝트의 `.env.local`과 credential 파일을 development fallback으로
찾을 수 있으므로, 실행 프로세스의 설정·프로필·환경변수도 함께 격리한다.

절대 사용 금지 경로:

```text
%APPDATA%\\Osoo_Handle_App
%APPDATA%\\wastewater-treatment-plant
```

서버에는 이미 `OSOO_APP_DATA_PATH` 주입 지점이 있으므로, 진단 러너는 이를 임시 `app-data` 디렉터리로 설정한다. 운영 DB를 복사해서 사용하는 방식은 원본 오염과 테스트 간 상태 누적을 일으킬 수 있으므로 기본 방식으로 채택하지 않는다.

진단 프로세스는 최소한 다음 환경을 사용한다.

```text
OSOO_API_PORT_MIN=<ephemeral-port>
OSOO_MINIMAL_BUILD=0
OSOO_APP_DATA_PATH=<run-directory>/app-data
APPDATA=<run-directory>/profile/appdata
LOCALAPPDATA=<run-directory>/profile/localappdata
OSOO_PACKAGED=1
OSOO_API_VALIDATION=1
BIGQUERY_SYNC_ENABLED=false
PHOTO_NORMALIZE_ON_STARTUP=false
OSOO_SERVER_TOKEN=<ephemeral-token>
NODE_OPTIONS=--require tools/diagnostic-runner/lib/external-call-guard.cjs
```

포트는 일반 Node 방식인 `OSOO_API_PORT_MIN` 하나로 임의 포트에 바인딩한다
(`validate-release --api-test`와 동일한 계약). `ELECTRON=1`+`OSOO_API_PORT` 방식은
범위 밖이므로 사용하지 않는다. 18731은 운영 포트이므로 진단 서버가 점유하지 않는다.
격리에 필요한 OSSO_* 값은 spawn env와 더불어 guard 복사본이 preload 시점에 읽는
diagnostic-env.json으로 이중 주입되며, 어느 한쪽이 유실되어도 계약이 유지된다.
OSOO_MINIMAL_BUILD=0은 전체 라우트 로드를 명시한다.

### 2.3 앱 운영 코드에 진단 분기를 넣지 않는다

다음 변경은 1차 범위에서 금지한다.

- `server.cjs`에 진단 로직 추가
- `start.cjs` 수정
- Electron main/preload 수정
- 앱 화면에서 진단 러너 import
- View/ViewModel에 테스트 전용 조건 추가
- 운영 서버에 mock API를 등록
- 운영 DB 스키마를 진단 때문에 변경

앱 쪽에 반드시 설정 주입 지점이 추가되어야 한다면, 먼저 사용자 검토를 받고 영향 범위와 패키징 계약을 갱신한다.

### 2.4 외부 쿼터를 기본값으로 사용하지 않는다

모드별 정책은 다음과 같다.

| 모드 | DB | 외부 API | 용도 |
|---|---|---|---|
| `local` | 새 임시 SQLite | 외부 호출 차단, 로컬 큐·상태만 검사 | 기본 개발 진단 |
| `fixture` | 새 임시 SQLite | 저장된 응답 fixture (별도 승인 후 구현) | 장애 재현 |
| `smoke` | 별도 테스트 데이터 | 명시적으로 허용한 실제 호출 | 제한적 배포 전 확인 |

`local`과 `fixture`에서 외부 요청이 한 번이라도 발생하면 해당 실행은 실패한다. `smoke`는 별도 명령과 명시적인 허용 플래그 없이는 실행되지 않는다.

## 3. 목표 구조

```text
프로젝트 루트/
├── tools/
│   └── diagnostic-runner/
│       ├── package.json
│       ├── README.md
│       ├── runner.cjs
│       ├── lib/
│       │   ├── app-process.cjs
│       │   ├── temp-workspace.cjs
│       │   ├── scenario-context.cjs
│       │   ├── diagnostic-reporter.cjs
│       │   └── external-call-guard.cjs
│       ├── scenarios/
│       │   ├── health.scenario.cjs
│       │   ├── auth.scenario.cjs
│       │   ├── dailylog.scenario.cjs
│       │   ├── dailylog-equipment-link.scenario.cjs
│       │   ├── water-quality.scenario.cjs
│       │   ├── facility.scenario.cjs
│       │   ├── equipment-card.scenario.cjs
│       │   ├── attendance.scenario.cjs
│       │   ├── board.scenario.cjs
│       │   └── recovery.scenario.cjs
│       ├── fixtures/
│       │   ├── base-dataset.json
│       │   ├── users.json
│       │   └── conflict-cases.json
│       ├── mocks/
│       │   ├── drive-mock.cjs
│       │   ├── bigquery-mock.cjs
│       │   └── firebase-mock.cjs
│       └── playwright/
│           ├── browser-context.cjs
│           ├── layout-checks.cjs
│           └── screenshots.cjs
└── tmp/
    └── diagnostics/
```

`tmp/diagnostics/`는 실행 산출물 전용이며 Git과 배포 입력에서 제외한다. 루트 `.gitignore`에는
`tmp/diagnostics/`와 `tools/diagnostic-runner/node_modules/`를 명시한다.

독립 `package.json`은 진단 도구의 의존성과 실행 방법을 명시하기 위한 것이다. 루트 앱의 production dependency에 Playwright나 진단 전용 패키지를 추가하지 않는다.

현재 `prototypes/equipment-history-ui/`와 `src/features/equipment/`의 화면은 장비이력카드
검토·연결 UI가 먼저 존재하고 저장·이력 연계는 아직 완성 전인 상태다. 진단 러너는 이 화면을
완성된 업무 기능으로 판정하지 않으며, 아래 기능 상태와 계약 버전을 결과에 표시한다.

```text
prototype        화면·UX 확인만 가능, 회귀 참고 대상
contract-pending API/DB 저장 계약 미확정, 자동 PASS 금지
implemented      저장·조회·권한·격리 계약이 확정된 정식 시나리오
deprecated       이전 시나리오, 호환 기간 동안만 유지
```

## 4. 실행 흐름

```text
1. 실행 옵션 검증
2. 임시 run 디렉터리와 프로필 생성
3. 외부 네트워크 차단 guard를 자식 프로세스 환경에 주입
4. 운영 기본 포트(18731)와 격리된 환경변수로 앱 서버 실행
5. 서버 readiness 확인
6. 임시 `osoo.db`에 fixture 직접 seed
7. API 업무 시나리오 실행
8. 선택 시 Playwright UI 시나리오 실행 (브라우저 네트워크 차단은 Playwright 실행 전 등록)
9. DB quick_check와 업무별 정합성 검사
10. JSON 및 HTML 결과 생성
11. 서버 종료
12. 임시 파일 정리 또는 실패 시 재현용 보존
```

차단 guard는 `NODE_OPTIONS` 환경변수로만 주입할 수 있으므로 반드시 서버 기동 전에
넣는다. 서버 초기화 과정의 진단 업로드 예약과 지연 warm-up(Excel/PDF 변환 준비)도 guard
적용 대상이므로, readiness 뒤에 감시를 시작하는 순서는 허용하지 않는다.

권장 산출물:

```text
tmp/diagnostics/run-20260828-143012/
├── app-data/
│   ├── osoo.db
│   └── logs/
├── screenshots/
├── traces/
├── result.json
└── report.html
```

성공 실행은 기본적으로 정리할 수 있지만, 실패 실행은 분석을 위해 보존 옵션을 제공한다.

## 5. 버전관리 계약

진단 러너는 앱 버전만 보고 시나리오 호환성을 판단하지 않는다. 다음 버전을 별도로
기록하고 호환성을 검사한다.

```text
runnerVersion       진단 러너 코드·리포트 형식 버전
appVersion          루트 package.json의 앱 버전
apiContractVersion  API route/spec 계약 버전 또는 API baseline 식별자
schemaVersion       임시 DB 스키마·migration 기준 버전
scenarioVersion     업무 시나리오의 입력·검증 규칙 버전
fixtureVersion      seed 데이터 구조와 의미 버전
uiBaselineVersion   viewport별 기준 screenshot/레이아웃 규칙 버전
```

각 실행의 `result.json`에는 위 값을 모두 기록한다. 한 버전이 호환되지 않으면 진단을
성공으로 표시하지 않고 `incompatible` 또는 `blocked`로 종료한다. 이 상태는 기능 실패와
구분하되 릴리즈 게이트에서는 통과로 취급하지 않는다.

시나리오 파일은 다음 메타데이터를 제공한다.

```json
{
  "id": "dailylog-equipment-link",
  "version": "0.1.0",
  "status": "contract-pending",
  "requires": {
    "app": ">=1.1.39",
    "schema": "equipment-link-v0"
  },
  "fixtureVersion": "equipment-preview-v1"
}
```

버전 규칙:

- 시나리오의 기대 결과가 바뀌면 `scenarioVersion`을 올린다.
- fixture의 필드 의미나 기본 데이터가 바뀌면 `fixtureVersion`을 올린다.
- API 응답·DB 컬럼·권한 계약이 바뀌면 `apiContractVersion` 또는 `schemaVersion`을 올린다.
- CSS 기준 이미지가 의도적으로 바뀌면 `uiBaselineVersion`을 올리고 변경 사유를 남긴다.
- 기대 계약이 바뀌지 않는 구현 수정은 버전을 올리지 않고 같은 시나리오를 재실행한다.
- 서로 다른 계약 버전은 회귀 비교에서 제외하고 `incompatible`로 기록한다.

검토·승인 없이 baseline screenshot, fixture, 기대값을 덮어써서 실패를 숨기지 않는다.
baseline 갱신은 변경 사유, 영향 화면, 검토자, 이전 버전을 리포트에 남긴다.

## 6. 단계별 개발계획

### Phase 0. 사전 검토와 배포 경계 보호

목표: 기능 구현 전에 진단 도구가 운영 산출물에 들어갈 수 없다는 계약을 고정한다.

작업:

- `tools/diagnostic-runner/` 위치와 독립 `package.json` 확정
- `tmp/diagnostics/`와 독립 dependency의 Git ignore 규칙 추가
- Electron builder 입력에서 진단 디렉터리가 제외되는지 확인
- `dist`, `app.asar`, `release/win-unpacked`, `extraResources` 누출 검증 설계
- credential, 임시 DB, screenshot, trace가 패키지에 들어가지 않는 검사 항목 정의
- 누출 검증기는 1차에 `tools/diagnostic-runner/`에서 수동 실행하도록 설계

완료 조건:

- 진단 러너를 `scripts/` 아래에 두지 않는다는 결정이 기록됨
- `tmp/diagnostics/`와 진단 dependency가 Git에서 제외됨
- 패키징 누출 시 실패하는 수동 검증기가 있음
- 이 단계에서는 운영 코드와 `electron/`을 수정하지 않음

### Phase 1. 독립 러너와 임시 실행 환경

목표: 앱 서버를 운영 환경과 분리된 DB·포트로 기동하고 안정적으로 종료한다.

작업:

- CLI 옵션 파서 구현: `--scenario`, `--mode`, `--ui`, `--keep-artifacts`
- 실행 ID와 임시 작업 디렉터리 생성
- 사용하지 않는 포트 선택 및 충돌 처리
- 임시 프로필과 허용목록 환경변수 생성
- `OSOO_APP_DATA_PATH`, `APPDATA`, `LOCALAPPDATA`, `OSOO_SERVER_TOKEN` 주입
- `OSOO_PACKAGED=1`, `OSOO_API_VALIDATION=1` 및 외부 sync/background task 비활성화
- Node와 Electron의 `better-sqlite3` ABI 호환성 사전점검 (better-sqlite3 ABI preflight)
- `/api/ping` readiness 확인
- child process 종료, timeout, signal 처리
- 러너가 생성한 PID와 자식만 종료하고, 기존 포트 점유 프로세스는 종료하지 않음
- 임시 서버 종료 후 자식 프로세스 잔존 여부 확인

완료 조건:

- 운영 AppData DB가 변경되지 않음
- 매 실행마다 새 `osoo.db`가 생성됨
- 프로젝트 `.env.local` 및 credential fallback을 읽지 않음
- Node/Electron ABI 불일치가 있으면 업무 시나리오 전에 명확히 실패함
- 서버가 readiness 전에 시나리오를 시작하지 않음
- 실패 시 서버와 임시 파일의 상태가 결과에 남음

### Phase 2. fixture와 외부 호출 차단

목표: 실제 SQLite와 앱 서버를 사용하면서 외부 쿼터는 0으로 유지한다.

작업:

- 관리자, 사용자, 사이트, 기본 설정 fixture 정의
- readiness 확인 뒤 임시 `osoo.db`에 직접 연결
- 트랜잭션으로 fixture를 seed하고 연결을 닫은 뒤 실제 운영 API로 시나리오 실행
- 운영 서버에 테스트 전용 fixture API를 추가하지 않음
- Drive, BigQuery, Firebase mock은 초기부터 앱에 억지로 주입하지 않고 단계적으로 검토
- 외부 HTTP/TCP/TLS 요청 감시 및 차단
- 필요 시 `NODE_OPTIONS=--require <guard>` preload로 socket/module 가드를 주입
- 호출 횟수, URL, 서비스명, 호출 단계 기록
- `local` 모드에서 credential 탐색, 외부 SDK 로드, `require.cache` 등록 여부 확인

완료 조건:

- 기본 진단의 Drive/BigQuery/Firebase 호출 수가 0
- 외부 네트워크 요청 발생 시 즉시 실패하며 loopback(`localhost`, `127.0.0.1`, `::1`)만 허용
- `googleapis`, `firebase-admin`, BigQuery SDK의 로드 여부가 결과에 기록됨
- `local`은 외부 기능을 로컬 큐 생성·재시도 상태까지만 검사함
- `fixture` mock 주입은 별도 설계 승인 후 구현함
- 비밀번호, token, credential 원문이 로그에 남지 않음

### Phase 3. 핵심 업무 시나리오

목표: 긴급 패치에서 자주 깨지는 저장·조회·수정·권한 흐름을 검증한다.

우선순위:

1. health 및 DB 무결성
2. 로그인 및 세션 복구
3. 일일기록 생성·저장·조회·수정
4. 유량·약품·키트 입력 및 재조회
5. 수질분석 저장 및 목록 확인
6. 근태와 권한별 접근
7. 게시판과 팝업 공지
8. 사진 저장 및 업무 레코드 연결
9. 서버 재시작 후 데이터 보존
10. 동기화 큐 생성·실패·재시도
11. 양방향 두 `site_id`의 조회·저장·사진·세션 격리

장비이력카드는 현재 메뉴와 화면 일부가 존재하지만 저장·이력 API/DB 계약이 확정되지
않았으므로 Phase 3의 정식 PASS 대상에서 제외한다. 대신 `equipment-card`는
`contract-pending` 상태로 화면 진입·오류 격리·기준 레이아웃만 참고 검사한다.
일일업무일지와 시설관리 항목 연결도 동일하게 `dailylog-equipment-link` 시나리오를
먼저 계약 검증 상태로 등록하고, 다음 조건이 확정된 뒤 `implemented`로 승격한다.

- 장비 고유 ID와 `site_id` 연결 규칙
- 일일 점검 결과와 장비이력카드의 스냅샷 보존 규칙
- 과거 일지의 장비명·사양 변경 독립성
- 이상 판정에서 수리이력으로 이어지는 사용자 확인 절차
- 양방향 현장의 조회·저장·사진·세션 격리
- 기존 업무일지 연결·이관 원본과 승인된 마이그레이션 범위

날짜 fixture는 고정된 KST 기준 날짜를 사용해 시간대에 따른 결과 변동을 막는다.

각 시나리오는 다음 구조를 따른다.

```text
setup fixture
-> execute business action
-> assert HTTP result
-> reload/read back
-> assert persisted data
-> assert database invariants
-> record step result
```

최초 구현은 health, auth, dailylog, recovery부터 시작한다. 모든 메뉴를 한 번에 구현하지 않는다.

### Phase 4. 브라우저 UI와 레이아웃 회귀

목표: 기능은 동작하지만 CSS나 레이아웃이 깨지는 회귀를 발견한다.

작업:

- Playwright를 진단 도구의 독립 dependency로 설치
- Vite 개발 UI는 기본 계약상 `18735`로 고정
- `18735`가 사용 중이면 기존 프로세스를 종료하지 않고 진단을 중단
- 백엔드 임시 포트는 `localStorage.osoo_server_port`에 주입
- 페이지 로드 전 `addInitScript`로 테스트용 `window.electronAPI` shim 주입
- shim은 허용목록 방식으로 최소 메서드만 제공한다. 로그인·세션 복원 시뮬레이션에 필요한
  최소 집합은 `getServerToken`, `getDefaultSiteContext`, `checkVersionChanged`,
  `clearVersionMarker`, `getSharedAuthenticatedUser`, `setSharedAuthenticatedUser`와
  `onSessionReset`, `onGlobalSessionReset`, `onWindowRestored`다. 리스너는 아무 작업도
  하지 않는 구독 해제 함수를 반환한다(`onSessionReset: () => () => {}`). 시나리오별로
  필요한 메서드만 허용목록에 등록하고, 대상 화면이 늘어날 때만 확장한다.
- 정의되지 않은 `electronAPI` 메서드 호출은 조용히 성공시키지 않는다. 호출 메서드명과
  화면을 기록하고 해당 단계를 실패로 처리한다. 넓은 shim은 실제 Electron 연동 오류를 감춘다.
- 브라우저 네트워크에도 서버와 같은 차단 계약을 적용한다. `context.route()`로
  loopback(`localhost`, `127.0.0.1`, `::1`) 외 요청을 차단하고 차단 횟수와 URL을
  `externalCalls`에 합산 기록한다.
- Vite 개발 서버 프로세스도 앱 서버와 동일한 수명 계약을 적용한다. PID 기록, timeout,
  강제 종료, 종료 후 잔존 프로세스 확인 대상에 포함한다.
- 순수 Chromium에 Electron preload가 없다는 사실을 전제로 UI를 실행
- 브라우저 console error, page error, failed request 수집
- 주요 요소의 visible/enabled 상태 검사
- bounding box와 overflow 검사
- 기준 screenshot 비교 및 변경 파일 보존
- `LAYOUT_CONTRACT.md`의 고정 shell과 내부 스크롤 조건 검사

검사 viewport:

```text
1440x900
1280x800
1024x768
390x844
```

최초 대상 화면:

- 로그인
- 메인 shell
- 일일기록
- 수질분석
- 설정 또는 공통 패널

완료 조건:

- Header, Sidebar, Workspace, StatusBar가 유지됨
- feature root의 `width: 100%`, `min-width: 0`, `min-height: 0` 조건을 검사함
- 넓은 표는 내부 스크롤을 가짐
- 수평 overflow, 화면 밖 버튼, 겹치는 주요 요소가 실패로 기록됨
- console error와 API 4xx/5xx가 결과에 포함됨

Playwright 1차 범위는 API·DB·React·CSS 회귀 진단이다. Electron main/preload, 트레이와
단일 실행, 감시런처, 자동 업데이트와 UAC, 네이티브 파일 선택창, Electron webview,
설치 후 빈 화면·비상복구, 실제 HWP 프로그램 연동은 별도 후속 검사로 분리한다.

모바일 `390x844`는 현재 모바일 지원 기준이 아니므로 참고용 경고 검사로 기록한다.
릴리즈 실패 기준 viewport는 `1024x768`, `1280x800`, `1440x900`이다.

픽셀 비교만으로 판정하지 않는다. DOM 위치·크기·overflow 검사와 함께 사용하고, 운영체제 폰트 차이로 인한 오탐을 줄일 수 있는 허용 기준을 문서화한다.

### Phase 5. 구조화된 리포트와 선택 실행

목표: 정상 영역은 다시 검사하지 않고 실패한 시나리오만 빠르게 분석한다.

지원 옵션 예시:

```powershell
node tools/diagnostic-runner/runner.cjs --scenario health
node tools/diagnostic-runner/runner.cjs --scenario dailylog
node tools/diagnostic-runner/runner.cjs --scenario dailylog --ui
node tools/diagnostic-runner/runner.cjs --scenario all --mode fixture
node tools/diagnostic-runner/runner.cjs --scenario all --assert-no-network
```

결과는 최소한 다음을 포함한다.

- run ID, mode, scenario, 앱 버전
- 시작·종료 시각과 단계별 소요 시간
- 단계별 pass/fail과 재현 메시지
- HTTP 상태 및 실패 요청 요약
- 외부 서비스별 호출·차단 횟수
- SQLite quick_check 및 업무 정합성 결과
- browser console/page/request 오류
- screenshot과 trace 경로
- 보안상 민감한 값의 redaction 결과

변경 파일을 자동으로 시나리오에 매핑하는 `--changed`는 핵심 시나리오가 안정된 뒤 Phase 5 후반에 추가한다.

기존 `validate-clean-server-boot.cjs`, `validate-release.cjs --api-test`,
`validate-auth-contract`, `validate-settings-persistence` 등 검증된 스크립트는 재작성하지
않는다. 러너가 격리된 환경에서 안전하게 호출할 수 있는 항목은 결과를 통합하고, 고정
포트나 독자 환경을 요구하는 항목은 동일한 검증 패턴만 재사용한다. 단,
`validate-release.cjs`가 전달하는 `BIGQUERY_SYNC_SCHEDULER`는 서버가 소비하지 않는 죽은
환경변수이므로 러너는 전달하지 않고, 해당 스크립트의 전달 줄은 별도 정리 후보로 기록한다.

### Phase 6. 개발 명령과 릴리즈 게이트 연결

목표: 반복 실행을 쉽게 하되, 진단 도구가 운영 명령과 패키징에 섞이지 않도록 한다.

초기에는 직접 실행한다.

```powershell
node tools/diagnostic-runner/runner.cjs --scenario dailylog
```

루트 `package.json`에 `diagnose` script를 추가하는 것은 별도 검토 대상으로 둔다. 루트 scripts 변경은 프로젝트 운영 규칙상 영향이 있으므로, 독립 러너가 먼저 안정된 뒤 추가한다.

Phase 0에서는 다음 누출 검사를 `tools/diagnostic-runner/`에서 수동 실행한다.

릴리즈 게이트 후보는 다음과 같다.

- 진단 러너 파일이 `dist`에 없음
- `app.asar`에 진단 러너와 fixture가 없음
- `release/win-unpacked`에 진단 러너와 진단 dependency가 없음
- `extraResources`에 진단 디렉터리가 없음
- 진단 산출물과 credential이 설치파일에 없음

루트 `validate`나 릴리즈 명령에 자동 연결하는 것은 사용자 승인 후 Phase 6에서 진행한다.
실제 Electron 빌드 이후에는 기존 `npm run validate:asar`와 함께 패키징 누출을 검사하고,
개발 중에는 패키징 없이 파일 include 계산만 검사할 수 있게 한다.

기존 릴리즈 순서를 대체하지 않는다.

```text
clean -> build -> validate -> package -> packaged validate
```

진단 러너는 이 순서에서 개발 검증용 보조 도구로 사용하고, 기존 `npm run validate`, `npm run build`, `npm run electron:build`를 대체하지 않는다.

## 7. 실패 주입 시나리오

성공 케이스만으로는 동기화와 복구 문제를 발견하기 어렵다. 다음 실패를 fixture/mock으로 재현한다.

- 네트워크 단절
- 401/403 권한 오류
- 429 quota exceeded
- 500/503 서버 오류
- 중복 요청
- 부분 성공
- 오래된 revision 또는 충돌
- 원격 파일 업로드 후 로컬 DB 반영 실패
- 로컬 DB 반영 후 원격 동기화 실패
- 서버 재시작 중 요청
- 비어 있거나 지연된 API 응답

각 실패 주입은 실제 외부 서비스에 요청하지 않고, mock 호출 기록과 앱의 재시도·오류 표시·로컬 보존 결과를 검증한다.

## 8. 진단 로그 형식

예시:

```json
{
  "runId": "20260828-143012",
  "mode": "local",
  "scenario": "dailylog",
  "port": 19731,
  "runtime": {
    "nodeVersion": "22.x.x",
    "nodeModulesAbi": "127",
    "betterSqlite3Version": "x.x.x",
    "architecture": "x64",
    "abiPreflight": "passed"
  },
  "status": "failed",
  "startedAt": "2026-08-28T14:30:12.000Z",
  "durationMs": 1842,
  "steps": [
    {
      "name": "login",
      "status": "passed",
      "durationMs": 180
    },
    {
      "name": "reload-and-verify",
      "status": "failed",
      "errorCode": "DATA_NOT_PERSISTED",
      "message": "저장한 기록이 새로고침 후 조회되지 않음"
    }
  ],
  "externalCalls": {
    "drive": 0,
    "bigquery": 0,
    "firebase": 0,
    "blockedRequests": 0
  },
  "database": {
    "integrityCheck": "passed"
  }
}
```

로그에 기록하지 않는 값:

- 비밀번호
- access token 및 server token
- credential JSON 원문
- 원격 서비스의 전체 응답 원문
- 필요 이상의 사용자 개인정보
- 운영 DB 절대 경로

## 9. 다른 에이전트의 구현 검토 체크리스트

### 구조

- [ ] 진단 러너가 `tools/diagnostic-runner/` 아래 독립되어 있는가?
- [ ] 앱 코드가 진단 러너를 import하지 않는가?
- [ ] `server.cjs`, `start.cjs`, `electron/`에 불필요한 변경이 없는가?
- [ ] 앱 서버와 Vite 개발 서버 모두 PID 기록·timeout·강제 종료·잔존 확인 대상인가?
- [ ] 독립 `package.json`으로 진단 dependency가 production dependency에 섞이지 않는가?

### 데이터와 쿼터

- [ ] 매 실행마다 새 임시 DB를 사용하는가?
- [ ] 운영 AppData 경로를 읽거나 쓰지 않는가?
- [ ] `APPDATA`와 `LOCALAPPDATA`도 임시 프로필로 격리하는가?
- [ ] `OSOO_PACKAGED=1`과 외부 sync 비활성화 환경을 적용하는가?
- [ ] 기본 모드에서 Drive, BigQuery, Firebase 호출이 0회인가?
- [ ] loopback 외부 네트워크 호출을 감지하고 실패시키는가?
- [ ] 외부 SDK의 `require.cache` 로드를 기록하는가?
- [ ] smoke 모드가 명시적 허용 없이 실행되지 않는가?

### 기능

- [ ] 저장 후 재조회와 새로고침 검증이 있는가?
- [ ] 권한·오류·재시도·재시작 흐름이 포함되는가?
- [ ] SQLite quick_check와 업무 정합성 검사가 있는가?
- [ ] 양방향 두 `site_id`의 데이터와 세션이 서로 격리되는가?
- [ ] 실패 단계가 재현 가능한 fixture와 함께 기록되는가?

### UI

- [ ] 브라우저 console/page/request 오류를 수집하는가?
- [ ] 브라우저에서 loopback 외 요청을 차단하고 기록하는가?
- [ ] `electronAPI` shim이 허용목록 방식이고, 미정의 메서드 호출을 실패로 기록하는가?
- [ ] 릴리즈 기준 viewport와 참고용 모바일 viewport를 구분하는가?
- [ ] layout contract의 shell, min-width, min-height, 내부 스크롤 조건을 검사하는가?
- [ ] screenshot만으로 성공을 판정하지 않는가?

### 배포

- [ ] 진단 러너가 `dist`, `app.asar`, `win-unpacked`에 없는가?
- [ ] fixture, screenshot, trace, 임시 DB가 설치파일에 없는가?
- [ ] 진단 dependency가 패키징되지 않는가?
- [ ] credential이 결과물에 포함되지 않는가?
- [ ] 누출 시 자동으로 실패하는 검증이 있는가?

## 10. 완료 기준

진단 러너 1차 완료는 다음 조건을 모두 만족할 때로 한다.

- 운영 앱을 실행하지 않고도 임시 DB 기반 진단이 가능하다.
- 핵심 업무 시나리오의 저장·조회·수정·재시작 흐름을 검증한다.
- 기본 실행에서 외부 쿼터 사용량이 0이다.
- 실패 시 JSON 결과와 사람이 읽을 수 있는 요약을 남긴다.
- UI 검사에서 콘솔 오류, API 오류, overflow, 주요 요소 겹침을 발견한다.
- 실패 실행을 보존해 다른 에이전트가 같은 상태를 재현할 수 있다.
- 진단 러너와 산출물이 Electron 패키지에 포함되지 않는다.
- 기존 운영 DB, 런타임 AppData 경로, Electron 실행 계약을 변경하지 않는다.
- 기존 린트·빌드·릴리즈 검증의 대체물이 아니라 빠른 회귀 진단 도구로 동작한다.
- 기존 포트 점유 프로세스를 종료하지 않고, 러너가 만든 프로세스만 정리한다.
- Node와 Electron의 `better-sqlite3` ABI 호환성 검사를 업무 시나리오 전에 수행한다.

## 11. 구현 시 우선순위

```text
1. 배포 누출 방지 검사
2. 임시 작업 디렉터리와 child process 수명 관리
3. health/auth/dailylog 기능 시나리오
4. 외부 네트워크 차단과 호출 기록
5. JSON 리포트
6. settings-local, 유량·약품·수질·키트 저장 재조회
7. 양방향 `site_id` 격리와 recovery
8. 장비이력카드·일일업무일지 연결 contract-pending 검사
9. 실패 주입
10. Playwright UI/레이아웃 검사
11. contract-pending 기능의 implemented 승격 검사
12. changed-scope 자동 선택
13. 루트 npm script 연결 검토
```

구조 변경, Electron 파일 수정, 루트 `package.json` scripts 변경 또는 DB 스키마 변경이 필요해지는 순간에는 구현을 멈추고 해당 변경의 필요성과 영향 범위를 먼저 검토한다.
