# Drive 진단로그 수집 및 분석

`앱진단로그/YYYY/MM` 폴더의 JSONL 파일을 내려받아 중앙관리자 PC 전용 SQLite DB에 적재하고, 해당 월의 현장·버전·기능·결과별 집계와 오류 사례를 JSON 보고서로 만듭니다. 앱 공용 DB나 서버 테이블은 변경하지 않습니다. 이 도구는 `tools/diagnostic-archive/`에 분리되어 있으며 electron-builder의 앱 파일 목록과 `extraResources` 대상에 포함되지 않습니다.

## 실행

프로젝트 루트에서 실행합니다.

```powershell
node tools/diagnostic-archive/import-drive-diagnostics.cjs --year 2026 --month 10
```

연도와 월을 생략하면 현재 연도와 월을 사용합니다. 현장 필터를 생략하면 해당 월의 모든 현장 진단로그를 처리합니다.

## 저장 및 삭제 동작

- 분석에 필요한 이벤트 필드와 상세값은 `%APPDATA%\Osoo_Handle_App\diagnostic-analysis\diagnostics.db`의 `drive_diagnostic_events` 테이블에 저장됩니다. 원본 전체 보관을 목적으로 하지는 않습니다.
- 월별 분석 JSON은 `%APPDATA%\Osoo_Handle_App\diagnostic-analysis\YYYY\MM\`에 저장됩니다.
- DB 저장 트랜잭션과 JSON 보고서 작성이 성공한 다음에만 처리한 Drive 파일을 삭제합니다.
- Drive 파일 삭제에 실패하면 오류를 반환합니다. 저장은 이미 완료된 상태이므로 다시 실행하면 중복 적재를 피하고 남은 파일 삭제를 재시도합니다.
- 기본 동작은 처리한 원본 파일 삭제입니다. 보존하려면 `--keep-drive-files`를 지정합니다.
- 처리 범위가 실수로 넓어지지 않도록 알 수 없는 옵션이나 값 누락은 오류로 중단합니다.
- 이 DB는 버전 수정 분석용 작업공간입니다. 릴리즈 후 정리가 필요하면 아래 명령을 실행합니다. 두 확인 옵션이 모두 있어야 로컬 DB 행만 지우며, Drive 원본과 월별 JSON 보고서는 건드리지 않습니다.

```powershell
node tools/diagnostic-archive/import-drive-diagnostics.cjs --clear-local-archive --confirm-clear-local-archive
```

## 옵션

```powershell
# 현장명이 파일명에 포함된 로그만 처리
node tools/diagnostic-archive/import-drive-diagnostics.cjs --year 2026 --month 10 --site 천등산

# Drive 원본을 보존하고 DB/JSON만 갱신
node tools/diagnostic-archive/import-drive-diagnostics.cjs --year 2026 --month 10 --keep-drive-files

# 보고서에 포함할 오류 사례 수 지정
node tools/diagnostic-archive/import-drive-diagnostics.cjs --year 2026 --month 10 --limit-issues 200

# 파일 목록만 확인하고 내려받거나 저장/삭제하지 않음
node tools/diagnostic-archive/import-drive-diagnostics.cjs --year 2026 --month 10 --list-only

# 내려받은 JSONL 원본도 지정한 로컬 폴더에 저장
node tools/diagnostic-archive/import-drive-diagnostics.cjs --year 2026 --month 10 --download-dir .\diagnostic-downloads
```

보고서에는 이번 실행에서 선택한 파일과 새로 적재한 행 수, 해당 월에 누적된 집계(`bySite`, `byVersion`, `byFeature`, `byResult`), 오류 사례가 포함됩니다. 잘못된 JSONL 행도 `parse-error` 레코드로 보존하고 오류 사례에 표시합니다.

Drive 인증 정보와 `GOOGLE_DRIVE_FOLDER_ID`는 앱과 동일한 런타임 설정을 사용합니다. 인증이 없거나 지정한 연/월 폴더를 찾지 못하면 스크립트가 오류로 종료되며 원본은 삭제하지 않습니다.
