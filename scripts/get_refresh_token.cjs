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

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI  = 'http://localhost:8900/api/auth/callback/google';

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

// 임시 로컬 서버 (포트 8900)
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  if (!parsed.pathname.includes('/api/auth/callback/google')) {
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

server.listen(8900, () => {
  console.log('로컬 서버 대기 중 (포트 8900)...');
});
