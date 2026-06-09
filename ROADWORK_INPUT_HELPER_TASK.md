# 공사 입력 도우미 체크리스트

상세 계획: `ROADWORK_INPUT_HELPER_PLAN.md`

## 0차: 도로공사 입력 양식 확인

- [ ] 도로공사 홈페이지 유량 입력 순서 확인
- [x] 도로공사 홈페이지 전력량 입력 영역 확인
- [ ] 도로공사 홈페이지 약품 입력 순서 확인
- [ ] 도로공사 홈페이지 키트 입력 순서 확인
- [ ] 한 번에 붙여넣기 가능한 그리드인지 확인
- [ ] 탭/줄바꿈 복사 형식이 먹히는지 확인

## 1차: 메뉴 공간 확보

- [x] 일지 메뉴 하위에 `공사 입력 도우미` 메뉴 추가
- [x] 현장관리자에게 노출되는지 확인
- [ ] admin에서도 테스트 가능하도록 노출 정책 확인
- [x] 아직 기능 미완성일 경우 안내 화면 또는 준비 중 상태 제공

## 2차: 프론트 feature 생성

- [x] `src/features/roadwork-helper/` 생성
- [x] `RoadworkHelperModel.js` 생성
- [x] `useRoadworkHelperViewModel.js` 생성
- [x] `RoadworkHelperView.jsx` 생성
- [x] `index.js` barrel export 생성
- [ ] `components/RoadworkHelperWindow.jsx` 생성
- [ ] `components/RoadworkHelperTabs.jsx` 생성
- [ ] `components/RoadworkDateSelector.jsx` 생성
- [x] `components/RoadworkCopyGrid.jsx` 생성

## 3차: 데이터 API 생성

- [x] `server/routes/roadworkHelperRoutes.cjs` 생성
- [x] 유량 조회 API 추가
- [x] 약품사용량 조회 API 추가
- [x] 키트사용량 조회 API 추가
- [x] 필요 시 BigQuery 복구 로직 연동
- [x] route registry 등록
- [x] api-spec 등록

## 4차: 데이터 바인딩

- [x] 기준일 DatePicker 상태 연결
- [x] 유량 현황 섹션 데이터 바인딩
- [x] 전력량 현황 섹션 데이터 바인딩
- [x] 약품 사용현황 섹션 데이터 바인딩
- [x] 빈 데이터 표시 규칙 적용
- [x] 새로고침 버튼 연결

## 5차: 복사 그리드

- [ ] 도로공사 입력 순서 기반 컬럼 정의
- [x] 탭별 그리드 구성
- [x] 전체 복사 버튼 추가
- [ ] 선택 범위 복사 가능성 검토
- [x] TSV 형식 복사 적용
- [ ] 도로공사 홈페이지 붙여넣기 테스트

## 6차: 항상 위 보조 창

- [ ] 앱 내부 모달로 충분한지 1차 검증
- [ ] 외부 브라우저 클릭 시 가려지는지 확인
- [ ] Electron always-on-top 보조 창 필요 여부 결정
- [ ] 필요 시 사용자 승인 후 `electron/main.cjs` 수정
- [ ] IPC 채널 설계
- [ ] 보조 창 위치/크기 기억 여부 결정

## 검증

- [x] `npm run validate`
- [x] `npm run build`
- [ ] 일지 메뉴에서 공사 입력 도우미 진입
- [ ] 기준일 변경 시 데이터 갱신
- [ ] 유량 값 표시
- [ ] 약품 값 표시
- [ ] 키트 값 표시
- [ ] 복사 버튼 동작
- [ ] 브라우저와 함께 사용 가능한지 확인
