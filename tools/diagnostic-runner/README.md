# 업무 시나리오 진단 러너

긴급 패치 이후 기능 회귀와 UI/CSS 회귀를 빠르게 발견하기 위한 개발·검증 전용 도구다.
계약 전문은 루트 `docs/DIAGNOSTIC_RUNNER_DEVELOPMENT_PLAN.md` 를 따른다.

> **이 디렉터리는 절대 배포하지 않는다.** 루트 `electron-builder.config.cjs`의
> `files` 화이트리스트에 없으므로 패키징되지 않으며, `scripts/` 아래에 파일을 만들지 않는다.
> 릴리즈 전에는 `node leak-check.cjs` 로 누출 여부를 수동 검사한다.

## 현재 구현 범위

| Phase | 내용 | 상태 |
|---|---|---|
| 0 | 배포 누출 방지 검사(`leak-check.cjs`), `.gitignore` 계약 | 구현 |
| 1 | 임시 작업 공간, 격리 환경, 서버 spawn/readiness/수명 관리, ABI 프리플라이트 | 구현 |
| 2 | 외부 호출 차단 guard(`NODE_OPTIONS=--require`), fixture 직접 seed | 구현 |
| 3 | health / auth / dailylog / recovery 시나리오 | 구현 |
| 4 | Playwright UI·레이아웃 회귀 | 실험적 구현(--ui, 기본 미사용) |
| 5 | `--changed` 선택 실행·기준선 비교 | 구현 |
| - | `fixture` 모드 mock 주입, `smoke` 모드 | 별도 승인 대상(§2.4) |

## 사용법

```powershell
node tools/diagnostic-runner/runner.cjs --scenario health
node tools/diagnostic-runner/runner.cjs --scenario all
node tools/diagnostic-runner/runner.cjs --scenario all --lint   # npm run lint 결과를 리포트에 포함
node tools/diagnostic-runner/runner.cjs --scenario all --ui    # (실험적) Playwright UI 검사
node tools/diagnostic-runner/runner.cjs --scenario all --keep-artifacts
node tools/diagnostic-runner/runner.cjs --list

# 배포 누출 검사(수동)
node tools/diagnostic-runner/leak-check.cjs
node tools/diagnostic-runner/leak-check.cjs --asar release/win-unpacked/resources/app.asar
node tools/diagnostic-runner/leak-check.cjs --win-unpacked release/win-unpacked
```

- 실패 실행은 `tmp/diagnostics/run-<id>/` 에 서버 로그, guard 로그, 임시 DB가 보존된다.
- 성공 실행은 기본적으로 정리되며 `result.json`만 남는다.
- `result.json`의 `runtime` 블록에는 Node/ABI 정보가 기록된다(ABI 불일치 원인 추적용).


## 메뉴 커버리지 (전체 메뉴 자동 회귀검증)

| 메뉴 | 시나리오 | 상태 |
|---|---|---|
| 대시보드 | menus-light (집계 GET) | implemented |
| 유량관리 | dailylog (검침 보정 규칙 포함) | implemented |
| 약품관리 | medicine (재고 규칙 포함) | implemented |
| 수질분석 | water-quality | implemented |
| 키트관리 | kit | implemented |
| 운전상태 | operation-status | implemented |
| 성적서 | menus-light (목록 조회) | implemented |
| 업무사진관리 | facility (업무기록 CRUD) | implemented |
| 장비이력카드 | menus-light (404 트립와이어) | contract-pending |
| 일지작성(7개 뷰) | dailylog + 각 원본 데이터 시나리오 | implemented |
| 소통게시판 | board (Firebase 결합 고정) | contract-pending |
| 설정 | menus-light (읽기 전용) | implemented |
| 로그인/권한 | auth | implemented |
| 서버 복구 | recovery | implemented |
| 양방향 현장 격리 | site-isolation (403/409 포함) | implemented |

- `contract-pending` 항목은 현재 동작을 고정하는 트립와이어다. 계약이 바뀌면 해당 단계가 실패하며 승격을 요구한다.
- 게시판은 Firebase 키 없이 쓰기·조회 모두 500(로컬 폴백 없음)이 현재 계약이다.

## 격리 계약

- `OSOO_APP_DATA_PATH`, `APPDATA`, `LOCALAPPDATA`, `TEMP` 모두 run 디렉터리로 격리되며
  `%APPDATA%\Osoo_Handle_App` 운영 경로는 절대 읽거나 쓰지 않는다.
- 환경변수는 허용목록 방식으로만 전달되어 Google/Firebase/BigQuery credential 변수가
  자식 프로세스에 유입되지 않는다.
- `OSOO_PACKAGED=1` 로 프로젝트 루트 credential fallback(`.env.local`, `client_secret_*.json`)
  을 차단하고, `NODE_OPTIONS` guard 가 loopback 외 네트워크 호출을 기록·차단한다.
- 포트는 `OSOO_API_PORT_MIN` 방식(일반 Node 계약, `validate-release --api-test`와 동일)으로 임의 포트에 바인딩한다.
- 포트는 `OSOO_API_PORT_MIN` 방식(일반 Node 방식, `validate-release --api-test`와 동일)을 쓴다.
- better-sqlite3 ABI가 Node와 맞지 않으면 시나리오 전에 명확히 실패한다.
  (`electron:build` 직후라면 `npm rebuild better-sqlite3` 후 재실행)

## 에이전트 워크플로 (쿼터 절감)

기능을 수정하거나 추가한 뒤, 에이전트는 린트·검증·시뮬레이션을 수동으로 반복하지 말고
한 번의 실행으로 마친다:

```powershell
node tools/diagnostic-runner/runner.cjs --scenario all --lint
```

- 결과는 마지막 요약(stdout)과 `tmp/diagnostics/run-*/result.json`, 그리고 코딩 에이전트 인계용
  `agent-report.md`(단계별 HTTP 증거·타임스탬프·재현 안내 포함, 성공 실행도 보존)로 판정한다.
- 검증 후에는 `agent-report.md`를 해당 메뉴를 수정할 코딩 에이전트에게 그대로 전달한다.
  실패 단계에는 errorCode·메시지·요청/응답 요약·재현 명령이 포함되어 있다.
- status가 passed면 추가 검증 반복 없이 종료한다. failed면 실패 단계·errorCode·보존된
  산출물(서버 로그·guard 로그·임시 DB)만 읽고 해당 부분만 수정한다.
- --ui는 화면(UI) 수정이 있을 때만 붙인다.


## 권장 운용 (검증 3단계)

| 상황 | 실행할 검증 |
|---|---|
| 일반 기능 수정 직후 | 러너 1회 (`--scenario all --lint --changed`) |
| Electron·인증·서버 공통·패키징·릴리즈 전 | 러너 + `npm run validate` |
| 설치파일 생성 후 | 배포 검증 (`validate:asar` 포함) |

러너는 1차 회귀검증기다. `npm run validate`(패키지/asar/설치 계약)를 대체하지 않는다.
게시판 500·시설 중복 저장 500 등 contract-pending 단계는 정상 판정이 아니라
현재 동작을 고정하는 감시선이다.

## 선택 실행과 기준선 비교

- `--changed [ref]`: git 변경 파일을 시나리오로 매핑해 관련 것만 실행한다(항상 health 포함).
  매핑 규칙은 `lib/changed-scope.cjs`에 있다. infra(server 공통/전역 UI)나 미매핑 코드 파일이
  하나라도 있으면 안전하게 전체 실행으로 돌아간다. 문서·로그는 무시된다.
- 기준선 비교: 매 실행 직전 성공 실행의 result.json과 비교해 신규/제거 단계와
  소요시간 급증(500ms 초과 & 2배 이상)을 agent-report.md에 기록한다(경고 수준, 판정 불변).
- 산출물 보존 정책: 실행마다 최근 10개 run 디렉터만 유지한다(잠긴 항목은 최선형 건너뛰기).

## 인코딩 규칙

이 도구의 모든 파일은 UTF-8(BOM 없음)로만 저장한다. Windows 콘솔 출력의 한글 깨짐은
CP949 표시 문제일 수 있으므로, 파일 판정은 `npm run validate` 결과를 따른다.
