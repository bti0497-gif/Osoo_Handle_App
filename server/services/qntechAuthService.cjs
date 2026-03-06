const fs = require('fs');
const path = require('path');
const https = require('https');

const DEFAULT_BASE_URL = 'https://eco.qntech.co.kr';

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
    }
  };
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

async function createAuthenticatedClient(db) {
  const credential = getStoredCredential(db);
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
    throw new Error('QnTECH 사용자 정보를 가져오지 못했습니다.');
  }

  return {
    baseUrl: credential.baseUrl,
    cookieJar,
    me: meResult.me,
    graphqlRequest: (query, variables, referer) => graphqlRequest(credential.baseUrl, cookieJar, query, variables, referer)
  };
}

module.exports = {
  createAuthenticatedClient,
  httpRequest,
  normalizeBaseUrl
};