# Admin 설정 콘솔 위젯화 체크리스트

상세 계획: `ADMIN_SETTINGS_REFACTORING_PLAN.md`

## 1차: View 패널 분리

- [x] `src/features/settings/components/` 생성
- [x] `src/features/settings/panels/` 생성
- [x] `src/features/settings/widgets/` 생성
- [x] `SettingsShell.jsx` 추가
- [x] `SettingsTabs.jsx` 추가
- [x] `SettingsDataModal.jsx` 분리
- [x] `SettingsImportProgress.jsx` 분리
- [x] `DefaultAmountModal.jsx` 분리
- [x] `BasicSitePanel.jsx` 분리
- [x] `BasicSiteHeaderPanel.jsx` 분리
- [x] `ItemManagementPanel.jsx` 분리
- [x] `MeasurementPlacePanel.jsx` 분리
- [x] `FlowMappingPanel.jsx` 분리
- [x] `WaterMappingPanel.jsx` 분리
- [x] `MedicinePanel.jsx` 분리
- [x] `KitPanel.jsx` 분리
- [x] `TemplateFilePanel.jsx` 분리
- [x] `WebAppPanel.jsx` 분리
- [ ] `DriveSyncPanel.jsx` 분리 보류: 현재 설정 화면에 분리할 Drive 전용 UI가 없음
- [x] `SludgeExportPanel.jsx` 분리
- [x] `LogMappingPanel.jsx` 분리
- [x] `SettingsView.jsx`를 패널 조립 파일로 축소

## 2차: 공통 위젯 추출

- [x] `ItemActiveGrid.jsx` 추출
- [x] `ExcelCellMapper.jsx` 추출
- [x] `LocationOrderEditor.jsx` 추출
- [x] `CredentialCard.jsx` 추출
- [x] `TemplateUploadCard.jsx` 추출
- [x] `MappingPreviewTable.jsx` 추출

## 3차: ViewModel 분리

- [x] `settingsDefaults.js` 기본값/순수 헬퍼 분리
- [x] 매핑 저장 진행률 공통 함수 정리
- [x] `useSettingsViewModel.js` 반환값 계약 정리
- [x] `useBasicSiteSettings` 내부 hook 분리
- [x] `useMeasurementPlaceSettings` 내부 hook 분리
- [x] `useMappingSettings` 내부 hook 분리
- [x] `useTemplateSettings` 내부 hook 분리
- [x] `useExternalServiceSettings` 내부 hook 분리
- [x] `useDefaultAmountSettings` 내부 hook 분리
- [x] `useItemSettings` 내부 hook 분리

## 4차: 서버 설정 라우트 경량화

- [x] `server/routes/settingsRoutes.cjs`에서 요청/응답 계층만 유지
- [x] `server/services/settings/appSettingsService.cjs` 분리
- [x] `server/services/settings/defaultSettingsService.cjs` 분리
- [x] `server/services/settings/initialSyncService.cjs` 분리
- [x] `server/services/settings/siteSettingsService.cjs` 분리
- [x] `server/services/settings/mappingSettingsService.cjs` 분리
- [x] `server/services/settings/templateSettingsService.cjs` 분리
- [x] `server/services/settings/externalCredentialService.cjs` 분리

## 검증

- [x] `npm run validate`
- [x] `npm run validate:api` 실행: FAIL 0, WARN 2 (`OSOO_SERVER_TOKEN`, `/api/auth/current-user` 테스트 경고)
- [ ] `npm run build` 최종 릴리즈 직전 실행
- [x] admin 로그인 시 설정 메뉴 노출: 기존 설치버전/개발버전에서 검증 완료
- [x] 현장관리자 로그인 시 설정 메뉴 미노출: 기존 설치버전/개발버전에서 검증 완료
- [x] 현장 기본 설정 저장: 로컬DB 예시현장 데이터로 검증 완료
- [x] 측정장소관리 저장: 로컬DB 예시현장 데이터로 검증 완료
- [ ] 측정장소 순서 변경 후 저장/재로딩: 리팩토링 중 신규 보강된 순서 저장 흐름만 확인 필요
- [x] 약품 항목 관리 저장: 로컬DB 예시현장 데이터로 검증 완료
- [x] 키트 항목 관리 저장: 로컬DB 예시현장 데이터로 검증 완료
- [x] 유량 매핑 저장: 로컬DB 예시현장 데이터로 검증 완료
- [x] 수질 매핑 저장: 로컬DB 예시현장 데이터로 검증 완료
- [x] 일일업무일지 매핑 저장: 로컬DB 예시현장 데이터로 검증 완료
- [x] 엑셀 양식 업로드/미리보기 정상: 기존 설치버전/개발버전에서 검증 완료
- [x] 기존 배포/설치 워크플로우 영향 없음: 기존 설치버전 기준 검증 완료, 최종 빌드 후 재확인

## 보류 항목

- `DriveSyncPanel.jsx`: 현재 설정 화면에 Drive 전용 입력/상태 UI가 없으므로 파일을 만들지 않는다.
- Drive 루트 폴더, 동기화 상태, 사진 복구 옵션처럼 admin이 조정할 UI가 생기면 그때 `DriveSyncPanel.jsx`를 신규 패널로 추가한다.
