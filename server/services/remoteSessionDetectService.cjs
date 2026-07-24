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

function tryReadTasklistProcessNames() {
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
        const first = line.split('","')[0] || '';
        return first.replace(/^"/, '').replace(/"$/, '').toLowerCase();
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function detectRemoteSession() {
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

  const runningProcessNames = tryReadTasklistProcessNames();
  const matchedRemoteProcesses = KNOWN_REMOTE_PROCESSES
    .filter((name) => runningProcessNames.includes(name));
  const matchedByKeyword = runningProcessNames
    .filter((proc) => KNOWN_REMOTE_PROCESS_KEYWORDS.some((keyword) => proc.includes(keyword)))
    .filter((proc) => !matchedRemoteProcesses.includes(proc));

  const observedTools = [...new Set(
    [...matchedRemoteProcesses, ...matchedByKeyword].map(getRemoteToolLabel)
  )];

  // A tray/service process only means that remote access is available. It is
  // not proof that a remote operator is currently controlling this PC. Keep
  // the list out of attendance evidence so central monitoring cannot mistake
  // an installed tray tool for an active remote session.
  const detected = confirmedIndicators.length > 0;
  let sessionType = 'local';
  if (sessionName.toUpperCase().startsWith('RDP-') || (clientName && clientName.toUpperCase() !== 'CONSOLE')) {
    sessionType = 'Windows RDP';
  } else if (sshConnection) {
    sessionType = 'SSH';
  }

  return {
    detected,
    sessionType,
    evidence: confirmedIndicators.join('; '),
    observedTools
  };
}

module.exports = {
  detectRemoteSession
};
