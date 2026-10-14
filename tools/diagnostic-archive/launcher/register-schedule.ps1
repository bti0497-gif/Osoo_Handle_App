param(
    [Parameter(Mandatory = $true)][string]$ExecutablePath,
    [switch]$Disable
)
$ErrorActionPreference = 'Stop'
$taskName = 'Osoo Diagnostic Archive Daily'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($Disable) {
    if ($existing) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
    return
}
$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
if ((Get-TimeZone).Id -ne 'Korea Standard Time') {
    throw 'Daily collection schedule requires Korea Standard Time on this PC.'
}
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $resolvedExecutable -Argument '--background' -WorkingDirectory (Split-Path -Parent $resolvedExecutable)
$trigger = New-ScheduledTaskTrigger -Daily -At '09:00'
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 12)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Central PC diagnostic collector: daily 09:00, catch up missed start, interactive tray, no stored password.' -Force | Out-Null
Write-Output 'Daily 09:00 schedule registered (StartWhenAvailable). Launcher was not started.'
