const fs = require('fs');
const path = require('path');
const https = require('https');

const DEFAULT_BASE_URL = 'https://eco.qntech.co.kr';
const SESSION_REVALIDATE_MS = 5 * 60 * 1000;
const SESSION_MAX_IDLE_MS = 30 * 60 * 1000;

const LOGIN_MUTATION = `mutation Login($userId: String!, $password: String!) {
  signIn(data: { userId: $userId, password: $password }) {
    id
  }
}`;

const ME_QUERY = `query Me {
  me {
    id
    userId
    cellPhone
    email
    name
    sites {
      address
      name
      id
    }
    role {
      id
      name
    }
  }
}`;

let cachedSession = null;
let authenticationPromise = null;

function normalizeBaseUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return DEFAULT_BASE_URL;

  try {
    const parsed = new URL(trimmed);
    return parsed.origin;
  } catch (_) {
    return trimmed.replace(/\/$/, '').replace(/\/(login|signin)$/i, '');
  }
}

function createCookieJar() {
  const jar = new Map();

  return {
    addFromHeaders(setCookieHeaders) {
      if (!setCookieHeaders) return;
      const values = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
      values.forEach((headerValue) => {
        const firstPart = String(headerValue).split(';')[0];
        const separator = firstPart.indexOf('=');
        if (separator <= 0) return;
        const key = firstPart.slice(0, separator).trim();
        const value = firstPart.slice(separator + 1).trim();
        if (key) jar.set(key, value);
      });
    },
    toHeader() {
      return Array.from(jar.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
    },
    isEmpty() {
      return jar.size === 0;
    }
  };
}

function buildCredentialFingerprint(credential) {
  return [credential.baseUrl, credential.userId, credential.password].join('|');
}

function isCachedSessionUsable(fingerprint) {
  if (!cachedSession || cachedSession.fingerprint !== fingerprint) return false;
  if (!cachedSession.cookieJar || cachedSession.cookieJar.isEmpty()) return false;
  return (Date.now() - cachedSession.lastUsedAt) < SESSION_MAX_IDLE_MS;
}

function shouldRevalidateSession() {
  if (!cachedSession) return true;
  return (Date.now() - cachedSession.lastValidatedAt) >= SESSION_REVALIDATE_MS;
}

function markSessionTouched(sessionState) {
  sessionState.lastUsedAt = Date.now();
}

function invalidateQntechSessionCache(reason = '') {
  if (reason) {
    console.log(`[QnTECH] 세션 캐시 무효화: ${reason}`);
  }
  cachedSession = null;
}

function httpRequest(urlString, { method = 'GET', headers = {}, body } = {}) {
  const url = new URL(urlString);

  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method,
      headers
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode || 0,
          headers: response.headers,
          body: Buffer.concat(chunks)
        });
      });
    });

    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

async function seedSession(baseUrl, cookieJar) {
  const response = await httpRequest(`${baseUrl}/login`, {
    headers: { 'User-Agent': 'Osoo-QnTECH/1.0' }
  });
  cookieJar.addFromHeaders(response.headers['set-cookie']);
}

async function graphqlRequest(baseUrl, cookieJar, query, variables, referer = '/login') {
  const body = JSON.stringify({ query, variables });
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'User-Agent': 'Osoo-QnTECH/1.0',
    Origin: baseUrl,
    Referer: `${baseUrl}${referer}`
  };

  const cookieHeader = cookieJar.toHeader();
  if (cookieHeader) headers.Cookie = cookieHeader;

  const response = await httpRequest(`${baseUrl}/graphql`, {
    method: 'POST',
    headers,
    body
  });

  cookieJar.addFromHeaders(response.headers['set-cookie']);

  let parsed;
  try {
    parsed = JSON.parse(response.body.toString('utf8'));
  } catch (error) {
    throw new Error(`QnTECH GraphQL 응답이 JSON이 아닙니다. status=${response.statusCode}`);
  }

  if (response.statusCode >= 400) {
    throw new Error(`QnTECH GraphQL 요청 실패: status=${response.statusCode}`);
  }

  if (parsed.errors?.length) {
    throw new Error(parsed.errors.map((item) => item.message).join(' | '));
  }

  return parsed.data;
}

function getStoredCredential(db) {
  const credential = db.prepare(`
    SELECT service_url, user_id, password
    FROM web_app_credentials
    WHERE service_key = 'water_analysis_app'
  `).get();

  if (!credential?.user_id || !credential?.password) {
    throw new Error('수질분석 앱 계정이 저장되어 있지 않습니다.');
  }

  return {
    baseUrl: normalizeBaseUrl(credential.service_url),
    userId: credential.user_id,
    password: credential.password
  };
}

function getConfiguredQntechSiteId(db) {
  const row = db.prepare('SELECT qntech_site_id FROM app_settings WHERE id = 1').get();
  return String(row?.qntech_site_id || '').trim();
}

async function authenticateWithCredential(credential, fingerprint) {
  const cookieJar = createCookieJar();
  await seedSession(credential.baseUrl, cookieJar);

  const loginResult = await graphqlRequest(
    credential.baseUrl,
    cookieJar,
    LOGIN_MUTATION,
    { userId: credential.userId, password: credential.password }
  );

  if (!loginResult?.signIn?.id) {
    throw new Error('QnTECH 로그인에 실패했습니다.');
  }

  const meResult = await graphqlRequest(credential.baseUrl, cookieJar, ME_QUERY, {}, '/');
  if (!meResult?.me) {
    throw new Error('QnTECH 로그인에 실패했습니다.');
  }

  const now = Date.now();
  cachedSession = {
    fingerprint,
    baseUrl: credential.baseUrl,
    cookieJar,
    me: meResult.me,
    authenticatedAt: now,
    lastValidatedAt: now,
    lastUsedAt: now
  };

  return cachedSession;
}

async function refreshAuthenticatedSession(credential, fingerprint) {
  if (!authenticationPromise) {
    authenticationPromise = authenticateWithCredential(credential, fingerprint)
      .finally(() => {
        authenticationPromise = null;
      });
  }

  return authenticationPromise;
}

async function ensureAuthenticatedSession(db, options = {}) {
  const { forceRefresh = false } = options;
  const credential = getStoredCredential(db);
  const fingerprint = buildCredentialFingerprint(credential);

  if (!forceRefresh && isCachedSessionUsable(fingerprint)) {
    if (!shouldRevalidateSession()) {
      markSessionTouched(cachedSession);
      return { credential, session: cachedSession };
    }

    try {
      const meResult = await graphqlRequest(credential.baseUrl, cachedSession.cookieJar, ME_QUERY, {}, '/');
      if (!meResult?.me) {
        throw new Error('QnTECH 사용자 정보를 가져오지 못했습니다.');
      }

      cachedSession.me = meResult.me;
      cachedSession.lastValidatedAt = Date.now();
      markSessionTouched(cachedSession);
      return { credential, session: cachedSession };
    } catch (_) {
      invalidateQntechSessionCache('cached session validation failed');
    }
  }

  const session = await refreshAuthenticatedSession(credential, fingerprint);
  return { credential, session };
}

function isAuthenticationError(error) {
  const message = String(error?.message || '').toLowerCase();
  return [
    'status=401',
    'status=403',
    'unauthorized',
    'forbidden',
    '로그인',
    '인증',
    'session',
    'csrf'
  ].some((token) => message.includes(token));
}

async function createAuthenticatedClient(db) {
  const { credential, session } = await ensureAuthenticatedSession(db);

  return {
    baseUrl: credential.baseUrl,
    cookieJar: session.cookieJar,
    me: session.me,
    qntechSiteId: getConfiguredQntechSiteId(db),
    graphqlRequest: async (query, variables, referer) => {
      const active = await ensureAuthenticatedSession(db);
      try {
        const result = await graphqlRequest(active.credential.baseUrl, active.session.cookieJar, query, variables, referer);
        markSessionTouched(active.session);
        return result;
      } catch (error) {
        if (!isAuthenticationError(error)) {
          throw error;
        }

        const refreshed = await ensureAuthenticatedSession(db, { forceRefresh: true });
        const result = await graphqlRequest(refreshed.credential.baseUrl, refreshed.session.cookieJar, query, variables, referer);
        markSessionTouched(refreshed.session);
        return result;
      }
    }
  };
}

module.exports = {
  createAuthenticatedClient,
  httpRequest,
  normalizeBaseUrl,
  invalidateQntechSessionCache
};
