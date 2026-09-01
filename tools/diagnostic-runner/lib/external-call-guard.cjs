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
 *   격리 계약(OSOO_*)은 파일 경유로 이중화한다. 서버 코드보다 먼저 실행되는 preload 시점이라
 *   서버가 포트를 읽기 전에 주입이 끝난다.
 * - http/https 요청과 net/tls 연결을 감시해 loopback(localhost, 127.0.0.1, ::1) 외
 *   주소로 나가는 호출을 기록하고 즉시 차단(throw)한다.
 * - 외부 SDK(googleapis, firebase-admin, @google-cloud/bigquery 등)의 require 로드를
 *   기록한다. 로드 자체는 차단하지 않고 결과 리포트의 증거로 남긴다.
 *
 * 이 모듈은 앱 코드가 아니라 진단 도구의 일부이며, 운영 실행 경로에는 절대 주입되지 않는다.
 */

// 1) side-channel env 주입 — 어떤 process.env 읽기보다 먼저 실행되어야 한다.
let _injectedCount = -1;
try {
  const _fs = require('fs');
  const _path = require('path');
  const _envFile = _path.join(__dirname, 'diagnostic-env.json');
  if (_fs.existsSync(_envFile)) {
    const _injected = JSON.parse(_fs.readFileSync(_envFile, 'utf8'));
    _injectedCount = 0;
    for (const [_k, _v] of Object.entries(_injected)) {
      if (process.env[_k] === undefined || process.env[_k] === '') {
        process.env[_k] = String(_v);
        _injectedCount += 1;
      }
    }
    process.stderr.write(`[diagnostic-guard] env 주입: ${_injectedCount}/${Object.keys(_injected).length}키 (${_envFile})\n`);
  } else {
    process.stderr.write(`[diagnostic-guard] diagnostic-env.json 없음: ${_envFile}\n`);
  }
} catch (_e) {
  process.stderr.write(`[diagnostic-guard] env 주입 실패: ${_e.message}\n`);
}

const Module = require('module');
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');

// 기록 경로: env 전달이 불안정한 환경에서도 동작하도록, env 값이 없으면 이 파일의
// 위치(<run>/guard/)에서 파생한다. 파생 경로는 <run>/logs/external-call-guard.jsonl.
const GUARD_LOG_PATH = (process.env.OSOO_DIAG_GUARD_LOG && process.env.OSOO_DIAG_GUARD_LOG.trim())
  || path.join(__dirname, '..', 'logs', 'external-call-guard.jsonl');

// 부팅 증거를 PID별 파일로 항상 남긴다(GUARD_LOG_PATH 유무와 무관). stdio 인터리브로
// 재시도 간 출력을 구분할 수 없으므로, 프로세스 단위 검증은 이 파일로 한다.
try {
  fs.writeFileSync(path.join(__dirname, `guard-boot-${process.pid}.json`), JSON.stringify({
    pid: process.pid,
    at: new Date().toISOString(),
    injectedCount: _injectedCount,
    envProbe: {
      port: Number(process.env.OSOO_API_PORT_MIN) || null,
      portRaw: JSON.stringify(process.env.OSOO_API_PORT_MIN),
      packagedRaw: JSON.stringify(process.env.OSOO_PACKAGED),
      packaged: process.env.OSOO_PACKAGED === '1',
      hasAppDataPath: Boolean(process.env.OSOO_APP_DATA_PATH),
      guardLogLen: (process.env.OSOO_DIAG_GUARD_LOG || '').length,
      hasNodeOptions: Boolean(process.env.NODE_OPTIONS),
    },
  }, null, 2), 'utf8');
} catch (_) { /* 증거 파일 실패는 본 기능에 영향 없음 */ }

function isLoopbackHost(host) {
  const value = String(host || '').trim().toLowerCase();
  if (!value) return true; // unix socket 등 host 없는 연결은 loopback 으로 간주하지 않고 통과
  return value === 'localhost' || value === '127.0.0.1' || value === '::1' || value === '[::1]' || value === '::ffff:127.0.0.1';
}

function appendRecord(record) {
  if (!GUARD_LOG_PATH) return;
  try {
    fs.mkdirSync(path.dirname(GUARD_LOG_PATH), { recursive: true });
    fs.appendFileSync(GUARD_LOG_PATH, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (_) {
    // guard 자체 오류로 앱을 죽이지 않는다.
  }
}

function describeTarget(args) {
  try {
    const first = args[0];
    if (typeof first === 'string') {
      // http.get('http://example.com/') 형태: URL 문자열이 첫 인자로 온다.
      const parsed = new URL(first);
      return { host: parsed.hostname, port: parsed.port || '', path: parsed.pathname };
    }
    if (first instanceof URL) {
      return { host: first.hostname, port: first.port || '', path: first.pathname };
    }
    if (first && typeof first === 'object' && !(first instanceof Buffer)) {
      const rawHost = String(first.hostname || first.host || '');
      const host = rawHost.split(':')[0];
      return {
        host,
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

const SDK_MODULES = new Set([
  'googleapis',
  'google-auth-library',
  '@google-cloud/bigquery',
  'firebase-admin',
  'firebase',
]);

const originalModuleLoad = Module._load;
http.request = guardEgress(http.request, 'http');
http.get = guardEgress(http.get, 'http');
https.request = guardEgress(https.request, 'https');
https.get = guardEgress(https.get, 'https');
net.connect = guardEgress(net.connect, 'net');
net.createConnection = guardEgress(net.createConnection, 'net');
tls.connect = guardEgress(tls.connect, 'tls');


appendRecord({
  type: 'guard-installed',
  pid: process.pid,
  at: new Date().toISOString(),
  // 격리 계약 검증용: guard가 본 자식 프로세스의 핵심 env 프로브(값은 기록하지 않음)
  envProbe: {
    port: Number(process.env.OSOO_API_PORT_MIN) || null,
    packaged: process.env.OSOO_PACKAGED === '1',
    hasAppDataPath: Boolean(process.env.OSOO_APP_DATA_PATH),
    hasGuardLog: Boolean(GUARD_LOG_PATH),
  },
});
