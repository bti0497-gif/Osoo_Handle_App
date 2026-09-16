# 일일업무일지 점검표·장비이력 연동 개발 계획

## 1. 목표

일일업무일지 첫 페이지의 `단위공정별 점검사항`을 장비이력카드·업무사진관리와 연결한다.

- 점검항목마다 `정상 / 불량`을 라디오 방식으로 선택한다.
- 연결 장비가 정상 사용 상태가 아니면 자동으로 `불량`을 제안한다.
- 사용자는 자동 제안을 검토하고 직접 변경할 수 있다.
- 공법 또는 현장 구성상 필요 없는 항목은 `미적용`으로 잠그며 정상·불량을 수정할 수 없게 한다.
- 날씨·평균기온과 일지에 사용한 유량·수질·운전상태·슬러지·전력·약품 값을 날짜별 스냅샷으로 보존한다.
- 워크스페이스 미리보기, 로컬 DB, BigQuery, HWP 출력이 같은 스냅샷을 단일 원본으로 사용한다.
- 과거 원본 데이터나 장비 상태가 바뀌어도 확정된 과거 일지는 변하지 않는다.

참조 양식은 `일일업무일지(A2O).pdf` 첫 페이지이며, 실제 구현 시 A2O와 MBR HWP 원본을 모두 점검한다.

## 2. 개발 원칙

1. 본앱 접목 전에 독립 UI/UX 프로토타입을 완성하고 사용자 확인을 받는다.
2. Phase 1에서는 운영 DB, API, BigQuery, HWP를 변경하지 않는다.
3. 프로토타입의 fixture는 운영 데이터와 명확히 구분한다.
4. UI 확정 후 Model/ViewModel/View 경계를 지켜 본앱에 이식한다.
5. 미리보기와 HWP가 서로 별도 판정 로직을 갖지 않는다.
6. 출력 시 현재 원본을 재조립하지 않고 확정된 스냅샷을 사용한다.
7. 양방향 현장은 모든 테이블과 API를 `site_id`로 격리한다.

## 3. 점검항목 계약

### 3.1 항목 상태

각 항목은 다음 값을 가진다.

- `is_applicable = 1`: 정상 또는 불량 중 하나를 선택할 수 있다.
- `is_applicable = 0`: 미적용. 정상·불량을 모두 비우고 컨트롤을 비활성화한다.
- `suggested_result`: 자동판정값(`normal` 또는 `fault`).
- `final_result`: 사용자가 확정한 값(`normal` 또는 `fault`).
- `judgement_source`: `auto`, `manual`, `manual_override`.
- `judgement_reason`: 자동판정 근거.
- `override_reason`: 자동 불량을 정상으로 변경한 사유.

`미적용`은 세 번째 라디오 값이 아니다. 공법·현장별 적용 설정이며 일반 점검 화면에서는 잠긴 상태로 표시한다.

### 3.2 공법별 기본 적용

- A2O: 스크린, 유량조정조, 무산소·혐기조, 폭기조, 침전조, 응집시설, 여과기, 방류수, 기타를 적용한다.
- MBR: MBR 양식의 실제 점검행을 기준으로 적용하며 분리막 항목을 활성화한다.
- 공법 기본값 위에 현장별 적용 여부 override를 둘 수 있다.
- 현장 설정에서 항목을 미적용으로 바꾸면 사유와 변경자를 기록한다.

### 3.3 자동판정

적용 항목은 이상 근거가 없으면 정상으로 제안한다.

1. 연결된 필수 장비 중 하나라도 `사용 중`이 아니면 불량을 제안한다.
2. 해당 날짜에 미완료 고장·수리·점검 이력이 있으면 불량을 제안한다.
3. 여러 장비가 연결된 항목은 하나라도 비정상이면 불량이다.
4. 장비에 직접 대응하지 않는 청소상태·폭기상태·슬러지 침전성·여재상태 항목은 정상으로 제안하고 사람이 확인한다.
5. 업무사진은 증빙으로 연결하지만 사진 존재만으로 정상·불량을 판정하지 않는다.
6. 자동 불량을 정상으로 바꿀 때는 변경 사유를 필수로 입력한다.
7. 사용자의 최종판정이 자동판정보다 우선하지만 두 값과 근거를 모두 보존한다.

## 4. 일지 스냅샷 계약

### 4.1 헤더

후보 테이블: `daily_work_log_snapshots`

- `id`, `site_id`, `site_name`, `date`, `method`
- `weather`, `average_temperature`, `weather_source`, `weather_basis_time`
- `template_version`, `revision`
- `status` (`draft`, `confirmed`, `exported`)
- `confirmed_by`, `confirmed_at`
- `created_at`, `last_modified`, `is_synced`
- 고유키 후보: `site_id + date + revision`

날씨는 하루 중 가장 심한 상태를 대표값으로, 기온은 일평균으로 저장한다. 확정된 과거 일지는 기상 API를 다시 호출하지 않는다.

### 4.2 일지 값

후보 테이블: `daily_work_log_snapshot_values`

- `id`, `snapshot_id`
- `section` (`flow`, `water`, `operation`, `sludge`, `power`, `medicine` 등)
- `item_key`, `item_label`
- `text_value`, `numeric_value`, `unit`
- `source_table`, `source_record_id`, `source_updated_at`
- `display_order`, `is_synced`
- 고유키 후보: `snapshot_id + section + item_key`

원본 테이블의 값을 중복 계산하기 위한 테이블이 아니라, HWP에 실제로 사용한 값을 재현하기 위한 출력 스냅샷이다.

### 4.3 점검결과

후보 테이블: `daily_equipment_inspection_items`

- `id`, `snapshot_id`, `item_code`
- `process_name_snapshot`, `inspection_text_snapshot`
- `is_applicable`
- `suggested_result`, `final_result`
- `judgement_source`, `judgement_reason`, `override_reason`
- `confirmed_by`, `last_modified`, `is_synced`
- 고유키 후보: `snapshot_id + item_code`

점검문구도 스냅샷으로 저장하여 이후 기준 문구가 바뀌어도 과거 일지를 재현한다.

### 4.4 점검 기준·장비 연결

후보 테이블:

- `daily_equipment_inspection_catalog`: 공법별 점검항목, 표시순서, 기본 적용 여부, 양식 버전.
- `daily_inspection_equipment_links`: `site_id + item_code + equipment_id` 연결.
- `daily_inspection_site_overrides`: 현장별 적용 여부, 변경 사유, 변경자.

한 점검항목은 여러 장비와 연결할 수 있고, 한 장비도 여러 점검항목과 연결할 수 있다.

## 5. 개정·재현 정책

1. 저장 전 초안은 원본 변경에 따라 다시 계산할 수 있다.
2. 확정 후에는 원본이 바뀌어도 기존 스냅샷을 자동 변경하지 않는다.
3. 원본 변경을 감지하면 `저장된 일지 유지 / 현재 데이터로 다시 생성`을 선택하게 한다.
4. 다시 생성하면 기존 행을 덮어쓰지 않고 revision을 증가시킨다.
5. 출력 파일과 진단로그에 사용한 snapshot id와 revision을 남긴다.

## 6. Phase 1 - 독립 UI/UX 프로토타입

예정 위치: `prototypes/daily-work-log-inspection-ui/`

운영 API·DB를 호출하지 않고 fixture만 사용한다.

### 6.1 화면 구성

- 좌측: 날짜, 현장, 공법, 저장상태, 원본 변경 경고.
- 중앙: 실제 첫 페이지 비율의 점검표 미리보기.
- 점검행: 단위공정, 점검사항, 정상 라디오, 불량 라디오, 판정근거 버튼.
- 미적용행: 흐리게 표시하고 라디오 비활성화, 미적용 사유 표시.
- 우측 상세 패널 또는 모달: 연결 장비, 현재 상태, 최근 이력, 업무사진 썸네일.
- 하단: 초안 다시 계산, 점검결과 저장, HWP 출력 준비 버튼.

### 6.2 반드시 재현할 fixture

- 모든 항목 정상.
- 연결 펌프가 `수리 중`이라 자동 불량.
- 자동 불량을 사용자가 정상으로 변경하고 사유 입력.
- A2O에서 분리막 항목 미적용.
- 현장 설정으로 특정 항목 미적용.
- 연결 장비 여러 대 중 한 대가 비정상.
- 저장된 과거 스냅샷 재조회.
- 원본 수정 감지 및 revision 생성 안내.
- 작업사진 0장/1장/여러 장 확대보기.

### 6.3 Phase 1 완료 기준

- 정상/불량이 한 번에 하나만 선택된다.
- 미적용 항목은 수정할 수 없다.
- 자동판정과 사용자 최종판정이 시각적으로 구분된다.
- 불량 원인을 한 번의 클릭으로 확인할 수 있다.
- 고령 사용자가 읽을 수 있는 글자 크기와 36px 이상의 조작 높이를 지킨다.
- 좁은 화면에서도 앱 shell을 침범하지 않고 내부 스크롤한다.
- 사용자 확인을 받아 항목 밀도, 색상, 버튼 위치, 저장 동선을 확정한다.

## 7. Phase 2 - 데이터·API·BigQuery

Phase 1 승인 후에만 착수한다.

1. SQLite DDL과 안전한 마이그레이션 작성.
2. 점검 카탈로그 A2O/MBR seed 및 버전 지정.
3. 장비 연결·현장별 적용 설정 API.
4. 날짜별 초안 생성·저장·확정·재조회·개정 API.
5. 원본 `last_modified` 비교를 통한 변경 감지.
6. BigQuery 테이블 생성·컬럼 계약·MERGE 자연키 확정.
7. 로컬 저장 우선, 비차단 동기화, 실패 재시도와 진단로그 적용.
8. 양방향 현장 site_id 격리 검증.

## 8. Phase 3 - 본앱 접목

- `DailyLogModel`: 점검표/스냅샷 API 호출만 담당.
- `useDailyLogViewModel`: 자동판정 표시, 라디오 변경, 저장·개정 흐름 담당.
- `DailyLogView`: 프로토타입에서 확정한 UI 렌더링만 담당.
- 기존 워크스페이스 shell과 출력 형식 선택을 유지한다.
- 장비 상세와 사진은 기존 안전한 사진 모달을 재사용한다.

## 9. Phase 4 - HWP 연동

1. A2O·MBR HWP 원본에서 각 점검행의 정상/불량 책갈피를 확정한다.
2. 고정 인쇄된 정상 표시를 제거하고 책갈피 값으로만 표시한다.
3. `normal`이면 정상에 `○`, `fault`이면 불량에 `○`, 미적용이면 둘 다 빈칸으로 바인딩한다.
4. 날씨·기온·나머지 일지 값도 같은 snapshot id에서 읽는다.
5. 워크스페이스와 HWP가 동일한 snapshot id/revision을 사용했는지 진단한다.
6. 현재 비동기 HWP 작업 큐와 진행률 UI를 유지한다.

## 10. 회귀검증

- A2O/MBR 점검행과 미적용 행.
- 정상/불량 라디오 단일 선택.
- 자동 불량과 수동 override 사유.
- 장비 상태·이력·업무사진 연결.
- 저장 후 재시작 및 과거 날짜 재현.
- 원본 수정 후 기존 revision 보존.
- 로컬/BigQuery 동기화와 복원.
- 양방향 현장 완전 격리.
- 미리보기/HWP 값 동일성.
- HWP 생성 중 서버 API 응답 유지.

## 11. 구현 보류선

다음 항목은 Phase 1 사용자 승인 전에는 변경하지 않는다.

- `server/database.cjs`
- BigQuery 원격 스키마
- HWP 원본 양식과 책갈피
- 일일업무일지 운영 API
- 본앱 `DailyLogView`

