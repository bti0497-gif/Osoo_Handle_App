'use strict';

const fs = require('fs');
const path = require('path');
const { RUNTIME_CONFIG_DIR } = require('../server/config/runtimeConfig.cjs');

const sourceDir = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const mappings = [
  { target: '.env.local', candidates: ['.env.local'] },
  { target: 'google-key.json', candidates: ['google-key.json', 'server/config/google-key.json'] },
  {
    target: 'bigquery-service-account.json',
    candidates: ['bigquery-service-account.json', 'server/config/work-jindan-194620a46d59.json'],
  },
  {
    target: 'firebase-service-account.json',
    candidates: ['firebase-service-account.json', 'server/config/firebase-service-account.json'],
  },
];

function findSource(candidates) {
  return candidates
    .map((candidate) => path.join(sourceDir, candidate))
    .find((candidate) => fs.existsSync(candidate));
}

fs.mkdirSync(RUNTIME_CONFIG_DIR, { recursive: true });
const copied = [];
const missing = [];

for (const mapping of mappings) {
  const source = findSource(mapping.candidates);
  if (!source) {
    missing.push(mapping.target);
    continue;
  }
  fs.copyFileSync(source, path.join(RUNTIME_CONFIG_DIR, mapping.target));
  copied.push(mapping.target);
}

const oauthSecret = fs.readdirSync(sourceDir)
  .find((name) => /^client_secret_.*\.json$/i.test(name));
if (oauthSecret) {
  fs.copyFileSync(path.join(sourceDir, oauthSecret), path.join(RUNTIME_CONFIG_DIR, oauthSecret));
  copied.push(oauthSecret);
}

console.log(`런타임 설정 위치: ${RUNTIME_CONFIG_DIR}`);
console.log(`복사 완료: ${copied.length ? copied.join(', ') : '없음'}`);
if (missing.length) console.warn(`선택 파일 누락: ${missing.join(', ')}`);
