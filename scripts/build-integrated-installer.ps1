param(
    [Parameter(Mandatory = $false)]
    [string]$AppVersion = '',

    [Parameter(Mandatory = $false)]
    [string]$OutputDir = '',

    [Parameter(Mandatory = $false)]
    [string]$CredentialSourceRoot = '',

    [Parameter(Mandatory = $false)]
    [switch]$LowMemoryMode = $true
)

$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $CredentialSourceRoot) {
    $CredentialSourceRoot = if ($env:OSOO_CREDENTIAL_SOURCE_ROOT) {
        $env:OSOO_CREDENTIAL_SOURCE_ROOT
    } else {
        $projectRoot
    }
}
$credentialRoot = [System.IO.Path]::GetFullPath($CredentialSourceRoot)
$packageJson = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') |
    ConvertFrom-Json
$isLegacyWin7X86 = $packageJson.name -eq 'osoo-handle-app-win7-x86'
$artifactPrefix = if ($isLegacyWin7X86) { 'Osoo.Handle.App.Win7.x86.Integrated.Setup' } else { 'Osoo.Handle.App.Integrated.Setup' }
$unpackedFolder = if ($isLegacyWin7X86) { 'win-ia32-unpacked' } else { 'win-unpacked' }
if (-not $AppVersion) {
    $AppVersion = $packageJson.version
}
if ($packageJson.version -ne $AppVersion) {
    throw "package.json 버전($($packageJson.version))과 요청 버전($AppVersion)이 다릅니다."
}

if (-not $OutputDir) {
    $OutputDir = Join-Path $projectRoot 'release\integrated-deployment'
}
$outputRoot = [System.IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

$requiredFiles = @{
    '.env.local' = Join-Path $credentialRoot '.env.local'
    'google-key.json' = Join-Path $credentialRoot 'server\config\google-key.json'
    'bigquery-service-account.json' = Join-Path $credentialRoot 'server\config\work-jindan-194620a46d59.json'
    'firebase-service-account.json' = Join-Path $credentialRoot 'server\config\firebase-service-account.json'
}

foreach ($entry in $requiredFiles.GetEnumerator()) {
    if (-not (Test-Path -LiteralPath $entry.Value -PathType Leaf)) {
        throw "통합 설치파일에 필요한 파일이 없습니다: $($entry.Value)"
    }
}

$oauthFile = Get-ChildItem -LiteralPath $credentialRoot -File -Filter 'client_secret_*.json' |
    Select-Object -First 1
if (-not $oauthFile) {
    throw 'Google OAuth client_secret_*.json 파일을 찾을 수 없습니다.'
}
$requiredFiles[$oauthFile.Name] = $oauthFile.FullName

$buildRoot = Join-Path $outputRoot '.integrated-build'
$includeFile = Join-Path $buildRoot 'installer-credentials.nsh'
$processGuardFile = Join-Path $projectRoot 'scripts\installer-process-guard.nsh'
$configFile = Join-Path $buildRoot 'electron-builder.integrated.cjs'
$outputFile = Join-Path $outputRoot "$artifactPrefix.$AppVersion.exe"

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

if (-not (Test-Path -LiteralPath $processGuardFile -PathType Leaf)) {
    throw "설치 프로세스 종료 보호 스크립트가 없습니다: $processGuardFile"
}

$processGuardSourcePath = ConvertTo-NsisSourcePath $processGuardFile

$includeLines = @(
    "!include `"$processGuardSourcePath`""
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
# The embedded server is launched from app.asar.unpacked/server.cjs. Every
# runtime dependency must therefore be unpacked beside it; unpacking only
# native modules makes Node fail at startup with MODULE_NOT_FOUND (express).
$asarUnpackSection = '  asarUnpack: base.asarUnpack,'
$concurrencySection = if ($isLegacyWin7X86) { '' } else { '  concurrency: { jobs: 1 },' }

$configText = @"
const base = require('$baseConfigPath');

module.exports = {
  ...base,
$concurrencySection
  files: [
    ...base.files,
    'templates/**/*',
  ],
  extraResources: [
    ...base.extraResources,
    { from: 'templates', to: 'templates' },
  ],
  directories: {
    ...base.directories,
    output: '$outputConfigPath',
  },
$asarUnpackSection
    artifactName: '$artifactPrefix.`${version}.`${ext}',
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
    if ($isLegacyWin7X86) {
        & npx.cmd '@electron/rebuild' --force --arch=ia32 --version=22.3.27
    } else {
        & npx.cmd '@electron/rebuild' --force --arch=x64 --version=40.6.0
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Electron 네이티브 모듈 재빌드에 실패했습니다. 종료 코드: $LASTEXITCODE"
    }

    Write-Host 'Building renderer...'
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        throw "렌더러 빌드에 실패했습니다. 종료 코드: $LASTEXITCODE"
    }

    Write-Host "Building single-stage integrated installer: $outputFile"
    if ($isLegacyWin7X86) {
        & npx.cmd electron-builder --config $configFile --win nsis --ia32
    } else {
        & npx.cmd electron-builder --config $configFile --win nsis
    }
    if ($LASTEXITCODE -ne 0) {
        throw "통합 설치파일 생성에 실패했습니다. 종료 코드: $LASTEXITCODE"
    }

    if (-not (Test-Path -LiteralPath $outputFile -PathType Leaf)) {
        throw "통합 설치파일이 생성되지 않았습니다: $outputFile"
    }

    $unpackedAsar = Join-Path $outputRoot "$unpackedFolder\resources\app.asar"
    Write-Host 'Validating packaged application...'
    if ($isLegacyWin7X86) {
        & node.exe scripts\run-with-legacy-electron.cjs scripts\validate-release.cjs --asar-path $unpackedAsar
    } else {
        & npm.cmd rebuild better-sqlite3
        if ($LASTEXITCODE -ne 0) {
            throw "Node.js 검증용 네이티브 모듈 복원에 실패했습니다. 종료 코드: $LASTEXITCODE"
        }
        & node.exe scripts\validate-release.cjs --asar-path $unpackedAsar
    }
    if ($LASTEXITCODE -ne 0) {
        throw "패키지 검증에 실패했습니다. 종료 코드: $LASTEXITCODE"
    }

    $unpackedRoot = Join-Path $outputRoot $unpackedFolder
    Write-Host 'Smoke testing packaged native modules...'
    & node.exe scripts\validate-packaged-native.cjs $unpackedRoot
    if ($LASTEXITCODE -ne 0) {
        throw "패키지 네이티브 모듈 검증에 실패했습니다. 종료 코드: $LASTEXITCODE"
    }

    if (Test-Path -LiteralPath $unpackedRoot) {
        Remove-Item -LiteralPath $unpackedRoot -Recurse -Force
    }
    $blockMap = "$outputFile.blockmap"
    if (Test-Path -LiteralPath $blockMap) {
        Remove-Item -LiteralPath $blockMap -Force
    }

    $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $outputFile
    $manifest = [ordered]@{
        version = $AppVersion
        installerName = [System.IO.Path]::GetFileName($outputFile)
        size = (Get-Item -LiteralPath $outputFile).Length
        sha256 = $hash.Hash
        generatedAt = [DateTime]::UtcNow.ToString('o')
        asarValidation = $true
        nativeSqliteSmokeTest = $true
        installTargets = [ordered]@{
            primary = '%APPDATA%\Osoo_Handle_App\config'
            legacy = '%APPDATA%\wastewater-treatment-plant\config'
        }
        requiredConfigFiles = @(
            '.env.local'
            'google-key.json'
            'bigquery-service-account.json'
            'firebase-service-account.json'
        )
    }
    $manifestPath = Join-Path $outputRoot 'field-installer-manifest.json'
    $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding utf8

    Write-Host "Integrated installer created: $outputFile"
    Write-Host "Size: $((Get-Item -LiteralPath $outputFile).Length) bytes"
    Write-Host "SHA256: $($hash.Hash)"
    Write-Host "Deployment manifest created: $manifestPath"
}
finally {
    if (Test-Path -LiteralPath $buildRoot) {
        Remove-Item -LiteralPath $buildRoot -Recurse -Force
    }

    if (-not $isLegacyWin7X86) {
        Write-Host 'Restoring native modules for the local Node.js runtime...'
        & npm.cmd rebuild better-sqlite3
    }
}
