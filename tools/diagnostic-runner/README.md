# 업무 시나리오 진단 러너

긴급 패치 이후 기능 회귀와 UI/CSS 회귀를 빠르게 발견하기 위한 개발·검증 전용 도구다.
계약 전문은 루트 `docs/DIAGNOSTIC_RUNNER_DEVELOPMENT_PLAN.md` 를 따른다.

> **이 디렉터리는 절대 배포하지 않는다.** 루트 `electron-builder.config.cjs`의
> `files` 화이트리스트에 없으므로 패키징되지 않으며, `scripts/` 아래에 파일을 만들지 않는다.
> 릴리즈 전에는 `node leak-check.cjs` 로 누출 여부를 수동 검사한다.

## 현재 구현 범위

| Phase | 내용 | 상태 |
|---|---|---|
| 0 | 배포 누출 방지 검사(`leak-check.cjs`), `.gitignore` 계약 | 구현 |
| 1 | 임시 작업 공간, 격리 환경, 서버 spawn/readiness/수명 관리, ABI 프리플라이트 | 구현 |
| 2 | 외부 호출 차단 guard(`NODE_OPTIONS=--require`), fixture 직접 seed | 구현 |
| 3 | health / auth / dailylog / recovery 시나리오 | 구현 |
| 4 | Playwright UI·레이아웃 회귀 | 미구현 |
| 5 | `--changed` 선택 실행 | 미구현 |
| - | `fixture` 모드 mock 주입, `smoke` 모드 | 별도 승인 대상(§2.4) |

## 사용법

```powershell
node tools/diagnostic-runner/runner.cjs --scenario health
node tools/diagnostic-runner/runner.cjs --scenario all
node tools/diagnostic-runner/runner.cjs --scenario all --keep-artifacts
node tools/diagnostic-runner/runner.cjs --list

# 배포 누출 검사(수동)
node tools/diagnostic-runner/leak-check.cjs
node tools/diagnostic-runner/leak-check.cjs --asar release/win-unpacked/resources/app.asar
node tools/diagnostic-runner/leak-check.cjs --win-unpacked release/win-unpacked
```

- 실패 실행은 `tmp/diagnostics/run-<id>/` 에 서버 로그, guard 로그, 임시 DB가 보존된다.
- 성공 실행은 기본적으로 정리되며 `result.json`만 남는다.
- `result.json`의 `runtime` 블록에는 Node/ABI 정보가 기록된다(ABI 불일치 원인 추적용).

## 격리 계약

- `OSOO_APP_DATA_PATH`, `APPDATA`, `LOCALAPPDATA`, `TEMP` 모두 run 디렉터리로 격리되며
  `%APPDATA%\Osoo_Handle_App` 운영 경로는 절대 읽거나 쓰지 않는다.
- 환경변수는 허용목록 방식으로만 전달되어 Google/Firebase/BigQuery credential 변수가
  자식 프로세스에 유입되지 않는다.
- `OSOO_PACKAGED=1` 로 프로젝트 루트 credential fallback(`.env.local`, `client_secret_*.json`)
  을 차단하고, `NODE_OPTIONS` guard 가 loopback 외 네트워크 호출을 기록·차단한다.
- 포트는 `OSOO_API_PORT_MIN` 방식(일반 Node 방식, `validate-release --api-test`와 동일)을 쓴다.
- better-sqlite3 ABI가 Node와 맞지 않으면 시나리오 전에 명확히 실패한다.
  (`electron:build` 직후라면 `npm rebuild better-sqlite3` 후 재실행)

## 인코딩 규칙

이 도구의 모든 파일은 UTF-8(BOM 없음)로만 저장한다. Windows 콘솔 출력의 한글 깨짐은
CP949 표시 문제일 수 있으므로, 파일 판정은 `npm run validate` 결과를 따른다.
