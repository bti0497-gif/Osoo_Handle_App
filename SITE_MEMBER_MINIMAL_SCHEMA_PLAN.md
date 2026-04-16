# 현장/회원 최소 변경 스키마 초안

## 목적
- 로컬 설정은 그대로 유지한다.
- 중앙에서 볼 데이터만 현장 기준으로 표준화한다.
- 현장은 고정 마스터로 관리하고, 회원은 개인 정보 중심으로 분리한다.

## 중앙 관리 대상에서 제외
- config_items
- app_settings 내부의 로컬 항목 설정
- 엑셀 매핑 설정
- 분석장소 목록
- sludge_export_settings
- web_app_credentials
- excel_raw_data
- excel_sheets

위 항목은 각 현장 PC 로컬 설정으로 유지한다.

## 최소 변경 원칙
- 기존 현장별 단독 설치 워크플로우는 깨지지 않게 유지한다.
- 기존 app_settings는 당장 제거하지 않고 로컬 현재 현장 컨텍스트로 유지한다.
- 중앙 집계가 필요한 테이블만 site_id를 표준 컬럼으로 맞춘다.
- site_name은 당분간 조회/출력 편의를 위한 보조 컬럼으로 유지한다.

## 이번 단계 최종 확정값

### 공통 규칙
- site_id는 TEXT 타입 UUID 문자열을 사용한다.
- member_id는 기존 members.id를 그대로 사용한다.
- created_at, updated_at, last_modified는 TEXT ISO datetime을 사용한다.
- boolean 성격 컬럼은 INTEGER 0/1로 저장한다.
- 기존 role 값은 당장 변경하지 않고 그대로 유지한다.

### role 값 최소 변경 기준
- admin: 현장관리자
- group_admin: 권역/중앙 관리자
- user: 일반 사용자 또는 레거시 기본값

설명:
- 현재 코드베이스는 admin, group_admin을 이미 사용 중이므로 이번 단계에서는 role 체계를 새로 갈아엎지 않는다.
- central_admin, super_admin 같은 이름은 신규 기능에서만 일부 쓰이고 있어, 실제 DB 스키마 변경 단계에서는 우선 admin/group_admin 중심으로 맞춘다.

### FK 방향 최종안
- member_sites.member_id -> members.id
- member_sites.site_id -> sites.id
- 중앙 집계 테이블의 site_id -> sites.id

설명:
- SQLite에서 FK 강제는 환경에 따라 느슨할 수 있지만, 스키마 설계 기준은 FK 참조를 명시하는 방향으로 확정한다.

## 신규 테이블

### 1. sites
현장 마스터 테이블.

최종 컬럼안:
- id TEXT PRIMARY KEY
- site_name TEXT NOT NULL UNIQUE
- manager_name TEXT
- method TEXT
- series TEXT
- is_active INTEGER DEFAULT 1
- created_at TEXT DEFAULT CURRENT_TIMESTAMP
- updated_at TEXT DEFAULT CURRENT_TIMESTAMP

제약조건:
- UNIQUE(site_name)
- CHECK(is_active IN (0, 1))

권장 인덱스:
- INDEX idx_sites_active_name (is_active, site_name)

설명:
- 현장명, 관리자명, 공법, 계열수는 중앙 기준 마스터로 승격한다.
- 로컬 app_settings의 site_id, site_name, manager_name, method, series는 최초 마이그레이션 소스로 사용한다.

### 2. member_sites
회원-현장 연결 테이블.

최종 컬럼안:
- id INTEGER PRIMARY KEY AUTOINCREMENT
- member_id TEXT NOT NULL
- site_id TEXT NOT NULL
- is_primary INTEGER DEFAULT 0
- can_manage INTEGER DEFAULT 1
- is_bidirectional INTEGER DEFAULT 0
- created_at TEXT DEFAULT CURRENT_TIMESTAMP
- UNIQUE(member_id, site_id)

제약조건:
- UNIQUE(member_id, site_id)
- CHECK(is_primary IN (0, 1))
- CHECK(can_manage IN (0, 1))
- CHECK(is_bidirectional IN (0, 1))

권장 인덱스:
- INDEX idx_member_sites_member (member_id)
- INDEX idx_member_sites_site (site_id)
- INDEX idx_member_sites_primary (member_id, is_primary)

설명:
- 한 명의 사용자가 여러 현장을 담당하는 요구를 처리한다.
- 이전에 논의된 다현장 관리자 요구를 최소 변경으로 수용하려면 members에 site_id 하나만 넣는 것보다 연결 테이블이 안전하다.
- 일반 근무자는 1행, 다현장 관리자는 여러 행을 갖게 된다.
- 실무 규칙은 “회원당 주현장 1개”를 애플리케이션 로직으로 보장한다.

## 기존 테이블 변경안

### 1. members
현재 역할:
- 로그인 사용자 기본 정보 저장

최종 컬럼안:
- id TEXT PRIMARY KEY
- name TEXT NOT NULL UNIQUE
- password TEXT NOT NULL
- phone TEXT
- role TEXT DEFAULT 'user'
- target_lat REAL
- target_lng REAL
- radius_m REAL DEFAULT 500
- notes TEXT
- created_at DATETIME DEFAULT CURRENT_TIMESTAMP
- updated_at TEXT DEFAULT CURRENT_TIMESTAMP

제약조건:
- UNIQUE(name)
- CHECK(role IN ('admin', 'group_admin', 'user'))
- CHECK(radius_m IS NULL OR radius_m >= 0)

권장 인덱스:
- INDEX idx_members_role (role)
- INDEX idx_members_name (name)

설명:
- 회원 테이블에는 개인 정보만 둔다.
- 현장 소속은 members가 아니라 member_sites로 연결한다.
- 기존 Google Sheets 기반 부가 컬럼(site_name1, site_name2, target_lat, target_lng, radius_m, notes)은 장기적으로 members + member_sites로 분리 이관한다.
- 비밀번호 컬럼명은 이번 최소 변경에서는 password를 유지한다. 해시 전환은 별도 보안 작업으로 분리한다.

### 2. app_settings
유지 방향:
- 로컬 현재 현장 컨텍스트 저장

유지 컬럼:
- site_id
- site_name
- manager_name
- method
- series

설명:
- 현장 PC에서는 여전히 app_settings 1행이 중요하다.
- 다만 중앙 기준 원본은 sites 테이블이고, app_settings는 로컬 복제/현재 선택 현장 개념으로 본다.

운영 규칙:
- app_settings.site_id는 반드시 sites.id와 일치해야 한다.
- 현장 PC 최초 설정 시 sites 1건 생성 후 app_settings.site_id에 같은 값을 기록한다.

## site_id 표준화 대상 확정

### A. 이미 site_id가 있거나 추가 마이그레이션이 들어간 테이블
- flow_readings
- medicine_logs
- water_quality
- kit_logs
- facility_logs

근거:
- server/database.cjs의 syncTables 마이그레이션에서 site_id 추가 처리 중.

### B. 이번 최소 변경안에서 site_id를 추가해야 하는 테이블
- attendance
- sludge_photo_logs

설명:
- attendance는 중앙 출결 현황 집계 대상이므로 site_id 필수.
- sludge_photo_logs는 각 일지/사진대지 중앙 조회 대상이면 site_id가 필요하다.

권장 attendance 추가 컬럼:
- site_id TEXT
- site_name TEXT

권장 제약/인덱스:
- INDEX idx_attendance_site_date (site_id, date)
- INDEX idx_attendance_member_date (member_id, date)

권장 sludge_photo_logs 추가 컬럼:
- site_id TEXT

권장 제약/인덱스:
- INDEX idx_sludge_photo_logs_site_date (site_id, date)

### C. 로컬 DB 컬럼 추가보다 서비스 레벨 표준화가 필요한 대상
- board posts/comments
- daily work log export/view 모델

설명:
- 게시판은 로컬 SQLite가 아니라 BigQuery 서비스 기반이다.
- 현재는 author_site, target_site처럼 문자열 site 기준으로 처리하고 있으므로, 중앙 표준화 시 site_id 기준 필드를 서비스 계층에 추가하는 방식이 적절하다.
- 게시판 최소 변경 표준 필드 제안:
	- posts.site_id
	- posts.target_site_id
	- comments.site_id
- 일일업무일지는 별도 저장 테이블이 아니라 flow/medicine/water/kit/facility/sludge 등의 원본 데이터를 조합해 출력한다.
- 따라서 일일업무일지 자체에 새 테이블을 만드는 것이 아니라, 원본 데이터 테이블의 site_id 표준화로 해결한다.

## site_id 표준 컬럼 규칙
- site_id: 중앙 집계용 기준 키, 필수
- site_name: 출력/검색 보조용 캐시 문자열, 유지

설명:
- 새 저장 로직은 site_id를 기준으로 동작한다.
- 기존 출력물과 BigQuery 연계 호환을 위해 site_name은 당분간 같이 저장한다.

## 테이블별 최종 결론

### 1. sites
- 신규 생성
- 현장 마스터 원본

### 2. members
- 기존 유지
- phone, target_lat, target_lng, radius_m, notes, updated_at 추가
- 현장 직접 소속 컬럼은 넣지 않음

### 3. member_sites
- 신규 생성
- 회원-현장 연결 담당

### 4. attendance
- site_id 추가
- site_name 추가
- 중앙 출결 집계용 표준화 대상

### 5. flow_readings
- 현 구조 유지
- site_id, site_name 계속 사용

### 6. medicine_logs
- 현 구조 유지
- site_id, site_name 계속 사용

### 7. water_quality
- 현 구조 유지
- site_id, site_name 계속 사용

### 8. kit_logs
- 현 구조 유지
- site_id, site_name 계속 사용

### 9. facility_logs
- 현 구조 유지
- site_id, site_name 계속 사용

### 10. sludge_photo_logs
- site_id 추가
- site_name은 기존 유지

### 11. board posts/comments
- 로컬 DB 변경 없음
- BigQuery 스키마에 site_id 계열 필드 추가 검토

### 12. daily work log
- 신규 테이블 없음
- 원본 데이터 테이블 site_id 표준화만 반영

## 구현용 SQL 기준 초안

```sql
CREATE TABLE IF NOT EXISTS sites (
	id TEXT PRIMARY KEY,
	site_name TEXT NOT NULL UNIQUE,
	manager_name TEXT,
	method TEXT,
	series TEXT,
	is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sites_active_name ON sites (is_active, site_name);

CREATE TABLE IF NOT EXISTS member_sites (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	member_id TEXT NOT NULL,
	site_id TEXT NOT NULL,
	is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
	can_manage INTEGER NOT NULL DEFAULT 1 CHECK (can_manage IN (0, 1)),
	is_bidirectional INTEGER NOT NULL DEFAULT 0 CHECK (is_bidirectional IN (0, 1)),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE(member_id, site_id),
	FOREIGN KEY (member_id) REFERENCES members(id),
	FOREIGN KEY (site_id) REFERENCES sites(id)
);

CREATE INDEX IF NOT EXISTS idx_member_sites_member ON member_sites (member_id);
CREATE INDEX IF NOT EXISTS idx_member_sites_site ON member_sites (site_id);
CREATE INDEX IF NOT EXISTS idx_member_sites_primary ON member_sites (member_id, is_primary);
```

## BigQuery 스키마 변경 범위

### 원칙
- 로컬 DB 변경과 BigQuery 변경은 같이 봐야 한다.
- 중앙 집계 대상은 BigQuery에서도 site_id 기준으로 표준화한다.
- 기존 BigQuery 테이블에 REQUIRED 컬럼은 자동 append가 불가능하므로, 신규 컬럼은 우선 NULL 허용으로 추가한다.
- 기존 필드명과 호환이 필요한 경우 site_name은 유지한다.

### 현재 BigQuery 생성 스크립트 기준 현황
- 정의 파일: server/scripts/initBigQuery.cjs
- 이미 site_id가 들어간 테이블:
	- flow_readings
	- medicine_logs
	- water_quality
	- kit_logs
	- facility_logs
- 아직 site_id가 없는 테이블:
	- attendance
	- posts
	- comments

### BigQuery 표준화 대상 확정

#### 1. flow_readings
- 유지
- 필드 유지: site_id, site_name, author, local_id, created_at, updated_at, uploaded_at

#### 2. medicine_logs
- 유지
- 필드 유지: site_id, site_name, author, local_id, created_at, updated_at, uploaded_at

#### 3. water_quality
- 유지
- 필드 유지: site_id, site_name, author, local_id, created_at, updated_at, uploaded_at

#### 4. kit_logs
- 유지
- 필드 유지: site_id, site_name, author, local_id, created_at, updated_at, uploaded_at

#### 5. facility_logs
- 유지
- 필드 유지: site_id, site_name, author, local_id, created_at, updated_at, uploaded_at

#### 6. attendance
변경 필요.

권장 BigQuery 컬럼안:
- id STRING REQUIRED
- site_id STRING
- site_name STRING
- member_id STRING REQUIRED
- member_name STRING
- date DATE REQUIRED
- login_time TIMESTAMP
- logout_time TIMESTAMP
- login_lat FLOAT
- login_lng FLOAT
- logout_lat FLOAT
- logout_lng FLOAT
- location_matched BOOLEAN
- auto_logout BOOLEAN
- uploaded_at TIMESTAMP

주의:
- 현재 스크립트는 member_id를 INTEGER로 정의하고 있다.
- 로컬 members.id는 TEXT이므로 BigQuery도 STRING으로 맞춰야 한다.
- logout_lat, logout_lng는 로컬 attendance에 이미 있으므로 BigQuery에도 추가하는 것이 맞다.
- site_id는 nullable로 먼저 추가한다.

#### 7. posts
변경 필요.

권장 BigQuery 컬럼 추가:
- site_id STRING
- target_site_id STRING

기존 필드 유지:
- author_site
- target_site

설명:
- 당장 조회 호환을 위해 문자열 기반 author_site, target_site는 유지한다.
- 이후 서비스는 site_id, target_site_id를 우선 사용하고, 레거시 조회/표시는 site_name 문자열을 병행 사용한다.

#### 8. comments
변경 검토 필요.

권장 BigQuery 컬럼 추가:
- site_id STRING

설명:
- 댓글 자체는 post_id로 상위 post를 따라갈 수 있으므로 필수는 아니다.
- 하지만 중앙 최근 활동을 site_id 단위로 빠르게 집계하려면 comments.site_id를 두는 편이 유리하다.
- 최소 변경 원칙상 댓글은 post_id 조인으로 처리 가능하면 생략 가능하다.

## BigQuery 변경 방식 확정

### 자동 append 가능한 변경
- NULL 허용 STRING/FLOAT/BOOLEAN/TIMESTAMP 컬럼 추가
- 예:
	- attendance.site_id
	- attendance.logout_lat
	- attendance.logout_lng
	- posts.site_id
	- posts.target_site_id
	- comments.site_id

### 자동 append로 처리하면 안 되는 변경
- REQUIRED 컬럼 신규 추가
- 기존 컬럼 타입 변경

현재 해당되는 항목:
- attendance.member_id INTEGER -> STRING 변경

설명:
- initBigQuery 스크립트는 누락된 REQUIRED 컬럼을 자동 추가하지 못한다.
- 기존 타입 변경도 자동 보정하지 않는다.
- attendance.member_id 타입 변경은 별도 마이그레이션이 필요하다.

## BigQuery 마이그레이션 전략

### 전략 A. 기존 테이블 유지 + 점진 변경
- 장점: 운영 영향이 가장 적다.
- 방식:
	1. attendance에 site_id, logout_lat, logout_lng nullable 컬럼 추가
	2. posts에 site_id, target_site_id nullable 컬럼 추가
	3. comments에 site_id nullable 컬럼 추가 여부 결정
	4. attendance.member_id는 당장은 기존 INTEGER 유지 또는 새 member_id_text 컬럼 추가

적합한 경우:
- 현재 운영 데이터를 끊지 않고 빠르게 진행할 때

### 전략 B. attendance_v2 / posts_v2 재생성
- 장점: 타입과 필드를 깔끔하게 재정리 가능하다.
- 방식:
	1. attendance_v2 생성
	2. member_id STRING, site_id STRING 포함
	3. 신규 적재는 v2로 전환
	4. 필요 시 조회는 뷰 또는 서비스에서 통합

적합한 경우:
- 출결을 중앙 대시보드 핵심 데이터로 쓸 예정이고, member_id 타입을 정확히 맞춰야 할 때

## 현재 권장안
- flow/medicine/water/kit/facility는 현재 BigQuery 스키마 유지
- attendance는 BigQuery에서 별도 보강 필요
- posts는 site_id, target_site_id 추가
- comments는 우선 생략 가능, 필요 시 site_id 추가
- member_id 타입 문제 때문에 attendance는 단순 append만으로 끝내지 말고 별도 결정이 필요

## 구현 전 추가 확정 필요 항목
1. BigQuery attendance에서 member_id를 STRING으로 강제 전환할지
2. comments에 site_id를 둘지, post 조인으로만 처리할지
3. posts.target_site_id를 다중 대상 없이 단일 현장 기준으로 둘지

## 실무 결론
- 맞다. 이번 작업은 로컬 SQLite 마이그레이션만으로 끝나지 않는다.
- BigQuery도 최소한 attendance, posts 계열 스키마를 같이 손봐야 한다.
- 특히 attendance.member_id 타입 문제는 지금 미리 정리하지 않으면 이후 회원-현장 연결 작업에서 다시 막힌다.

## 중앙 조회 대상 목록
- attendance
- flow_readings
- medicine_logs
- water_quality
- kit_logs
- facility_logs
- sludge_photo_logs
- board posts/comments

설명:
- 위 데이터는 중앙 화면이나 대시보드에서 site_id 기준 필터링 가능해야 한다.
- 성적서 기능을 붙일 경우 certificates 계열 테이블도 처음부터 site_id 포함으로 설계한다.

## 이번 단계에서 하지 않는 것
- config_items를 현장 마스터와 연결하는 작업
- app_settings 제거
- 엑셀 매핑 구조 개편
- 분석장소 목록을 중앙 DB로 승격

## 권장 마이그레이션 순서
1. sites, member_sites 생성
2. members에 개인 컬럼 확장
3. attendance, sludge_photo_logs에 site_id 추가
4. 기존 app_settings 1행을 기준으로 sites 1건 백필
5. 기존 members 및 Google Sheets 데이터를 members + member_sites로 이관
6. 중앙 조회 API를 site_id 기준으로 정리

## 구현 우선순위
1. DB 스키마 추가: sites, member_sites, attendance.site_id, sludge_photo_logs.site_id
2. syncMetadataService 기준으로 site_id 주입 일관화
3. authRoutes 출결 저장/동기화에 site_id 반영
4. 회원관리 API를 개인 정보와 현장 연결 정보로 분리
5. 이후 중앙 조회 화면에서 site_id 필터 적용

## 결론
- 로컬 설정은 그대로 두고, 중앙 집계 대상만 site_id 기준으로 맞추는 것이 최소 변경안이다.
- 현장은 sites 마스터로, 회원은 members 개인 정보로, 소속은 member_sites로 나누는 구성이 현재 요구에 가장 잘 맞는다.