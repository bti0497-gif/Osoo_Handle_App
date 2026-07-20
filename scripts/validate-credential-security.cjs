const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { sanitize } = require('../server/services/diagnosticLogService.cjs');

const ROOT = path.resolve(__dirname, '..');
const BUILDER_CONFIG = path.join(ROOT, 'electron-builder.config.cjs');
const FORBIDDEN_CREDENTIAL_PATH = /(^|\/)(?:\.env(?:\..+)?|google-key\.json|bigquery-service-account\.json|work-jindan-[^/]+\.json|firebase-service-account\.json|client_secret_[^/]+\.json|[^/]+\.(?:pem|p12|pfx))$/i;
const ALLOWED_EXAMPLE = /(?:\.example|\.sample)\.(?:json|env)$/i;

function gitLines(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/\\/g, '/'))
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

function findForbidden(paths) {
  return [...new Set(paths.filter((file) => FORBIDDEN_CREDENTIAL_PATH.test(file) && !ALLOWED_EXAMPLE.test(file)))];
}

const tracked = findForbidden(gitLines(['ls-files']));
if (tracked.length > 0) {
  throw new Error(`Git에 실제 자격증명 파일이 추적되고 있습니다: ${tracked.join(', ')}`);
}

const historical = findForbidden(gitLines(['log', '--all', '--name-only', '--pretty=format:']));
if (historical.length > 0) {
  console.warn(`! 교체 완료된 과거 자격증명 파일 기록 ${historical.length}건은 경고만 표시합니다.`);
}

const builder = fs.readFileSync(BUILDER_CONFIG, 'utf8');
for (const exclusion of [
  '!server/config/google-key.json',
  '!server/config/bigquery-service-account.json',
  '!server/config/work-jindan-*.json',
  '!server/config/firebase-service-account.json',
]) {
  if (!builder.includes(exclusion)) throw new Error(`일반 릴리즈 자격증명 제외 규칙 누락: ${exclusion}`);
}

const diagnosticSample = sanitize({
  password: 'visible-password',
  message: 'Bearer header.payload.signature client_secret=visible-secret',
  apiError: 'request failed: https://example.test/path?access_token=visible-token',
  privateKeyText: '-----BEGIN PRIVATE KEY-----\nvisible-private-key\n-----END PRIVATE KEY-----',
});
const serialized = JSON.stringify(diagnosticSample);
for (const secret of ['visible-password', 'header.payload.signature', 'visible-secret', 'visible-token', 'visible-private-key']) {
  if (serialized.includes(secret)) throw new Error(`진단로그 문자열 자격증명 마스킹 실패: ${secret}`);
}

console.log('✓ Git 현재 추적 파일에 자격증명 없음');
console.log('✓ 일반 릴리즈 자격증명 제외 규칙 검사 통과');
console.log('✓ 진단로그 객체 키·토큰·개인키 문자열 마스킹 검사 통과');
