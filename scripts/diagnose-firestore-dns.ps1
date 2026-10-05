# Read-only Firestore DNS and HTTPS connectivity diagnostic for the Andong site.
# Run from Windows PowerShell 5.1 or later; no elevation is required.
# The script changes no DNS, proxy, firewall, or application settings. It sends only DNS queries and TLS handshakes.

[CmdletBinding()]
param(
    [ValidateRange(1, 10)]
    [int]$Rounds = 4,
    [ValidateRange(1, 120)]
    [int]$IntervalSeconds = 15,
    [string]$OutputRoot = [Environment]::GetFolderPath('Desktop')
)

$ErrorActionPreference = 'Continue'
Write-Host 'This diagnostic is intended only for the Andong site.' -ForegroundColor Yellow
$siteConfirmation = Read-Host 'Type ANDONG to continue'
if ($siteConfirmation -cne 'ANDONG') {
    Write-Host 'Cancelled. No diagnostic was run.' -ForegroundColor Yellow
    exit 2
}

$startedAt = Get-Date
$stamp = $startedAt.ToString('yyyyMMdd-HHmmss')
if (-not (Test-Path -LiteralPath $OutputRoot)) {
    $OutputRoot = $env:TEMP
}
$reportPath = Join-Path $OutputRoot "Andong-Firestore-DNS-$stamp.txt"
$lines = New-Object 'System.Collections.Generic.List[string]'

function Add-ReportLine {
    param([string]$Text = '')
    [void]$script:lines.Add($Text)
}

function Get-ExceptionText {
    param([System.Exception]$Exception)
    if ($null -eq $Exception) { return 'No exception details' }
    $message = $Exception.Message
    if ($Exception.InnerException) {
        $message += ' | Inner: ' + $Exception.InnerException.Message
    }
    return ($message -replace '[\r\n]+', ' ')
}

function Invoke-Nslookup {
    param(
        [string]$HostName,
        [string]$DnsServer = '',
        [int]$TimeoutMilliseconds = 8000
    )
    $exe = Join-Path $env:SystemRoot 'System32\nslookup.exe'
    if (-not (Test-Path -LiteralPath $exe)) { $exe = 'nslookup.exe' }
    $arguments = '"' + $HostName + '"'
    if ($DnsServer) { $arguments += ' ' + $DnsServer }
    try {
        $startInfo = New-Object System.Diagnostics.ProcessStartInfo
        $startInfo.FileName = $exe
        $startInfo.Arguments = $arguments
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = $startInfo
        [void]$process.Start()
        if (-not $process.WaitForExit($TimeoutMilliseconds)) {
            try { $process.Kill() } catch { }
            return 'TIMEOUT after ' + $TimeoutMilliseconds + ' ms'
        }
        $stdout = $process.StandardOutput.ReadToEnd()
        $stderr = $process.StandardError.ReadToEnd()
        $text = ($stdout + "`n" + $stderr).Trim()
        if (-not $text) { $text = 'No output; exit code ' + $process.ExitCode }
        return ($text -replace '[\r\n]+', ' | ')
    } catch {
        return 'ERROR: ' + (Get-ExceptionText $_.Exception)
    } finally {
        if ($process) { $process.Dispose() }
    }
}

function Invoke-ResolverLookup {
    param([string]$HostName)
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        if (Get-Command Resolve-DnsName -ErrorAction SilentlyContinue) {
            $addresses = Resolve-DnsName -Name $HostName -Type A -DnsOnly -QuickTimeout -ErrorAction Stop |
                Where-Object { $_.IPAddress } | ForEach-Object { $_.IPAddress }
        } else {
            return (Invoke-Nslookup $HostName)
        }
        $timer.Stop()
        if (-not $addresses) { return ('NO A RECORD in {0} ms' -f $timer.ElapsedMilliseconds) }
        return ('OK in {0} ms; addresses={1}' -f $timer.ElapsedMilliseconds, ($addresses -join ','))
    } catch {
        $timer.Stop()
        return ('FAIL in {0} ms; {1}' -f $timer.ElapsedMilliseconds, (Get-ExceptionText $_.Exception))
    }
}

function Test-TlsEndpoint {
    param(
        [string]$HostName,
        [int]$TimeoutMilliseconds = 8000
    )
    $client = $null
    $ssl = $null
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $connect = $client.BeginConnect($HostName, 443, $null, $null)
        if (-not $connect.AsyncWaitHandle.WaitOne($TimeoutMilliseconds, $false)) {
            return 'TCP TIMEOUT after ' + $TimeoutMilliseconds + ' ms'
        }
        $client.EndConnect($connect)
        $ssl = New-Object System.Net.Security.SslStream($client.GetStream(), $false)
        $auth = $ssl.BeginAuthenticateAsClient($HostName, $null, $null)
        if (-not $auth.AsyncWaitHandle.WaitOne($TimeoutMilliseconds, $false)) {
            return 'TCP connected; TLS TIMEOUT after ' + $TimeoutMilliseconds + ' ms'
        }
        $ssl.EndAuthenticateAsClient($auth)
        return ('TLS OK; protocol={0}; cipher={1}; bits={2}' -f $ssl.SslProtocol, $ssl.CipherAlgorithm, $ssl.CipherStrength)
    } catch {
        return 'FAIL: ' + (Get-ExceptionText $_.Exception)
    } finally {
        if ($ssl) { $ssl.Dispose() }
        if ($client) { $client.Close() }
    }
}

Add-ReportLine 'OSOO FIRESTORE DNS DIAGNOSTIC (READ ONLY)'
Add-ReportLine ('Started local: ' + $startedAt.ToString('o'))
Add-ReportLine ('Started UTC:   ' + $startedAt.ToUniversalTime().ToString('o'))
Add-ReportLine ('Rounds: ' + $Rounds + '; interval seconds: ' + $IntervalSeconds)
Add-ReportLine 'No credentials, application database, user documents, or photos are collected.'
Add-ReportLine 'Network probes: DNS queries to the configured resolver, 8.8.8.8, and 1.1.1.1; TLS handshakes to public Google endpoints.'
Add-ReportLine 'No system settings are changed. The only local output is this report file.'
Add-ReportLine ''

Add-ReportLine '[SYSTEM]'
Add-ReportLine ('PowerShell: ' + $PSVersionTable.PSVersion.ToString())
try {
    $os = Get-WmiObject -Class Win32_OperatingSystem -ErrorAction Stop
    Add-ReportLine ('Windows: ' + $os.Caption + '; version=' + $os.Version + '; build=' + $os.BuildNumber)
} catch {
    Add-ReportLine ('Windows details unavailable: ' + (Get-ExceptionText $_.Exception))
}
try {
    Add-ReportLine ('Time zone: ' + [TimeZoneInfo]::Local.Id)
} catch { }
Add-ReportLine ''

Add-ReportLine '[CONFIGURED DNS SERVERS]'
if (Get-Command Get-DnsClientServerAddress -ErrorAction SilentlyContinue) {
    try {
        $dnsConfigs = Get-DnsClientServerAddress -ErrorAction Stop |
            Where-Object { $_.ServerAddresses -and $_.ServerAddresses.Count -gt 0 }
        foreach ($dnsConfig in $dnsConfigs) {
            Add-ReportLine ('Interface=' + $dnsConfig.InterfaceAlias + '; family=' + $dnsConfig.AddressFamily + '; servers=' + ($dnsConfig.ServerAddresses -join ','))
        }
        if (-not $dnsConfigs) { Add-ReportLine 'No configured DNS server was reported.' }
    } catch {
        Add-ReportLine ('DNS server query failed: ' + (Get-ExceptionText $_.Exception))
    }
} else {
    Add-ReportLine 'Get-DnsClientServerAddress is unavailable on this Windows version.'
    Add-ReportLine 'Filtered ipconfig DNS lines follow:'
    try {
        & ipconfig.exe /all 2>&1 | Where-Object { $_ -match '(?i)DNS Servers|DNS server|DNS 서버' } | ForEach-Object { Add-ReportLine ([string]$_).Trim() }
    } catch { Add-ReportLine ('ipconfig query failed: ' + (Get-ExceptionText $_.Exception)) }
}
Add-ReportLine ''

Add-ReportLine '[HOSTS FILE MATCHES]'
$hostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
try {
    $hostMatches = Get-Content -LiteralPath $hostsPath -ErrorAction Stop |
        Where-Object { $_ -match '(?i)firestore\.googleapis\.com|googleapis\.com' -and $_ -notmatch '^\s*#' }
    if ($hostMatches) { $hostMatches | ForEach-Object { Add-ReportLine ([string]$_).Trim() } }
    else { Add-ReportLine 'No active googleapis/firestore entries found.' }
} catch { Add-ReportLine ('Hosts file could not be read: ' + (Get-ExceptionText $_.Exception)) }
Add-ReportLine ''

Add-ReportLine '[DNS LOOKUP VIA WINDOWS RESOLVER]'
$targets = @('firestore.googleapis.com', 'www.google.com')
for ($round = 1; $round -le $Rounds; $round++) {
    Add-ReportLine ('Round ' + $round + ' at ' + (Get-Date).ToString('o'))
    foreach ($target in $targets) {
        Add-ReportLine ('  ' + $target + ' => ' + (Invoke-ResolverLookup $target))
    }
    if ($round -lt $Rounds) { Start-Sleep -Seconds $IntervalSeconds }
}
Add-ReportLine ''

Add-ReportLine '[NSLOOKUP: DEFAULT DNS SERVER]'
Add-ReportLine (Invoke-Nslookup 'firestore.googleapis.com')
Add-ReportLine ''

Add-ReportLine '[NSLOOKUP: OPTIONAL PUBLIC RESOLVER COMPARISON]'
Add-ReportLine 'Direct queries to public DNS may be blocked by site policy; timeout here alone does not prove a DNS fault.'
Add-ReportLine ('Google Public DNS 8.8.8.8 => ' + (Invoke-Nslookup 'firestore.googleapis.com' '8.8.8.8'))
Add-ReportLine ('Cloudflare DNS 1.1.1.1 => ' + (Invoke-Nslookup 'firestore.googleapis.com' '1.1.1.1'))
Add-ReportLine ''

Add-ReportLine '[DIRECT TCP 443 + TLS HANDSHAKE]'
Add-ReportLine 'No Firestore credentials or application data are sent; this performs only a TLS handshake.'
Add-ReportLine ('firestore.googleapis.com => ' + (Test-TlsEndpoint 'firestore.googleapis.com'))
Add-ReportLine ('www.google.com => ' + (Test-TlsEndpoint 'www.google.com'))
Add-ReportLine ''

Add-ReportLine '[WINDOWS DNS CACHE MATCHES]'
try {
    if (Get-Command Get-DnsClientCache -ErrorAction SilentlyContinue) {
        $cacheMatches = Get-DnsClientCache -ErrorAction Stop |
            Where-Object { $_.Entry -match '(?i)firestore\.googleapis\.com|googleapis\.com' } |
            Select-Object -First 20
        if ($cacheMatches) {
            foreach ($entry in $cacheMatches) {
                Add-ReportLine ('Entry=' + $entry.Entry + '; type=' + $entry.Type + '; status=' + $entry.Status + '; data=' + $entry.Data)
            }
        } else { Add-ReportLine 'No matching cached DNS entry found.' }
    } else { Add-ReportLine 'Get-DnsClientCache is unavailable on this Windows version.' }
} catch { Add-ReportLine ('DNS cache query failed: ' + (Get-ExceptionText $_.Exception)) }
Add-ReportLine ''

Add-ReportLine ('Finished local: ' + (Get-Date).ToString('o'))
$lines | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Host ''
Write-Host 'Firestore DNS diagnostic completed.' -ForegroundColor Green
Write-Host ('Report: ' + $reportPath) -ForegroundColor Green
Write-Host 'Please send only this TXT report back through the approved support channel.' -ForegroundColor Yellow
