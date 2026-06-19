param(
    [Parameter(Mandatory = $false)]
    [string]$ReleaseDir = '',

    [Parameter(Mandatory = $false)]
    [string]$OutputDir = ''
)

$ErrorActionPreference = 'Stop'

if (-not $ReleaseDir) {
    $ReleaseDir = Join-Path $PSScriptRoot '..\release'
}
if (-not $OutputDir) {
    $OutputDir = Join-Path $PSScriptRoot '..\release\deployment-package'
}
$releaseRoot = (Resolve-Path -LiteralPath $ReleaseDir).Path
$outputRoot = [System.IO.Path]::GetFullPath($OutputDir)

$installer = Get-ChildItem -LiteralPath $releaseRoot -File -Filter 'Osoo Handle App Setup *.exe' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (-not $installer) {
    throw "Release installer not found: $releaseRoot"
}

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $outputRoot 'credentials') -Force | Out-Null

$filesToCopy = @(
    $installer.FullName,
    (Join-Path $PSScriptRoot 'install-with-provisioning.cmd'),
    (Join-Path $PSScriptRoot 'install-with-provisioning.ps1'),
    (Join-Path $PSScriptRoot 'provision-runtime-config.ps1')
)

foreach ($file in $filesToCopy) {
    Copy-Item -LiteralPath $file -Destination $outputRoot -Force
}

Write-Host "Deployment package prepared: $outputRoot"
Write-Host 'Place site credential files in the credentials directory, then run install-with-provisioning.cmd.'
