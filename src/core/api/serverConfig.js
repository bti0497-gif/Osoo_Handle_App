/**
 * 서버 포트 자동 탐색 모듈
 * 서버가 포트 충돌로 8901 이 아닌 다른 포트를 사용할 경우에도 자동으로 찾아 연결합니다.
 */

const PORT_MIN = 8901;
const PORT_MAX = 8950;
const PING_TIMEOUT_MS = 600;
const CACHE_KEY = 'osoo_server_port';

let _cachedBase = null;

async function pingPort(port) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
    const res = await fetch(`http://localhost:${port}/api/ping`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 앱 시작 시 한 번 호출. 서버 포트를 탐색하고 캐시합니다.
 */
export async function initServerConfig() {
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    const port = parseInt(cached, 10);
    if (!isNaN(port) && await pingPort(port)) {
      _cachedBase = `http://localhost:${port}`;
      console.log(`[ServerConfig] 캐시된 포트 ${port} 연결 성공`);
      return _cachedBase;
    }
    localStorage.removeItem(CACHE_KEY);
  }

  for (let port = PORT_MIN; port <= PORT_MAX; port++) {
    if (await pingPort(port)) {
      _cachedBase = `http://localhost:${port}`;
      localStorage.setItem(CACHE_KEY, String(port));
      console.log(`[ServerConfig] 포트 ${port}에서 서버 발견`);
      return _cachedBase;
    }
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
