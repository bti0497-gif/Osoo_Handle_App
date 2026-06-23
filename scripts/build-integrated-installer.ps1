param(
    [Parameter(Mandatory = $false)]
    [string]$AppVersion = '1.0.2',

    [Parameter(Mandatory = $false)]
    [string]$OutputDir = ''
)

$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $OutputDir) {
    $OutputDir = Join-Path $projectRoot 'release\integrated-deployment'
}
$outputRoot = [System.IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

$appInstallerCandidates = @(
    (Join-Path $projectRoot "release\deployment-package\Osoo Handle App Setup $AppVersion.exe"),
    (Join-Path $projectRoot "release\Osoo Handle App Setup $AppVersion.exe")
)
$appInstaller = $appInstallerCandidates |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1
if (-not $appInstaller) {
    throw "앱 설치파일을 찾을 수 없습니다: Osoo Handle App Setup $AppVersion.exe"
}

$requiredFiles = @{
    ENV_FILE = Join-Path $projectRoot '.env.local'
    GOOGLE_KEY_FILE = Join-Path $projectRoot 'server\config\google-key.json'
    BIGQUERY_KEY_FILE = Join-Path $projectRoot 'server\config\work-jindan-194620a46d59.json'
    FIREBASE_KEY_FILE = Join-Path $projectRoot 'server\config\firebase-service-account.json'
    INSTALLER_ICON = Join-Path $projectRoot 'public\icon.ico'
}

foreach ($entry in $requiredFiles.GetEnumerator()) {
    if (-not (Test-Path -LiteralPath $entry.Value -PathType Leaf)) {
        throw "통합 설치파일에 필요한 파일이 없습니다: $($entry.Value)"
    }
}

$oauthFile = Get-ChildItem -LiteralPath $projectRoot -File -Filter 'client_secret_*.json' |
    Select-Object -First 1
if (-not $oauthFile) {
    throw 'Google OAuth client_secret_*.json 파일을 찾을 수 없습니다.'
}

$makensisCandidates = @(
    (Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\nsis\nsis-3.0.4.1-nsis-3.0.4.1\Bin\makensis.exe'),
    'C:\Program Files (x86)\NSIS\makensis.exe',
    'C:\Program Files\NSIS\makensis.exe'
)
$makensis = $makensisCandidates |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1
if (-not $makensis) {
    throw 'NSIS makensis.exe를 찾을 수 없습니다. electron-builder를 먼저 실행하세요.'
}

$outputFile = Join-Path $outputRoot "Osoo Handle App Integrated Setup $AppVersion.exe"
$nsiScript = Join-Path $PSScriptRoot 'integrated-installer.nsi'

$defines = @(
    "/DAPP_VERSION=$AppVersion",
    "/DOUTPUT_FILE=$outputFile",
    "/DAPP_INSTALLER=$appInstaller",
    "/DOAUTH_FILE=$($oauthFile.FullName)",
    "/DOAUTH_TARGET_NAME=$($oauthFile.Name)"
)
foreach ($entry in $requiredFiles.GetEnumerator()) {
    $defines += "/D$($entry.Key)=$($entry.Value)"
}

Write-Host "Building integrated installer: $outputFile"
& $makensis @defines $nsiScript
if ($LASTEXITCODE -ne 0) {
    throw "NSIS 통합 설치파일 생성에 실패했습니다. 종료 코드: $LASTEXITCODE"
}

if (-not (Test-Path -LiteralPath $outputFile -PathType Leaf)) {
    throw "통합 설치파일이 생성되지 않았습니다: $outputFile"
}

$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $outputFile
Write-Host "Integrated installer created: $outputFile"
Write-Host "Size: $((Get-Item -LiteralPath $outputFile).Length) bytes"
Write-Host "SHA256: $($hash.Hash)"
