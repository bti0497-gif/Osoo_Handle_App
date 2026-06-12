# 성적서 수질 데이터 업무일지 바인딩 계획

## 목적

업무일지 양식의 `6. 수질측정` 표에는 큐앤테크 현장 측정값이 아니라, 중앙관리자용 앱이 성적서를 파싱해 BigQuery `water_quality`에 올린 성적서 수질 데이터를 바인딩한다.

해당 표 항목:

- 시료채취일
- PH
- BOD
- COD
- SS
- T-N
- T-P
- 총대장균군
- 비고

## 현재 확인 결과

### 이미 되어 있는 것

- 로그인 성공 시 `server/routes/authRoutes.cjs`에서 `syncRecentCertificateCacheForSite(...)`를 호출한다.
- `server/services/certificateCacheSyncService.cjs`가 BigQuery `water_quality`를 조회해 로컬 `water_quality` 테이블에 저장한다.
- 로컬 `water_quality` 스키마는 성적서 파싱값 중심으로 정리되어 있다.
  - `report_date`
  - `category`
  - `site_name`
  - `site_name_raw`
  - `bod`
  - `ss`
  - `tn`
  - `tp`
  - `mlss`
  - `total_coliform`
  - `drive_file_name`
  - `source_pdf_name`
- 업무일지 엑셀 생성 서비스는 named cell을 읽어 `bindings` 객체의 값을 셀에 넣는 구조다.

### 아직 안 된 것

- `server/services/dailyWorkLogService.cjs`의 `buildBindingsForDate()`에서 `water_quality`를 조회하지 않는다.
- 현재 수질 관련 바인딩은 다음처럼 빈 값으로 초기화되어 있다.
  - `수질ph1`, `수질bod1`, `수질toc1`, `수질ss1`, `수질tn1`, `수질tp1`, `수질대장균1`
  - `수질ph2`, `수질bod2`, `수질toc2`, `수질ss2`, `수질tn2`, `수질tp2`, `수질대장균2`
  - `수질날짜1`, `수질날짜2`
- 업무일지 미리보기 전용 `dailyLogPreviewService.cjs`는 `qntech_water_quality` 중심으로 동작한다. 이것은 큐앤테크 수질분석 사진/측정값 영역용이므로 성적서 표와 섞지 않는다.

## 수정 방향

### 1. 로컬 성적서 수질 조회 함수 추가

`server/services/dailyWorkLogService.cjs`에 다음 역할의 helper를 추가한다.

- 입력: `db`, `date`, `scope`
- 조회 테이블: 로컬 `water_quality`
- 조건:
  - `report_date <= 업무일지 날짜`
  - 현장 범위가 있으면 `site_name` 또는 `site_name_raw`를 현장명 기준으로 필터
  - 가장 최근 성적서 1건 또는 2건을 반환
- 정렬:
  - `report_date DESC`
  - `last_modified DESC`
  - `id DESC`

후보 함수명:

```js
function getCertificateWaterQualityRows(db, date, scope) { ... }
```

### 2. 업무일지 named cell 바인딩 추가

`buildBindingsForDate()`에서 현재 빈 값으로 들어가는 수질 바인딩 부분을 `water_quality` 조회 결과로 교체한다.

기본 매핑:

| 업무일지 셀 이름 후보 | 로컬 `water_quality` 칼럼 |
| --- | --- |
| `수질날짜1`, `시료채취일1` | `report_date` |
| `수질bod1`, `BOD1` | `bod` |
| `수질ss1`, `SS1` | `ss` |
| `수질tn1`, `TN1`, `T-N1` | `tn` |
| `수질tp1`, `TP1`, `T-P1` | `tp` |
| `수질대장균1`, `총대장균군1` | `total_coliform` |
| `수질ph1`, `PH1` | 현재 로컬 스키마에 없음. 빈 값 유지 또는 BigQuery 스키마 추가 필요 |
| `수질cod1`, `COD1` | 현재 로컬 스키마에 없음. 빈 값 유지 또는 BigQuery 스키마 추가 필요 |
| `수질비고1`, `비고1` | `drive_file_name` 또는 `source_pdf_name` 참고 가능 |

2행 양식 대응을 위해 최근 2건까지 `1`, `2` suffix로 넣는다.

### 3. PH/COD 처리 결정 필요

현재 로컬 `water_quality` 스키마에는 `ph`, `cod` 칼럼이 없다.

선택지:

1. 성적서 파싱 대상에 PH/COD가 실제로 있으면 BigQuery와 로컬 `water_quality`에 `ph`, `cod` 칼럼을 추가한다.
2. 성적서 파싱 대상이 BOD, SS, T-N, T-P, 총대장균군, MLSS 중심이면 PH/COD는 빈 값으로 둔다.

사용자 확인 전까지는 스키마 추가 없이 빈 값 유지가 안전하다.

### 4. 성적서 메뉴와 분리 유지

성적서 메뉴는 계속 Drive-only로 유지한다.

- 목록 조회: Drive
- 선택 파일 다운로드/병합: Drive
- DB/BigQuery 조회 없음

성적서 파싱 수질값은 업무일지 작성 시 로컬 `water_quality`만 조회한다.

### 5. 검증 항목

- 로그인 후 `water_quality` 로컬 캐시가 최신 2개월치로 내려오는지 확인
- 업무일지 날짜 기준 가장 가까운 성적서 데이터가 표에 들어가는지 확인
- 셀 이름 정규화 때문에 `BOD1`, `수질bod1`, `T-N1` 같은 후보가 모두 잡히는지 확인
- PH/COD가 없을 때 빈 값으로 유지되는지 확인
- `npm run validate`
- `npm run build`

## 작업 우선순위

1. `dailyWorkLogService.cjs`에 `getCertificateWaterQualityRows()` 추가
2. `buildBindingsForDate()` 수질 빈 값 초기화 구간을 성적서 데이터 바인딩으로 교체
3. 실제 일지양식 named cell 이름 목록 확인
4. PH/COD 스키마 추가 여부 결정
5. 검증 실행
