const { execSync } = require('child_process');

const KNOWN_REMOTE_PROCESSES = [
  'teamviewer.exe',
  'teamviewer_service.exe',
  'anydesk.exe',
  'anydesk_service.exe',
  'remoting_host.exe',
  'remoting_desktop.exe',
  'chrome_remote_desktop_host.exe',
  'rustdesk.exe',
  'rustdesk-service.exe',
  'parsecd.exe',
  'todesk.exe',
  'sunloginclient.exe',
  'awesun.exe',
  'anypc.exe',
  'anypcviewer.exe',
  'anypcservice.exe'
];

const KNOWN_REMOTE_PROCESS_KEYWORDS = [
  'teamviewer',
  'anydesk',
  'remoting_host',
  'chrome_remote_desktop',
  'rustdesk',
  'anypc',
  'parsec',
  'todesk',
  'sunlogin',
  'awesun'
];

const REMOTE_TOOL_LABELS = [
  ['rustdesk', 'RustDesk'],
  ['teamviewer', 'TeamViewer'],
  ['anydesk', 'AnyDesk'],
  ['chrome_remote_desktop', 'Chrome Remote Desktop'],
  ['remoting_host', 'Chrome Remote Desktop'],
  ['parsec', 'Parsec'],
  ['todesk', 'ToDesk'],
  ['sunlogin', 'Sunlogin'],
  ['awesun', 'AweSun'],
  ['anypc', 'AnyPC']
];

function getRemoteToolLabel(processName) {
  const normalized = String(processName || '').toLowerCase();
  return REMOTE_TOOL_LABELS.find(([keyword]) => normalized.includes(keyword))?.[1] || processName;
}

function tryReadTasklistProcessEntries() {
  try {
    const output = execSync('tasklist /fo csv /nh', {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return String(output || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('","');
        if (parts.length < 2) return null;
        return {
          name: parts[0].replace(/^"/, '').toLowerCase(),
          pid: parts[1].replace(/"/g, '')
        };
      })
      .filter(Boolean);
  } catch {
    return null;
  }
}

function tryFindActiveRemoteConnections(procs) {
  if (!procs || procs.length === 0) return [];
  try {
    const netstat = execSync('netstat -ano -p tcp', {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const active = [];
    for (const proc of procs) {
      const pidRegex = new RegExp(`\\s+ESTABLISHED\\s+${proc.pid}\\s*$`, 'm');
      if (pidRegex.test(netstat)) {
        active.push({
          toolName: getRemoteToolLabel(proc.name),
          procName: proc.name,
          pid: proc.pid
        });
      }
    }
    return active;
  } catch {
    return null;
  }
}

let lastDetectCache = null;
let lastDetectAt = 0;

function detectRemoteSession({ useCache = false } = {}) {
  const now = Date.now();
  if (useCache && lastDetectCache && (now - lastDetectAt < 1500)) {
    return lastDetectCache;
  }

  const confirmedIndicators = [];
  const sessionName = String(process.env.SESSIONNAME || '').trim();
  const clientName = String(process.env.CLIENTNAME || '').trim();
  const sshConnection = String(process.env.SSH_CONNECTION || '').trim();

  if (sessionName.toUpperCase().startsWith('RDP-')) {
    confirmedIndicators.push(`session:${sessionName}`);
  }
  if (clientName && clientName.toUpperCase() !== 'CONSOLE') {
    confirmedIndicators.push(`client:${clientName}`);
  }
  if (sshConnection) {
    confirmedIndicators.push('ssh_connection');
  }

  const runningEntries = tryReadTasklistProcessEntries();
  if (runningEntries === null) {
    return {
      detected: true,
      sessionType: 'unverified',
      evidence: 'tasklist-unavailable',
      observedTools: [],
      verificationFailed: true,
    };
  }
  const runningProcessNames = runningEntries.map((e) => e.name);
  const matchedRemoteProcesses = KNOWN_REMOTE_PROCESSES
    .filter((name) => runningProcessNames.includes(name));
  const matchedByKeyword = runningProcessNames
    .filter((proc) => KNOWN_REMOTE_PROCESS_KEYWORDS.some((keyword) => proc.includes(keyword)))
    .filter((proc) => !matchedRemoteProcesses.includes(proc));

  const matchedEntries = runningEntries.filter((e) =>
    matchedRemoteProcesses.includes(e.name) ||
    KNOWN_REMOTE_PROCESS_KEYWORDS.some((k) => e.name.includes(k))
  );

  const observedTools = [...new Set(
    [...matchedRemoteProcesses, ...matchedByKeyword].map(getRemoteToolLabel)
  )];

  // Active remote connection check (e.g. AnyDesk, TeamViewer, RustDesk, Chrome Remote connected)
  const activeRemoteSessions = tryFindActiveRemoteConnections(matchedEntries);
  if (activeRemoteSessions === null) {
    return {
      detected: true,
      sessionType: 'unverified',
      evidence: 'netstat-unavailable',
      observedTools,
      verificationFailed: true,
    };
  }
  for (const active of activeRemoteSessions) {
    confirmedIndicators.push(`active_remote:${active.toolName}(PID:${active.pid})`);
  }

  if (runningProcessNames.includes('rdpclip.exe')) {
    confirmedIndicators.push('active_remote:Windows RDP(rdpclip.exe)');
  }

  // A tray/service process only means that remote access is available. It is
  // not proof that a remote operator is currently controlling this PC. Keep
  // the list out of attendance evidence so central monitoring cannot mistake
  // an installed tray tool for an active remote session.
  const detected = confirmedIndicators.length > 0;
  let sessionType = 'local';
  if (sessionName.toUpperCase().startsWith('RDP-') || (clientName && clientName.toUpperCase() !== 'CONSOLE') || runningProcessNames.includes('rdpclip.exe')) {
    sessionType = 'Windows RDP';
  } else if (sshConnection) {
    sessionType = 'SSH';
  } else if (activeRemoteSessions.length > 0) {
    sessionType = activeRemoteSessions[0].toolName;
  }

  const result = {
    detected,
    sessionType,
    evidence: confirmedIndicators.join('; '),
    observedTools
  };

  lastDetectCache = result;
  lastDetectAt = now;
  return result;
}

module.exports = {
  detectRemoteSession
};
