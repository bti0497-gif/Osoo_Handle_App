# 성적서 수질 데이터 업무일지 바인딩 기록

## 목적

일일업무일지 양식의 `6. 수질측정` 표에는 큐앤테크 현장 측정값이 아니라, 중앙관리자용 앱이 성적서를 파싱해 BigQuery `water_quality`에 올린 성적서 수질 데이터를 바인딩한다.

대상 표 항목:

- 시료채취일
- PH
- BOD
- COD
- SS
- T-N
- T-P
- 총대장균군
- 비고

## 구현 완료

### 백그라운드 동기화

- 로그인 성공 시 `server/routes/authRoutes.cjs`에서 `syncRecentCertificateCacheForSite(...)`를 호출한다.
- `server/services/certificateCacheSyncService.cjs`가 BigQuery `water_quality`를 조회해 로컬 `water_quality` 테이블에 저장한다.
- 성적서 메뉴는 이 데이터를 조회하지 않는다. 성적서 메뉴는 Drive 파일 목록만 조회한다.

### 업무일지 바인딩

`server/services/dailyWorkLogService.cjs`에 다음 흐름을 추가했다.

- `getCertificateWaterQualityRows(db, date, scope, limit)`
  - 로컬 `water_quality` 조회
  - `report_date <= 업무일지 날짜`
  - 현재 현장 `site_name`, `site_name_raw` 기준 필터
  - `site_name`이 없을 때만 `site_id` fallback 사용
  - 과거 백필/레거시 데이터에서 여러 현장의 `site_id`가 현재 앱 site_id로 채워질 수 있어, 현장명이 있으면 `site_id OR site_name` 조건을 쓰지 않는다.
  - 동일 성적서가 로컬 캐시에 중복되어 있으면 바인딩 직전에 중복을 제거한다.
  - 최근 2건 반환
- `bindCertificateWaterQuality(bindings, rows)`
  - 최근 2건을 각각 `1`, `2` suffix로 바인딩
  - named cell 후보를 넓게 지원

현재 매핑:

| 업무일지 셀 이름 후보 | 로컬 `water_quality` 칼럼 |
| --- | --- |
| `수질날짜1`, `시료채취일1` | `report_date` |
| `수질bod1`, `BOD1`, `bod1` | `bod` |
| `수질ss1`, `SS1`, `ss1` | `ss` |
| `수질tn1`, `TN1`, `T-N1`, `수질T-N1` | `tn` |
| `수질tp1`, `TP1`, `T-P1`, `수질T-P1` | `tp` |
| `수질대장균1`, `대장균1`, `총대장균군1`, `수질총대장균군1` | `total_coliform` |
| `수질mlss1`, `MLSS1`, `mlss1` | `mlss` |
| `수질비고1`, `비고1` | `drive_file_name` 또는 `source_pdf_name` |

위 매핑은 `2` suffix에도 동일하게 적용된다.

### 캐시 갱신

일일업무일지 미리보기 캐시 서명에 성적서 수질 데이터도 포함했다.

- `report_date`
- `bod`
- `ss`
- `tn`
- `tp`
- `total_coliform`
- `mlss`
- `last_modified`

성적서 데이터가 바뀌면 기존 미리보기 캐시가 재사용되지 않고 다시 생성된다.

## 남은 결정 사항

### PH/COD

현재 로컬 `water_quality` 스키마에는 `ph`, `cod` 칼럼이 없다.

현재 구현은 다음 셀을 빈 값으로 유지한다.

- `수질ph1`, `PH1`, `ph1`
- `수질cod1`, `COD1`, `cod1`
- `수질toc1`, `TOC1`, `toc1`

성적서 파싱 대상에 PH/COD가 실제로 포함된다면, 다음 작업이 필요하다.

1. BigQuery `water_quality`에 `ph`, `cod` 칼럼 추가
2. 로컬 `water_quality` 스키마에 `ph`, `cod` 칼럼 추가
3. `certificateCacheSyncService.cjs` 동기화 SELECT/INSERT에 반영
4. `dailyWorkLogService.cjs` 바인딩에서 빈 값 대신 `row.ph`, `row.cod` 사용

## 검증 완료

- `node --check server/services/dailyWorkLogService.cjs`
- `node --check server/database.cjs`
- `npm run validate`
- `npm run build`

## 분리 원칙

- `water_quality`: 성적서 파싱 데이터, 일일업무일지 수질측정 표 바인딩용
- `qntech_water_quality`: 큐앤테크 수질분석일지 작성용
- 성적서 메뉴: Drive 파일 조회와 선택 PDF 다운로드 전용
