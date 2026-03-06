# QnTECH 수질 자동불러오기 구현 계획

## 목적

QnTECH 웹의 일일 수질 분석 데이터를 현재 앱의 수질관리 메뉴로 불러올 수 있는 정식 구조를 만든다.

이번 구현의 목표는 아래 세 가지를 한 번에 만족하는 것이다.

1. 선택한 날짜의 수질값을 QnTECH에서 읽어 현재 앱의 수질 그리드에 채워 넣을 수 있어야 한다.
2. 같은 날짜의 분석 사진 4장을 패키지 내부 사진관리 폴더에 연도, 월, 날짜 구조로 저장할 수 있어야 한다.
3. 이 로직은 화면 코드에 직접 넣지 않고 별도 호출 가능한 프로시저 형태로 분리해, 필요할 때 ViewModel이나 서버 라우트에서 호출할 수 있어야 한다.

## 현재 확인된 사실

1. 저장된 water_analysis_app 계정으로 QnTECH GraphQL 로그인에 성공했다.
2. Me 쿼리로 접근 가능한 현장 목록을 가져올 수 있다.
3. Projects 쿼리로 하루치 measurements와 files를 함께 가져올 수 있다.
4. 사진 filePath는 직접 다운로드 가능한 URL로 반환된다.
5. 임시 PoC 기준으로 2026-03-05 데이터와 사진 4장 다운로드가 모두 성공했다.

## 최종 사용자 흐름

1. 사용자가 수질관리 메뉴 하단에서 날짜를 선택한다.
2. 사용자가 신규 버튼을 누른다. 예시 이름은 QnTECH 불러오기 또는 외부데이터 불러오기다.
3. 프런트 View는 ViewModel의 불러오기 핸들러만 호출한다.
4. ViewModel은 서버 API를 호출해 해당 날짜의 수질값과 사진 저장 결과를 받아온다.
5. ViewModel은 응답된 수질값을 현재 그리드 편집 상태에 반영한다.
6. 사용자는 화면에서 값 검토 후 기존 저장 버튼으로 DB 저장을 확정한다.

## 기본 설계 원칙

1. View는 버튼과 날짜 선택 UI만 담당한다.
2. 비즈니스 로직은 useWaterQualityViewModel.js에 둔다.
3. 외부 로그인, 조회, 사진 저장, 매핑은 서버 측 프로시저로 분리한다.
4. 화면은 프로시저를 직접 알지 않고 서버 API만 호출한다.
5. 사진 저장은 정식 구현에서는 패키지 내부 폴더를 사용한다.
6. 파일명 규칙은 날짜_분석항목명 형식으로 고정한다.

## 현장명 매핑 규칙

QnTECH 웹의 샘플명과 현재 앱의 location 이름은 완전히 같지 않을 수 있다. 다만 순서는 같다고 확인되었으므로, 우선 정식 구현은 순서 기반 매핑을 기본 규칙으로 둔다.

현재 앱의 저장 순서는 아래와 같다.

1. 유량조정조
2. 무산소조
3. 포기조
4. 침전조
5. 방류조

QnTECH 쪽 샘플 표시는 현장에 따라 다를 수 있다. 예를 들면 아래 같은 차이가 있다.

1. 방류조 대신 막여과수조가 올 수 있다.
2. MBR 공법이면 침전조가 없을 수 있다.
3. 혐기조 같은 추가 칸이 보일 수 있다.

정식 구현의 1차 매핑 규칙은 아래처럼 둔다.

1. measurements를 sample 표시 순서대로 정렬한다.
2. 현재 앱 활성 location 목록과 순서를 기준으로 앞에서부터 매핑한다.
3. 침전조가 없는 현장은 해당 위치를 건너뛴다.
4. 방류조 위치에 막여과수조가 오면 방류조로 저장한다.
5. 추가 샘플이 있어도 현재 앱 location 수를 넘는 값은 1차 구현에서는 무시한다.

추가로 이름 기반 보정 규칙도 함께 둔다.

1. sample 이름에 유량이 포함되면 유량조정조로 본다.
2. sample 이름에 무산소가 포함되면 무산소조로 본다.
3. sample 이름에 포기 또는 호기 관련 이름이 포함되면 포기조로 본다.
4. sample 이름에 침전이 포함되면 침전조로 본다.
5. sample 이름에 방류 또는 막여과가 포함되면 방류조로 본다.

최종 구현은 이름 기반 우선, 실패 시 순서 기반 보정으로 가는 것이 안전하다.

## 분석항목 매핑 규칙

QnTECH 항목명은 현재 앱 water_quality 컬럼으로 아래처럼 매핑한다.

1. 암모니아성 질소 -> nh3_n
2. 질산성 질소 -> no3_n
3. 오르토 인산염 -> po4_p
4. 알칼리도 -> alkalinity

값 처리 규칙은 아래처럼 둔다.

1. 숫자 값은 문자열 그대로 저장 가능해야 한다.
2. 하이픈, 초과, 불검출 같은 문자값도 그대로 저장 가능해야 한다.
3. 이 데이터는 표시와 기록 목적이므로 숫자형 계산 전제를 두지 않는다.

권장안은 아래다.

1. water_quality의 수질 관련 컬럼은 REAL 이 아니라 TEXT 기준으로 바꾼다.
2. QnTECH 원문값은 변환하지 않고 그대로 저장한다.
3. 숫자로 보이는 값도 문자열로 저장해 초과, 불검출, 하이픈과 같은 형식을 동일한 규칙으로 다룬다.
4. 추후 계산 기능이 필요해지면 계산용 컬럼을 별도로 두고, 원문 저장 컬럼은 그대로 유지한다.

현재 DB 스키마 영향은 아래와 같다.

1. server/database.cjs 의 water_quality 테이블에서 nh3_n, no3_n, po4_p, alkalinity 및 필요 시 tn, tp, cod, ss 컬럼 타입을 REAL 에서 TEXT 로 바꾸는 방향으로 간다.
2. 기존 bulk 저장 로직은 숫자 파싱 전제를 제거하고 문자열 그대로 upsert 할 수 있게 수정해야 한다.
3. 프런트 그리드도 숫자 포맷팅 고정 표시가 아니라 문자열 표시를 기본값으로 바꿔야 한다.

## 사진 저장 구조

정식 구현의 목표 폴더 구조는 아래다.

1. 패키지 내부 루트 폴더: 사진관리 또는 실험사진
2. 그 아래 연도 폴더: YYYY
3. 그 아래 월 폴더: MM
4. 그 아래 날짜 폴더: YYYY-MM-DD
5. 그 아래 파일명: YYYY-MM-DD_분석항목명.jpg

예시 경로는 아래와 같다.

1. 사진관리/2026/03/2026-03-05/2026-03-05_암모니아성 질소.jpg
2. 사진관리/2026/03/2026-03-05/2026-03-05_질산성 질소.jpg

패키지 내부 저장 루트는 정식 구현에서 설정 화면에 추가해야 한다.

## 프로시저 분리 구조

예전 표현대로 프로시저처럼 호출할 수 있게, 서버 측 로직을 아래처럼 분리한다.

### 1. 인증 프로시저

예상 파일:

1. server/services/qntechAuthService.cjs

역할:

1. 저장된 water_analysis_app 계정 읽기
2. 로그인 mutation 호출
3. 세션 쿠키 유지
4. 공통 GraphQL 호출 함수 제공

### 2. 데이터 수집 프로시저

예상 파일:

1. server/services/qntechWaterImportService.cjs

역할:

1. 날짜 기준 프로젝트 조회
2. measurements를 현재 앱 형식으로 매핑
3. files를 항목별 사진으로 정리
4. 사진 저장 경로 생성
5. 결과를 프런트용 DTO로 반환

### 3. 사진 저장 프로시저

예상 파일:

1. server/services/qntechPhotoStorageService.cjs

역할:

1. 패키지 내부 저장 루트 결정
2. 연, 월, 날짜 폴더 생성
3. 날짜_분석항목명 파일명 생성
4. 기존 파일 덮어쓰기 또는 교체 정책 처리

### 4. 호출 라우트

예상 파일:

1. server/routes/waterQualityRoutes.cjs

추가 엔드포인트 예시:

1. POST /api/water-quality/import-from-qntech

역할:

1. date 입력 받기
2. qntechWaterImportService 호출
3. grid 반영용 values 와 photo 저장 결과를 응답

## 프런트엔드 구조

### 1. Model

대상 파일:

1. src/features/water/WaterQualityModel.js

추가 메서드:

1. importFromQntech(date)

### 2. ViewModel

대상 파일:

1. src/features/water/useWaterQualityViewModel.js

추가 상태:

1. importTargetDate
2. isImportingFromQntech
3. lastImportSummary

추가 핸들러:

1. handleImportFromQntech(date)
2. applyImportedWaterValues(importedItems)

핵심 역할:

1. 서버에서 받아온 값을 현재 pendingChanges 또는 history 편집 상태에 반영
2. 사용자는 기존 저장 버튼으로 DB 저장 확정
3. 불러오기와 저장을 분리해 안전하게 검토 가능하게 유지

### 3. View

대상 파일:

1. src/features/water/WaterQualityView.jsx

추가 UI:

1. 그리드 하단 날짜 선택 UI
2. QnTECH 불러오기 버튼
3. 불러온 결과 요약 표시

주의사항:

1. 현재 수질 메뉴의 저장 UX를 깨지 않는다.
2. 불러오기 후 자동 DB 저장은 하지 않는다.
3. 사용자가 검토 후 기존 저장 버튼으로 반영한다.

## 설정 확장 계획

정식 구현에서는 설정에 아래 항목을 추가해야 한다.

1. 수질분석 앱 URL
2. 수질분석 앱 ID
3. 수질분석 앱 비밀번호
4. 사진 저장 루트 폴더명 또는 상대 경로
5. 폴더 구조 사용 여부 또는 규칙 설명

하지만 구현 순서는 아래처럼 나눈다.

1. 1차 구현: 현재 저장된 water_analysis_app 계정만 사용하고 사진 저장 루트는 서버 기본값으로 둔다.
2. 2차 구현: 설정 화면에 사진 저장 루트와 규칙을 추가한다.

## 단계별 구현 순서

### Phase 1. 서버 수집 프로시저 고정

1. 임시 PoC 스크립트의 로그인, Me, Projects, 다운로드 로직을 services 로 옮긴다.
2. 서비스 내부에서 날짜 하나를 입력받아 values 와 photos 결과를 반환하도록 정리한다.
3. 사진 저장 루트는 우선 서버 기본 경로로 구현한다.
4. 이 단계에서 값은 숫자 변환 없이 원문 문자열 기준으로 유지한다.
5. 이 단계에서 단독 서비스 테스트가 가능해야 한다.

완료 기준:

1. 날짜 입력 하나로 값 1건 이상과 사진 4장 저장이 서비스 레벨에서 된다.

### Phase 2. 서버 API 연결

1. waterQualityRoutes.cjs 에 import-from-qntech 엔드포인트를 추가한다.
2. date 입력 검증을 넣는다.
3. 서비스 결과를 프런트가 쓰기 쉬운 구조로 반환한다.
4. 응답 값은 숫자형이 아니라 문자열 그대로 내려주도록 고정한다.

응답 예시 방향:

1. importedRows
2. savedPhotos
3. skippedValues
4. summary

완료 기준:

1. HTTP 호출만으로 날짜 기준 가져오기와 사진 저장이 가능하다.

### Phase 3. 프런트 Model, ViewModel 연결

1. WaterQualityModel 에 importFromQntech 추가
2. useWaterQualityViewModel 에 handleImportFromQntech 추가
3. 응답된 importedRows 를 현재 그리드 colKey 형식으로 변환
4. pendingChanges 또는 임시 grid state에 문자열 값 그대로 주입
5. 숫자 소수점 포맷팅과 parseFloat 전제를 제거한다.

완료 기준:

1. 화면에서 불러온 값이 셀에 표시되고 아직 DB 저장 전 상태로 검토 가능하다.

### Phase 4. 수질 화면 UI 추가

1. WaterQualityView 하단에 날짜 선택 UI 추가
2. 불러오기 버튼 추가
3. 진행 중 표시와 결과 요약 표시 추가
4. 기존 저장 버튼과 충돌 없게 배치

완료 기준:

1. 사용자가 날짜를 고르고 버튼을 눌러 값을 불러온 뒤 저장 버튼으로 반영할 수 있다.

### Phase 5. 사진 저장 루트 설정 정식화

1. 설정 스키마에 사진 저장 루트 관련 값 추가
2. SettingsView, useSettingsViewModel, settingsRoutes, database 확장
3. 패키지 내부 상대 경로와 실제 저장 경로 변환 규칙 확정

완료 기준:

1. 설치 후 현장 PC마다 사진 저장 루트를 설정 또는 기본값 사용 가능하다.

## 우선 구현 범위

가장 먼저 구현할 범위는 아래다.

1. 서버 측 수집 서비스
2. 수질 API 엔드포인트
3. WaterQualityModel, useWaterQualityViewModel 연결
4. WaterQualityView 날짜 선택과 불러오기 버튼

이번 1차 범위에서 뒤로 미루는 항목은 아래다.

1. 설정 화면의 사진 저장 루트 입력 UI
2. 문자값 초과 처리 고도화
3. 현장별 세밀한 이름 매핑 편집 기능

## 파일별 작업 대상

1. server/services/qntechAuthService.cjs 추가
2. server/services/qntechWaterImportService.cjs 추가
3. server/services/qntechPhotoStorageService.cjs 추가
4. server/routes/waterQualityRoutes.cjs 수정
5. src/features/water/WaterQualityModel.js 수정
6. src/features/water/useWaterQualityViewModel.js 수정
7. src/features/water/WaterQualityView.jsx 수정
8. 추후 src/features/settings/SettingsView.jsx 수정
9. 추후 src/features/settings/useSettingsViewModel.js 수정
10. 추후 server/routes/settingsRoutes.cjs 수정
11. 추후 server/database.cjs 수정

## 검증 체크리스트

1. 저장된 water_analysis_app 계정으로 로그인되는가
2. 현장 식별이 되는가
3. 선택 날짜의 measurements 가 문자열 원문값 기준으로 매핑되는가
4. 방류조와 막여과수조 차이를 흡수하는가
5. 침전조 없는 현장에서 순서 기반 매핑이 깨지지 않는가
6. 사진 4장이 날짜_분석항목명 형식으로 저장되는가
7. 초과, 불검출, 하이픈 같은 값이 손실 없이 그리드에 반영되는가
8. 기존 저장 버튼으로 DB 저장이 되는가

## 권장 구현 순서 결론

가장 빠른 진행 순서는 아래다.

1. 서버 프로시저 3개 추가
2. waterQualityRoutes 에 import API 추가
3. WaterQualityModel 과 ViewModel 연결
4. WaterQualityView 에 날짜 선택과 버튼 추가
5. 그 다음 설정 확장

이 순서로 가면 먼저 기능이 동작하고, 이후 저장 루트 설정은 별도 단계로 안전하게 붙일 수 있다.