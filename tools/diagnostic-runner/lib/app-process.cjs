'use strict';

/**
 * 앱 서버 자식 프로세스 수명 관리 모듈.
 *
 * - 임의 포트 확보, 격리된 환경변수 생성, server.cjs spawn, readiness 확인,
 *   종료(PID 기록·timeout·강제 종료·잔존 프로세스 확인)를 담당한다.
 * - 운영 AppData 경로를 절대 사용하지 않으며, 환경변수는 허용목록 방식으로만 전달한다.
 * - Electron 방식(ELECTRON=1 + OSOO_API_PORT)은 범위 밖이므로 일반 Node 방식
 *   (OSOO_API_PORT_MIN)을 사용한다. docs/DIAGNOSTIC_RUNNER_DEVELOPMENT_PLAN.md §2.2.
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const READINESS_TIMEOUT_MS = 90 * 1000;
const READINESS_INTERVAL_MS = 500;
const EXIT_GRACE_MS = 10 * 1000;

// 자식 프로세스에 전달할 시스템 환경변수 허용목록.
// Google/Firebase/BigQuery/KMA 관련 credential 환경변수는 이 목록에 없으므로 자동으로 제거된다.
const ALLOWED_SYSTEM_ENV = [
  'ALLUSERSPROFILE',
  'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)',
  'COMPUTERNAME',
  'COMSPEC',
  'HOMEDRIVE',
  'HOMEPATH',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'PATH',
  'PATHEXT',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'PROCESSOR_LEVEL',
  'PROCESSOR_REVISION',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'USERNAME',
  'USERDOMAIN',
  'WINDIR',
];

/** 잠깐 닫을 수 있는 포트를 하나 확보해 반환한다(경합 시 readiness/exit 감지로 처리). */
function resolveFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : null;
      probe.close(() => (port ? resolve(port) : reject(new Error('포트를 확보하지 못했습니다.'))));
    });
  });
}

/**
 * better-sqlite3 ABI 프리플라이트.
 * electron:build/@electron/rebuild 직후에는 네이티브 모듈이 Electron ABI로 재빌드되어
 * 순수 Node에서 로드에 실패한다. 업무 시나리오 전에 명확히 실패시킨다(§Phase 1).
 */
function preflightAbi(projectRoot) {
  const probeScript = "try { const db = require('better-sqlite3'); const dbi = new db(':memory:'); dbi.exec('CREATE TABLE t(a)'); console.log('OK'); } catch (e) { console.error(e.message); process.exit(1); }";
  const result = spawnSync(process.execPath, ['-e', probeScript], {
    cwd: projectRoot,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 30 * 1000,
  });
  const betterSqlite3Version = readBetterSqlite3Version(projectRoot);
  const runtime = {
    nodeVersion: process.version,
    nodeModulesAbi: process.versions.modules,
    betterSqlite3Version,
    architecture: `${process.arch} / ${process.platform}`,
    abiPreflight: result.status === 0 ? 'passed' : 'failed',
  };
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().slice(0, 500);
    const error = new Error([
      'better-sqlite3 네이티브 모듈을 Node에서 로드할 수 없습니다 (ABI 불일치 추정).',
      `상세: ${detail}`,
      'electron:build 직후라면 `npm rebuild better-sqlite3` 로 Node ABI로 되돌린 뒤 다시 실행하세요.',
    ].join('\n'));
    error.runtime = runtime;
    throw error;
  }
  return runtime;
}

function readBetterSqlite3Version(projectRoot) {
  try {
    const pkg = JSON.parse(fs.readFileSync(
      path.join(projectRoot, 'node_modules', 'better-sqlite3', 'package.json'), 'utf8'));
    return pkg.version || 'unknown';
  } catch (_) {
    return 'unknown';
  }
}

/**
 * 격리된 자식 프로세스 환경을 만든다.
 * APPDATA/LOCALAPPDATA를 임시 프로필로 격리하고, NODE_OPTIONS로 외부 호출 guard를 주입한다.
 */
function buildIsolatedEnv({ projectRoot, workspace, port, token }) {
  const base = {};
  for (const key of ALLOWED_SYSTEM_ENV) {
    if (process.env[key] !== undefined) base[key] = process.env[key];
  }
  const env = {
    ...base,
    TEMP: workspace.profileTemp,
    TMP: workspace.profileTemp,
    APPDATA: workspace.profileAppData,
    LOCALAPPDATA: workspace.profileLocalAppData,
    OSOO_APP_DATA_PATH: workspace.appData,
    OSOO_API_PORT_MIN: String(port),
    OSOO_MINIMAL_BUILD: '0',
    OSOO_PACKAGED: '1',
    OSOO_API_VALIDATION: '1',
    BIGQUERY_SYNC_ENABLED: 'false',
    PHOTO_NORMALIZE_ON_STARTUP: 'false',
    OSOO_SERVER_TOKEN: token,
    // NODE_OPTIONS 는 공백으로 인자를 나누고 따옴표 안의 백슬래시를 이스케이프로 소비한다.
    // 그래서 공백 포함 경로는 따옴표로 감싸고, 구분자는 슬래시로 정규화한다.
    NODE_OPTIONS: `--require "${path.join(projectRoot, 'tools', 'diagnostic-runner', 'lib', 'external-call-guard.cjs').split(path.sep).join('/')}"`,
  };
  return env;
}

/** server.cjs 를 spawn 한다. guard는 반드시 이 시점의 환경에 포함되어 있어야 한다(§4 3단계). */
function startServer({ projectRoot, workspace, port, token }) {
  const env = buildIsolatedEnv({ projectRoot, workspace, port, token });
  const stdioStream = fs.createWriteStream(workspace.serverStdioLog, { flags: 'a' });
  const child = spawn(process.execPath, ['server.cjs'], {
    cwd: projectRoot,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const record = (line) => {
    stdioStream.write(`${line}\n`);
  };
  child.stdout.on('data', (chunk) => record(String(chunk)));
  child.stderr.on('data', (chunk) => record(String(chunk)));
  return { child, pid: child.pid, port, token, env, stdioStream };
}

/** /api/ping 이 { app:'osoo-handle-app', ready:true } 를 반환할 때까지 확인한다. */
async function waitForReady({ port, token, timeoutMs = READINESS_TIMEOUT_MS }) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/ping`, {
        headers: { 'x-osoo-server-token': token },
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        const payload = await response.json().catch(() => ({}));
        if (payload && payload.app === 'osoo-handle-app' && payload.ready === true) {
          return payload;
        }
        lastError = `ready=false 응답: ${JSON.stringify(payload).slice(0, 200)}`;
      } else {
        lastError = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, READINESS_INTERVAL_MS));
  }
  throw new Error(`서버가 ${Math.round(timeoutMs / 1000)}초 내에 ready 상태가 되지 않았습니다. 마지막 상태: ${lastError}`);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * 자식 프로세스를 종료하고 잔존 여부를 확인한다.
 * 러너가 생성한 PID만 종료하며, 기존 포트 점유 프로세스는 건드리지 않는다(§Phase 1).
 */
async function stopServer(serverProcess, { graceMs = EXIT_GRACE_MS } = {}) {
  const { child, pid, stdioStream } = serverProcess;
  if (!child || child.exitCode !== null || child.killed) {
    await new Promise((resolve) => stdioStream.end(resolve));
    return { exited: true, orphaned: isProcessAlive(pid) };
  }
  const exited = new Promise((resolve) => child.once('exit', () => resolve()));
  child.kill();
  const timeout = new Promise((resolve) => setTimeout(resolve, graceMs));
  await Promise.race([exited, timeout]);
  if (child.exitCode === null) {
    try { child.kill('SIGKILL'); } catch (_) { /* 이미 종료됨 */ }
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
  await new Promise((resolve) => stdioStream.end(resolve));
  const orphaned = isProcessAlive(pid);
  return { exited: !orphaned, orphaned };
}

module.exports = {
  resolveFreePort,
  preflightAbi,
  buildIsolatedEnv,
  startServer,
  waitForReady,
  stopServer,
  isProcessAlive,
  READINESS_TIMEOUT_MS,
};
