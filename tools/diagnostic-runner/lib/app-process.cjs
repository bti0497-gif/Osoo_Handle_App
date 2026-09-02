'use strict';

/**
 * 앱 서버 자식 프로세스 수명 관리 모듈.
 *
 * - 임의 포트 확보, 격리된 환경변수 생성, server.cjs spawn, readiness 확인,
 *   종료(PID 기록·timeout·강제 종료·잔존 프로세스 확인)를 담당한다.
 * - 운영 AppData 경로를 절대 사용하지 않으며, 환경변수는 허용목록 방식으로만 전달한다.
 * - 포트는 일반 Node 방식(OSOO_API_PORT_MIN)을 사용한다. docs/DIAGNOSTIC_RUNNER_DEVELOPMENT_PLAN.md §2.2.
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const READINESS_TIMEOUT_MS = 90 * 1000;
const READINESS_INTERVAL_MS = 500;
const EXIT_GRACE_MS = 10 * 1000;

// lib → diagnostic-runner → tools → 프로젝트 루트
const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');

// 자식 프로세스에 전달할 시스템 환경변수 허용목록.
// credential 계열 환경변수는 이 목록에 없으므로 자동으로 제거된다.
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

function readBetterSqlite3Version(projectRoot) {
  try {
    const pkg = JSON.parse(fs.readFileSync(
      path.join(projectRoot, 'node_modules', 'better-sqlite3', 'package.json'), 'utf8'));
    return pkg.version || 'unknown';
  } catch (_) {
    return 'unknown';
  }
}

function probeSqliteLoad(cwd) {
  const probeScript = "try { const db = require('better-sqlite3'); const dbi = new db(':memory:'); dbi.exec('CREATE TABLE t(a)'); console.log('OK'); } catch (e) { console.error(e.message); process.exit(1); }";
  return spawnSync(process.execPath, ['-e', probeScript], {
    cwd,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 30 * 1000,
  });
}

/**
 * better-sqlite3 ABI 프리플라이트(이중 검사).
 * - 게이트: 러너/시나리오가 require하는 tools 로컬 사본. 실패 시 즉시 중단한다.
 * - 정보: 루트 사본(서버가 guard 리다이렉트로 우회하므로 게이트에서 제외, 상태만 기록).
 */
function preflightAbi() {
  const runnerRoot = path.join(__dirname, '..');
  const probeRunner = probeSqliteLoad(runnerRoot);
  const rootPkgPath = path.join(PROJECT_ROOT, 'node_modules', 'better-sqlite3', 'package.json');
  let probeRootStatus = null;
  if (fs.existsSync(rootPkgPath)) probeRootStatus = probe(PROJECT_ROOT).status;

  const betterSqlite3Version = readBetterSqlite3Version(PROJECT_ROOT);
  const runtime = {
    nodeVersion: process.version,
    nodeModulesAbi: process.versions.modules,
    betterSqlite3Version,
    architecture: `${process.arch} / ${process.platform}`,
    abiPreflight: probeRunner.status === 0 ? 'passed' : 'failed',
    rootAbiPreflight: probeRootStatus === 0 ? 'passed' : (probeRootStatus === null ? 'skipped' : 'failed'),
  };
  if (probeRunner.status !== 0) {
    const detail = String(probeRunner.stderr || probeRunner.stdout || '').trim().slice(0, 500);
    const error = new Error([
      'better-sqlite3 네이티브 모듈(tools 로컬)을 Node에서 로드할 수 없습니다 (ABI 불일치 추정).',
      `상세: ${detail}`,
      '`tools/diagnostic-runner`에서 `npm rebuild better-sqlite3` 후 다시 실행하세요.',
    ].join('\n'));
    error.runtime = runtime;
    throw error;
  }
  return runtime;
}

/** 격리 계약의 OSOO_* 환경값. env 객체와 diagnostic-env.json 양쪽에 동일하게 사용한다. */
function buildOsooValues({ workspace, token }) {
  return {
    OSOO_APP_DATA_PATH: workspace.appData,
    OSOO_MINIMAL_BUILD: '0',
    OSOO_PACKAGED: '1',
    OSOO_API_VALIDATION: '1',
    BIGQUERY_SYNC_ENABLED: 'false',
    PHOTO_NORMALIZE_ON_STARTUP: 'false',
    OSOO_SERVER_TOKEN: token,
    OSOO_DIAG_GUARD_LOG: workspace.guardLog,
  };
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
  return {
    ...base,
    TEMP: workspace.profileTemp,
    TMP: workspace.profileTemp,
    APPDATA: workspace.profileAppData,
    LOCALAPPDATA: workspace.profileLocalAppData,
    OSOO_API_PORT_MIN: String(port),
    ...buildOsooValues({ workspace, token }),
    // NODE_OPTIONS 는 공백으로 인자를 나누고 따옴표 안의 백슬래시를 이스케이프로 소비한다.
    // 그래서 공백 포함 경로는 따옴표로 감싸고, 구분자는 슬래시로 정규화한다.
    NODE_OPTIONS: `--require "${path.join(projectRoot, 'tools', 'diagnostic-runner', 'lib', 'external-call-guard.cjs').split(path.sep).join('/')}"`,
  };
}

/** server.cjs 를 spawn 한다. guard는 반드시 이 시점의 환경에 포함되어 있어야 한다(§4 3단계). */
function startServer({ projectRoot, workspace, port, token }) {
  const env = buildIsolatedEnv({ projectRoot, workspace, port, token });
  const guardDir = path.join(workspace.runDir, 'guard');
  fs.mkdirSync(guardDir, { recursive: true });
  // guard 복사본과 diagnostic-env.json을 run 디렉터에 둔다. guard는 preload 시점에 이 JSON을
  // 읽어 비어 있는 OSOO_* env를 process.env에 재주입하므로, spawn env 전달이 불안정한 환경에서도
  // 포트·격리 계약이 유지된다.
  const guardCopy = path.join(guardDir, 'external-call-guard.cjs');
  fs.copyFileSync(path.join(projectRoot, 'tools', 'diagnostic-runner', 'lib', 'external-call-guard.cjs'), guardCopy);
  fs.writeFileSync(path.join(guardDir, 'diagnostic-env.json'), JSON.stringify({ ...buildOsooValues({ workspace, token }), OSOO_API_PORT_MIN: String(port) }, null, 2), 'utf8');
  env.NODE_OPTIONS = `--require "${guardCopy.split(path.sep).join('/')}"`;
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

/**
 * guard 부팅 증거(guard-installed 레코드 또는 guard-boot-<pid>.json)를 기다린다.
 * 증거가 없어도 치명적이지 않다: guard 기록 경로는 위치 파생으로 항상 기록되며,
 * 부팅 실패는 readiness 단계에서 잡힌다.
 */
async function waitForGuardBoot(guardDir, guardLogPath, { timeoutMs = 8000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let probe = null;
  while (Date.now() < deadline && !probe) {
    try {
      if (fs.existsSync(guardLogPath)) {
        const logContent = fs.readFileSync(guardLogPath, 'utf8');
        for (const line of logContent.split('\n')) {
          if (!line.trim()) continue;
          try {
            const record = JSON.parse(line);
            if (record.type === 'guard-installed' && record.envProbe) { probe = record.envProbe; break; }
          } catch (_) { /* 부분 라인 무시 */ }
        }
      }
      if (!probe && fs.existsSync(guardDir)) {
        for (const entry of fs.readdirSync(guardDir)) {
          if (!entry.startsWith('guard-boot-') || !entry.endsWith('.json')) continue;
          try {
            const boot = JSON.parse(fs.readFileSync(path.join(guardDir, entry), 'utf8'));
            if (boot.envProbe) { probe = boot.envProbe; break; }
          } catch (_) { /* 부분 파일 무시 */ }
        }
      }
    } catch (_) { /* 읽기 재시도 */ }
    if (!probe) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return probe;
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
    stdioStream.end();
    return { exited: !isProcessAlive(pid), orphaned: isProcessAlive(pid) };
  }
  const exited = new Promise((resolve) => child.once('exit', () => resolve()));
  child.kill();
  const timeout = new Promise((resolve) => setTimeout(resolve, graceMs));
  await Promise.race([exited, timeout]);
  if (isProcessAlive(pid)) {
    // Windows에서 kill() 신호가 무시될 수 있으므로 강제 종료(트리 포함)로 확정한다.
    try { spawnSync('taskkill', ['/PID', String(pid), '/F', '/T'], { windowsHide: true }); } catch (_) { /* 무시 */ }
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && isProcessAlive(pid)) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1500))]);
  }
  stdioStream.end();
  return { exited: !isProcessAlive(pid), orphaned: isProcessAlive(pid) };
}

module.exports = {
  resolveFreePort,
  preflightAbi,
  buildIsolatedEnv,
  buildOsooValues,
  startServer,
  waitForReady,
  waitForGuardBoot,
  stopServer,
  isProcessAlive,
  READINESS_TIMEOUT_MS,
};
