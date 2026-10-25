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

## 트레이 자동 수집기

### 1.1.0 독립 실행환경

수집기는 앱 프로젝트의 `better-sqlite3`를 사용하지 않습니다. 기존 `diagnostics.db`와 보고서는 유지하며, 전용 Node 실행파일과 SQLite 모듈을 `%APPDATA%\Osoo_Handle_App\diagnostic-analysis\collector-runtime\node-<Node버전>\`에 보관합니다. 앱을 Electron ABI로 빌드해도 이 모듈은 바뀌지 않습니다. `node-path.txt`가 지정하는 전용 Node가 트레이 설정의 과거 NodePath보다 우선합니다. 수집 스크립트·Drive 비네이티브 연동 코드는 기존 프로젝트에서 재사용하므로 저장소 이동 시 ProjectRoot는 계속 유효해야 합니다.

수집기만 빌드할 때는 다음 명령을 사용합니다. 프로젝트 루트의 npm rebuild나 현장 앱 릴리즈러너를 실행하지 않습니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/diagnostic-archive/launcher/build-collector.ps1
```

새 실행파일은 `launcher/publish-next/`에 생성됩니다. 실행 중인 기존 수집기의 작업이 끝난 뒤 종료하고 기존 `publish/`에 교체합니다. 기존 로그인 자동시작·09시 예약 경로와 09:00~18:45 수집·19시 종료 정책은 유지합니다. 수동 스크립트 실행도 `node-path.txt`의 전용 Node로 실행해야 합니다. 데이터 적재·보고서 저장 이후에만 Drive 원본을 정리하는 조건은 변경하지 않았습니다.

중앙관리자 PC에서만 사용하는 별도 Windows 트레이 앱입니다. 앱 본체의 Electron 설정·패키지에는 포함하지 않습니다. Node.js와 이 저장소의 수집 스크립트를 호출하며, AI 서비스는 호출하지 않습니다.

- Windows 사용자 로그인 시 및 매일 오전 9시에 자동 시작합니다. 작업 스케줄러의 `Osoo Diagnostic Archive Daily`는 놓친 시작을 재실행하며, 현재 사용자 로그인 상태에서만 트레이를 실행합니다. PC 절전 해제나 비밀번호 저장은 하지 않습니다. 트레이 메뉴에서 자동 시작을 끄면 로그인 등록과 일일 예약을 함께 해제합니다.
- 한국시간 오전 9시부터 오후 6시 45분까지 15분 간격으로 확인합니다. 18:45가 마지막 수집 시작 시각이며, 그 뒤에는 새 조회를 시작하지 않고 오후 7시에 종료합니다. 오전 9시 전에는 대기합니다.
- 새 로그가 없으면 DB를 열거나 빈 보고서를 만들지 않고 조용히 다음 주기를 기다립니다.
- 로그가 있으면 기존 안전 순서대로 로컬 DB와 JSON 보고서를 저장한 후에만 Drive 원본 삭제를 시도합니다.
- 실행 결과와 오류만 간단히 `%APPDATA%\Osoo_Handle_App\diagnostic-analysis\launcher.log`에 남깁니다. 사진/로그 원문이나 자격증명은 런처 로그에 기록하지 않습니다.
- 설정은 `%APPDATA%\Osoo_Handle_App\diagnostic-analysis\tray-settings.json`에 저장됩니다. 실행 파일을 저장소 밖으로 옮긴 경우 `ProjectRoot`와 `NodePath`를 지정할 수 있습니다.

빌드(저장소 루트에서):

```powershell
dotnet publish tools/diagnostic-archive/launcher/OsooDiagnosticTray.csproj `
  -c Release -r win-x64 --self-contained false `
  -p:PublishSingleFile=true `
  -o tools/diagnostic-archive/launcher/publish
```

이 중앙관리자 PC에 설치된 .NET 8 Desktop Runtime을 사용하므로 자체 런타임을 중복 포함하지 않습니다. 빌드 산출물은 Git 및 현장관리자 앱 패키지에서 제외됩니다. 시간표 로직은 아래 명령으로 Drive에 접속하지 않고 자체 점검할 수 있습니다.

```powershell
tools/diagnostic-archive/launcher/publish/OsooDiagnosticTray.exe --self-test
```
