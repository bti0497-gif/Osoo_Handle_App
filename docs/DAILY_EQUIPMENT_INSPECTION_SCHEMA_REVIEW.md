# 일일업무일지 장비점검 스키마 사전 검토

작성일: 2026-09-09. 담당: 현장관리자용 앱·일지 담당 에이전트.
상태: 소스 기반 설계안. 실제 DB·라우트·출력 코드는 변경하지 않음.
연계: [Phase 1 인계](EQUIPMENT_CARD_PHASE1_INTEGRATION_HANDOFF.md), [장비 개발 계획](EQUIPMENT_CARD_DEVELOPMENT_PLAN.md).

추가 검토: [날씨·기온의 좌표/평균/캐시 및 스냅샷 검토](DAILY_LOG_WEATHER_REVIEW.md). 일지 날씨 스냅샷을 점검 항목별 저장과 분리하며, 현재 기상청 조회는 좌표 기반이 아닌 고정 지역 매핑임을 확인했다.

## 1. 현재 코드에서 확인한 사항

- `server/database.cjs`: equipment_assets는 UUID와 UNIQUE(site_id, management_no)를 사용한다. equipment_asset_photos, work_records, work_record_photos, work_record_equipment_links가 이미 있다. 재생성하지 않는다.
- work_records는 현장+날짜당 1건이며, facility_logs는 별도 개별 사건 저장소다. 일일 점검표 전용 테이블은 이 파일에서 확인되지 않았다.
- facility_logs의 equipment_id/type/completed_at 확장은 장비 개발 계획의 후속 작업이다. 아직 존재한다고 가정하지 않는다.
- equipment_assets에 is_synced가 있어도 database.cjs의 syncTables에는 포함되지 않는다. 장비/사진/연결/신규 점검 테이블의 동기화와 복원은 별도 구현이 필요하다.
- bigQuerySyncService.cjs는 facility_logs의 원격 식별 기준을 site_id/date/location/facility_name으로 구성한다. 같은 날 같은 장비에 사건 여러 건이 있으면 충돌 가능성을 점검해야 한다. 신규 컬럼도 현재 변환 매핑에 없다. 단순히 기존 동기화 채널을 쓴다는 이유로 지원 완료로 판단하지 않는다.
- dailyWorkLogService.cjs의 buildPreviewManifest는 날짜당 totalPagesForDate=1이다. 첫째·둘째 페이지 지원을 추가해야 한다. 일반 dailyLogPreviewService와 일일업무일지 경로를 혼동하지 않는다.
- dailyWorkLogHwpxService.cjs의 getChecklistBindings는 공법에 따라 정해진 책갈피에 체크를 넣는다. 실제 장비 점검 결과를 읽지 않는다. 이 체크가 양호/불량인지 대상 설비 표시인지는 양식 실물을 확인해야 한다. 기존 체크를 곧바로 불량 판정으로 치환하지 않는다.

## 2. 권장 저장 구조

장비의 현재 상태, 개별 고장/수리 사건, 날짜별 점검 결과를 분리한다. 점검은 현장+업무일로 묶되 수정본을 보존한다. 아래 이름과 타입은 제안이며 마이그레이션 전 확정한다.

### A. daily_equipment_inspections — 날짜별 문서 식별자

| 컬럼 | 제안 타입/제약 | 목적 |
|---|---|---|
| id | TEXT PK, UUID | PC 간 동기화 가능한 불변 ID |
| site_id | TEXT NOT NULL | 양방향 현장 구분 |
| work_date | TEXT NOT NULL, YYYY-MM-DD | 현장 업무일, KST 날짜 |
| current_revision | INTEGER NOT NULL | 최신 저장 개정 번호 |
| created_at / updated_at | TEXT NOT NULL | UTC ISO 시각 |

UNIQUE(site_id, work_date). 수정 시 문서 ID는 유지한다. 원격 동시 생성으로 같은 날짜 문서가 둘이면 한쪽을 무조건 덮어쓰지 않고 현장+날짜 기준 충돌로 처리한다.

### B. daily_equipment_inspection_revisions — 불변 저장본

| 컬럼 | 제안 타입/제약 | 목적 |
|---|---|---|
| id | TEXT PK, UUID | 개정 저장본 ID, 업로드 식별자 |
| inspection_id | TEXT NOT NULL FK | 날짜별 문서 참조 |
| revision | INTEGER NOT NULL, 양수 | 개정 순서 |
| template_version / rule_version | TEXT NOT NULL | 출력 매핑·자동 판정 규칙 추적 |
| method_snapshot / site_name_snapshot | TEXT | 당시 공법·현장 표시 보존 |
| saved_by / saved_at | TEXT NOT NULL | 저장자·저장 시각 |
| change_reason | TEXT | 과거 점검 수정 사유 |
| is_synced | INTEGER NOT NULL DEFAULT 0 | 실제 동기화 구현 시 사용 |

UNIQUE(inspection_id, revision). 저장본은 수정하지 않고 새 개정으로 추가한다. 미저장 UI 초안은 이 테이블의 확정 저장본과 구분한다. 단순 조회/자동 제안만으로 저장본을 생성하지 않는다.

### C. daily_equipment_inspection_items — 개정별 점검 항목

| 컬럼 | 제안 타입/제약 | 목적 |
|---|---|---|
| id | TEXT PK, UUID | 항목 저장본 식별 |
| revision_id | TEXT NOT NULL FK | 개정 저장본 참조 |
| item_key | TEXT NOT NULL | 변경되지 않는 점검 항목 코드 |
| label_snapshot / sort_order | TEXT / INTEGER | 당시 항목 이름·출력 순서 |
| suggested_result | TEXT NULL 또는 good/bad | 자동 제안, NULL은 근거 부족 |
| final_result | TEXT NULL 또는 good/bad | 사용자 확인 결과, NULL은 미확인 |
| source | TEXT, manual/auto_confirmed/unresolved | 수동/자동 확인/미확인 구분 |
| reason | TEXT | 판정·수동 변경 사유 |

UNIQUE(revision_id, item_key). 빈 문자열과 0을 양호로 해석하지 않는다. 서버 저장 시 result/source 조합의 정합성을 검증한다. ‘미확인 상태 저장은 허용하되 출력 전에 안내’ 등 완료 기준은 UI 확정 시 결정한다. 자동 제안과 실제 확인 결과를 동일시하지 않는다.

### D. daily_equipment_inspection_item_assets — 당시 장비 및 근거

| 컬럼 | 제안 타입/제약 | 목적 |
|---|---|---|
| item_id / equipment_id | TEXT, 복합 PK | 한 항목에 여러 장비 연결 |
| management_no_snapshot / name_snapshot | TEXT | 장비 개명 후 과거 표시 유지 |
| status_snapshot | TEXT | 해당 날짜 판정에 사용한 상태 |
| evidence_snapshot_json | TEXT | 근거 사건 ID·발생/완료 시각·판정에 필요한 값 |

장비 참조는 RESTRICT를 권장하고 사용 종료 장비는 이력을 유지한다. 사용자 삭제 정책 충돌은 인계 문서 §3에 정리돼 있으므로 확정 후 구현한다. 근거 JSON은 버전과 허용 필드 목록을 정의하고 원본 이벤트가 바뀌어도 판정 당시 근거를 보존한다. 사진 바이너리·인증정보를 넣지 않는다.

## 3. 점검 항목과 장비/양식 매핑

- 점검 항목과 장비는 1:1이라고 가정하지 않는다. 예를 들어 ‘교반기’ 항목이 A/B호기를 함께 포함할 수 있다.
- 기본 정의는 공법/템플릿별 item_key·label·order·good/bad 책갈피 매핑으로 준비하고 현장 장비 ID 연결을 별도로 둔다.
- 현장별 연결은 UNIQUE(site_id, template_version, item_key, equipment_id) 계약을 권장한다. 기존 설정 저장 구조에 맞출지 독립 테이블로 할지는 실제 양식을 확인한 후 결정한다.
- 대표사진/작업사진 테이블은 재사용한다. 일지 점검 사진을 무조건 복제하지 않는다.
- ‘숨김’은 표시 여부다. 숨김 장비를 점검 대상에서 자동 제외하지 않는다. 폐기/예비의 점검 대상 여부는 명시적 설정으로 결정한다.

## 4. 저장·조회 무결성

1. 요청의 현장 권한, 모든 장비의 site_id 일치를 먼저 확인한다. FK만으로 현장 일치를 보장한다고 가정하지 않는다.
2. 저장은 문서 생성/조회 → 개정 추가 → 항목/근거 저장 → 최신 개정 갱신을 단일 트랜잭션으로 실행한다.
3. UI가 읽은 expectedRevision과 최신 개정이 다르면 409 충돌을 반환하고 편집값을 유지한다.
4. 요청 ID 또는 클라이언트 생성 revision UUID로 재시도 중복 저장을 방지한다. 같은 ID에 다른 내용이 오면 거부한다.
5. 삭제는 기본 사용자 동선에서 제공하지 않고 개정으로 정정한다. 실제 삭제/복원 요구가 생기면 원격 삭제 전파까지 설계한다.
6. 날짜는 유효한 달력 날짜인지 검증하며 시각 변환으로 날짜가 하루 이동하지 않게 한다.
7. FK 선언뿐 아니라 연결별 foreign_keys 활성화 및 foreign_key_check 결과를 확인한다. 이번 검토에서는 실제 운영 DB를 열거나 변경하지 않았다.

## 5. 과거 판정과 출력

- 고장 당시 불량 저장 → 다음 날 수리 완료 → 과거 불량 유지.
- 아직 저장본이 없는 과거 날짜는 현재 status만으로 자동 판정하지 않는다. 날짜별 사건 근거가 없으면 미확인.
- 수동 판정은 재조회나 자동 상태 갱신으로 덮어쓰지 않는다.
- 첫째·둘째 페이지와 출력에 동일 revision_id를 전달한다. 페이지 캐시 키에 현장/날짜/revision/template_version/page 식별자를 포함한다.
- 장비점검 외 검침값 등도 페이지 사이에 다르게 조회되지 않게 한 번에 확정한 출력 payload를 공유한다. 기존 업무 테이블을 모두 새 테이블로 복제하는 작업은 별도 범위다.
- 템플릿의 양호/불량 두 칸을 모두 명시적으로 바인딩하여 이전 체크가 남지 않게 한다. 현재 책갈피 실물과 HWP 생성 경로부터 확인한다.
- 기존 사용자 수정 HWP는 자동 덮어쓰기 금지 정책을 유지한다.

## 6. 동기화·백업 및 실행 전 조건

- 새 테이블 생성만으로 BigQuery 동기화가 되지 않는다. 원격 스키마·변환 매핑·키·업로드 순서·재시도·복원 순서를 함께 구현한다.
- 개정 UUID로 원격 중복을 방지하고 자식 항목이 일부만 업로드된 개정은 완료로 취급하지 않는다. 로컬 저장 성공과 원격 업로드 성공을 구분한다.
- 기존 facility_logs 원격 키 변경은 장비 담당과 협의하여 과거 데이터 중복/손실 없이 이행한다. 기존 키를 전역으로 즉시 바꾸지 않는다.
- 신규 테이블은 기존 마이그레이션 보호/백업 경로에 포함되는지 확인하고 재실행 가능한 추가 방식으로 도입한다.
- 초기 장비 목록이 없거나 점검 미연동인 기존 현장에는 자동 불량/양호를 만들지 않는다. 기존 일지 출력 동작과의 전환 안내를 준비한다.

후속 구현 전 확정할 사항: 실제 1·2페이지 양식/책갈피, 공법별 점검 항목, 삭제·숨김 정책, 상태 사건의 시각 계약, 미확인 결과 출력 정책. 먼저 장비 담당에게 필요한 ID·상태·사건 계약을 공유하고 일지 담당이 스키마/API/출력을 구현한다.

검증: 양방향 현장 격리, 하루 복수 사건, 저장 충돌/재시도, 다음 날 수리 후 과거 보존, 장비 개명 후 스냅샷 보존, 두 페이지/출력 동일 값, 동기화 중단 후 재개, 백업 복원. 현재는 문서 사전 검토만 완료했다.
