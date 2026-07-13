param(
    [Parameter(Mandatory = $false)]
    [string]$Tag = '',

    [Parameter(Mandatory = $false)]
    [string]$ReleaseDir = ''
)

$ErrorActionPreference = 'Stop'

function Fail([string]$Message) {
    Write-Error "[Upload FAIL] $Message"
    exit 1
}

function Pass([string]$Message) {
    Write-Host "[Upload PASS] $Message"
}

function Info([string]$Message) {
    Write-Host "[Upload INFO] $Message"
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

$installerName = "Osoo.Handle.App.Setup.$version.exe"
$blockmapName = "$installerName.blockmap"
$installerPath = Join-Path $releaseRoot $installerName
$blockmapPath = Join-Path $releaseRoot $blockmapName
$latestYmlPath = Join-Path $releaseRoot 'latest.yml'

Info "Version=$version Tag=$Tag"
Info "Release dir=$releaseRoot"

$policyCheckScript = Join-Path $PSScriptRoot 'check-release-asset-policy.ps1'
if (-not (Test-Path -LiteralPath $policyCheckScript -PathType Leaf)) {
    Fail "Policy check script not found: $policyCheckScript"
}

Info 'Running policy check before upload.'
& $policyCheckScript -Tag $Tag -ReleaseDir $releaseRoot -SkipRemoteReleaseCheck
if ($LASTEXITCODE -ne 0) {
    Fail 'Policy check failed. Upload aborted.'
}
Pass 'Policy check passed.'

foreach ($required in @($installerPath, $blockmapPath, $latestYmlPath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        Fail "Required file missing after policy normalization: $required"
    }
}
Pass 'Required files found for upload.'

$ghCommand = Get-Command gh -ErrorAction SilentlyContinue
if (-not $ghCommand) {
    Fail 'GitHub CLI (gh) is not installed or not available in PATH.'
}

Info 'Uploading latest.yml, installer, blockmap with --clobber.'
& gh release upload $Tag $latestYmlPath $installerPath $blockmapPath --clobber
if ($LASTEXITCODE -ne 0) {
    Fail "gh release upload failed for tag $Tag"
}
Pass 'Upload completed.'

Info 'Verifying uploaded asset names.'
$assetsOutput = & gh release view $Tag --json assets --jq '.assets[].name'
if ($LASTEXITCODE -ne 0) {
    Fail "gh release view failed for tag $Tag"
}
$assets = @($assetsOutput -split "`r?`n" | Where-Object { $_ -and $_.Trim() -ne '' } | ForEach-Object { $_.Trim() })

if ($assets -notcontains $installerName) {
    Fail "Uploaded release does not contain installer: $installerName"
}
if ($assets -notcontains $blockmapName) {
    Fail "Uploaded release does not contain blockmap: $blockmapName"
}
if ($assets -notcontains 'latest.yml') {
    Fail 'Uploaded release does not contain latest.yml'
}

Pass "Release $Tag now contains policy-compliant auto-update assets."

Info 'Running final local and remote release policy verification.'
& $policyCheckScript -Tag $Tag -ReleaseDir $releaseRoot
if ($LASTEXITCODE -ne 0) {
    Fail 'Final release policy verification failed.'
}
Pass 'Final release policy verification passed.'
