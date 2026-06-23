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
    $existingPackageRoot = Join-Path $releaseRoot 'deployment-package'
    if (Test-Path -LiteralPath $existingPackageRoot -PathType Container) {
        $installer = Get-ChildItem -LiteralPath $existingPackageRoot -File -Filter 'Osoo Handle App Setup *.exe' |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
    }
}

if (-not $installer) {
    throw "Release installer not found: $releaseRoot"
}

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $outputRoot 'credentials') -Force | Out-Null

$installerDestination = Join-Path $outputRoot $installer.Name
if (-not [string]::Equals($installer.FullName, $installerDestination, [System.StringComparison]::OrdinalIgnoreCase)) {
    Copy-Item -LiteralPath $installer.FullName -Destination $installerDestination -Force
}

Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'install-with-provisioning.cmd') -Destination $outputRoot -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'install-with-provisioning.ps1') -Destination $outputRoot -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'provision-runtime-config.ps1') -Destination $outputRoot -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\docs\현장-배포-방법.md') -Destination $outputRoot -Force

Write-Host "Deployment package prepared: $outputRoot"
Write-Host 'Place site credential files in the credentials directory, then run install-with-provisioning.cmd.'
