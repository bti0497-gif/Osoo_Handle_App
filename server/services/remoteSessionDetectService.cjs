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
  const indicators = [];
  const sessionName = String(process.env.SESSIONNAME || '').trim();
  const clientName = String(process.env.CLIENTNAME || '').trim();
  const sshConnection = String(process.env.SSH_CONNECTION || '').trim();

  if (sessionName.toUpperCase().startsWith('RDP-')) {
    indicators.push(`session:${sessionName}`);
  }
  if (clientName && clientName.toUpperCase() !== 'CONSOLE') {
    indicators.push(`client:${clientName}`);
  }
  if (sshConnection) {
    indicators.push('ssh_connection');
  }

  const runningProcessNames = tryReadTasklistProcessNames();
  const matchedRemoteProcesses = KNOWN_REMOTE_PROCESSES
    .filter((name) => runningProcessNames.includes(name));
  const matchedByKeyword = runningProcessNames
    .filter((proc) => KNOWN_REMOTE_PROCESS_KEYWORDS.some((keyword) => proc.includes(keyword)))
    .filter((proc) => !matchedRemoteProcesses.includes(proc));

  matchedRemoteProcesses.forEach((proc) => indicators.push(`proc:${proc}`));
  matchedByKeyword.forEach((proc) => indicators.push(`proc:${proc}`));

  const detected = indicators.length > 0;
  let sessionType = 'local';
  if (sessionName.toUpperCase().startsWith('RDP-') || clientName) {
    sessionType = 'rdp';
  } else if (matchedRemoteProcesses.length > 0 || matchedByKeyword.length > 0) {
    sessionType = 'remote_app';
  } else if (sshConnection) {
    sessionType = 'ssh';
  }

  return {
    detected,
    sessionType,
    evidence: indicators.join('; ')
  };
}

module.exports = {
  detectRemoteSession
};
