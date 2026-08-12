<#
  현장 워크스페이스 오류 수집기 (읽기 전용)

  사용법
    powershell -ExecutionPolicy Bypass -File .\collect-field-workspace-diagnostics.ps1

  앱을 종료/재시작하거나 설정·DB를 변경하지 않습니다.
  시작 후 앱에서 오류를 재현하고, 이 창으로 돌아와 Enter를 누르면
  바탕 화면에 ZIP 파일 하나가 생성됩니다.
#>

[CmdletBinding()]
param(
    [string]$OutputRoot = [Environment]::GetFolderPath('Desktop'),
    [int]$SampleSeconds = 3
)

$ErrorActionPreference = 'Continue'
$requestedOutputRoot = $OutputRoot
if (-not (Test-Path -LiteralPath $OutputRoot)) {
    $oneDriveDesktop = if ($env:OneDrive) { Join-Path $env:OneDrive 'Desktop' } else { $null }
    if ($oneDriveDesktop -and (Test-Path -LiteralPath $oneDriveDesktop)) {
        $OutputRoot = $oneDriveDesktop
    } else {
        $OutputRoot = $env:TEMP
    }
}
$startedAt = Get-Date
$stamp = $startedAt.ToString('yyyyMMdd-HHmmss')
$bundleDir = Join-Path $OutputRoot "Osoo-Workspace-Diagnostics-$stamp"
$zipPath = "$bundleDir.zip"
New-Item -ItemType Directory -Path $bundleDir -Force | Out-Null

function Write-TextFile {
    param([string]$Name, [object]$Value)
    $Value | Out-File -LiteralPath (Join-Path $bundleDir $Name) -Encoding utf8 -Width 240
}

function Get-AppProcesses {
    Get-CimInstance Win32_Process | Where-Object {
        $_.Name -in @('Osoo Handle App.exe', 'OsooWatchdog.exe', 'node.exe') -or
        $_.CommandLine -match 'Osoo_Handle_App|server\.cjs|start\.cjs'
    } | Select-Object Name, ProcessId, ParentProcessId, CreationDate, ExecutablePath, CommandLine
}

function Copy-IfExists {
    param([string]$Source, [string]$Name)
    if (Test-Path -LiteralPath $Source) {
        Copy-Item -LiteralPath $Source -Destination (Join-Path $bundleDir $Name) -Force -ErrorAction SilentlyContinue
    }
}

$appData = Join-Path $env:APPDATA 'Osoo_Handle_App'
$legacyAppData = Join-Path $env:APPDATA 'wastewater-treatment-plant'
$runtimeLog = Join-Path $appData 'runtime\electron-recovery-events.jsonl'
$updaterLog = Join-Path $appData 'logs\electron-updater.log'
$serverLogDir = Join-Path $appData 'logs'
$diagnosticLogDir = Join-Path $serverLogDir 'diagnostics'

Write-TextFile 'readme.txt' @"
시작: $($startedAt.ToString('o'))
요청 저장 위치: $requestedOutputRoot
실제 저장 위치: $OutputRoot
목적: 워크스페이스 렌더링 오류 재현 중의 상태 수집
수집 범위: 프로세스, localhost 서버 응답, 앱/서버/복구 로그, Windows Application 오류 이벤트
수집하지 않음: 비밀번호, 토큰, 로컬 DB 원본, 사용자 사진
"@
Write-TextFile 'system.txt' (Get-ComputerInfo | Select-Object WindowsProductName, WindowsVersion, OsBuildNumber, CsName, CsSystemType)
Write-TextFile 'powershell.txt' $PSVersionTable
Write-TextFile 'processes-at-start.txt' (Get-AppProcesses)
Write-TextFile 'ports-at-start.txt' (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -in 18731,18732,18733,18734 | Select-Object LocalAddress, LocalPort, OwningProcess)

$samplesPath = Join-Path $bundleDir 'runtime-samples.jsonl'
$job = Start-Job -ArgumentList $samplesPath, $SampleSeconds -ScriptBlock {
    param($samplesPath, $sampleSeconds)
    while ($true) {
        $now = Get-Date
        $processes = Get-Process -ErrorAction SilentlyContinue | Where-Object {
            $_.ProcessName -in @('Osoo Handle App', 'OsooWatchdog', 'node')
        } | ForEach-Object {
            [ordered]@{
                name = $_.ProcessName
                id = $_.Id
                responding = $_.Responding
                cpu = $_.CPU
                workingSet = $_.WorkingSet64
                privateMemory = $_.PrivateMemorySize64
                startTime = try { $_.StartTime.ToString('o') } catch { $null }
            }
        }
        $health = @()
        foreach ($port in 18731..18734) {
            try {
                $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/api/ping" -TimeoutSec 2
                $health += [ordered]@{ port = $port; statusCode = $response.StatusCode; body = $response.Content.Substring(0, [Math]::Min(240, $response.Content.Length)) }
            } catch {
                $health += [ordered]@{ port = $port; error = $_.Exception.Message }
            }
        }
        [ordered]@{ timestamp = $now.ToString('o'); processes = @($processes); serverHealth = @($health) } |
            ConvertTo-Json -Depth 6 -Compress | Add-Content -LiteralPath $samplesPath -Encoding utf8
        Start-Sleep -Seconds $sampleSeconds
    }
}

Write-Host ''
Write-Host '수집을 시작했습니다. 이제 앱에서 여러 메뉴를 이동하며 화면 오류를 재현해 주세요.' -ForegroundColor Yellow
Write-Host '앱은 종료하지 마십시오. 재현 후 이 창에서 Enter를 누르면 ZIP 파일을 만듭니다.' -ForegroundColor Yellow
[void](Read-Host '재현이 끝났으면 Enter')

Stop-Job -Job $job -ErrorAction SilentlyContinue
Receive-Job -Job $job -ErrorAction SilentlyContinue | Out-Null
Remove-Job -Job $job -Force -ErrorAction SilentlyContinue

Write-TextFile 'processes-at-end.txt' (Get-AppProcesses)
Write-TextFile 'ports-at-end.txt' (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -in 18731,18732,18733,18734 | Select-Object LocalAddress, LocalPort, OwningProcess)

# 로그는 복사본만 수집한다. 오류 직전/직후의 최신 로그가 우선이다.
Copy-IfExists $runtimeLog 'electron-recovery-events.jsonl'
Copy-IfExists $updaterLog 'electron-updater.log'
if (Test-Path -LiteralPath $serverLogDir) {
    Get-ChildItem -LiteralPath $serverLogDir -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 20 |
        ForEach-Object { Copy-IfExists $_.FullName ("server-log_" + $_.Name) }
}
if (Test-Path -LiteralPath $diagnosticLogDir) {
    Get-ChildItem -LiteralPath $diagnosticLogDir -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 12 |
        ForEach-Object { Copy-IfExists $_.FullName ("diagnostic_" + $_.Name) }
}

$events = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $startedAt } -ErrorAction SilentlyContinue |
    Where-Object { $_.LevelDisplayName -in @('Error', 'Warning') } |
    Select-Object TimeCreated, ProviderName, Id, LevelDisplayName, Message
Write-TextFile 'windows-application-events.txt' $events

Compress-Archive -LiteralPath $bundleDir\* -DestinationPath $zipPath -Force
Write-Host ''
Write-Host "완료: $zipPath" -ForegroundColor Green
Write-Host '이 ZIP 파일을 이 대화에 첨부하거나, 내부 파일 내용을 복사해 주세요.' -ForegroundColor Green
