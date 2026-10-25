param()
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).Path
$archiveRoot = Join-Path $env:APPDATA 'Osoo_Handle_App/diagnostic-analysis'
$runtimeRoot = Join-Path $archiveRoot 'collector-runtime'
$sourceNode = (Get-Command node -ErrorAction Stop).Source
$nodeVersion = (& $sourceNode -p 'process.versions.node').Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Cannot resolve Node version' }
$runtimeDir = Join-Path $runtimeRoot "node-$nodeVersion"
$pinnedNode = Join-Path $runtimeDir 'node.exe'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
if (-not (Test-Path -LiteralPath $pinnedNode)) { Copy-Item -LiteralPath $sourceNode -Destination $pinnedNode }
if ((& $pinnedNode -p 'process.versions.node').Trim() -ne $nodeVersion) { throw 'Pinned Node version mismatch' }
$sqlitePackage = Join-Path $runtimeDir 'node_modules/better-sqlite3'
if (-not (Test-Path -LiteralPath $sqlitePackage)) {
    & npm.cmd install --prefix $runtimeDir --no-save --package-lock=false --runtime=node "--target=$nodeVersion" better-sqlite3@12.6.2
    if ($LASTEXITCODE -ne 0) { throw 'Isolated SQLite installation failed' }
}
# Test only the isolated module with its paired Node, never the app node_modules.
& $pinnedNode (Join-Path $PSScriptRoot 'validate-runtime.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Isolated SQLite ABI verification failed' }
$pointer = Join-Path $runtimeRoot 'node-path.txt'
[IO.File]::WriteAllText($pointer, $pinnedNode, [Text.UTF8Encoding]::new($false))
$outputDir = Join-Path $PSScriptRoot 'publish-next'
& dotnet publish (Join-Path $PSScriptRoot 'OsooDiagnosticTray.csproj') -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -o $outputDir
if ($LASTEXITCODE -ne 0) { throw 'Collector build failed' }
$exe = Join-Path $outputDir 'OsooDiagnosticTray.exe'
$testProcess = Start-Process -FilePath $exe -ArgumentList '--self-test' -WindowStyle Hidden -Wait -PassThru
if ($testProcess.ExitCode -ne 0) { throw 'Collector schedule self-test failed' }
Write-Output "Built collector 1.1.0: $exe"
Write-Output "Pinned runtime: $pinnedNode"
Write-Output 'Existing diagnostics.db retained. Field app ABI unchanged. Deployment/restart is a separate step.'
