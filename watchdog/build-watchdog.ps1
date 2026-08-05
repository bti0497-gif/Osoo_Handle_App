$ErrorActionPreference = 'Stop'

$watchdogRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourcePath = Join-Path $watchdogRoot 'OsooWatchdog.cs'
$outputRoot = Join-Path $watchdogRoot 'dist'
$outputPath = Join-Path $outputRoot 'OsooWatchdog.exe'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'

if (-not (Test-Path -LiteralPath $compiler)) {
    throw "C# compiler not found: $compiler"
}

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

& $compiler `
    /nologo `
    /target:winexe `
    /platform:anycpu `
    /optimize+ `
    /debug- `
    /nowarn:0649 `
    /out:$outputPath `
    /reference:System.Runtime.Serialization.dll `
    $sourcePath

if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $outputPath)) {
    throw 'Watchdog compilation failed.'
}

$item = Get-Item -LiteralPath $outputPath
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
    $stream = [System.IO.File]::OpenRead($item.FullName)
    try {
        $hash = [System.BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '')
    } finally {
        $stream.Dispose()
    }
} finally {
    $sha256.Dispose()
}

[PSCustomObject]@{
    Path = $item.FullName
    Version = $item.VersionInfo.FileVersion
    Size = $item.Length
    Sha256 = $hash
}
