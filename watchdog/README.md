# Osoo Handle App Watchdog

## 운영 계약

`OsooWatchdog.exe`는 현재 로그인한 Windows 사용자 세션에서 Osoo Handle App의 실행 상태와 내장 서버 포트(18731)를 함께 감시합니다. 데이터베이스나 Google 서비스에는 직접 접근하지 않습니다.

- 앱이 없으면 백그라운드로 다시 시작합니다.
- 앱은 살아 있지만 서버 포트가 계속 준비되지 않으면, 앱이 남기는 준비 하트비트를 기준으로 최대 2분의 시작 유예를 둔 뒤 앱을 재시작합니다.
- 포트 실패는 3회 연속일 때만 복구를 시도하며, 10분 내 3회 재시작 후에는 30분 쿨다운으로 무한 재시작을 막습니다.
- `maintenance.json`의 `update`, `full-exit`, `installer`, `maintenance` 잠금이 유효한 동안에는 어떤 재기동도 하지 않습니다.
- 1.0.5부터 `update` 잠금 동안에만 Windows `Consent.exe`(UAC 보안 데스크톱)가 관찰됐는지 기록하고, 다음 앱 재기동 때 설치 전후 앱 파일 버전을 함께 남깁니다. 이는 일회성 환경 진단이며 UAC 창을 조작하거나 자동 승인하지 않습니다. `uacPromptObserved=false`는 감시 주기 안에 관찰되지 않았다는 뜻일 뿐, UAC가 절대 표시되지 않았다는 단정은 아닙니다.
- 앱이 서버 준비를 마치면 이전 `full-exit` 잠금은 해제되어 감시 보호가 다시 활성화됩니다.
- 1.0.5부터 재시작 결정 시 재시작 주체·트리거, 관찰된 앱 PID/시작 시각, 마지막 앱 하트비트, 18731 포트 도달 여부, 재시작 창 횟수와 새로 시작한 PID를 함께 기록합니다. 비밀번호·토큰·업무 데이터는 기록하지 않습니다.

1.0.9부터 원격접속 진단 신호도 구조화된 관측 이벤트로 로컬에 보존합니다. 감시 대상은 **RustDesk와 Chrome Remote Desktop만**이며 TeamViewer, AnyDesk, Windows RDP 등은 판정하지 않습니다. 로그인 차단은 이 버전에서 수행하지 않습니다.

- RustDesk는 실제 원격 세션 창의 표시 여부로 판정하며, 단순 실행/트레이 상주만으로 원격 접속이라 하지 않습니다.
- Chrome Remote Desktop은 Windows Application 로그의 `chromoting` 연결/해제 이벤트로 판정합니다. 이벤트 메시지의 이메일·계정·IP는 로그에 복사하지 않습니다.
- `%APPDATA%\Osoo_Handle_App\runtime\remote-session-state.json`을 기본 5초 간격으로 갱신합니다. 판정 변경 시와 동일 판정의 5분 주기마다 `remote-session-observations.jsonl`에 관측 ID, 지원 도구별 상태·비식별 근거, RustDesk 프로세스/세션 창 유무, Chrome 연결 이벤트 ID·시각을 기록합니다. 키 입력, 마우스 좌표, 창 제목, 원격 사용자 식별자는 수집하지 않습니다.
- 앱은 이 JSONL을 로컬 대기열로 보존하고 BigQuery 유휴 동기화 주기(활동 후 30분)에 `daily_log_system.remote_session_observations`로 업서트합니다. 성공한 파일 오프셋은 runtime cursor에 기록되어 실패 시 재시도하고 중복 관측 ID는 BigQuery `MERGE`로 제거합니다.
- 현재는 감지 신호를 기록만 하며 로그인 제출·세션 복원·로그아웃을 차단하지 않습니다. 향후 차단 기준을 재검토할 때 이 관측 자료를 사용합니다.
- 상태 파일이 없거나 15초보다 오래됐거나 읽을 수 없으면 런처 신호는 `unknown`으로 기록합니다. 앱은 이를 원격 차단으로 간주하지 않아 현장 사용자를 잠그지 않습니다.

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

운영 시 상태 파일은 `%APPDATA%\Osoo_Handle_App\runtime`에 기록됩니다. `maintenance.json` 잠금이 유효하면 앱을 재시작하지 않습니다. Watchdog 1.0.9의 원격 상태 갱신은 정비 잠금이나 앱 재기동 경로와 독립적으로 매 검사 주기에 수행됩니다.
