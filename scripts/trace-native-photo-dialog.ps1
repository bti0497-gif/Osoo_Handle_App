<#
  Osoo native photo dialog tracer (read-only)

  Purpose
    Correlates the Windows native file dialog lifecycle with the packaged app's
    local diagnostics while reproducing a photo-selection failure.

  Usage
    powershell -ExecutionPolicy Bypass -File .\trace-native-photo-dialog.ps1

  Reproduce the control and failing photo selections, return to this PowerShell
  window, and press Enter. The script does not stop or modify the app.
#>

[CmdletBinding()]
param(
    [string]$OutputRoot = '',
    [ValidateRange(50, 1000)]
    [int]$PollMilliseconds = 100,
    [ValidateRange(1, 3600)]
    [int]$MaxDurationSeconds = 600,
    [switch]$SkipPowerShellDialogControl
)

$ErrorActionPreference = 'Continue'
$startedAt = Get-Date
$stamp = $startedAt.ToString('yyyyMMdd-HHmmss')

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $outputFolderName = -join @([char]0xB354, [char]0xC8E4, [char]0xD658, [char]0xACBD)
    $OutputRoot = Join-Path (Join-Path $env:USERPROFILE 'Desktop') $outputFolderName
}

if (-not (Test-Path -LiteralPath $OutputRoot)) {
    New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
}

$bundleDir = Join-Path $OutputRoot "Osoo-Native-Photo-Trace-$stamp"
$windowEventPath = Join-Path $bundleDir 'window-events.jsonl'
$processEventPath = Join-Path $bundleDir 'process-events.jsonl'
New-Item -ItemType Directory -Path $bundleDir -Force | Out-Null

function Write-JsonFile {
    param([string]$Name, [object]$Value, [int]$Depth = 10)
    $Value | ConvertTo-Json -Depth $Depth | Set-Content -LiteralPath (Join-Path $bundleDir $Name) -Encoding UTF8
}

function Add-JsonLine {
    param([string]$Path, [object]$Value)
    $Value | ConvertTo-Json -Depth 8 -Compress | Add-Content -LiteralPath $Path -Encoding UTF8
}

if (-not ('OsooNativeWindowProbe' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public sealed class OsooWindowInfo
{
    public long Handle { get; set; }
    public long OwnerHandle { get; set; }
    public long ParentHandle { get; set; }
    public int ProcessId { get; set; }
    public int ThreadId { get; set; }
    public string Title { get; set; }
    public string ClassName { get; set; }
    public bool Visible { get; set; }
    public bool Foreground { get; set; }
    public int Left { get; set; }
    public int Top { get; set; }
    public int Right { get; set; }
    public int Bottom { get; set; }
}

public static class OsooNativeWindowProbe
{
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maxCount);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr hWnd, uint command);

    [DllImport("user32.dll")]
    private static extern IntPtr GetParent(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    public static OsooWindowInfo[] Snapshot()
    {
        var windows = new List<OsooWindowInfo>();
        IntPtr foreground = GetForegroundWindow();

        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
        {
            uint processId;
            uint threadId = GetWindowThreadProcessId(hWnd, out processId);
            var title = new StringBuilder(1024);
            var className = new StringBuilder(256);
            RECT rect;
            GetWindowText(hWnd, title, title.Capacity);
            GetClassName(hWnd, className, className.Capacity);
            GetWindowRect(hWnd, out rect);

            windows.Add(new OsooWindowInfo
            {
                Handle = hWnd.ToInt64(),
                OwnerHandle = GetWindow(hWnd, 4).ToInt64(),
                ParentHandle = GetParent(hWnd).ToInt64(),
                ProcessId = unchecked((int)processId),
                ThreadId = unchecked((int)threadId),
                Title = title.ToString(),
                ClassName = className.ToString(),
                Visible = IsWindowVisible(hWnd),
                Foreground = hWnd == foreground,
                Left = rect.Left,
                Top = rect.Top,
                Right = rect.Right,
                Bottom = rect.Bottom
            });
            return true;
        }, IntPtr.Zero);

        return windows.ToArray();
    }
}
'@
}

function Get-RelevantWindowSnapshot {
    $allWindows = @([OsooNativeWindowProbe]::Snapshot())
    $windowByHandle = @{}
    foreach ($window in $allWindows) { $windowByHandle[$window.Handle] = $window }
    $ownerPids = @{}
    foreach ($window in $allWindows) {
        if ($window.OwnerHandle -ne 0 -and $windowByHandle.ContainsKey($window.OwnerHandle)) {
            $ownerPids[$window.Handle] = $windowByHandle[$window.OwnerHandle].ProcessId
        }
    }

    $processNameCache = @{ 0 = '' }
    foreach ($process in Get-Process -ErrorAction SilentlyContinue) {
        $processNameCache[$process.Id] = $process.ProcessName
    }
    $result = foreach ($window in $allWindows) {
        $processName = if ($processNameCache.ContainsKey($window.ProcessId)) { $processNameCache[$window.ProcessId] } else { '' }
        $ownerPid = if ($ownerPids.ContainsKey($window.Handle)) { $ownerPids[$window.Handle] } else { 0 }
        $ownerProcessName = if ($processNameCache.ContainsKey($ownerPid)) { $processNameCache[$ownerPid] } else { '' }
        $isRelevant = $window.Foreground `
            -or ($window.Visible -and $window.ClassName -eq '#32770') `
            -or ($window.Visible -and $window.Title -match '(?i)open|choose|select|file upload') `
            -or $processName -match '(?i)osoo|electron|pickerhost|applicationframehost' `
            -or $ownerProcessName -match '(?i)osoo|electron'

        if ($isRelevant) {
            [ordered]@{
                handle = ('0x{0:X}' -f $window.Handle)
                ownerHandle = ('0x{0:X}' -f $window.OwnerHandle)
                processId = $window.ProcessId
                processName = $processName
                ownerProcessId = $ownerPid
                ownerProcessName = $ownerProcessName
                threadId = $window.ThreadId
                title = $window.Title
                className = $window.ClassName
                visible = $window.Visible
                foreground = $window.Foreground
                bounds = [ordered]@{
                    left = $window.Left
                    top = $window.Top
                    right = $window.Right
                    bottom = $window.Bottom
                }
            }
        }
    }
    @($result | Sort-Object processId, handle)
}

function Get-RelevantProcesses {
    @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '(?i)osoo|electron|node|explorer|pickerhost|applicationframehost|runtimebroker|dllhost' } |
        Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CreationDate)
}

function Get-RelevantProcessesLight {
    @(Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessName -match '(?i)osoo|electron|node|explorer|pickerhost|applicationframehost|runtimebroker|dllhost' } |
        ForEach-Object {
            $started = $null
            $path = $null
            try { $started = $_.StartTime } catch { }
            try { $path = $_.Path } catch { }
            [pscustomobject]@{
                ProcessId = $_.Id
                Name = $_.ProcessName
                ExecutablePath = $path
                CreationDate = $started
            }
        })
}

function Get-PhotoFiles {
    param([string]$Root)
    if (-not (Test-Path -LiteralPath $Root)) { return @() }
    @(Get-ChildItem -LiteralPath $Root -File -Recurse -ErrorAction SilentlyContinue |
        Select-Object FullName, Length, LastWriteTimeUtc)
}

function Get-DiagnosticsSince {
    param([string]$DiagnosticRoot, [datetime]$Since)
    $items = @()
    if (-not (Test-Path -LiteralPath $DiagnosticRoot)) { return $items }
    $sinceUtc = $Since.ToUniversalTime()

    foreach ($file in Get-ChildItem -LiteralPath $DiagnosticRoot -File -Filter '*_diagnostics.jsonl' -ErrorAction SilentlyContinue) {
        foreach ($line in Get-Content -LiteralPath $file.FullName -Tail 5000 -Encoding UTF8 -ErrorAction SilentlyContinue) {
            try {
                $entry = $line | ConvertFrom-Json -ErrorAction Stop
                $created = [datetime]::Parse($entry.created_at).ToUniversalTime()
                if ($created -ge $sinceUtc) {
                    $items += [pscustomobject]@{ file = $file.Name; line = $line; entry = $entry }
                }
            } catch { }
        }
    }
    @($items)
}

$appData = Join-Path $env:APPDATA 'Osoo_Handle_App'
$photoFolderName = -join @([char]0xC0AC, [char]0xC9C4, [char]0xAD00, [char]0xB9AC)
$photoRoot = Join-Path $appData $photoFolderName
$diagnosticRoot = Join-Path $appData 'logs\diagnostics'

$beforePhotoFiles = Get-PhotoFiles $photoRoot
$beforePhotoIndex = @{}
foreach ($file in $beforePhotoFiles) {
    $beforePhotoIndex[$file.FullName] = "$($file.Length)|$($file.LastWriteTimeUtc.ToString('o'))"
}

$os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
$windowsVersion = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction SilentlyContinue
$uac = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -ErrorAction SilentlyContinue
$controlledFolderAccess = $null
try { $controlledFolderAccess = (Get-MpPreference -ErrorAction Stop).EnableControlledFolderAccess } catch { }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)

Write-JsonFile 'system-environment.json' ([ordered]@{
    collectedAt = (Get-Date).ToString('o')
    os = [ordered]@{
        caption = $os.Caption
        version = $os.Version
        buildNumber = $os.BuildNumber
        displayVersion = $windowsVersion.DisplayVersion
        ubr = $windowsVersion.UBR
        editionId = $windowsVersion.EditionID
        architecture = $os.OSArchitecture
        lastBootUpTime = $os.LastBootUpTime
    }
    session = [ordered]@{
        sessionName = $env:SESSIONNAME
        elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    }
    uac = [ordered]@{
        enableLUA = $uac.EnableLUA
        consentPromptBehaviorAdmin = $uac.ConsentPromptBehaviorAdmin
        promptOnSecureDesktop = $uac.PromptOnSecureDesktop
    }
    security = [ordered]@{
        controlledFolderAccess = $controlledFolderAccess
    }
    paths = [ordered]@{
        appData = $appData
        photoRootExists = (Test-Path -LiteralPath $photoRoot)
        diagnosticsRootExists = (Test-Path -LiteralPath $diagnosticRoot)
        oneDriveConfigured = [bool]$env:OneDrive
    }
})

$startProcesses = Get-RelevantProcesses
Write-JsonFile 'processes-at-start.json' $startProcesses

$dialogControl = [ordered]@{
    attempted = $false
    selected = $false
    fileName = $null
    extension = $null
    length = $null
    sha256 = $null
    error = $null
}

if (-not $SkipPowerShellDialogControl) {
    $dialogControl.attempted = $true
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $controlDialog = New-Object System.Windows.Forms.OpenFileDialog
        $controlDialog.Title = 'Osoo diagnostic control - select the photo to test'
        $controlDialog.Filter = 'Image files|*.jpg;*.jpeg;*.png;*.bmp;*.webp|All files|*.*'
        $controlDialog.Multiselect = $false
        if ($controlDialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            $selectedInfo = Get-Item -LiteralPath $controlDialog.FileName -ErrorAction Stop
            $dialogControl.selected = $true
            $dialogControl.fileName = $selectedInfo.Name
            $dialogControl.extension = $selectedInfo.Extension
            $dialogControl.length = $selectedInfo.Length
            $dialogControl.sha256 = (Get-FileHash -LiteralPath $selectedInfo.FullName -Algorithm SHA256).Hash
        }
        $controlDialog.Dispose()
    } catch {
        $dialogControl.error = $_.Exception.Message
    }
}
Write-JsonFile 'powershell-dialog-control.json' $dialogControl

$lastWindowFingerprint = ''
$lastProcessFingerprint = ''
$dialogHandles = @{}
$foregroundTransitions = 0
$sampleCount = 0
$stopRequested = $false
$traceStartedAt = Get-Date

Write-Host ''
Write-Host 'Native photo-dialog tracing has started.' -ForegroundColor Yellow
if ($dialogControl.selected) {
    Write-Host "PowerShell dialog returned: $($dialogControl.fileName) ($($dialogControl.length) bytes)" -ForegroundColor Green
    Write-Host 'Select this same file in each app comparison.' -ForegroundColor Yellow
} elseif ($dialogControl.attempted) {
    Write-Host 'PowerShell dialog did not return a file. The app trace will still continue.' -ForegroundColor DarkYellow
}
Write-Host 'Use the same local JPG for these comparisons when possible:' -ForegroundColor Yellow
Write-Host '  1. Trade statement photo (control)' -ForegroundColor Yellow
Write-Host '  2. Medicine or sludge row photo (failing case)' -ForegroundColor Yellow
Write-Host '  3. Select the row first, then retry its photo button' -ForegroundColor Yellow
Write-Host 'After the dialog closes and the app shows success or failure, return here and press Enter.' -ForegroundColor Yellow
Write-Host 'The app, database, and photos are not modified by this tracer.' -ForegroundColor DarkGray

while (-not $stopRequested) {
    $now = Get-Date
    $windows = Get-RelevantWindowSnapshot
    $windowFingerprint = ($windows | ConvertTo-Json -Depth 5 -Compress)
    if ($windowFingerprint -ne $lastWindowFingerprint) {
        $foregroundTransitions += 1
        Add-JsonLine $windowEventPath ([ordered]@{
            capturedAt = $now.ToString('o')
            windows = $windows
        })
        $lastWindowFingerprint = $windowFingerprint

        foreach ($window in $windows | Where-Object { $_.visible -and $_.className -eq '#32770' }) {
            $dialogHandles[$window.handle] = [ordered]@{
                handle = $window.handle
                processId = $window.processId
                processName = $window.processName
                ownerProcessId = $window.ownerProcessId
                ownerProcessName = $window.ownerProcessName
                title = $window.title
            }
        }
    }

    if (($sampleCount % [Math]::Max(1, [int](1000 / $PollMilliseconds))) -eq 0) {
        $processes = Get-RelevantProcessesLight
        $processFingerprint = ($processes | Select-Object ProcessId, Name, CreationDate | ConvertTo-Json -Compress)
        if ($processFingerprint -ne $lastProcessFingerprint) {
            Add-JsonLine $processEventPath ([ordered]@{
                capturedAt = $now.ToString('o')
                processes = $processes
            })
            $lastProcessFingerprint = $processFingerprint
        }
    }

    try {
        if ([Console]::KeyAvailable) {
            $key = [Console]::ReadKey($true)
            if ($key.Key -eq [ConsoleKey]::Enter) { $stopRequested = $true }
        }
    } catch { }

    $sampleCount += 1
    if (((Get-Date) - $traceStartedAt).TotalSeconds -ge $MaxDurationSeconds) {
        $stopRequested = $true
    }
    if (-not $stopRequested) { Start-Sleep -Milliseconds $PollMilliseconds }
}

$completedAt = Get-Date
$endProcesses = Get-RelevantProcesses
$afterPhotoFiles = Get-PhotoFiles $photoRoot
$changedPhotoFiles = @($afterPhotoFiles | Where-Object {
    $signature = "$($_.Length)|$($_.LastWriteTimeUtc.ToString('o'))"
    -not $beforePhotoIndex.ContainsKey($_.FullName) -or $beforePhotoIndex[$_.FullName] -ne $signature
})

$diagnostics = Get-DiagnosticsSince $diagnosticRoot $startedAt
$diagnosticEntries = @($diagnostics | ForEach-Object { $_.entry })
$photoDiagnostics = @($diagnosticEntries | Where-Object {
    $_.action -match '(?i)photo|upload' -or $_.message -match '(?i)photo|upload'
})

if ($diagnostics.Count -gt 0) {
    $diagnostics | ForEach-Object { $_.line } | Set-Content -LiteralPath (Join-Path $bundleDir 'diagnostics-since-start.jsonl') -Encoding UTF8
}
Write-JsonFile 'photo-diagnostics.json' $photoDiagnostics
Write-JsonFile 'changed-photo-files.json' $changedPhotoFiles
Write-JsonFile 'processes-at-end.json' $endProcesses

$applicationEvents = @()
try {
    $applicationEvents = @(Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $startedAt } -ErrorAction Stop |
        Where-Object {
            $_.ProviderName -match '(?i)application error|windows error reporting|\.net runtime' `
                -or $_.Message -match '(?i)osoo|electron'
        } |
        Select-Object TimeCreated, Id, LevelDisplayName, ProviderName, Message)
} catch { }
Write-JsonFile 'application-events.json' $applicationEvents

$ping = $null
foreach ($port in 18731..18734) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/api/ping" -TimeoutSec 2
        $ping = [ordered]@{ port = $port; status = $response.StatusCode; success = $true }
        break
    } catch { }
}
if (-not $ping) { $ping = [ordered]@{ success = $false } }

$summary = [ordered]@{
    startedAt = $startedAt.ToString('o')
    completedAt = $completedAt.ToString('o')
    durationSeconds = [Math]::Round(($completedAt - $startedAt).TotalSeconds, 1)
    pollMilliseconds = $PollMilliseconds
    maxDurationSeconds = $MaxDurationSeconds
    samples = $sampleCount
    foregroundOrWindowTransitions = $foregroundTransitions
    nativeDialogCount = $dialogHandles.Count
    nativeDialogs = @($dialogHandles.Values)
    powershellDialogControl = $dialogControl
    photoDiagnosticActions = @($photoDiagnostics | ForEach-Object { $_.action })
    fileSelectionReceived = [bool]($photoDiagnostics | Where-Object { $_.action -match 'file-selection-received' })
    uploadHandlerStarted = [bool]($photoDiagnostics | Where-Object { $_.action -match 'upload-handler-started' })
    uploadApiObserved = [bool]($photoDiagnostics | Where-Object { $_.action -match 'upload-api|/upload-photo' })
    changedPhotoFileCount = $changedPhotoFiles.Count
    applicationErrorEventCount = $applicationEvents.Count
    serverPing = $ping
}
Write-JsonFile 'summary.json' $summary

$zipPath = "$bundleDir.zip"
Compress-Archive -Path (Join-Path $bundleDir '*') -DestinationPath $zipPath -Force

Write-Host ''
Write-Host "Completed: $zipPath" -ForegroundColor Green
Write-Host 'Send the ZIP file. summary.json alone is not sufficient for this trace.' -ForegroundColor Green
