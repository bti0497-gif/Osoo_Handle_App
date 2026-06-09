#!/usr/bin/env node
/**
 * scripts/clean-release.cjs
 * 
 * 불필요한 빌드 아티팩트를 정리하고 깨끗한 release/ 폴더만 남김
 * 
 * 사용:
 *   node scripts/clean-release.cjs
 *   npm run clean:release  (package.json에서)
 */

const fs = require('fs');
const path = require('path');

const BASE_DIR = path.join(__dirname, '..');

const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
};

function log(color, label, msg) {
  console.log(`${color}[${label}]${colors.reset} ${msg}`);
}

function removeDir(dirPath) {
  try {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      log(colors.green, '✓ 삭제', path.relative(BASE_DIR, dirPath));
      return true;
    }
  } catch (e) {
    log(colors.red, '✗ 오류', `${path.relative(BASE_DIR, dirPath)}: ${e.message}`);
    return false;
  }
}

function cleanDir(dirPath) {
  try {
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath);
      files.forEach(file => {
        const fullPath = path.join(dirPath, file);
        if (fs.lstatSync(fullPath).isDirectory()) {
          fs.rmSync(fullPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(fullPath);
        }
      });
      log(colors.green, '✓ 비움', path.relative(BASE_DIR, dirPath));
      return true;
    }
  } catch (e) {
    log(colors.red, '✗ 오류', `${path.relative(BASE_DIR, dirPath)}: ${e.message}`);
    return false;
  }
}

console.log(`\n${colors.cyan}🧹 빌드 아티팩트 정리${colors.reset}`);
console.log(`${colors.cyan}${'═'.repeat(50)}${colors.reset}\n`);

// 1. 기존 임시 release 폴더들 삭제
const tempDirs = [
  'release-fresh',
  'release-logo-fix',
  'release-token-fix',
  'release-unique-port',
  'release-zip',
  'test-build',
];

log(colors.yellow, 'ℹ', '임시 release 폴더 삭제 중...');
tempDirs.forEach(dir => {
  removeDir(path.join(BASE_DIR, dir));
});

// 2. dist/ 비우기 (다시 빌드할 예정)
log(colors.yellow, 'ℹ', '\n빌드 출력 폴더 정리 중...');
cleanDir(path.join(BASE_DIR, 'dist'));

// 3. release/ 폴더 비우기 (rebuild 전 깨끗한 상태)
log(colors.yellow, 'ℹ', '\nrelease/ 폴더 정리 중...');
cleanDir(path.join(BASE_DIR, 'release'));

// 4. build/ 폴더도 있으면 정리
if (fs.existsSync(path.join(BASE_DIR, 'build'))) {
  cleanDir(path.join(BASE_DIR, 'build'));
}

console.log(`\n${colors.cyan}${'═'.repeat(50)}${colors.reset}`);
console.log(`${colors.green}✅ 정리 완료!${colors.reset}`);
console.log(`\n다음 단계:`);
console.log(`  1. npm run validate          # 검증`);
console.log(`  2. npm run build             # Vite 빌드`);
console.log(`  3. npm run release:safe      # 안전한 패키징`);
console.log(`\n또는 한 번에:`);
console.log(`  npm run release:safe\n`);
