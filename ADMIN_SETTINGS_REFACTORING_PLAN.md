# Admin 설정 콘솔 위젯화 리팩토링 계획

## 1. 배경

설정 메뉴는 일반 현장관리자 업무 화면이 아니라 admin 전용 초기 세팅/유지보수 콘솔이다.

현재 `src/features/settings/SettingsView.jsx`는 약 2,000줄 이상으로 비대하고, 설정 화면의 하위 기능들이 파일 단위 컴포넌트가 아니라 내부 렌더 함수로만 나뉘어 있다. 측정장소관리, 키트관리, 약품관리, 장소/데이터 매핑, 엑셀 양식 관리, 외부 서비스 연동 설정이 한 파일에 섞여 있어 업그레이드와 수리 비용이 커지고 있다.

따라서 설정 메뉴를 admin 전용 관리 콘솔로 정의하고, 하부 기능을 패널 단위로 분리하며, 반복 UI를 위젯으로 재사용하는 방향으로 리팩토링한다.

릴리즈 이후 유지보수 기준은 `POST_RELEASE_MAINTENANCE_GUIDE.md`를 따른다.

설정 메뉴 리팩토링 전에 일지 메뉴 하위의 `공사 입력 도우미` 진입점과 향후 확장 공간을 먼저 확보한다. 상세 계획은 `ROADWORK_INPUT_HELPER_PLAN.md`를 따른다.

## 2. 목표

- admin 전용 설정 영역을 일반 업무 메뉴와 구조적으로 구분한다.
- 설정 메뉴의 하부 기능을 패널 단위 파일로 분리한다.
- 각 탭 안에서 반복되는 부분 기능을 위젯화한다.
- 1차 리팩토링에서는 동작 변경 없이 파일 구조만 나눈다.
- 2차 리팩토링에서 ViewModel과 서버 라우트를 도메인별로 나눈다.
- 현장관리자에게 설정 메뉴가 노출되지 않는 기존 권한 흐름을 유지한다.

## 3. 현재 상태

```text
src/features/settings/
  index.js
  SettingsModel.js
  SettingsView.jsx
  useSettingsViewModel.js
```

문제점:

- `SettingsView.jsx`가 설정 UI 대부분을 직접 렌더링한다.
- `useSettingsViewModel.js`가 기본 설정, 매핑, 템플릿, 외부 연동 설정, 업로드 상태를 함께 관리한다.
- 설정 탭은 화면상으로는 나뉘어 있지만 코드 관리 단위는 분리되어 있지 않다.
- 측정장소, 약품, 키트, 유량, 수질, 일지 매핑이 서로 다른 업무인데 같은 파일 안에서 유지보수된다.

## 4. 권장 구조

```text
src/features/settings/
  SettingsView.jsx
  SettingsModel.js
  useSettingsViewModel.js

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

## 5. 패널 분리 기준

- `BasicSitePanel`: 현장 선택, 공법, 계열, 현장 위치, 현장관리자 선택
- `MeasurementPlacePanel`: 유량조정조, 혐기조, 무산소조, 포기조, 침전조, 방류조 등 측정장소 관리
- `FlowMappingPanel`: 유량 항목 관리와 엑셀 셀 매핑
- `WaterMappingPanel`: 수질 항목 관리, 측정장소별 컬럼 매핑, 엑셀 셀 매핑
- `MedicinePanel`: 약품 기본 목록, 활성화 여부, 약품관리대장/입고일지 매핑
- `KitPanel`: 키트 기본 목록, 활성화 여부, 키트입고일지 매핑
- `TemplatePanel`: 엑셀 양식 업로드, 저장 상태, 미리보기
- `WebAppPanel`: QnTECH 등 외부 웹앱 접속 정보
- `DriveSyncPanel`: Google Drive, BigQuery, Firebase 등 동기화 관련 설정
- `SludgeExportPanel`: 슬러지 사진대지/반출관리대장 출력 설정
- `LogMappingPanel`: 일일업무일지 데이터 매핑

## 6. 위젯 분리 기준

- `ItemActiveGrid`: 항목명, 활성화 여부, 추가/삭제 버튼을 가진 공통 목록
- `ExcelCellMapper`: 항목과 셀 주소를 연결하는 공통 매핑 테이블
- `LocationOrderEditor`: 현장별 측정장소 순서와 표시명을 조정하는 위젯
- `CredentialCard`: URL, ID, 비밀번호, 표시/숨김, 편집잠금 처리를 가진 공통 카드
- `TemplateUploadCard`: 엑셀 양식 업로드, 현재 파일 상태, 미리보기 버튼을 가진 공통 카드
- `MappingPreviewTable`: 엑셀에서 읽어온 행/열 미리보기와 매핑 확인

## 7. 단계별 작업 순서

### 1단계: View 파일 분리

- `SettingsView.jsx`의 내부 렌더 함수들을 그대로 패널 파일로 이동한다.
- `SettingsView.jsx`는 `SettingsShell`과 패널 조립만 담당하도록 축소한다.
- 기존 `useSettingsViewModel.js`의 반환값은 유지하고, 각 패널에 props로 전달한다.
- 이 단계에서는 저장 로직, DB 스키마, API 호출 방식은 변경하지 않는다.

### 2단계: 공통 위젯 추출

- 항목 활성화 목록을 `ItemActiveGrid`로 추출한다.
- 셀 주소 매핑 UI를 `ExcelCellMapper`로 추출한다.
- 측정장소 순서/명칭 편집 UI를 `LocationOrderEditor`로 추출한다.
- URL/ID/PW 입력 UI를 `CredentialCard`로 추출한다.
- 엑셀 양식 업로드 UI를 `TemplateUploadCard`로 추출한다.

### 3단계: ViewModel 내부 분리

- `useSettingsViewModel.js`를 바로 쪼개지 않고, 먼저 반환값 계약을 정리한다.
- 안정화 후 내부 hook을 분리한다.

```text
useBasicSiteSettings
useMeasurementPlaceSettings
useMappingSettings
useTemplateSettings
useExternalServiceSettings
```

### 4단계: 서버 설정 라우트 경량화

- `server/routes/settingsRoutes.cjs`는 요청/응답만 담당하도록 줄인다.
- 실제 로직은 `server/services/settings/` 하위 서비스로 이동한다.

```text
server/services/settings/
  siteSettingsService.cjs
  mappingSettingsService.cjs
  templateSettingsService.cjs
  externalCredentialService.cjs
```

## 8. 금지 사항

- 1차 위젯화에서 DB 스키마를 변경하지 않는다.
- 패널 또는 위젯에서 직접 `fetch` 또는 `apiClient`를 호출하지 않는다.
- admin 권한 조건을 느슨하게 만들지 않는다.
- 현장관리자에게 설정 메뉴가 노출되는 구조로 변경하지 않는다.
- Excel-only 정책을 다시 HWPX 혼합 구조로 되돌리지 않는다.
- 구조 분리와 기능 변경을 한 커밋에 섞지 않는다.

## 9. 검증 기준

- `npm run validate` 통과
- `npm run build` 통과
- admin 로그인 시 설정 메뉴 진입 가능
- 현장관리자 로그인 시 설정 메뉴 미노출
- 현장 기본 설정 저장 가능
- 측정장소관리 저장 가능
- 약품/키트 항목 관리 저장 가능
- 유량/수질/일일업무일지 매핑 저장 가능
- 엑셀 양식 업로드와 미리보기 정상
- 기존 배포/설치 워크플로우 영향 없음

## 10. 완료 기준

- `SettingsView.jsx`가 콘솔 조립 파일 수준으로 축소된다.
- 측정장소관리, 키트관리, 약품관리, 유량/수질/일지 매핑, 템플릿 관리가 파일 단위로 분리된다.
- 공통 매핑/항목/업로드 UI가 위젯으로 재사용된다.
- 기존 admin 초기 설정 워크플로우가 동일하게 동작한다.
- 리팩토링 후 기능 변경 없이 코드 관리 단위만 명확해진다.
- 이후 업그레이드는 이 구조를 기준으로 작은 패널/위젯/hook/service 추가로 처리하며, 다시 대단위 리팩토링이 필요하지 않도록 관리한다.

## 11. 리팩토링 완료 후 실제 구조

설정 화면은 다음 역할 분담을 기준으로 유지한다.

- `SettingsView.jsx`: ViewModel 계약을 받아 패널을 조립한다.
- `useSettingsViewModel.js`: 전체 설정 콘솔의 상태 계약을 `shellState`, `basicSiteState`, `itemState`, `templateState`, `mappingState`, `webAppState`, `logMappingState`, `defaultAmountState`로 묶어 반환한다.
- `hooks/`: 기본 현장, 항목, 측정장소, 템플릿, 매핑, 외부 서비스, 기본 입고량 상태와 핸들러를 분담한다.
- `panels/`: 설정 탭 또는 큰 업무 단위를 담당한다.
- `widgets/`: 여러 패널에서 반복되는 작은 UI를 담당한다.
- `server/services/settings/`: 설정 저장, 사이트 선택, 기본값, 템플릿, 외부 인증, 매핑 저장 업무 로직을 담당한다.

현재 보류:

- `DriveSyncPanel.jsx`는 아직 분리할 실제 UI가 없으므로 생성하지 않는다.
- Drive/Firebase/BigQuery 동기화 설정 UI가 추가될 때 `DriveSyncPanel.jsx`를 생성한다.

추가 반영:

- 측정장소 순서는 `LocationOrderEditor.jsx`에서 조정한다.
- 기본설정 저장 시 `config_items.display_order`도 함께 갱신하여 재로딩 후 순서를 유지한다.
- 새 기능 추가 전에는 `POST_RELEASE_MAINTENANCE_GUIDE.md`의 “대단위 리팩토링 재발 방지 원칙”을 확인한다.

## Google 공식 계정 전환 대비

현재 개발 과정에서는 개인 Google 계정과 개발용 Google Cloud/Firebase 리소스를 사용할 수 있지만, 운영 배포 시 회사 공식 계정으로 교체될 수 있다. 이 리팩토링은 계정 교체 시 코드 수정이 아니라 설정 교체와 서비스 단위 검증으로 대응할 수 있게 만드는 것을 포함한다.

운영 원칙:

- Google/Firebase 연결 값은 `.env.local`과 `server/config/*.json`에 격리한다.
- 계정 교체 때문에 View, ViewModel, route 파일을 수정하지 않는다.
- BigQuery, Drive, Sheets, Firebase 호출 로직은 `server/services/` 하위 서비스에만 둔다.
- 새 Google 연동 기능은 라우트에 직접 구현하지 않고 서비스 모듈로 분리한다.
- 개발 계정 데이터와 회사 공식 계정 데이터를 섞지 않는다.

교체 대상:

- `server/config/google-key.json`
- `server/config/firebase-service-account.json`
- `GOOGLE_MEMBERS_SHEET_ID`
- `GOOGLE_DRIVE_FOLDER_ID`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_REDIRECT_URI`
- BigQuery 프로젝트/데이터셋 권한
- Firebase Firestore 프로젝트
- GitHub Releases 배포 계정/저장소

상세 절차는 `GOOGLE_ACCOUNT_MIGRATION_GUIDE.md`를 따른다.
