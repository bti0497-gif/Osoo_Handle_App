# 장비이력카드(설비이력카드) 개발 계획

> 작성일: 2026-09-04
> 개발 방식: **UI/UX 선행 확정 → 라우트/스키마 후결** (사용자 승인된 순서)
> 관련 문서: `docs/ROADMAP.md`(§1–2 장비이력 계획), `LAYOUT_CONTRACT.md`, `ROUTE_CREATION_GUIDE.md`

---

## 1. 배경과 목표

오수처리장의 모든 설비(펌프, 브로아, 계측기 등)에 대해 다음을 제공하는 것이 목표다.

1. **장비 대장(마스터)**: 관리번호, 분류(1~4단계), 사양, 설치일, 제조사, 설치위치, 상태, 대표사진 관리
2. **설비이력카드**: 장비별 점검·고장·수리 이력을 날짜순으로 누적 조회 (누적 비용 포함)
3. **작업내용과의 맞물림**: 업무사진관리(work_records)에서 장비를 선택하면,
   해당 장비의 이력카드에 "연결된 업무·사진"으로 자동 집계된다.
   업무 기록 날짜는 일일업무일지 날짜와 1:1 대응하므로 결과적으로
   "장비 → 관련 업무일지 날짜 추적"(ROADMAP 문구)이 성립한다.

### 이미 존재하는 뼈대 (신규 제작 불필요)

| 요소 | 위치 | 상태 |
|---|---|---|
| 메뉴 `equipment_card`(장비이력카드) | `src/core/constants/index.js` + `src/App.jsx` 라우팅 | 등록 완료 |
| `equipment_assets` 테이블 | `server/database.cjs` | 스키마 확정(사용 안 됨) |
| `equipment_asset_photos`, `work_record_equipment_links` | `server/database.cjs` + 인덱스 | 스키마 확정(사용 안 됨) |
| 프리뷰 UI | `src/features/equipment/` | 화면 동작만 확인 가능 |
| 독립 프로토타입 | `prototypes/equipment-history-ui/` | UI 참고용, 확정 후 삭제 예정 |

즉 본 기능은 "새로 만들기"가 아니라 **영속화(Persistence)와 연결(Link)을 활성화**하는 작업이다.

---

## 2. 범위

### 1차 범위 (본 계획)

- 장비 마스터 CRUD + 대표사진 등록
- 장비별 이력(점검/고장/수리/부품교체/위탁) CRUD
- 업무사진관리 ↔ 장비 연결 저장 및 이력카드 집계
- 장비 삭제 시 연결된 이력/업무 기록이 있으면 차단(RESTRICT) 안내
- 진단러너 회귀 시나리오 1종 추가

### 1차 범위 외 (명시적 제외)

- **예방정비 주기 스케줄링**(예: 3개월마다 오일 교환, 계기값 기반 트리거) — 별도 테이블이 필요하므로 2차 확장 후보. Odoo/Atlas CMMS의 PM 개념 참고.
- 이력카드 인쇄/양식 출력 — 라우트 연결 후 별도 요청 시
- BigQuery 원격 조회(로컬 우선) — 기존 `facility_logs` 동기화 채널을 그대로 사용하므로 별도 신규 경로 없음

---

## 3. 설계 결정 사항 (2026-09-04 사용자 승인)

### 3-1. 이력 저장소: 기존 `facility_logs` 확장 (A안)

신규 테이블 `equipment_maintenance_logs`를 만들지 않고,
레거시 `facility_logs`(이미 BigQuery `syncTables` 동기화 포함)에 컬럼을 추가한다.

**근거**
- `facility_logs`의 기존 컬럼(date, facility_name, content, company, price, notes, site_id, author)이
  수리이력 엔트리의 형태와 일치한다.
- BigQuery 동기화 경로/스키마를 재사용하므로 동기화 코드 신규 작업이 없다.
- 과거 수리이력 데이터가 별도 마이그레이션 없이 자연 승계된다.
- 부트 타임 idempotent 마이그레이션 패턴(`ensureColumn`)과 정확히 일치한다.

**단점(수용함)**
- 테이블명이 `facility_logs`로 레거시 이름을 유지된다. 코드 주석과 API 명세로 의미를 문서화한다.

### 3-2. 오픈소스 참고

코드 채택은 불가(전부 서버형 웹앱, Atlas CMMS는 AGPLv3)하며 **개념/스키마 패턴만 참고**한다.

- [Atlas CMMS (Grash)](https://github.com/Grashjs/cmms): 자산→워크오더→PM 트리거 개념 모델
- Snipe-IT: 자산 마스터 + 유지보수 로그 + 커스텀 필드 패턴
- Odoo Maintenance: 계기 기반 예방정비(2차 확장 시 참고)

### 3-3. 역할 분리

- `facility_logs`(equipment_id 있음): 하루 여러 건 가능한 **개별 점검·고장·수리 이벤트**
- `work_records`(UNIQUE(site_id, date)): **하루 1건 종합 업무 기록 + 사진 첨부**
- 두 흐름이 이력카드 타임라인에서 날짜순으로 합쳐 조회된다.

### 3-7. 업무사진관리 ↔ 장비 맞물림 스키마 검토 결과 (2026-09-10)

기존 DDL 확인 완료 — **테이블 추가 없이 맞물림 가능**:

- `work_record_equipment_links(work_record_id INTEGER, equipment_id TEXT, PK 복합, CASCADE/RESTRICT)`가
  이미 존재하며 양쪽 PK 자료형과 정확히 일치한다.
- 링크된 업무기록을 `facility_logs`로 **복사하지 않는다**. work_records는 하루 1건(UNIQUE 제약)이라
  복사본은 원본 수정/삭제 시 고아화된다. 카드는 두 탭으로 표시하거나, 통합 타임라인이 필요하면
  조회 시 UNION으로만 합친다(저장은 원본 테이블 단일 소스).
- 삭제 무결성: 업무기록 삭제 → 링크·사진 CASCADE, 링크된 장비 삭제는 RESTRICT(=409 EQUIPMENT_IN_USE 설계와 일치).
- Phase 3에서 채울 구멍: ① work-records POST/PUT이 `equipmentIds`를 받아 링크 diff-upsert(현재 UI 선택기만 있고 payload 누락),
  ② `GET /api/equipment/work-records`(링크 조인 + work_record_photos 사진 수 서브쿼리) 신설,
  ③ 프로토타입 WORK_RECORD_PREVIEW_ITEMS의 `equipmentIds` 배열은 Phase 2에서 링크 테이블 조인으로 대체.

### 3-4. 공법별 기본 설비 목록 (2026-09-06 사용자 확정)

- 공법은 **앱 기본설정(`app_settings.method`, 값 'A2O' | 'MBR')**에서 지정되며 앱 전체가 그 값을 따른다.
  (WaterMappingPanel의 `method.toUpperCase() === 'MBR'` 판별과 동일 계약)
- 기본 설비 목록(시드)은 공법에 따라 다르다:
  - **A2O**: 침사조 - 유량조정조 - 포기조 - 침전조 - 응집침전조 - 방류조
  - **MBR**: 침전조·외부반송·응집침전이 없는 대신 **막분리조**(막모듈·흡인펌프·막세척펌프·막분리유량계)가 있다
- 시드는 **최초 1회 프로비저닝** 기준이며, 이후 현장 실정에 맞게 **추가/수정/삭제(CRUD)로 다듬는다**.
  "교반기(기본 2대 · 추가 시 C, D, E...)" 같은 확장 관례는 비고(notes) 필드에 남긴다.
- 분류 체계: `category1`=공정, `category2`=종류(펌프류/교반기류/브로아류/스크린류/계측기류/감속기/탱크류/막분리/소독기류/여과기/약품펌프류), `category3`=대분류(기계/전기/계측기)
- 목록 화면은 **공정별/종류별 보기 토글**로 같은 데이터를 두 축으로 묶어 보여준다.

### 3-5. 장비 추가 카탈로그 (2026-09-06 사용자 제안 채택)

'장비 추가'는 빈 양식이 아니라 **체크식 카탈로그**가 기본 경로다(빈 양식 직접 입력은 보조 경로로 유지).

- 카탈로그 구성(공법별 자동 필터): 펌프류 / 교반기류(유량조정·무산소·혐기·포기·방류) / 브로아류(포기·교반) / 스크린류 / 계측기류(DO·PH·MLSS) / 유량계(파샬플롬·유입·내부반송·외부반송·중수·응집이송·막분리) / 감속기 / 탱크류 / 약품펌프류 / 막분리(MBR) / 소독기류 / 여과기
- 카탈로그 체크는 **양방향 동기화**다(2026-09-06 사용자 확정, 2026-09-10 삭제 정책 개정):
  체크 = 목록 등록, 체크 해제 = 목록에서 제거. 이때 **이력이 있는 장비는 삭제하지 않고
  '숨김' 전환으로 이력을 보존**하며, 이력 없는 잘못 등록 장비만 실제 삭제한다.
  확인 다이얼로그에 제거/숨김 대상 관리번호를 구분 표시한다. 개수형의 스테퍼는 **원하는 대수**로,
  늘리면 다음 호기가 추가되고 줄이면 높은 호기부터 제거된다(제거 대상 호기도 확인창에 표시).

### 3-6. 관리번호 명명규칙과 자동채번 (2026-09-06 사용자 확정)

장비 추가 시 관리번호는 **명명규칙에 따라 자동 부여**하고, 필요하면 사람이 나중에 수정할 수 있다.

| 설비 | 접두어 | 예 |
|---|---|---|
| 기계설비(펌프·교반기·브로아·스크린·탱크·감속기 등) | `M-` | M-101 |
| 유량계 | `FLT-` | FLT-101 |
| 수위계측기 | `LIT-` | LIT-101 |
| 계측기(종류별, 계측기명에서 추출) | `DO-` / `PH-` / `MLSS-` | DO-101 |

- 일련번호는 **접두어별 독립 채번**: 기존 최대값 + 1, 새 접두어는 101부터 시작.
- 다중 호기는 베이스 번호 승계(예: M-103A/B에 추가 → **M-103C**). 호기 접미사 번호는 채번 계산에서 제외.
- 직접 입력 양식은 열릴 때 다음 번호로 자동 사전입력되고, **이름·대분류에 맞춰 접두어가 자동 전환**되다가
  사용자가 직접 고르는 순간부터 수동으로 고정된다.
- 시드(기본 장비)도 동일 규칙으로 번호가 매겨진다(M-101~, FLT-101~, DO-101, PH-101...).
- 이미 등록된 단일 항목은 '등록됨'으로 비활성, 개수형은 현재 대수와 다음 호기를 힌트로 보여준다.
- 카탈로그에 없는 설비는 이름·공정·종류를 입력해 **세션 카탈로그에 직접 추가한 뒤 체크**할 수 있다.
- 시드의 다중 대수 장비도 동일 규칙으로 호기 단위 카드로 등록한다(장비 단위 이력 추적이 목적).
- Phase 2 매핑: 카탈로그 정의는 코드/설정 상수로 서버에 두고, `POST /api/equipment/catalog` 형태로
  다중 등록을 처리한다(관리번호 자동채번은 서버 책임).

---

## 4. 데이터 모델 최종 설계

### 4-1. 기존 테이블 (변경 없음)

```sql
-- 이미 존재. 스키마 그대로 사용한다.
equipment_assets            -- 장비 마스터 (TEXT UUID PK, UNIQUE(site_id, management_no))
equipment_asset_photos      -- 대표사진 (photo_type, sort_order 포함)
work_record_equipment_links -- 업무기록↔장비 다대다 (PK 복합, CASCADE/RESTRICT)
```

### 4-2. `facility_logs` 확장 (Phase 2에서 실행)

```sql
-- ensureColumn 방식 부트 타임 마이그레이션 (ALTER TABLE ADD COLUMN)
ALTER TABLE facility_logs ADD COLUMN equipment_id TEXT;  -- equipment_assets.id 논리적 참조
ALTER TABLE facility_logs ADD COLUMN type TEXT;          -- 정기점검/고장/수리/부품교체/위탁/기타
ALTER TABLE facility_logs ADD COLUMN contact TEXT;       -- 작업 업체 연락처
ALTER TABLE facility_logs ADD COLUMN completed_at TEXT;  -- 완료일(발생일과 다를 수 있음)

CREATE INDEX IF NOT EXISTS idx_facility_logs_equipment
  ON facility_logs (equipment_id, date);
```

상태(`equipment_assets.status`)는 현장 앱 단순성을 위해 한글 라벨을 그대로 저장한다.
(`사용 중` / `점검 필요` / `수리 중` / `예비` / `철거` / `폐기` 6종. 기존 기본값 `active`는 신규 등록 시 항상 명시적으로 덮어쓴다.)
목록 표시 여부는 상태가 아니라 `is_visible`(§4-4)로 관리한다.

### 4-3. 마이그레이션 체크리스트 (Phase 2)

- [ ] `server/database.cjs` `ensureColumn` 4건 + 인덱스 1건 추가
- [ ] 기존 `facility_logs` 행의 `equipment_id`는 NULL로 유지(과거 데이터는 미연결 상태가 정상)
- [ ] BigQuery 측 `facility_logs` 테이블 스키마에 신규 컬럼 반영 여부 확인(`server/services/initBigQuery.cjs` / `bigQuerySyncService.cjs`)
- [ ] 마이그레이션 전 자동 백업(`sqliteProtectionService.protectDatabaseBeforeMigration`) 동작 확인
- [ ] §4-4 확정 설계(is_visible, local_id, facility_log_photos) 마이그레이션 포함

### 4-4. Phase 2 착수 전 확정 설계 (2026-09-10 점검 확정)

Phase 1 점검에서 확정된 5가지 설계. Phase 2 구현은 이 기준으로 하며, 담당 에이전트가 임의로 변경하지 않는다.

1. **status와 is_visible 분리**
   - status는 운영상태만: `사용 중 / 점검 필요 / 수리 중 / 예비 / 철거 / 폐기`(6종, '숨김' 없음)
   - 목록 표시 여부는 `equipment_assets.is_visible INTEGER DEFAULT 1`(ensureColumn)로 관리
   - 일지 점검 자동 판정은 status를 근거로 하며, is_visible=0이어도 점검 대상에서 자동 제외하지 않는다
2. **이력 다중 사진 관계 테이블 신설** — 이력 본문은 facility_logs 단일 테이블 유지(§3-1 불변), 사진 관계만 분리
   ```sql
   CREATE TABLE IF NOT EXISTS facility_log_photos (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     facility_log_id INTEGER NOT NULL,
     original_name TEXT,
     stored_name TEXT NOT NULL,
     relative_path TEXT NOT NULL,
     sort_order INTEGER DEFAULT 0,
     created_at TEXT DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY (facility_log_id) REFERENCES facility_logs(id) ON DELETE CASCADE
   );
   CREATE INDEX IF NOT EXISTS idx_facility_log_photos_log
     ON facility_log_photos (facility_log_id, sort_order, id);
   ```
   JSON 경로 저장 방식은 비권장으로 배제한다.
3. **BigQuery 동기화 자연키 충돌 해소**
   - 기존 자연키(site_id+date+location+facility_name)는 같은 날·같은 장비에 점검과 수리가
     함께 기록되면 충돌한다. SQLite에 별도 UUID 컬럼을 추가하지 않고 기존 정수 PK인
     `facility_logs.id`를 BigQuery의 `local_id INTEGER`로 전송하여 원격 식별 기준을
     `site_id + local_id`로 변경한다.
   - 기존 원격 행 호환: `local_id`가 없는 과거 행은 기존 자연키도 함께 비교하는 전환 규칙으로
     중복 편입을 막는다. 재해복구 시에는 `local_id`를 로컬 `id`로 복원해 사진 FK를 보존한다.
4. **장비 데이터 재해복구 경로**
   - `equipment_assets`, `equipment_asset_photos`, `work_record_equipment_links`, `facility_log_photos`를
     BigQuery 동기화(syncTables) 또는 주기적 내보내기 대상에 추가한다.
   - 사진 원본은 슬러지/관리사진과 동일한 Drive 저장 경로를 둔다(로컬 우선 + Drive 미러).
   - 누락 시 DB 손상 후 facility_logs.equipment_id 고아가 발생하므로 Phase 2에서 반드시 함께 정의한다.
5. **상태 목록 통일**: 문서·UI·프로토타입 모두 6종으로 통일한다. `철거`는 사용 종료(목록 제거 전 단계),
   `폐기`는 최종 폐기이며, 숨김은 status가 아니라 is_visible로만 표현한다.
6. **가독성 하한선**: 현재 밀도를 유지하되 본문·표 본문 최소 13px, 주요 동작 버튼 최소 높이 36px.
   (현장관리자 연령과 1366×768 환경 기준 하한선으로 확정)

---

## 5. API 명세 (Phase 2 구현)

모든 엔드포인트는 siteContext 미들웨어로 현장 스코핑되며, 토큰 미들웨어 대상이다.
라우트 파일: `server/routes/equipmentRoutes.cjs`(신규) → `server/routeRegistry.cjs` 1줄 등록(tier 1).

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/equipment` | 장비 목록(사진 수 포함). `?q=` 검색 |
| POST | `/api/equipment` | 장비 등록. 관리번호 중복 시 `409 EQUIPMENT_DUPLICATE` |
| PUT | `/api/equipment/:id` | 장비 수정 |
| DELETE | `/api/equipment/:id` | 장비 삭제. 이력/연결 존재 시 `409 EQUIPMENT_IN_USE`(RESTRICT 안내) |
| POST | `/api/equipment/:id/photos` | 대표사진 업로드(multer, 최대 5장, `사진관리/장비이력/<id>/`) |
| GET | `/api/equipment/history` | 이력 전체(equipment_id 있는 facility_logs 행, 장비 요약 조인) |
| POST | `/api/equipment/history` | 이력 등록(facility_logs INSERT, equipment_id 필수) |
| PUT | `/api/equipment/history/:id` | 이력 수정 |
| DELETE | `/api/equipment/history/:id` | 이력 삭제 |
| GET | `/api/equipment/work-records` | 링크된 업무기록(work_records ⟩ links ⟩ photo_count) |
| POST | `/api/equipment/catalog` | 카탈로그 체크 일괄 등록(호기 이어증가·관리번호 자동채번은 서버 처리, §3-5) |

### 프론트 Model 매핑

`EquipmentModel.js`는 Phase 1에서 프리뷰 데이터를 반환하는 임시 구현으로 메서드 시그니처를 먼저 확정하고,
Phase 2에서 `apiClient` 호출로 내부만 교체한다(ViewModel/View 불변).

```js
// Phase 2 교체 후 내부 예시 (시그니처 불변)
fetchEquipment()                  → GET  /api/equipment
fetchHistory()                    → GET  /api/equipment/history
fetchWorkRecords()                → GET  /api/equipment/work-records
saveEquipment(item)               → POST /api/equipment | PUT /api/equipment/:id
deleteEquipment(id)               → DELETE /api/equipment/:id
saveHistoryEntry(entry)           → POST /api/equipment/history | PUT /api/equipment/history/:id
deleteHistoryEntry(id)            → DELETE /api/equipment/history/:id
uploadEquipmentPhotos(id, files)  → POST /api/equipment/:id/photos
```

### 업무사진관리 연결 활성화 (Phase 3)

`facilityRoutes.cjs`의 POST/PUT `/api/work-records`가 payload의 `equipmentIds`를 받아
`work_record_equipment_links`를 diff-upsert(제거/추가)한다. (현재 UI 선택기는 있으나 payload에서 누락)

같이 수정할 기존 결함:
- 동일 site+date 중복 POST가 500(원시 SQLite 에러)으로 나는 문제 → 사전 검사 후 `409 WORK_RECORD_DUPLICATE`
- `DailyLogModel.fetchAllData()`의 죽은 `GET /api/facilities` 호출 제거

---

## 6. UI/UX 명세 (Phase 1 — 프로토타입에서 구현, 본앱 이식 대기)

`prototypes/equipment-history-ui/`에서 MVVM 구조 그대로 구현한다. **모든 데이터는 프리뷰(메모리)이며 서버 저장 없음.**
새로고침 시 초기화되는 대신 앱 세션 동안은 유지되어 실제 사용감으로 확인할 수 있다.
본앱 이식 시 파일별 변경 폭은 프로토타입 `README.md`의 표를 따른다.

### 6-1. 화면 구성 (마스터-디테일)

```
┌─────────────┬──────────────────────────────────────────┐
│ 장비 목록 패널 │ 시설물 이력카드 패널                        │
│  검색        │  헤더(설비명/관리번호) + [수정][삭제][출력*]   │
│  분류 스트립   │  사양 그리드(9필드) + 대표사진 영역           │
│  장비 행      │  요약 통계(총 이력/누적비용/연간비용/최근이력)  │
│  (상태배지)   │  탭 [장비 이력 n] [연결된 업무·사진 m]        │
│             │  이력 테이블(행별 수정/삭제) or 업무기록 리스트 │
└─────────────┴──────────────────────────────────────────┘
* 출력 버튼은 확정용 자리표시자(비활성) — Phase 2 이후 인쇄 구현
```

- 검색: 관리번호/설비명/위치/구분
- 분류 스트립: `전체` + 데이터의 구분3 유니크(동적 생성)
- 상태 배지 색: 사용 중(녹) / 점검 필요(주황) / 수리 중(빨강) / 예비(회) / 철거(회색) / 폐기(진회)
- 상단에 프리뷰 안내 배너: "UI 확인 단계 — 서버에 저장되지 않습니다"

### 6-2. 파일 구성 (모두 `prototypes/equipment-history-ui/src/` 아래)

| 파일 | 역할 |
|---|---|
| `equipment/EquipmentModel.js` | 데이터 접근(Phase 1: 메모리 스토어 / Phase 2: apiClient) |
| `equipment/useEquipmentViewModel.js` | 상태·필터·CRUD 비즈니스 로직 |
| `equipment/EquipmentCardView.jsx` | 렌더링 전용 |
| `equipment/EquipmentEditorModal.jsx` | 장비 등록/수정 모달 |
| `equipment/EquipmentHistoryEditor.jsx` | 이력 등록/수정 모달 |
| `equipment/equipmentPreviewData.js` | 프리뷰 fixture |
| `equipment/equipment.css` / `equipmentEditor.css` | 스타일 |
| `dialog.js` | 프로토타입용 useDialog shim(이식 시 삭제) |
| `main.jsx` / `styles.css` / `icons.css` | 프로토타입 셸(앱 헤더·사이드바 모방, 이식 안 함) |

`EquipmentLinkSelector.jsx`(업무사진관리용 장비 선택기)는 본앱 `src/features/equipment/`에
이미 존재하며 `items` prop 주입 방식으로 실데이터 연결을 대비해 둔다(Phase 3).

레이아웃 계약 준수: 루트 `width:100%; height:100%; min-width:0; min-height:0`,
이력 테이블은 내부 스크롤 컨테이너 보유, 초기 렌더 시 배열 기본값 `[]`.

---

## 7. 단계별 실행 계획

### Phase 1 — UI/UX 완성 및 확정 (현재, 프로토타입에서 진행)

> **개발 방식(사용자 확정, 2026-09-04): 이 단계의 산출물은 앱 본체(src/)에 넣지 않고
> `prototypes/equipment-history-ui/`에서 별도 개발서버로만 확인한다.**
> 앱 본체의 `src/features/equipment/`는 기존 프리뷰 상태(HEAD) 그대로 유지한다.

1. 프리뷰 데이터 보강(장비 9대, 이력 10건, 연결 업무기록 4건) — 완료
2. MVVM 구조(EquipmentModel/useEquipmentViewModel/뷰 분리) + 이력 편집 모달 + 통계/필터/행 수정삭제 — 완료
3. 프로토타입 빌드(vite) + 브라우저 렌더링 검증 — 완료
4. **사용자가 개발서버(`npm run dev --prefix prototypes/equipment-history-ui`, http://localhost:5180)로
   UI를 살펴보며 다듬고 확정**
   - 수정 요청은 프로토타입에서 반영(라우트 없이 빠른 수정)
   - 확정 시: Phase 2 착수와 동시에 `src/equipment/` 파일들을 본앱 `src/features/equipment/`로 이식
     (이식 시 바뀌는 것은 README 표에 정리 — useDialog import 경로와 Model 내부뿐)

### Phase 2 — 백엔드(스키마 변경은 본 계획 승인 + §4-4 확정 설계 기준)

1. `database.cjs`: facility_logs 컬럼 4종 + `equipment_assets.is_visible` + 인덱스 (§4-2, §4-4)
2. `facility_log_photos` 테이블 신설 + 이력 사진 저장/조회/삭제 라우트 (§4-4-2)
3. `equipmentRoutes.cjs` 신규 + routeRegistry 등록 + api-spec.cjs 갱신
4. `EquipmentModel.js` 내부를 apiClient로 교체(시그니처 불변). 공법은 기본설정(app_settings.method)에서 주입
5. 공법별 기본 설비 시드 1회 프로비저닝(장비 목록이 비어 있고 공법이 지정된 경우에만 — 사용자 CRUD 결과를 덮어쓰지 않음)
6. 사진 업로드(업로드 보안 미들웨어 재사용) + 로컬 폴더 저장 + Drive 미러 경로(§4-4-4)
7. BigQuery: facility_logs 동기화 키를 site_id+local_id로 전환, 원격 스키마 갱신, 신규 테이블 동기화/백업 포함(§4-4-3,4)
8. validate 전체 통과 + 진단러너 equipment-card 시나리오(§7 Phase 4)

### Phase 3 — 업무사진관리 맞물림

1. work-records POST/PUT에 `equipmentIds` diff-upsert
2. 중복 POST 409 처리
3. 죽은 `/api/facilities` 호출 제거
4. EquipmentLinkSelector에 실데이터 주입

### Phase 4 — 검증 인프라 및 마무리

1. 진단러너 시나리오 `equipment-card` 추가:
   장비 등록 → 이력 등록 → 업무기록+장비 링크 → 타임라인 집계 검증 → 삭제(RESTRICT 검증)
2. `changed-scope.cjs` RULES에 신규 경로 매핑(src/features/equipment, equipmentRoutes, facility_logs 관련)
3. `prototypes/equipment-history-ui/` 삭제
4. 문서 갱신(본 문서에 완료 표기, ROADMAP 반영)

---

## 8. 검증 계획

| 단계 | 검증 |
|---|---|
| Phase 1 | `npm run lint`, `npm run validate`, 사용자 UI 확정 |
| Phase 2 | `node tools/diagnostic-runner/runner.cjs --changed`(equipment 경로), validate:api |
| Phase 4 | `runner.cjs --scenario equipment-card`, `--coverage` 갭 없음 확인 |

## 9. 리스크와 계약 준수

- **BigQuery 동기화**: facility_logs 신규 컬럼이 원격 스키마와 어긋나면 동기화 실패 가능 → Phase 2 체크리스트로 확인
- **장비 삭제 무결성**: 이력/링크가 있는 장비 삭제 시 데이터 고아화 방지(RESTRICT + 409 안내)
- **AGENTS.md 준수**: 스키마 변경은 본 문서 승인으로 갈음. core/api·electron·빌드 설정은 변경 없음
- **인코딩**: 모든 신규 파일 UTF-8(BOM 없음). 작업 후 `npm run validate`로 Mojibake 자가 검증

## 10. 완료 기준 (Definition of Done)

1. 장비 등록/수정/삭제/사진이 실제 DB에 저장되고 재시작 후 유지된다
2. 이력 등록/수정/삭제가 facility_logs에 저장되고 장비 카드 타임라인에 반영된다
3. 업무사진관리에서 장비를 연결하면 해당 장비 카드의 "연결된 업무·사진"에 나타난다
4. 장비 삭제 시 연결 데이터가 있으면 삭제가 차단되고 안내된다
5. status와 is_visible이 분리되어, 숨김 장비의 운영상태가 유지되고 일지 판정 근거에서 사라지지 않는다
6. 이력 다중 사진이 facility_log_photos로 저장·조회·삭제되고(§4-4-2) 재시작 후 유지된다
7. facility_logs 동기화가 site_id+local_id 기준으로 동작하고 같은 날 다건 기록이 충돌하지 않는다
8. 장비 마스터·사진 메타데이터·연결 테이블의 동기화/백업 경로가 존재하고 복원 절차가 문서화된다
9. `node tools/diagnostic-runner/runner.cjs --scenario equipment-card` PASSED
10. `npm run validate` 통과, 진단러너 `--coverage`에 미커버 메뉴 없음
