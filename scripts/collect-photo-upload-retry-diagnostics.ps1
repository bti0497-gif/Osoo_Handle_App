<#
  사진 업로드 재시도 진단 수집기 (읽기 전용)

  사용법
    powershell -ExecutionPolicy Bypass -File .\collect-photo-upload-retry-diagnostics.ps1 -OutputRoot "$env:USERPROFILE\Desktop"

  시작 후 사진 한 장을 선택하고, 저장 또는 업로드가 끝난 뒤 Enter를 누릅니다.
  앱/서버/DB/사진 원본을 변경하거나 앱을 종료하지 않습니다.
#>

[CmdletBinding()]
param(
    [string]$OutputRoot = [Environment]::GetFolderPath("Desktop")
)

$ErrorActionPreference = 'Continue'
$startedAt = Get-Date
$stamp = $startedAt.ToString('yyyyMMdd-HHmmss')

if (-not (Test-Path -LiteralPath $OutputRoot)) {
    $OutputRoot = $env:TEMP
}
$bundleDir = Join-Path $OutputRoot "Osoo-Photo-Retry-Diagnostics-$stamp"
New-Item -ItemType Directory -Path $bundleDir -Force | Out-Null

function Write-Json {
    param([string]$Name, [object]$Value)
    $Value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $bundleDir $Name) -Encoding UTF8
}

function Get-PhotoFiles {
    param([string]$Root)
    if (-not (Test-Path -LiteralPath $Root)) { return @() }
    @(Get-ChildItem -LiteralPath $Root -File -Recurse -ErrorAction SilentlyContinue |
        Select-Object FullName, Length, LastWriteTimeUtc)
}

function Get-LogLinesSinceStart {
    param([string]$DiagnosticRoot, [datetime]$Since)
    if (-not (Test-Path -LiteralPath $DiagnosticRoot)) { return @() }
    $patterns = "upload-photo|sludge-photos|medicine-in|photo|error|fail"
    $sinceStamp = $Since.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm")
    @(Get-ChildItem -LiteralPath $DiagnosticRoot -File -Filter '*_diagnostics.jsonl' -ErrorAction SilentlyContinue |
        ForEach-Object {
            Get-Content -LiteralPath $_.FullName -Tail 3000 -ErrorAction SilentlyContinue |
                Where-Object {
                    $line = $_
                    $matchesPattern = $patterns | Where-Object { $line -match $_ }
                    $matchesPattern -and $line -match $sinceStamp
                }
        })
}

$appData = Join-Path $env:APPDATA "Osoo_Handle_App"
$photoFolderName = -join @([char]0xC0AC, [char]0xC9C4, [char]0xAD00, [char]0xB9AC)
$photoRoot = Join-Path $appData $photoFolderName
$diagnosticRoot = Join-Path $appData "logs\diagnostics"
$beforeFiles = Get-PhotoFiles $photoRoot
$beforeIndex = @{}
foreach ($file in $beforeFiles) { $beforeIndex[$file.FullName] = "$($file.Length)|$($file.LastWriteTimeUtc)" }

Write-Host ""
Write-Host "Photo-upload diagnostic collection has started." -ForegroundColor Yellow
Write-Host "Select one problem photo and complete its actual save/upload attempt." -ForegroundColor Yellow
Write-Host "After the success or failure message, return here and press Enter." -ForegroundColor Yellow
[void](Read-Host "Press Enter after the retry")

$completedAt = Get-Date
$afterFiles = Get-PhotoFiles $photoRoot
$changedFiles = @($afterFiles | Where-Object {
    -not $beforeIndex.ContainsKey($_.FullName) -or $beforeIndex[$_.FullName] -ne "$($_.Length)|$($_.LastWriteTimeUtc)"
})

$recentFiles = @($afterFiles | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 30)
$diagnosticLines = Get-LogLinesSinceStart $diagnosticRoot $startedAt
$photoApiLines = @($diagnosticLines | Where-Object { $_ -match '/api/(sludge-photos|medicine-in)/upload-photo' })

$ports = @(Get-NetTCPConnection -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in 18731,18732,18733,18734 -or $_.RemotePort -in 18731,18732,18733,18734 } |
    Select-Object State, LocalAddress, LocalPort, RemoteAddress, RemotePort, OwningProcess)

$ping = $null
foreach ($port in 18731..18734) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/api/ping" -TimeoutSec 2
        $ping = [ordered]@{ port = $port; status = $response.StatusCode; success = $true }
        break
    } catch { }
}
if (-not $ping) { $ping = [ordered]@{ success = $false } }

$report = [ordered]@{
    startedAt = $startedAt.ToString('o')
    completedAt = $completedAt.ToString('o')
    appData = $appData
    photoRoot = $photoRoot
    serverPing = $ping
    changedPhotoFiles = $changedFiles
    recentPhotoFiles = $recentFiles
    photoApiDiagnostics = $photoApiLines
    allRelevantDiagnostics = $diagnosticLines
    portConnections = $ports
}
Write-Json "photo-retry-report.json" $report

Compress-Archive -LiteralPath (Join-Path $bundleDir "*") -DestinationPath "$bundleDir.zip" -Force
Write-Host ""
Write-Host "Completed: $bundleDir.zip" -ForegroundColor Green
Write-Host "Send the ZIP file or photo-retry-report.json content." -ForegroundColor Green
