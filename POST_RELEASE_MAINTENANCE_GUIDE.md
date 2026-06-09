# 릴리즈 이후 유지보수 지침

## 1. 목적

이 문서는 최초 릴리즈 이후 현장 사용 경험을 바탕으로 들어오는 수정, 기능 추가, 디자인 변경, 양식 변경을 빠르게 처리하기 위한 관리 지침이다.

목표는 다음과 같다.

- 현장별 차이를 코드 수정이 아니라 설정, 템플릿, 매핑으로 최대한 흡수한다.
- 수정 요청이 들어왔을 때 어느 파일과 어느 계층을 봐야 하는지 명확히 한다.
- 자동 업데이트 배포 전에 검증해야 할 항목을 고정한다.
- admin 전용 설정 콘솔과 현장관리자 업무 화면의 경계를 유지한다.
- 이번 리팩토링을 향후 업그레이드의 기준 구조로 삼아, 다시 대단위 리팩토링이 필요해지는 상황을 예방한다.

## 2. 리팩토링 이후 기준 구조

설정 메뉴는 admin 전용 콘솔로 관리한다.

```text
src/features/settings/
  SettingsView.jsx
  SettingsModel.js
  useSettingsViewModel.js

  hooks/
    useExternalServiceSettings.js
    useMappingSettings.js
    useTemplateSettings.js
    useDefaultAmountSettings.js
    useItemSettings.js
    useBasicSiteSettings.js
    useMeasurementPlaceSettings.js

  components/
    SettingsShell.jsx
    SettingsTabs.jsx
    SettingsSection.jsx
    SettingsDataModal.jsx
    SettingsImportProgress.jsx

  panels/
    BasicSitePanel.jsx
    MeasurementPlacePanel.jsx
    FlowMappingPanel.jsx
    WaterMappingPanel.jsx
    MedicinePanel.jsx
    KitPanel.jsx
    TemplatePanel.jsx
    WebAppPanel.jsx
    DriveSyncPanel.jsx
    SludgeExportPanel.jsx
    LogMappingPanel.jsx

  widgets/
    ItemActiveGrid.jsx
    ExcelCellMapper.jsx
    LocationOrderEditor.jsx
    CredentialCard.jsx
    TemplateUploadCard.jsx
    MappingPreviewTable.jsx
```

구조 원칙:

- `SettingsView.jsx`는 설정 콘솔 조립만 담당한다.
- `useSettingsViewModel.js`는 전체 조립 계약을 담당하고, `shellState`, `basicSiteState`, `itemState`, `templateState`, `mappingState`, `webAppState`, `logMappingState`, `defaultAmountState` 단위로 반환한다.
- 세부 상태/핸들러는 `hooks/`로 분리한다.
- `panels/`는 설정 탭 또는 큰 업무 단위다.
- `widgets/`는 여러 패널에서 반복되는 작은 UI 단위다.
- 패널과 위젯은 직접 API를 호출하지 않는다.
- API 호출은 `SettingsModel.js`와 ViewModel을 경유한다.
- admin 권한 조건은 느슨하게 만들지 않는다.
- `DriveSyncPanel.jsx`는 아직 실제 UI가 없으므로 생성하지 않고, Drive 동기화 설정 UI가 생길 때 추가한다.
- 새 기능은 이 구조 안에 붙인다. 구조가 맞지 않는다고 느껴지면 먼저 기존 책임 분리가 잘못된 것인지 확인하고, 대단위 재배치가 아니라 작은 패널/위젯/hook/service 추가로 해결한다.

대단위 리팩토링 재발 방지 원칙:

- 한 파일에 서로 다른 업무 책임을 계속 추가하지 않는다.
- View 파일이 API 호출, 저장 판단, 데이터 변환을 직접 담당하지 않는다.
- ViewModel이 화면별 모든 세부 상태를 직접 들고 비대해지면 hook으로 분리한다.
- 라우트 파일이 SQL, 외부 API, 파일 처리 로직을 직접 들고 비대해지면 service로 분리한다.
- 새 기능을 추가할 때 “어느 패널, 어느 위젯, 어느 hook, 어느 service에 들어갈지”를 먼저 정하고 작업한다.
- 구조 정리와 기능 추가는 커밋을 분리한다.
- 파일이 500줄 이상이거나 한 화면에서 두 개 이상의 업무 도메인이 섞이면 다음 작업 전에 분리 계획을 먼저 세운다.

## 3. 수정 요청 분류

현장 사용 후 들어오는 요청은 먼저 아래 분류 중 하나로 정리한다.

```text
CONFIG   현장별 설정 문제
DATA     데이터 입력/저장 문제
REPORT   일지/대장/성적서 출력 문제
SYNC     BigQuery, Drive, Firebase 동기화 문제
PHOTO    사진 저장, 업로드, 복구 문제
UX       화면 동선, 문구, 버튼, 디자인 문제
FEATURE  새 기능 추가
BUILD    설치파일, 자동업데이트, 릴리즈 문제
ROADWORK 도로공사 홈페이지 입력 보조/자동입력 문제
```

분류 기준:

- 현장마다 다른 값이면 먼저 `CONFIG`로 본다.
- 엑셀 출력 위치나 그래프 문제면 먼저 `REPORT`로 본다.
- 로컬에는 있는데 중앙에 없거나, 중앙에는 있는데 로컬에 없으면 `SYNC`로 본다.
- 사진 파일이 없거나 복구가 필요한 경우 `PHOTO`로 본다.
- 사용자가 헷갈린다고 말하면 기능 오류가 아니어도 `UX`로 본다.
- 도로공사 홈페이지에 옮겨 적는 업무는 `ROADWORK`로 분류한다.

## 4. 요청별 확인 위치

### 설정 UI 수정

```text
src/features/settings/panels/
src/features/settings/widgets/
src/features/settings/useSettingsViewModel.js
src/features/settings/SettingsModel.js
```

예:

- 측정장소 이름/순서 수정: `MeasurementPlacePanel`, `LocationOrderEditor`
- 약품/키트 항목 관리 수정: `MedicinePanel`, `KitPanel`, `ItemActiveGrid`
- 셀 매핑 수정: `FlowMappingPanel`, `WaterMappingPanel`, `ExcelCellMapper`
- 엑셀 양식 업로드 수정: `TemplatePanel`, `TemplateUploadCard`
- 외부 계정 수정: `WebAppPanel`, `CredentialCard`
- 슬러지반출 기본값 수정: `LogMappingPanel`, `SludgeExportPanel`

설정 기능 추가 위치:

- 새 탭이 필요한 큰 기능이면 `panels/`에 패널을 추가한다.
- 기존 탭 안의 반복 UI면 `widgets/`에 위젯을 추가한다.
- API 호출은 `SettingsModel.js`에만 추가한다.
- 상태/저장/검증 로직은 `hooks/` 또는 `useSettingsViewModel.js`에 둔다.
- 백엔드 업무 로직은 `server/services/settings/`에 둔다.
- 설정 저장값으로 흡수 가능한 현장별 차이는 코드 분기보다 설정 항목으로 추가한다.

### 현장 업무 화면 수정

```text
src/features/flow/
src/features/water/
src/features/medicine/
src/features/kit/
src/features/sludge/
src/features/dailylog/
```

규칙:

- View는 UI 렌더링만 담당한다.
- ViewModel은 상태와 비즈니스 로직을 담당한다.
- Model은 API 호출만 담당한다.

### 백엔드 API/라우트 추가

```text
ROUTE_CREATION_GUIDE.md
server/routes/
server/services/
server/routeRegistry.cjs
server/api-spec.cjs
```

운영 원칙:

- 새 라우트 작성 전 `ROUTE_CREATION_GUIDE.md`를 먼저 확인한다.
- 라우트 파일은 요청/응답 계층만 담당하고, 업무 로직은 `server/services/`로 분리한다.
- API를 추가하거나 제거하면 `server/routeRegistry.cjs`와 `server/api-spec.cjs`를 함께 갱신한다.
- 프론트에서는 feature의 `Model.js`에만 API 호출을 추가한다.
- 라우트 변경 후 `npm run validate`를 실행한다.

### 일지/대장 출력 수정

```text
templates/reports/
server/services/
server/routes/excelRoutes.cjs
server/routes/dailyWorkLogRoutes.cjs
server/routes/medicineInRoutes.cjs
server/routes/sludgePhotoRoutes.cjs
```

운영 원칙:

- 가능하면 엑셀 템플릿과 셀 매핑으로 해결한다.
- 코드 수정은 템플릿/매핑으로 해결할 수 없을 때만 한다.
- 그래프는 템플릿 안에 유지하고, 앱은 데이터 셀과 사진 삽입만 담당하도록 한다.

### 도로공사 입력 도우미 수정

```text
ROADWORK_INPUT_HELPER_PLAN.md
ROADWORK_INPUT_HELPER_TASK.md
src/features/roadwork-helper/
server/routes/roadworkHelperRoutes.cjs
```

운영 원칙:

- 1차 목표는 자동입력이 아니라 수동 입력 보조다.
- 현장관리자가 도로공사 홈페이지를 보면서 앱 데이터를 쉽게 옮겨 적을 수 있어야 한다.
- 유량, 약품사용량, 키트사용량은 탭으로 구분한다.
- 도로공사 홈페이지 입력 순서가 확인되면 그 순서대로 복사용 그리드를 맞춘다.
- 한 번에 붙여넣기 가능한 경우 TSV 형식 복사를 우선 지원한다.
- 항상 위에 보이는 보조 창이 필요하면 Electron 창 수정이 필요하므로 별도 승인 후 진행한다.

### 동기화 수정

```text
server/services/bigQuerySyncService.cjs
server/services/bigQueryRestoreService.cjs
server/services/driveService.cjs
server/services/boardFirebaseService.cjs
server/services/boardService.cjs
```

확인 순서:

1. 로컬 DB에 저장되었는지 확인
2. `is_synced` 또는 동기화 상태 확인
3. BigQuery/Drive/Firebase에 올라갔는지 확인
4. 실패 로그가 남았는지 확인
5. 복구 경로가 있는지 확인

### 사진 저장/복구 수정

```text
server/routes/medicineInRoutes.cjs
server/routes/sludgePhotoRoutes.cjs
server/services/driveService.cjs
```

원칙:

- 사진은 로컬 저장을 우선한다.
- Drive 설정이 있으면 백그라운드로 업로드한다.
- 로컬 사진이 없고 Drive에 있으면 사용자에게 확인 메시지를 띄운 뒤 복구한다.
- Drive에도 없으면 사진 없음 상태를 유지한다.

## 5. 현장별 차이 처리 원칙

현장별 차이는 가능한 한 코드가 아니라 설정으로 관리한다.

- 측정장소명: 설정 메뉴에서 관리
- 공법/계열: 설정 메뉴에서 관리
- 양식 차이: 엑셀 템플릿 교체로 관리
- 셀 위치 차이: 셀 매핑으로 관리
- 담당자 차이: 현장관리자 설정으로 관리
- 출력 그래프 차이: 엑셀 템플릿 내부 차트로 관리

코드 수정이 필요한 경우:

- 기존 설정 구조로 표현할 수 없는 새 데이터 종류가 생긴 경우
- 저장/동기화 테이블 구조가 달라져야 하는 경우
- 모든 현장에 공통 적용할 UX 또는 기능 변경인 경우

## 6. 릴리즈 전 검증 루틴

모든 수정 후 최소한 아래 명령을 실행한다.

```bash
npm run validate
npm run build
```

설치파일 릴리즈 전에는 추가로 확인한다.

```text
admin 로그인
설정 메뉴 진입
현장 기본 설정 저장
현장관리자 로그인
출근/퇴근 기록
유량/수질/약품/키트/슬러지 저장
BigQuery 백그라운드 업로드
Drive 사진 업로드
Drive 사진 복구
Firebase 게시판 작성/조회
일지/대장 Excel 출력
성적서 선택 PDF 다운로드
자동 로그아웃/트레이 동작
```

## 7. 버전 운영

권장 버전 흐름:

```text
v1.0.0  최초 현장 배포 기준 안정판
v1.0.1  현장 사용 중 발견된 버그 수정
v1.1.0  설정/양식/UX 개선
v1.2.0  기능 추가
v2.0.0  중앙관리자 앱과 역할 분리 본격화
```

버전 기준:

- 패치 버전: 버그 수정, 문구 수정, 작은 UX 조정
- 마이너 버전: 새 설정 항목, 새 출력 양식, 사용자 동선 개선
- 메이저 버전: DB 구조 변경, 중앙관리자 앱 분리, 권한 체계 변경

## 8. 커밋 단위 원칙

커밋은 기능 경계별로 작게 나눈다.

예:

```text
refactor(settings): extract medicine and kit panels
refactor(settings): extract mapping widgets
fix(sync): retry BigQuery upload for flow readings
fix(report): bind medicine-in photos by placeholder name
feat(settings): add measurement place editor
```

한 커밋에 섞지 말 것:

- 구조 리팩토링과 기능 변경
- DB 스키마 변경과 UI 변경
- 템플릿 교체와 동기화 로직 변경
- 빌드 설정 변경과 업무 기능 수정

## 9. 릴리즈 이후 운영 메모

- 현장 요청은 먼저 재현 절차와 날짜, 현장명, 로그인 사용자, 메뉴명을 기록한다.
- 출력물 문제는 해당 엑셀 템플릿 파일과 바인딩 데이터를 함께 확인한다.
- 동기화 문제는 로컬 DB, BigQuery, Drive/Firebase 순서로 확인한다.
- 현장별 예외가 2곳 이상 반복되면 설정 항목으로 승격할지 검토한다.
- 새 기능은 먼저 admin 설정으로 제어 가능한 형태인지 검토한다.
## Google 공식 계정/프로젝트 교체

운영 배포 시 개인 개발 계정에서 회사 공식 Google 계정으로 전환할 수 있다. 이때 코드 수정이 아니라 `.env.local`, `server/config/google-key.json`, `server/config/firebase-service-account.json` 교체와 권한 검증으로 처리한다.

계정 교체 절차는 `GOOGLE_ACCOUNT_MIGRATION_GUIDE.md`를 우선 확인한다.

핵심 원칙:

- Google Sheets, BigQuery, Drive, Firebase 연결 정보는 코드에 직접 쓰지 않는다.
- Google/Firebase 연동 로직은 `server/services/`에서 관리한다.
- 계정 교체와 기능 수정은 같은 커밋에 섞지 않는다.
- 교체 후 `npm run validate`와 실제 로그인/출결/업로드/게시판 수동 검증을 수행한다.
