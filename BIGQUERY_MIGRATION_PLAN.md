# BigQuery 아키텍처 마이그레이션 계획

## 1. 개요
기존의 **로컬 SQLite + Google Drive(JSON)** 구조를 **로컬 SQLite + BigQuery** 구조로 개편합니다.
현장 데이터는 로컬 DB에 우선 저장되어 오프라인 사용성을 보장하며, 백그라운드에서 BigQuery로 동기화되어 중앙 통합 관리를 실현합니다.

## 2. 핵심 전략: 동기화 플래그 (Sync Flag)
사용자의 제안대로 로컬 데이터베이스 테이블에 동기화 상태를 관리하는 컬럼을 추가하여, **변경된 데이터만 효율적으로 전송**합니다.

### 2.1. 로컬 DB 스키마 변경 대상
주요 데이터 테이블에 `is_synced` 컬럼을 추가합니다.
*   대상 테이블: `daily_logs`, `water_quality`, `flow_data`, `chemical_usage`, `facility_logs` 등
*   추가 컬럼:
    *   `is_synced` (INTEGER): `0` (미동기화), `1` (동기화 완료). 기본값 `0`.
    *   `last_modified` (TEXT): 데이터 수정 시각 (ISO8601).

### 2.2. BigQuery 테이블 설계 (Log-based)
BigQuery는 수정(UPDATE) 비용이 비싸고 제한적이므로, 모든 변경 사항을 **이력(Log)** 형태로 쌓습니다.
*   구조 예시 (`raw_water_quality`):
    *   `site_name`: 현장명
    *   `date`: 측정일
    *   `nh3_n`, `cod` ... : 데이터 필드
    *   `updated_at`: 로컬에서 수정된 시각 (`last_modified`)
    *   `uploaded_at`: BigQuery에 적재된 시각 (서버 시간)
    *   `is_deleted`: 삭제 여부 플래그

## 3. 상세 동기화 프로세스

1.  **사용자 작업 (Create/Update/Delete)**
    *   앱에서 저장 버튼 클릭.
    *   로컬 SQLite에 데이터 저장 (`INSERT` or `UPDATE`).
    *   이때 반드시 `is_synced = 0`, `last_modified = 현재시간`으로 설정.

2.  **백그라운드 동기화 (Sync Service)**
    *   주기적(예: 5분마다) 또는 저장 직후 트리거.
    *   쿼리: `SELECT * FROM table WHERE is_synced = 0`
    *   조회된 데이터를 JSON으로 변환하여 BigQuery API (`tabledata.insertAll`) 호출.

3.  **완료 처리 (Acknowledge)**
    *   BigQuery 응답이 성공(200 OK)이면,
    *   로컬 SQLite 업데이트: `UPDATE table SET is_synced = 1 WHERE id IN (...)`

4.  **충돌 해결 및 분석**
    *   BigQuery에는 같은 날짜, 같은 현장의 데이터가 여러 행 쌓일 수 있음.
    *   관리자 대시보드 조회 시: `updated_at`이 가장 최신인 행만 골라내는 SQL(`QUALIFY ROW_NUMBER()`) 사용.

## 4. 단계별 실행 계획 (Roadmap)

### Phase 1. Google Cloud 환경 구성
1.  Google Cloud Project 생성.
2.  BigQuery API 활성화.
3.  서비스 계정(Service Account) 생성 및 키 파일(`key.json`) 발급.
4.  BigQuery 데이터셋 및 테이블 스키마 생성.

### Phase 2. 로컬 DB 마이그레이션
1.  `server/database.cjs` 수정.
2.  기존 테이블에 `is_synced` 컬럼 추가 (Migration Script 작성).
3.  기존 데이터의 `is_synced`를 모두 `0`으로 초기화하여 최초 1회 전체 동기화 유도.

### Phase 3. 백엔드 동기화 서비스 구현
1.  `server/services/bigQueryService.cjs` 구현.
2.  Google Cloud BigQuery 클라이언트 라이브러리 연동.
3.  테이블별 매핑 로직 구현.

### Phase 4. 프론트엔드 연동 및 테스트
1.  데이터 저장 시점과 동기화 서비스 연결.
2.  오프라인 -> 온라인 전환 시 자동 동기화 테스트.
3.  동기화 상태 아이콘 표시 (선택 사항).

## 5. 예상 이점
*   **네트워크 독립성**: 인터넷이 끊겨도 현장 업무(저장/수정)는 100% 가능.
*   **데이터 무결성**: 전송 실패 시 로컬에 `is_synced=0`으로 남아있으므로 다음 번에 재시도됨.
*   **이력 관리**: 누가 언제 데이터를 수정했는지 BigQuery에 모두 기록됨.

## 6. 스키마 변경: 다중 현장 지원 (`site_name`, `author` 추가)

### 6.1. 목적
전국 휴게소 데이터의 출처를 명확히 하고 데이터 추적성을 확보하기 위해, `daily_log_system` 데이터셋의 모든 동기화 대상 테이블에 `site_name` (휴게소명)과 `author` (작성자) 칼럼을 추가합니다.

### 6.2. 사전 준비 사항
- Google Cloud SDK (`gcloud`)가 설치 및 설정되어 있어야 합니다.
- BigQuery 테이블을 수정할 수 있는 권한으로 GCP 프로젝트에 인증되어 있어야 합니다.

### 6.3. 대상 테이블
아래 테이블들의 스키마가 변경됩니다.
- `flow_readings`
- `medicine_logs`
- `water_quality`
- `kit_logs`
- `facility_logs`

### 6.4. 스키마 변경 명령어
Google Cloud SDK (gcloud CLI) 환경에서 아래 `bq` 명령어를 사용하여 각 테이블에 `site_name` (STRING)과 `author` (STRING) 칼럼을 추가합니다.

**중요**: 아래 명령어를 실행하기 전, GCP 프로젝트 ID가 `work-jindan-1946`이 맞는지 반드시 확인하세요. 만약 다르다면, 실제 프로젝트 ID로 수정 후 실행해야 합니다.

```bash
# Table: flow_readings
bq query --use_legacy_sql=false 'ALTER TABLE `work-jindan-1946.daily_log_system.flow_readings` ADD COLUMN site_name STRING, ADD COLUMN author STRING'

# Table: medicine_logs
bq query --use_legacy_sql=false 'ALTER TABLE `work-jindan-1946.daily_log_system.medicine_logs` ADD COLUMN site_name STRING, ADD COLUMN author STRING'

# Table: water_quality
bq query --use_legacy_sql=false 'ALTER TABLE `work-jindan-1946.daily_log_system.water_quality` ADD COLUMN site_name STRING, ADD COLUMN author STRING'

# Table: kit_logs
bq query --use_legacy_sql=false 'ALTER TABLE `work-jindan-1946.daily_log_system.kit_logs` ADD COLUMN site_name STRING, ADD COLUMN author STRING'

# Table: facility_logs
bq query --use_legacy_sql=false 'ALTER TABLE `work-jindan-1946.daily_log_system.facility_logs` ADD COLUMN site_name STRING, ADD COLUMN author STRING'
```

### 6.5. 애플리케이션 코드 업데이트
BigQuery 테이블 스키마가 위 명령어로 변경된 후, `server/services/bigQuerySyncService.cjs`의 애플리케이션 코드도 이 새로운 데이터를 전송하도록 수정되어야 합니다.