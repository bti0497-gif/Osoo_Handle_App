param(
    [Parameter(Mandatory = $false)]
    [string]$Tag = '',

    [Parameter(Mandatory = $false)]
    [string]$ReleaseDir = '',

    [Parameter(Mandatory = $false)]
    [switch]$AutoNormalizeLegacyNames = $true,

    [Parameter(Mandatory = $false)]
    [switch]$SkipRemoteReleaseCheck = $false
)

$ErrorActionPreference = 'Stop'

function Fail([string]$Message) {
    Write-Error "[Policy FAIL] $Message"
    exit 1
}

function Pass([string]$Message) {
    Write-Host "[Policy PASS] $Message"
}

function Info([string]$Message) {
    Write-Host "[Policy INFO] $Message"
}

function Ensure-PolicyNamedFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ReleaseRoot,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedName,

        [Parameter(Mandatory = $true)]
        [string[]]$LegacyPatterns,

        [Parameter(Mandatory = $false)]
        [switch]$AllowNormalize = $false
    )

    $expectedPath = Join-Path $ReleaseRoot $ExpectedName
    if (Test-Path -LiteralPath $expectedPath -PathType Leaf) {
        return $expectedPath
    }

    $candidates = @()
    foreach ($pattern in $LegacyPatterns) {
        $candidates += Get-ChildItem -LiteralPath $ReleaseRoot -File -Filter $pattern -ErrorAction SilentlyContinue
    }
    $candidates = @($candidates | Sort-Object LastWriteTime -Descending)

    if ($candidates.Count -eq 0) {
        Fail "Policy file missing and no legacy candidate found: $expectedPath"
    }

    if ($candidates.Count -gt 1) {
        $names = ($candidates | ForEach-Object { $_.Name }) -join ', '
        Fail "Multiple legacy candidates found for ${ExpectedName}: $names"
    }

    if (-not $AllowNormalize) {
        Fail "Policy file missing: $expectedPath"
    }

    $source = $candidates[0].FullName
    Copy-Item -LiteralPath $source -Destination $expectedPath -Force
    Pass "Normalized legacy filename to policy name: $($candidates[0].Name) -> $ExpectedName"
    return $expectedPath
}

function Get-Sha512Base64([string]$FilePath) {
    $hashHex = (Get-FileHash -LiteralPath $FilePath -Algorithm SHA512).Hash
    $bytes = for ($i = 0; $i -lt $hashHex.Length; $i += 2) {
        [Convert]::ToByte($hashHex.Substring($i, 2), 16)
    }
    return [Convert]::ToBase64String($bytes)
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$packageJsonPath = Join-Path $projectRoot 'package.json'
if (-not (Test-Path -LiteralPath $packageJsonPath -PathType Leaf)) {
    Fail "package.json not found: $packageJsonPath"
}
$packageJson = Get-Content -Raw -LiteralPath $packageJsonPath | ConvertFrom-Json

$version = [string]$packageJson.version
if (-not $Tag) {
    $Tag = "v$version"
}
if (-not $ReleaseDir) {
    $ReleaseDir = Join-Path $projectRoot 'release'
}
$releaseRoot = (Resolve-Path -LiteralPath $ReleaseDir).Path

$expectedInstaller = "Osoo.Handle.App.Setup.$version.exe"
$expectedBlockmap = "$expectedInstaller.blockmap"
$latestYmlPath = Join-Path $releaseRoot 'latest.yml'
$installerPath = Ensure-PolicyNamedFile -ReleaseRoot $releaseRoot -ExpectedName $expectedInstaller -LegacyPatterns @(
    "Osoo Handle App Setup $version.exe",
    "Osoo-Handle-App-Setup-$version.exe",
    "Osoo_Handle_App_Setup_$version.exe"
) -AllowNormalize:$AutoNormalizeLegacyNames

$blockmapPath = Ensure-PolicyNamedFile -ReleaseRoot $releaseRoot -ExpectedName $expectedBlockmap -LegacyPatterns @(
    "Osoo Handle App Setup $version.exe.blockmap",
    "Osoo-Handle-App-Setup-$version.exe.blockmap",
    "Osoo_Handle_App_Setup_$version.exe.blockmap"
) -AllowNormalize:$AutoNormalizeLegacyNames

Info "Version=$version Tag=$Tag"
Info "Expected installer: $expectedInstaller"

if (-not (Test-Path -LiteralPath $latestYmlPath -PathType Leaf)) {
    Fail "latest.yml not found: $latestYmlPath"
}
Pass 'Required release files exist.'

$latestText = Get-Content -Raw -LiteralPath $latestYmlPath

$urlMatch = [regex]::Match($latestText, '(?m)^\s*-\s*url:\s*(.+)\s*$')
$pathMatch = [regex]::Match($latestText, '(?m)^path:\s*(.+)\s*$')
$fileShaMatch = [regex]::Match($latestText, '(?m)^\s*sha512:\s*([^\r\n]+)\s*$')
$fileSizeMatch = [regex]::Match($latestText, '(?m)^\s*size:\s*(\d+)\s*$')

if (-not $urlMatch.Success) { Fail 'latest.yml files[].url not found.' }
if (-not $pathMatch.Success) { Fail 'latest.yml path not found.' }
if (-not $fileShaMatch.Success) { Fail 'latest.yml sha512 not found.' }
if (-not $fileSizeMatch.Success) { Fail 'latest.yml size not found.' }

$ymlUrl = $urlMatch.Groups[1].Value.Trim()
$ymlPath = $pathMatch.Groups[1].Value.Trim()
$ymlSha = $fileShaMatch.Groups[1].Value.Trim()
$ymlSize = [int64]$fileSizeMatch.Groups[1].Value

if ($ymlUrl -ne $expectedInstaller) {
    Fail "latest.yml url mismatch. expected=$expectedInstaller actual=$ymlUrl"
}
if ($ymlPath -ne $expectedInstaller) {
    Fail "latest.yml path mismatch. expected=$expectedInstaller actual=$ymlPath"
}
Pass 'latest.yml url/path naming policy matches dot-separated installer name.'

$actualSize = (Get-Item -LiteralPath $installerPath).Length
$actualSha = Get-Sha512Base64 -FilePath $installerPath

if ($actualSize -ne $ymlSize) {
    Fail "latest.yml size mismatch. expected=$actualSize actual=$ymlSize"
}
if ($actualSha -ne $ymlSha) {
    Fail 'latest.yml sha512 mismatch against installer file.'
}
Pass 'latest.yml size/sha512 matches installer file.'

if (-not $SkipRemoteReleaseCheck) {
    $ghCommand = Get-Command gh -ErrorAction SilentlyContinue
    if (-not $ghCommand) {
        Fail 'GitHub CLI (gh) is not installed or not available in PATH.'
    }

    try {
        $assetsJson = gh release view $Tag --json assets --jq '.assets[].name' 2>$null
        if (-not $assetsJson) {
            Fail "Unable to query release assets for tag $Tag."
        }
        $assetNames = @($assetsJson -split "`r?`n" | Where-Object { $_ -and $_.Trim() -ne '' } | ForEach-Object { $_.Trim() })

        if ($assetNames -notcontains $expectedInstaller) {
            Fail "Release asset missing: $expectedInstaller"
        }
        if ($assetNames -notcontains $expectedBlockmap) {
            Fail "Release asset missing: $expectedBlockmap"
        }
        if ($assetNames -notcontains 'latest.yml') {
            Fail 'Release asset missing: latest.yml'
        }

        Pass "Release assets for $Tag include installer/blockmap/latest.yml with policy-compliant names."
    } catch {
        Fail "GitHub release inspection failed: $($_.Exception.Message)"
    }
}

Pass 'All release asset policy checks passed.'
