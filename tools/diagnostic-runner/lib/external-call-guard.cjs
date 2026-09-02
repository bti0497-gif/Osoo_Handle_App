'use strict';

/**
 * 외부 호출 차단 guard.
 *
 * 자식 프로세스(앱 서버)를 spawn할 때 NODE_OPTIONS=--require 로 주입한다.
 * 반드시 서버 기동 전에 주입되어야 한다(docs/DIAGNOSTIC_RUNNER_DEVELOPMENT_PLAN.md §4).
 *
 * 동작:
 * - 이 파일이 run 디렉터 안에 있으면(러너가 복사한 경우) 같은 디렉터의 diagnostic-env.json을
 *   읽어 process.env에 주입한다. 일부 환경에서 spawn env 값이 간헐적으로 비어 전달되므로,
 *   격리 계약(OSOO_*)은 파일 경유로 이중화한다.
 * - better-sqlite3 와 그 네이티브 바인딩(.node) 요청을 tools 로컬 Node-ABI 사본으로
 *   리다이렉트한다(루트 사본은 electron:build에 의해 Electron ABI로 뒤집힌다).
 * - http/https 요청과 net/tls 연결을 감시해 loopback 외 주소로 나가는 호출을 기록하고 차단한다.
 * - 외부 SDK(googleapis, firebase-admin, @google-cloud/bigquery 등)의 require 로드를 기록한다.
 */

const path = require('path');

// 러너가 제공하는 tools 로컬 better-sqlite3 디렉터. diagnostic-env.json에
// OOO_TOOLS_SQLITE_DIR이 있으면 그 값을 쓰고, 없으면 이 파일 위치에서 파생한다
// (<run>/guard -> <run> -> tmp -> 프로젝트 루트 -> tools/...).
let _toolsSqliteDir = String(process.env.OSOO_TOOLS_SQLITE_DIR || '').trim();

try {
  const _fs = require('fs');
  const _envFile = path.join(__dirname, 'diagnostic-env.json');
  if (_fs.existsSync(_envFile)) {
    const _injected = JSON.parse(_fs.readFileSync(_envFile, 'utf8'));
    if (_injected.OSOO_TOOLS_SQLITE_DIR && !_toolsSqliteDir) {
      _toolsSqliteDir = String(_injected.OSOO_TOOLS_SQLITE_DIR);
    }
    for (const [_k, _v] of Object.entries(_injected)) {
      if (process.env[_k] === undefined || process.env[_k] === '') {
        process.env[_k] = String(_v);
      }
    }
  }
} catch (_) { /* 주입 실패 시 기존 env에 의존한다 */ }

if (!_toolsSqliteDir) {
  // 파생 폴백: <run>/guard -> <run> -> tmp -> 프로젝트 루트
  _toolsSqliteDir = path.join(__dirname, '..', '..', '..', '..', 'tools', 'diagnostic-runner', 'node_modules', 'better-sqlite3');
}

const Module = require('module');
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const fs = require('fs');

// better-sqlite3 리다이렉트: 루트 사본은 electron:build에 의해 Electron ABI가 되고,
// 라이브 프로세스가 .node 파일을 잠아 교체도 불가능하다. tools 로컬 Node-ABI 사본으로
// 로드를 고정한다(버전 일치).
const originalModuleLoad = Module._load;
let _toolsSqliteModule = null;
function loadToolsSqlite() {
  if (!_toolsSqliteModule) {
    const pkg = path.join(_toolsSqliteDir, 'package.json');
    if (!fs.existsSync(pkg)) return null;
    _toolsSqliteModule = originalModuleLoad.call(this, _toolsSqliteDir, null, false);
  }
  return _toolsSqliteModule;
}

const SQLITE_REQUEST_RE = /(^|[\\/])better-sqlite3([\\/]|$)/;

Module._load = function patchedLoad(request, parent, isMain) {
  if (_toolsSqliteDir && typeof request === 'string' && SQLITE_REQUEST_RE.test(request)) {
    const redirected = loadToolsSqlite();
    if (redirected) return redirected;
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};

function isLoopbackHost(host) {
  const value = String(host || '').trim().toLowerCase();
  if (!value) return true; // unix socket 등 host 없는 연결은 통과
  return value === 'localhost' || value === '127.0.0.1' || value === '::1' || value === '[::1]' || value === '::ffff:127.0.0.1';
}

// 기록 경로: env 전달이 불안정한 환경에서도 동작하도록, env 값이 없으면 이 파일의
// 위치(<run>/guard/)에서 파생한다. 파생 경로는 <run>/logs/external-call-guard.jsonl.
const GUARD_LOG_PATH = (process.env.OSOO_DIAG_GUARD_LOG && process.env.OSOO_DIAG_GUARD_LOG.trim())
  || path.join(__dirname, '..', 'logs', 'external-call-guard.jsonl');

function appendRecord(record) {
  if (!GUARD_LOG_PATH) return;
  try {
    fs.mkdirSync(path.dirname(GUARD_LOG_PATH), { recursive: true });
    fs.appendFileSync(GUARD_LOG_PATH, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (_) { /* guard 자체 오류로 앱을 죽이지 않는다. */ }
}

// 부팅 증거를 PID별 파일로 항상 남긴다(플러드 방지용 요약 포함).
try {
  fs.writeFileSync(path.join(__dirname, `guard-boot-${process.pid}.json`), JSON.stringify({
    pid: process.pid,
    at: new Date().toISOString(),
    toolsSqliteDir: _toolsSqliteDir || null,
    envProbe: {
      port: Number(process.env.OSOO_API_PORT_MIN) || null,
      portRaw: process.env.OSOO_API_PORT_MIN === undefined ? 'UNDEF' : String(process.env.OSOO_API_PORT_MIN),
      packaged: process.env.OSOO_PACKAGED === '1',
      hasAppDataPath: Boolean(process.env.OSOO_APP_DATA_PATH),
      hasNodeOptions: Boolean(process.env.NODE_OPTIONS),
    },
  }, null, 2), 'utf8');
} catch (_) { /* 증거 파일 실패는 본 기능에 영향 없음 */ }

function describeTarget(args) {
  try {
    const first = args[0];
    if (typeof first === 'string') {
      const parsed = new URL(first);
      return { host: parsed.hostname, port: parsed.port || '', path: parsed.pathname };
    }
    if (first instanceof URL) {
      return { host: first.hostname, port: first.port || '', path: first.pathname };
    }
    if (first && typeof first === 'object' && !(first instanceof Buffer)) {
      const rawHost = String(first.hostname || first.host || '');
      return {
        host: rawHost.split(':')[0],
        port: String(first.port || rawHost.split(':')[1] || ''),
        path: String(first.path || first.pathname || '').split('?')[0],
      };
    }
  } catch (_) { /* 파싱 실패는 unknown으로 취급해 fail-closed */ }
  return { host: 'unknown', port: '', path: '' };
}

function guardEgress(original, protocol) {
  return function patched(...args) {
    const target = describeTarget(args);
    if (!isLoopbackHost(target.host)) {
      appendRecord({
        type: 'blocked',
        protocol,
        host: target.host,
        port: String(target.port || ''),
        path: target.path,
        at: new Date().toISOString(),
        stack: String(new Error('blocked-egress').stack || '').split('\n').slice(1, 5).join('\n'),
      });
      const error = new Error(`[diagnostic-guard] 허용되지 않은 외부 호출이 차단되었습니다: ${protocol}://${target.host}:${target.port}${target.path}`);
      error.code = 'OSOO_DIAG_EGRESS_BLOCKED';
      throw error;
    }
    return original.apply(this, args);
  };
}

http.request = guardEgress(http.request, 'http');
http.get = guardEgress(http.get, 'http');
https.request = guardEgress(https.request, 'https');
https.get = guardEgress(https.get, 'https');
net.connect = guardEgress(net.connect, 'net');
net.createConnection = guardEgress(net.createConnection, 'net');
tls.connect = guardEgress(tls.connect, 'tls');

const SDK_MODULES = new Set([
  'googleapis',
  'google-auth-library',
  '@google-cloud/bigquery',
  'firebase-admin',
  'firebase',
]);

Module._load = function sdkTracedLoad(request, parent, isMain) {
  if (_toolsSqliteDir && typeof request === 'string' && /better_sqlite3\.node$/.test(request)) {
    // bindings가 cwd 기준으로 루트 Electron-ABI .node를 열지 않도록 tools 사본으로 재작성
    const fixed = path.join(_toolsSqliteDir, 'build', 'Release', 'better_sqlite3.node');
    if (fs.existsSync(fixed)) return originalModuleLoad.call(this, fixed, parent, isMain);
  }
  if (_toolsSqliteDir && typeof request === 'string' && SQLITE_REQUEST_RE.test(request)) {
    const redirected = loadToolsSqlite();
    if (redirected) return redirected;
  }
  if (SDK_MODULES.has(String(request || ''))) {
    appendRecord({ type: 'sdk-load', module: request, at: new Date().toISOString() });
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};

appendRecord({
  type: 'guard-installed',
  pid: process.pid,
  at: new Date().toISOString(),
  envProbe: {
    port: Number(process.env.OSOO_API_PORT_MIN) || null,
    packaged: process.env.OSOO_PACKAGED === '1',
    hasAppDataPath: Boolean(process.env.OSOO_APP_DATA_PATH),
    hasGuardLog: Boolean(GUARD_LOG_PATH),
    hasNodeOptions: Boolean(process.env.NODE_OPTIONS),
  },
});
