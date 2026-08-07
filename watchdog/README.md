# Osoo Handle App Watchdog

## 운영 계약

`OsooWatchdog.exe`는 현재 로그인한 Windows 사용자 세션에서 Osoo Handle App의 실행 상태와 내장 서버 포트(18731)를 함께 감시합니다. 데이터베이스나 Google 서비스에는 직접 접근하지 않습니다.

- 앱이 없으면 백그라운드로 다시 시작합니다.
- 앱은 살아 있지만 서버 포트가 계속 준비되지 않으면, 앱이 남기는 준비 하트비트를 기준으로 최대 2분의 시작 유예를 둔 뒤 앱을 재시작합니다.
- 포트 실패는 3회 연속일 때만 복구를 시도하며, 10분 내 3회 재시작 후에는 30분 쿨다운으로 무한 재시작을 막습니다.
- `maintenance.json`의 `update`, `full-exit`, `installer`, `maintenance` 잠금이 유효한 동안에는 어떤 재기동도 하지 않습니다.
- 앱이 서버 준비를 마치면 이전 `full-exit` 잠금은 해제되어 감시 보호가 다시 활성화됩니다.

`OsooWatchdog.exe`는 현재 로그인한 Windows 사용자 세션에서 Osoo Handle App의 생존 여부만 감시합니다. 데이터베이스나 Google 서비스에는 접근하지 않습니다.

## 빌드

```powershell
powershell -ExecutionPolicy Bypass -File .\watchdog\build-watchdog.ps1
```

산출물: `watchdog\dist\OsooWatchdog.exe`

대상 런타임은 .NET Framework 4.x이며 Windows 7 SP1, Windows 10, Windows 11에서 사용할 수 있도록 최신 Windows 전용 API를 사용하지 않습니다. 실제 Windows 7 장비 검증 전에는 운영 설치판에 포함하지 않습니다.

## 안전 검증

다음 명령은 앱을 실제로 실행하지 않고 재기동 판단 결과만 임시 폴더에 기록합니다.

```powershell
.\watchdog\dist\OsooWatchdog.exe --once --dry-run --simulate-process-absent --app "C:\Program Files\Osoo Handle App\Osoo Handle App.exe" --runtime "$env:TEMP\osoo-watchdog-test"
```

운영 시 상태 파일은 `%APPDATA%\Osoo_Handle_App\runtime`에 기록됩니다. `maintenance.json` 잠금이 유효하면 앱을 재시작하지 않습니다.
