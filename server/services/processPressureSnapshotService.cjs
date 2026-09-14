'use strict';
const { execFile } = require('child_process');
let pending = false;
let lastAttempt = 0;

// One bounded, asynchronous sample per 30 minutes. No command lines or user paths.
function collectProcessPressureSnapshot(done) {
  if (process.platform !== 'win32' || pending || Date.now() - lastAttempt < 30 * 60 * 1000) return;
  pending = true;
  lastAttempt = Date.now();
  const script = "$ErrorActionPreference='Stop'; $rows = if (Get-Command Get-CimInstance -ErrorAction SilentlyContinue) { Get-CimInstance Win32_Process } else { Get-WmiObject Win32_Process }; @($rows | Sort-Object {[double]$_.WorkingSetSize} -Descending | Select-Object -First 8 Name,ProcessId,WorkingSetSize,PageFileUsage,PageFaults,ReadTransferCount,WriteTransferCount,KernelModeTime,UserModeTime) | ConvertTo-Json -Compress";
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, timeout: 8000, maxBuffer: 64 * 1024, encoding: 'utf8' }, (error, stdout) => {
      pending = false;
      if (error) return done({ available: false, reason: error.killed ? 'timeout' : 'collection-failed' });
      try { done({ available: true, counters: 'cumulative; not instantaneous utilization', processes: JSON.parse(stdout) }); }
      catch (_) { done({ available: false, reason: 'invalid-response' }); }
    });
}
module.exports = { collectProcessPressureSnapshot };
