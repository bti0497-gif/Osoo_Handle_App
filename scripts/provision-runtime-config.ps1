param(
    [Parameter(Mandatory = $false)]
    [string]$SourceDir = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
$sourceRoot = [System.IO.Path]::GetFullPath($SourceDir)
$targetRoot = Join-Path $env:APPDATA 'Osoo_Handle_App\config'
$legacyTargetRoot = Join-Path $env:APPDATA 'wastewater-treatment-plant\config'
New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null
New-Item -ItemType Directory -Path $legacyTargetRoot -Force | Out-Null

$mappings = @(
    @{ Target = '.env.local'; Candidates = @('.env.local') },
    @{ Target = 'google-key.json'; Candidates = @('google-key.json', 'server\config\google-key.json') },
    @{ Target = 'bigquery-service-account.json'; Candidates = @('bigquery-service-account.json', 'server\config\work-jindan-194620a46d59.json') },
    @{ Target = 'firebase-service-account.json'; Candidates = @('firebase-service-account.json', 'server\config\firebase-service-account.json') }
)

$copied = New-Object System.Collections.Generic.List[string]
foreach ($mapping in $mappings) {
    $source = $null
    foreach ($candidate in $mapping.Candidates) {
        $candidatePath = Join-Path $sourceRoot $candidate
        if (Test-Path -LiteralPath $candidatePath) {
            $source = $candidatePath
            break
        }
    }
    if ($source) {
        Copy-Item -LiteralPath $source -Destination (Join-Path $targetRoot $mapping.Target) -Force
        Copy-Item -LiteralPath $source -Destination (Join-Path $legacyTargetRoot $mapping.Target) -Force
        $copied.Add($mapping.Target)
    }
}

$oauthFile = Get-ChildItem -LiteralPath $sourceRoot -File -Filter 'client_secret_*.json' |
    Select-Object -First 1
if ($oauthFile) {
    Copy-Item -LiteralPath $oauthFile.FullName -Destination (Join-Path $targetRoot $oauthFile.Name) -Force
    Copy-Item -LiteralPath $oauthFile.FullName -Destination (Join-Path $legacyTargetRoot $oauthFile.Name) -Force
    $copied.Add($oauthFile.Name)
}

Write-Host "Runtime config directory: $targetRoot"
Write-Host "Legacy compatibility config directory: $legacyTargetRoot"
Write-Host "Copied: $($copied -join ', ')"
