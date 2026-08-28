'use strict';

/**
 * 패키징 누출 검증기 (Phase 0, 수동 실행 전용).
 *
 * 진단 러너와 산출물이 Electron 배포 산출물에 섞이지 않는지 검사한다(§Phase 0/§6).
 *
 * 사용법:
 *   node tools/diagnostic-runner/leak-check.cjs                  # 패키징 없이 include 계산만 검사
 *   node tools/diagnostic-runner/leak-check.cjs --asar <경로>     # app.asar 내부 스캔
 *   node tools/diagnostic-runner/leak-check.cjs --win-unpacked <경로>
 *
 * 이 검증기는 scripts/validate-* 계약을 대체하지 않으며, 루트 validate에 자동 연결은
 * 별도 사용자 승인 대상이다(§6).
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const SUSPICIOUS_DIR_PATTERN = /(^|[\\/])(tools[\\/]diagnostic-runner|tmp[\\/]diagnostics)([\\/]|$)/i;
const SUSPICIOUS_FILE_PATTERNS = [
  { name: 'credential(client_secret)', pattern: /client_secret[^\./]*\.json$/i },
  { name: 'credential(.env.local)', pattern: /\.env\.local$/i },
  { name: 'local-db(.db)', pattern: /\.db$/i },
  { name: 'result.json', pattern: /(^|[\\/])result\.json$/i },
];

function escapeRegex(text) {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/** electron-builder files glob 패턴(간략 지원: **, *, 리터럴)을 정규식으로 변환한다. */
function globToRegex(pattern) {
  const negation = pattern.startsWith('!');
  const body = negation ? pattern.slice(1) : pattern;
  let regex = '^';
  for (let index = 0; index < body.length; index += 1) {
    if (body.startsWith('**/', index)) { regex += '(?:[^/]*/)*'; index += 2; }
    else if (body.startsWith('**', index)) { regex += '.*'; index += 1; }
    else if (body[index] === '*') { regex += '[^/]*'; }
    else if (body[index] === '?') { regex += '[^/]'; }
    else { regex += escapeRegex(body[index]); }
  }
  regex += '$';
  return { negation, regex: new RegExp(regex) };
}

/** electron-builder 계약상 files 목록에서 candidate 가 포함되는지(마지막 일치 패턴 기준). */
function isIncluded(filesPatterns, candidate) {
  let included = false;
  for (const pattern of filesPatterns) {
    const { negation, regex } = globToRegex(pattern);
    if (regex.test(candidate)) included = !negation;
  }
  return included;
}

function checkIncludeSimulation() {
  const config = require(path.join(PROJECT_ROOT, 'electron-builder.config.cjs'));
  const filesPatterns = config.files || [];
  const candidates = [
    'tools/diagnostic-runner/runner.cjs',
    'tools/diagnostic-runner/fixtures/users.json',
    'tools/diagnostic-runner/lib/external-call-guard.cjs',
    'tools/diagnostic-runner/node_modules/playwright-core/index.js',
    'tmp/diagnostics/run-20260828-000000/result.json',
    'tmp/diagnostics/run-20260828-000000/app-data/osoo.db',
    'tmp/diagnostics/run-20260828-000000/screenshots/main.png',
  ];
  const findings = [];
  for (const candidate of candidates) {
    if (isIncluded(filesPatterns, candidate)) findings.push(`files 계약에 포함됨: ${candidate}`);
  }
  for (const resource of config.extraResources || []) {
    const from = String(resource.from || resource || '');
    if (/^(tools|tmp)([\\/]|$)/i.test(from) || /diagnostic/i.test(from)) {
      findings.push(`extraResources에 진단 경로 포함: ${from}`);
    }
  }
  return findings;
}

function checkFileList(files, baseLabel) {
  const findings = [];
  for (const file of files) {
    const normalized = file.split('\\').join('/');
    if (SUSPICIOUS_DIR_PATTERN.test(normalized)) findings.push(`[${baseLabel}] 진단 디렉터리 누출: ${normalized}`);
    for (const { name, pattern } of SUSPICIOUS_FILE_PATTERNS) {
      if (pattern.test(normalized)) findings.push(`[${baseLabel}] ${name} 누출: ${normalized}`);
    }
  }
  return findings;
}

function listAsarEntries(asarPath) {
  let asar;
  try {
    // @electron/asar 는 electron-builder 의 의존성이며 루트 node_modules 에서 해결된다.
    asar = require('@electron/asar');
  } catch (_) {
    return { skipped: true, entries: [] };
  }
  return { skipped: false, entries: asar.listPackage(asarPath).map((entry) => String(entry)) };
}

function walkFiles(root) {
  const results = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else results.push(full);
    }
  };
  visit(root);
  return results;
}

function main() {
  const args = process.argv.slice(2);
  let findings = [];

  if (!args.includes('--asar') && !args.includes('--win-unpacked')) {
    console.log('[leak-check] 패키징 없이 include 계약만 검사합니다.');
    findings = findings.concat(checkIncludeSimulation());
  }

  const asarIndex = args.indexOf('--asar');
  if (asarIndex >= 0) {
    const asarPath = path.resolve(args[asarIndex + 1]);
    const { skipped, entries } = listAsarEntries(asarPath);
    if (skipped) {
      console.log('[leak-check] @electron/asar 모듈을 찾을 수 없어 asar 스캔을 건너뜁니다.');
    } else {
      console.log(`[leak-check] asar 항목 ${entries.length}건 스캔: ${asarPath}`);
      findings = findings.concat(checkFileList(entries, 'asar'));
    }
  }

  const unpackedIndex = args.indexOf('--win-unpacked');
  if (unpackedIndex >= 0) {
    const unpackedPath = path.resolve(args[unpackedIndex + 1]);
    console.log(`[leak-check] win-unpacked 스캔: ${unpackedPath}`);
    const files = walkFiles(unpackedPath).map((file) => path.relative(unpackedPath, file));
    findings = findings.concat(checkFileList(files, 'win-unpacked'));
  }

  if (findings.length > 0) {
    console.error(`\n[leak-check] 실패 — 배포 누출 징후 ${findings.length}건:`);
    for (const finding of findings) console.error(`  - ${finding}`);
    process.exit(1);
  }
  console.log('[leak-check] 통과 — 진단 러너/산출물/자격증명의 배포 누출 징후가 없습니다.');
}

main();
