'use strict';

/**
 * 외부 호출 차단 guard.
 *
 * 자식 프로세스(앱 서버)를 spawn할 때 NODE_OPTIONS=--require 로 주입한다.
 * 반드시 서버 기동 전에 주입되어야 한다(docs/DIAGNOSTIC_RUNNER_DEVELOPMENT_PLAN.md §4).
 *
 * 동작:
 * - http/https 요청과 net/tls 연결을 감시해 loopback(localhost, 127.0.0.1, ::1) 외
 *   주소로 나가는 호출을 기록하고 즉시 차단(throw)한다.
 * - 외부 SDK(googleapis, firebase-admin, @google-cloud/bigquery 등)의 require 로드를
 *   기록한다. 로드 자체는 차단하지 않고 결과 리포트의 증거로 남긴다.
 *
 * 이 모듈은 앱 코드가 아니라 진단 도구의 일부이며, 운영 실행 경로에는 절대 주입되지 않는다.
 */

const Module = require('module');
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');

const GUARD_LOG_PATH = process.env.OSOO_DIAG_GUARD_LOG || '';

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

function describeTarget(options, url) {
  try {
    if (typeof url === 'string') {
      const parsed = new URL(url);
      return { host: parsed.hostname, port: parsed.port || '', path: parsed.pathname };
    }
    if (url && typeof url === 'object' && !(url instanceof Buffer)) {
      options = { ...url, ...options };
    }
    return {
      host: options.hostname || options.host || '',
      port: options.port || '',
      path: String(options.path || options.pathname || '').split('?')[0],
    };
  } catch (_) {
    return { host: 'unknown', port: '', path: '' };
  }
}

function guardEgress(original, protocol) {
  return function patched(...args) {
    const target = describeTarget(args[0], args[1]);
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
Module._load = function patchedLoad(request, parent, isMain) {
  if (SDK_MODULES.has(String(request || ''))) {
    appendRecord({
      type: 'sdk-load',
      module: request,
      at: new Date().toISOString(),
    });
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};

http.request = guardEgress(http.request, 'http');
http.get = guardEgress(http.get, 'http');
https.request = guardEgress(https.request, 'https');
https.get = guardEgress(https.get, 'https');
net.connect = guardEgress(net.connect, 'net');
net.createConnection = guardEgress(net.createConnection, 'net');
tls.connect = guardEgress(tls.connect, 'tls');

appendRecord({ type: 'guard-installed', pid: process.pid, at: new Date().toISOString() });
