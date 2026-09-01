'use strict';

/**
 * UI 진단 세션 관리: Vite 개발 서버 수명 관리 + Playwright 브라우저/컨텍스트 생성.
 *
 * 계약(docs/DIAGNOSTIC_RUNNER_DEVELOPMENT_PLAN.md §Phase 4):
 * - Vite는 18735 고정. 점유 중이면 기존 프로세스를 종료하지 않고 중단한다.
 * - 백엔드는 운영 기본 포트 18731(러너 본체가 spawn). renderer는 자체 탐색으로 발견한다.
 * - 브라우저는 순수 Chromium(Electron preload 없음). 테스트용 window.electronAPI shim을
 *   addInitScript로 주입하며, 허용목록 외 메서드 접근을 기록한다.
 * - context.route()로 loopback 외 요청을 차단하고 횟수·URL을 기록한다.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const VITE_PORT = 18735;
const VITE_URL = `http://localhost:${VITE_PORT}`;
const VITE_READY_TIMEOUT_MS = 60 * 1000;

function isPortBusy(port) {
  return new Promise((resolve) => {
    const probe = net.connect(port, '127.0.0.1');
    probe.setTimeout(1500);
    probe.on('connect', () => { probe.destroy(); resolve(true); });
    probe.on('error', () => resolve(false));
    probe.on('timeout', () => { probe.destroy(); resolve(true); });
  });
}

async function waitForHttpOk(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.status < 500) return true;
    } catch (_) { /* 기동 전 */ }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

/**
 * Vite 개발 서버를 spawn하고 readiness를 확인한다.
 * 반환한 stopProcess는 반드시 호출해야 하며(§Phase 4), PID 기록·강제 종료·잔존 확인을 한다.
 */
async function startVite(projectRoot) {
  if (await isPortBusy(VITE_PORT)) {
    const error = new Error(`포트 ${VITE_PORT}(Vite 개발 서버)가 이미 점유되어 있습니다. 기존 프로세스를 종료하지 않고 진단을 중단합니다.`);
    error.errorCode = 'VITE_PORT_BUSY';
    throw error;
  }
  const viteBin = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(viteBin)) {
    const error = new Error('루트 node_modules에서 vite를 찾을 수 없습니다. `npm install` 후 다시 실행하세요.');
    error.errorCode = 'VITE_MISSING';
    throw error;
  }
  const child = spawn(process.execPath, [viteBin, '--strictPort'], {
    cwd: projectRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ready = await waitForHttpOk(VITE_URL, VITE_READY_TIMEOUT_MS);
  if (!ready || child.exitCode !== null) {
    try { child.kill('SIGKILL'); } catch (_) { /* 이미 종료됨 */ }
    const error = new Error('Vite 개발 서버가 기동되지 않았습니다.');
    error.errorCode = 'VITE_NOT_READY';
    throw error;
  }
  const stopProcess = async () => {
    try { child.kill(); } catch (_) { /* 이미 종료됨 */ }
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && child.exitCode === null) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (child.exitCode === null) {
      try { spawnSyncKill(child.pid); } catch (_) { /* 무시 */ }
    }
    const orphaned = await isPortBusy(VITE_PORT);
    return { exited: child.exitCode !== null || !orphaned, orphaned };
  };
  return { child, pid: child.pid, url: VITE_URL, stopProcess };
}

function spawnSyncKill(pid) {
  const { spawnSync } = require('child_process');
  spawnSync('taskkill', ['/PID', String(pid), '/F', '/T'], { windowsHide: true });
}

/** electronAPI shim이 기록한 허용목록 외 메서드 호출을 회수한다. */
async function collectShimViolations(page) {
  try {
    return await page.evaluate(() => (window.__osooDiag ? window.__osooDiag.shimViolations.slice() : []));
  } catch (_) {
    return [];
  }
}

/**
 * 브라우저 컨텍스트를 만든다: loopback 외 요청 차단 + electronAPI shim + 오류 수집.
 * shim 허용목록은 계획 문서 §Phase 4의 최소 집합과 셸 진입에 필요한 기본 메서드다.
 */
async function createUiContext({ browser, token, siteId, uiDiag }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  await context.route('**/*', (route) => {
    try {
      const parsed = new URL(route.request().url());
      const host = parsed.hostname;
      const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
      if (loopback) return route.continue();
      uiDiag.blockedRequests.push(`${parsed.protocol}//${parsed.host}${parsed.pathname}`.slice(0, 140));
      return route.abort();
    } catch (_) {
      return route.abort();
    }
  });

  const allowListNote = JSON.stringify(Object.keys(shimMethods(token, siteId)));
  await context.addInitScript(({ injectedToken, injectedSiteId, allowKeys }) => {
    window.__osooDiag = { shimViolations: [] };
    const methods = {
      getServerToken: async () => injectedToken,
      getDefaultSiteContext: async () => ({ siteId: injectedSiteId }),
      getVersion: async () => 'diagnostic-ui',
      checkVersionChanged: async () => ({ versionChanged: false }),
      clearVersionMarker: async () => undefined,
      getSharedAuthenticatedUser: async () => null,
      setSharedAuthenticatedUser: async () => undefined,
      resetGlobalAuthenticatedSession: async () => undefined,
      getStartupRecoveryState: async () => ({}),
      reportRendererReady: async () => undefined,
      getUpdateStatus: async () => ({ status: 'disabled' }),
      checkForUpdates: async () => undefined,
      onSessionReset: () => () => undefined,
      onGlobalSessionReset: () => () => undefined,
      onWindowRestored: () => () => undefined,
      onServerRecoveryProgress: () => () => undefined,
      onNativeFocusEvent: () => () => undefined,
      onOpenPopupModal: () => () => undefined,
    };
    const handler = {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop === 'symbol') return undefined;
        window.__osooDiag.shimViolations.push(String(prop));
        return async () => {
          throw new Error('electronAPI shim 미정의 메서드 호출: ' + String(prop));
        };
      },
    };
    window.electronAPI = new Proxy(methods, handler);
    void allowKeys;
  }, { injectedToken: token, injectedSiteId: siteId, allowKeys: allowListNote });

  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') uiDiag.consoleErrors.push(`[${page.url().slice(0, 80)}] ${message.text()}`.slice(0, 300));
  });
  page.on('pageerror', (error) => {
    uiDiag.pageErrors.push(String(error.message).slice(0, 300));
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure() && request.failure().errorText;
    // route.abort로 차단한 요청은 blockedRequests에 이미 집계된다. 나머지 실패만 수집.
    if (failure && failure !== 'net::ERR_FAILED') {
      uiDiag.requestFailures.push(`${request.url().slice(0, 120)} (${failure})`);
    }
  });
  page.setDefaultTimeout(45 * 1000);
  return { context, page };
}

function shimMethods(token, siteId) {
  return {
    getServerToken: token,
    getDefaultSiteContext: { siteId },
  };
}

async function closeBrowser({ browser, context }) {
  try { if (context) await context.close(); } catch (_) { /* 무시 */ }
  try { if (browser) await browser.close(); } catch (_) { /* 무시 */ }
}

module.exports = {
  VITE_PORT,
  VITE_URL,
  isPortBusy,
  startVite,
  createUiContext,
  closeBrowser,
  collectShimViolations,
  shimMethods,
};
