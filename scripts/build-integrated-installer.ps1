param(
    [Parameter(Mandatory = $false)]
    [string]$AppVersion = '1.0.8',

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

$requiredFiles = @{
    '.env.local' = Join-Path $projectRoot '.env.local'
    'google-key.json' = Join-Path $projectRoot 'server\config\google-key.json'
    'bigquery-service-account.json' = Join-Path $projectRoot 'server\config\work-jindan-194620a46d59.json'
    'firebase-service-account.json' = Join-Path $projectRoot 'server\config\firebase-service-account.json'
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
$requiredFiles[$oauthFile.Name] = $oauthFile.FullName

$packageJson = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') |
    ConvertFrom-Json
if ($packageJson.version -ne $AppVersion) {
    throw "package.json 버전($($packageJson.version))과 요청 버전($AppVersion)이 다릅니다."
}

$buildRoot = Join-Path $outputRoot '.integrated-build'
$includeFile = Join-Path $buildRoot 'installer-credentials.nsh'
$configFile = Join-Path $buildRoot 'electron-builder.integrated.cjs'
$outputFile = Join-Path $outputRoot "Osoo Handle App Integrated Setup $AppVersion.exe"

function ConvertTo-JsSingleQuotedString([string]$Value) {
    return $Value.Replace('\', '\\').Replace("'", "\'")
}

function ConvertTo-NsisSourcePath([string]$Value) {
    return $Value.Replace('$', '$$').Replace('"', '$\"')
}

if (Test-Path -LiteralPath $buildRoot) {
    Remove-Item -LiteralPath $buildRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null

$includeLines = @(
    '!macro customInstall'
    '  SetShellVarContext current'
    '  DetailPrint "Installing shared service configuration."'
    '  CreateDirectory "$APPDATA\Osoo_Handle_App\config"'
    '  CreateDirectory "$APPDATA\wastewater-treatment-plant\config"'
    '  SetOutPath "$APPDATA\Osoo_Handle_App\config"'
)
foreach ($entry in $requiredFiles.GetEnumerator() | Sort-Object Key) {
    $sourcePath = ConvertTo-NsisSourcePath $entry.Value
    $includeLines += "  File /oname=$($entry.Key) `"$sourcePath`""
}
$includeLines += '  SetOutPath "$APPDATA\wastewater-treatment-plant\config"'
foreach ($entry in $requiredFiles.GetEnumerator() | Sort-Object Key) {
    $sourcePath = ConvertTo-NsisSourcePath $entry.Value
    $includeLines += "  File /oname=$($entry.Key) `"$sourcePath`""
}
$includeLines += '  DetailPrint "Verifying shared service configuration."'
foreach ($entry in $requiredFiles.GetEnumerator() | Sort-Object Key) {
    $includeLines += "  IfFileExists `"`$APPDATA\Osoo_Handle_App\config\$($entry.Key)`" +2 0"
    $includeLines += "    Abort `"Failed to install required configuration: $($entry.Key)`""
}
$includeLines += @(
    '  DetailPrint "Shared service configuration installed."'
    '!macroend'
)
Set-Content -LiteralPath $includeFile -Value $includeLines -Encoding utf8

$baseConfigPath = ConvertTo-JsSingleQuotedString (Join-Path $projectRoot 'electron-builder.config.cjs')
$includeConfigPath = ConvertTo-JsSingleQuotedString $includeFile
$outputConfigPath = ConvertTo-JsSingleQuotedString $outputRoot
$configText = @"
const base = require('$baseConfigPath');

module.exports = {
  ...base,
  directories: {
    ...base.directories,
    output: '$outputConfigPath',
  },
  artifactName: 'Osoo Handle App Integrated Setup `${version}.`${ext}',
  nsis: {
    ...base.nsis,
    include: '$includeConfigPath',
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: false,
  },
  publish: base.publish,
};
"@
Set-Content -LiteralPath $configFile -Value $configText -Encoding utf8

try {
    if (Test-Path -LiteralPath $outputFile) {
        Remove-Item -LiteralPath $outputFile -Force
    }

    Write-Host 'Rebuilding native modules for Electron...'
    & npx.cmd '@electron/rebuild' --force --arch=x64 --electron-version=40.6.0
    if ($LASTEXITCODE -ne 0) {
        throw "Electron 네이티브 모듈 재빌드에 실패했습니다. 종료 코드: $LASTEXITCODE"
    }

    Write-Host 'Building renderer...'
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        throw "렌더러 빌드에 실패했습니다. 종료 코드: $LASTEXITCODE"
    }

    Write-Host "Building single-stage integrated installer: $outputFile"
    & npx.cmd electron-builder --config $configFile --win nsis
    if ($LASTEXITCODE -ne 0) {
        throw "통합 설치파일 생성에 실패했습니다. 종료 코드: $LASTEXITCODE"
    }

    if (-not (Test-Path -LiteralPath $outputFile -PathType Leaf)) {
        throw "통합 설치파일이 생성되지 않았습니다: $outputFile"
    }

    $unpackedAsar = Join-Path $outputRoot 'win-unpacked\resources\app.asar'
    Write-Host 'Validating packaged application...'
    & node.exe scripts\validate-release.cjs --asar-path $unpackedAsar
    if ($LASTEXITCODE -ne 0) {
        throw "패키지 검증에 실패했습니다. 종료 코드: $LASTEXITCODE"
    }

    $unpackedRoot = Join-Path $outputRoot 'win-unpacked'
    if (Test-Path -LiteralPath $unpackedRoot) {
        Remove-Item -LiteralPath $unpackedRoot -Recurse -Force
    }
    $blockMap = "$outputFile.blockmap"
    if (Test-Path -LiteralPath $blockMap) {
        Remove-Item -LiteralPath $blockMap -Force
    }

    $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $outputFile
    Write-Host "Integrated installer created: $outputFile"
    Write-Host "Size: $((Get-Item -LiteralPath $outputFile).Length) bytes"
    Write-Host "SHA256: $($hash.Hash)"
}
finally {
    if (Test-Path -LiteralPath $buildRoot) {
        Remove-Item -LiteralPath $buildRoot -Recurse -Force
    }

    Write-Host 'Restoring native modules for the local Node.js runtime...'
    & npm.cmd rebuild better-sqlite3
}
