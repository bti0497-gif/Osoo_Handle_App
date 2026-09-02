# 진단 러너 에이전트 인계 문서 (Diagnostic Runner Handoff)

> **이 문서의 수신자**: 이 앱의 기능을 수정하거나 추가하는 코딩 에이전트.
> 세션 맥락이 없어도 이 문서만으로 진단 러너를 완전히 사용할 수 있도록 작성됐다.

---

## 0. 이 도구는 무엇이고, 왜 쓰는가

**에이전트가 기능을 수정한 뒤 린트 → 검증 → 시뮬레이션을 반복하면서 쿼터를 대량 소모하는 것을 막기 위해** 만들어진 하드코딩된 원샷 검증 스크립트다.

- 수정 직후 **명령 1번** 실행 → 구조화된 결과 로그(`agent-report.md` + `result.json`) 생성
- 로그에 실패 단계·errorCode·HTTP 요청/응답 증거·재현 안내가 포함되어, **결과 읽기 외의 반복 소비가 필요 없다**
- 격리 실행: 운영 DB·AppData·외부 서비스(Drive/BigQuery/Firebase)에 접근하지 않는다

**판정 원칙**: status가 `passed`면 추가 검증 반복 없이 종료한다. `failed`면 해당 부분만 수정한다.

---

## 1. 명령어 (빠른 시작)

```powershell
cd "E:\Wastewater Treatment Plant"

# 표준: 전체 메뉴 회귀검증 + 린트 (수정 직후 이것만 돌리면 된다)
node tools/diagnostic-runner/runner.cjs --scenario all --lint

# 빠른 검증: 변경 파일 기반 선택 실행 (부분 수정 시)
node tools/diagnostic-runner/runner.cjs --scenario all --lint --changed

# 커버리지 갭 확인 (새 메뉴/기능 추가 시)
node tools/diagnostic-runner/runner.cjs --coverage

# 실패 분석용: 산출물 보존
node tools/diagnostic-runner/runner.cjs --scenario <이름> --keep-artifacts
```

- **종료 코드**: `0` = 통과, `1` = 검증 실패, `2` = 차단(잘못된 옵션/포트 점유 등)
- **소요**: 전체 실행 약 50~60초 (린트 포함 시 +35~50초)

---

## 2. 커버리지 (전 메뉴)

| 메뉴 | 시나리오 | 검증 내용 |
|---|---|---|
| 대시보드 | menus-light | 업무별 집계 GET 조합 |
| 유량관리 | dailylog | 저장·재조회·전일 대비 증분 규칙·감소 거부·수정 경로 |
| 약품관리 | medicine | 입고/사용·**재고 계산 규칙**·수정 경로 |
| 수질분석 | water-quality | 항목 입력(롱형식 upsert)·피벗 재조회·수정 |
| 키트관리 | kit | 일괄 입력·DB 불변식·수정 |
| 운전상태 | operation-status | PH/DO/SVI 저장·재조회·수정 |
| 성적서 | menus-light | 목록 조회 |
| 업무사진관리 | facility | 업무기록 INSERT/PUT 수정·중복 날짜 거부 |
| 장비이력카드 | menus-light | **404 트립와이어**(백엔드 부재 고정) |
| 일지작성(7뷰) | dailylog + 원본 데이터 | 원본 데이터 계약으로 커버 |
| 소통게시판 | board | **Firebase 강제 결합 고정**(감시선) |
| 설정 | auth / menus-light | 현장 설정·목록 |
| 로그인/권한 | auth | 로그인·거부·admin 차단·사이트 가드 |
| 서버 복구 | recovery | 재시작 후 데이터 보존·무결성 |
| (교차) 사이트 격리 | site-isolation | 양방향 현장 격리·403/409 |
| (교차) 사진 날짜 호환 | photo-date-compat | YYYYMMDD/legacy YYYYDDMM 이중 매칭 |
| (교차) 큐앤테크 사진 | qntech-photo | fail-closed(실패 시 부분 오염 없음) |

**현재: 14 시나리오 53단계 전부 통과. 미커버 메뉴 없음.** (`--coverage`로 상시 확인)

---

## 3. 결과 해석

### 3.1 성공 실행
- 콘솔 요약 + `tmp/diagnostics/run-<시각>/agent-report.md` + `result.json`만 보존된다.
- `agent-report.md`에 단계별 HTTP 증거와 시각이 있으므로 **회귀 비교 기준으로 그대로 전달** 가능하다.

### 3.2 실패 실행
- run 디렉터 전체가 보존된다: `logs/server-stdio.log`(서버 로그), `logs/external-call-guard.jsonl`(외부 호출 차단 기록), `app-data/osoo.db`(임시 DB), `guard/guard-boot-*.json`(자식 env 증거).
- **수정 에이전트의 행동 순서**: `agent-report.md`의 실패 단계(errorCode·메시지·HTTP 증거) → `server-stdio.log`의 해당 시각 앞뒤 → 원인 수정 → 전체 재실행.

### 3.3 주요 errorCode
| errorCode | 의미 | 대응 |
|---|---|---|
| `LINT_FAILED` | 린트 위반(다른 에이전트 진행 중 코드일 수 있음) | tail의 파일·라인 확인 후 수정 |
| `SITE_*` | 현장 컨텍스트/격리 계약 위반 | seed 현장·헤더 확인 |
| `FLOW_*` / `INVENTORY_RULE_*` | 업무 규칙 회귀 | 해당 라우트 계약 대조 |
| `BROWSER_ERRORS` / `VIEWPORT_LAYOUT_BROKEN` | UI 회귀(--ui 실험 모드) | 화면 수정 |
| `ABI 불일치` | better-sqlite3가 Electron ABI | 아래 5.1 참조 |
| `SERVER_FILES_UNSTABLE` | server/index.cjs가 계속 재기록됨 | 5.3 참조 |

---

## 4. 격리·내부 구조 요약 (동작 원리)

- **임시 격리**: 매 실행마다 새 `tmp/diagnostics/run-<id>/`를 만들고 `OSOO_APP_DATA_PATH`·`APPDATA`·`LOCALAPPDATA`·`TEMP`를 그 안으로 격리한다. 운영 `%APPDATA%\Osoo_Handle_App`은 절대 접근하지 않는다.
- **포트**: `OSOO_API_PORT_MIN`(일반 Node 계약)으로 임의 포트 바인딩. `ELECTRON=1` 방식은 사용하지 않는다.
- **guard 리다이렉트(중요)**: `NODE_OPTIONS=--require`로 주입되는 guard가 세 가지를 한다.
  1. diagnostic-env.json의 OSOO_* 값을 preload 시점에 process.env에 재주입(spawn env 유실 대비 이중화)
  2. `require('better-sqlite3')`와 `.node` 바인딩 로드를 **tools 로컬 Node-ABI 사본**으로 리다이렉트(루트 사본은 electron:build로 Electron ABI가 되기 때문)
  3. loopback 외 http/https/net/tls 호출 차단·기록, 외부 SDK 로드 기록
- **better-sqlite3 이중 사본**: 루트는 서버용(ABI가 빌드에 따라 바뀜), `tools/diagnostic-runner/node_modules/better-sqlite3`(12.11.1 고정)은 러너·시나리오·서버(리다이렉트) 전용이다.

---

## 5. 트러블슈팅

### 5.1 `better-sqlite3 ... NODE_MODULE_VERSION 143` (ABI 불일치)
`electron:build`/`@electron/rebuild` 직후에 발생한다. 복구:
```powershell
npm rebuild better-sqlite3
```
- **주의**: 다른 에이전트의 라이브 서버가 `.node` 파일을 잠그고 있으면 rebuild/복사가 "Device or resource busy"로 실패한다. 해당 프로세스 종료 후 재시도.
- 러너·시나리오는 tools 로컬 사본을 쓰므로 루트 재빌드와 무관하게 동작한다.

### 5.2 `포트 18731가 이미 점유` / 임시 포트 관련
러너는 임의 포트를 쓰므로 충돌이 없어야 한다. 18731 점유는 실행 중인 현장 앱이므로 **절대 kill하지 말고** 앱을 종료한 뒤 재실행한다.

### 5.3 `SERVER_FILES_UNSTABLE`
`server/index.cjs`가 실행 중 계속 재기록되고 있다는 뜻이다. 다른 에이전트의 동시 작업 또는 동기화 도구를 의심한다. 파일이 안정되면 재실행한다.

### 5.4 `ENV_DELIVERY_*`
자식 프로세스 env 전달 실패. guard 부팅 기록(`guard-boot-<pid>.json`의 envProbe)이 원문 증거를 남긴다. 다른 에이전트와 동시 실행 중이라면 종료 후 재시도한다.

---

## 6. 확장 방법 (새 기능 흡수 절차)

새 메뉴/기능이 추가되면 다음 순서로 흡수한다:

1. **시나리오 파일 추가**: `tools/diagnostic-runner/scenarios/<id>.scenario.cjs` — 표준 구조(create → reload → db-invariant, 필요 시 update/거부 계약). `covers: ['<메뉴 id>']` 선언 필수. 파일만 추가하면 **자동 등록**된다(SCENARIO_ORDER 수동 편집 불필요). recovery처럼 마지막에 실행돼야 하는 시나리오는 `last: true`.
2. **`node tools/diagnostic-runner/runner.cjs --coverage`** — 미커버 메뉴가 해소됐는지 확인.
3. **changed-scope 매핑**(필요 시): `lib/changed-scope.cjs` RULES에 새 기능 경로 → 시나리오 규칙 추가. 미매핑 코드는 안전하게 전체 실행으로 돌아간다.
4. **전체 스위트 재실행** → 통과 시 README 커버리지 표 갱신 → 커밋.

**판정 규칙**: 구현 디테일(응답 래퍼 형태 등)에 붙는 단정보다, 관대한 추출 + 업무 규칙 단정을 유지한다. 앱 동작이 의도적으로 바뀌면 시나리오 `version`을 올리고 단정을 갱신한다.

---

## 7. 현재 계약 특이사항 (앱 코드 개선 대기 목록)

이 항목들은 **버그가 아니라 현재 동작을 고정한 감시선**이다. 수정되면 시나리오 갱신이 필요하다:

1. **게시판 Firebase 강제 결합**: 키 파일이 없으면 쓰기·조회 모두 500. 로컬 저장 폴백 없음. 로컬 우선 저장 구현 시 board 시나리오를 implemented로 승격.
2. **시설관리 중복 날짜 POST → 500**: UNIQUE 위반이 500으로 나온다. 409 개선 여지.
3. **과거 검침 수정의 재계산**: 과거 검침을 수정하면 이후 일자 증분이 재계산되고, 음수는 0으로 기록된다(정보 손실 여지 — 현장 검토 권장).
4. **장비이력카드**: 백엔드 라우트 부재(프로토타입). 계약 확정 시 404 트립와이어가 실패하며 알려준다.
5. **Excel 프리워머 누수**: 서버 기동 시 띄운 EXCEL.EXE가 종료되지 않고 누적된다(hwpAutomationWorker 쪽 종료 처리 필요).

---

## 8. 운영 제약 (알고 쓰기)

- **동시 에이전트 금지**: 다른 에이전트가 같은 워크스페이스의 파일을 수정/빌드하는 동안에는 실행하지 않는다. 파일 되돌림·ABI 뒤집기·env 간섭이 관측된 바 있다.
- **ABI 댄스**: `electron:build` 후에는 better-sqlite3가 Electron ABI가 된다. 러너 실행 전 `npm rebuild better-sqlite3` 1회. (러너의 프리플라이트가 이를 최우선으로 잡아준다.)
- `npm run validate`를 대체하지 않는다: Electron·패키징·설치파일 계약은 기존 검증 체인이 담당한다. **권장 운용: 일반 수정 → 러너 1회 / 릴리즈 전 → 러너 + npm run validate / 설치파일 후 → validate:asar.**
- `--ui`(Playwright 화면 검사)는 실험적 코드로 보존돼 있으며 기본 실행에 포함되지 않는다.

---

## 9. 인코딩 규칙 (필수)

이 도구의 모든 파일은 **UTF-8(BOM 없음)**로만 저장한다. 작성 후 한자/가나 혼입 스캔(`[\u4e00-\u9fff\u3040-\u30ff]` 정규식 전수 검사)과 `npm run validate`를 통과해야 한다. Windows 콘솔의 한글 깨짐은 CP949 표시 문제일 뿐이며, 파일 판정은 validate 결과를 따른다.
