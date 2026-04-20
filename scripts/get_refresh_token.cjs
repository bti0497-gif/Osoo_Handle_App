'use strict';
/**
 * Google OAuth 리프레시 토큰 재발급 스크립트
 * 실행: node scripts/get_refresh_token.cjs
 *
 * Drive + Sheets 스코프를 포함한 새 토큰 발급
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

function findOAuthClientSecretFile() {
  try {
    const rootDir = path.join(__dirname, '..');
    const files = fs.readdirSync(rootDir);
    const match = files.find((name) => /^client_secret_.*\.json$/i.test(String(name || '').trim()));
    return match ? path.join(rootDir, match) : '';
  } catch (_) {
    return '';
  }
}

function loadOAuthClientConfig() {
  const envClientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const envClientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const envRedirectUri = String(process.env.GOOGLE_REDIRECT_URI || '').trim();
  if (envClientId && envClientSecret) {
    return {
      clientId: envClientId,
      clientSecret: envClientSecret,
      redirectUri: envRedirectUri || 'http://localhost'
    };
  }

  const secretFile = findOAuthClientSecretFile();
  if (!secretFile || !fs.existsSync(secretFile)) return null;
  const raw = JSON.parse(fs.readFileSync(secretFile, 'utf8'));
  const installed = raw.installed || raw.web || {};
  const redirectUris = Array.isArray(installed.redirect_uris) ? installed.redirect_uris : [];
  const clientId = String(installed.client_id || '').trim();
  const clientSecret = String(installed.client_secret || '').trim();
  const redirectUri = String(envRedirectUri || redirectUris[0] || 'http://localhost').trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri };
}

const oauthClientConfig = loadOAuthClientConfig();
if (!oauthClientConfig) {
  console.error('OAuth 클라이언트 정보를 찾지 못했습니다. .env.local 또는 client_secret_*.json 파일을 확인하세요.');
  process.exit(1);
}

const CLIENT_ID = oauthClientConfig.clientId;
const CLIENT_SECRET = oauthClientConfig.clientSecret;
const REDIRECT_URI = oauthClientConfig.redirectUri;
const REDIRECT_PATH = new URL(REDIRECT_URI).pathname || '/';
const LISTEN_PORT = Number(new URL(REDIRECT_URI).port || 80);

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
];

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',       // 반드시 consent: 새 refresh_token 발급
  scope: SCOPES,
});

console.log('\n=== Google OAuth 재인증 ===');
console.log('아래 URL을 브라우저에서 열고 bti0497@gmail.com 계정으로 로그인하세요:\n');
console.log(authUrl);
console.log('\n인증 완료 후 자동으로 토큰을 출력합니다...\n');

// 임시 로컬 서버
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  if (!String(parsed.pathname || '').startsWith(REDIRECT_PATH)) {
    res.end('무시');
    return;
  }

  const code = parsed.query.code;
  if (!code) {
    res.end('code 파라미터가 없습니다.');
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h2>인증 완료! 터미널에서 토큰을 확인하세요.</h2>');

    console.log('=== 새 토큰 ===');
    console.log('GOOGLE_REFRESH_TOKEN=' + tokens.refresh_token);
    console.log('\n.env.local 의 GOOGLE_REFRESH_TOKEN 을 위 값으로 교체하세요.\n');

    server.close();
  } catch (e) {
    res.end('오류: ' + e.message);
    console.error(e);
  }
});

server.listen(LISTEN_PORT, () => {
  console.log(`로컬 서버 대기 중 (포트 ${LISTEN_PORT})...`);
});
