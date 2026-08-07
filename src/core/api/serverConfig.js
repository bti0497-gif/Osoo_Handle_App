/**
 * 서버 포트 자동 탐색 모듈
 * 운영 서버는 앱 전용 포트 18731만 사용합니다.
 */

const PORT_MIN = 18731;
const PING_TIMEOUT_MS = 600;
const STARTUP_READY_TIMEOUT_MS = 120000;
const STARTUP_RETRY_DELAY_MS = 250;
const CACHE_KEY = 'osoo_server_port';

let _cachedBase = null;

async function pingPort(port) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
    const res = await fetch(`http://localhost:${port}/api/ping`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const payload = await res.json();
    return payload?.app === 'osoo-handle-app' && payload?.ready === true;
  } catch {
    return false;
  }
}

// 로그인 화면을 띄울 수 있는 상태는 단순히 Express 프로세스가 살아 있는
// 상태와 다르다. 인증 라우트와 로컬 DB 초기화까지 끝난 뒤에만 true가 된다.
async function probeLoginReady(port) {
  if (!await pingPort(port)) return false;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
  try {
    const serverToken = await window.electronAPI?.getServerToken?.();
    const headers = serverToken ? { 'x-osoo-server-token': serverToken } : {};
    const response = await fetch(`http://localhost:${port}/api/auth/login-hint`, {
      headers,
      signal: ctrl.signal,
    });
    if (!response.ok) return false;
    const payload = await response.json();
    return payload?.success === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPortReady(port, timeoutMs = STARTUP_READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeLoginReady(port)) return true;
    await delay(STARTUP_RETRY_DELAY_MS);
  }
  return false;
}

/**
 * 앱 시작 시 한 번 호출. 서버 포트를 탐색하고 캐시합니다.
 */
export async function initServerConfig({ waitForReady = false } = {}) {
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    const port = parseInt(cached, 10);
    const isAvailable = !isNaN(port) && await (waitForReady ? probeLoginReady(port) : pingPort(port));
    if (isAvailable) {
      _cachedBase = `http://localhost:${port}`;
      console.log(`[ServerConfig] 캐시된 포트 ${port} 연결 성공`);
      return _cachedBase;
    }
    localStorage.removeItem(CACHE_KEY);
  }

  const isDedicatedPortAvailable = await (waitForReady ? probeLoginReady(PORT_MIN) : pingPort(PORT_MIN));
  if (isDedicatedPortAvailable) {
    _cachedBase = `http://localhost:${PORT_MIN}`;
    localStorage.setItem(CACHE_KEY, String(PORT_MIN));
    console.log(`[ServerConfig] 전용 포트 ${PORT_MIN}에서 서버 발견`);
    return _cachedBase;
  }

  if (waitForReady && await waitForPortReady(PORT_MIN)) {
    _cachedBase = `http://localhost:${PORT_MIN}`;
    localStorage.setItem(CACHE_KEY, String(PORT_MIN));
    console.log(`[ServerConfig] startup wait completed on dedicated port ${PORT_MIN}`);
    return _cachedBase;
  }

  if (waitForReady) {
    throw new Error('로컬 서버 준비 시간이 초과되었습니다.');
  }

  _cachedBase = `http://localhost:${PORT_MIN}`;
  console.warn(`[ServerConfig] 서버를 찾지 못했습니다. 기본 포트(${PORT_MIN}) 사용`);
  return _cachedBase;
}

/**
 * 현재 연결된 서버 베이스 URL을 반환합니다.
 */
export function getApiBase() {
  return _cachedBase || `http://localhost:${PORT_MIN}`;
}

/**
 * 서버 연결이 끊겼을 때 재탐색 후 새 포트를 캐시합니다.
 */
export async function rediscoverServer() {
  localStorage.removeItem(CACHE_KEY);
  _cachedBase = null;
  return await initServerConfig();
}
