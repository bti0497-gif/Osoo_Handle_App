param(
    [Parameter(Mandatory = $false)]
    [string]$CredentialSource = '',

    [Parameter(Mandatory = $false)]
    [string]$InstallerPath = ''
)

$ErrorActionPreference = 'Stop'

if (-not $CredentialSource) {
    $CredentialSource = Join-Path $PSScriptRoot 'credentials'
}

function Resolve-InstallerPath {
    param([string]$RequestedPath)

    if ($RequestedPath) {
        return (Resolve-Path -LiteralPath $RequestedPath).Path
    }

    $installer = Get-ChildItem -LiteralPath $PSScriptRoot -File -Filter 'Osoo Handle App Setup *.exe' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $installer) {
        throw "Installer not found. Place 'Osoo Handle App Setup *.exe' beside this script or specify -InstallerPath."
    }

    return $installer.FullName
}

$credentialRoot = (Resolve-Path -LiteralPath $CredentialSource).Path
$provisionScript = Join-Path $PSScriptRoot 'provision-runtime-config.ps1'

if (-not (Test-Path -LiteralPath $provisionScript -PathType Leaf)) {
    throw "Provisioning script not found: $provisionScript"
}

$requiredSources = @(
    @{ Name = '.env.local'; Candidates = @('.env.local') },
    @{ Name = 'google-key.json'; Candidates = @('google-key.json', 'server\config\google-key.json') },
    @{ Name = 'bigquery-service-account.json'; Candidates = @('bigquery-service-account.json', 'server\config\work-jindan-194620a46d59.json') },
    @{ Name = 'firebase-service-account.json'; Candidates = @('firebase-service-account.json', 'server\config\firebase-service-account.json') }
)
$missingSources = $requiredSources | Where-Object {
    $mapping = $_
    -not ($mapping.Candidates | Where-Object {
        Test-Path -LiteralPath (Join-Path $credentialRoot $_) -PathType Leaf
    } | Select-Object -First 1)
} | ForEach-Object { $_.Name }

if ($missingSources.Count -gt 0) {
    throw "Required credential files are missing from the credentials directory: $($missingSources -join ', ')"
}

Write-Host '[1/3] Provisioning user configuration and service credentials.'
& $provisionScript -SourceDir $credentialRoot

$runtimeConfigRoot = Join-Path $env:APPDATA 'wastewater-treatment-plant\config'
$requiredFiles = @(
    '.env.local',
    'google-key.json',
    'bigquery-service-account.json',
    'firebase-service-account.json'
)
$missingFiles = $requiredFiles | Where-Object {
    -not (Test-Path -LiteralPath (Join-Path $runtimeConfigRoot $_) -PathType Leaf)
}

if ($missingFiles.Count -gt 0) {
    throw "Provisioning verification failed. Missing files: $($missingFiles -join ', ')"
}

Write-Host '[2/3] Provisioning verified.'
$resolvedInstaller = Resolve-InstallerPath -RequestedPath $InstallerPath

Write-Host "[3/3] Starting app installer: $resolvedInstaller"
$process = Start-Process -FilePath $resolvedInstaller -Wait -PassThru
if ($process.ExitCode -ne 0) {
    throw "App installation failed with exit code $($process.ExitCode)."
}

Write-Host 'Provisioning and app installation completed.'
