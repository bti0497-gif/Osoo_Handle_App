#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const retryDelayMs = 200;
const retryCount = 30;
const configuredReleaseDirectory = String(process.env.OSOO_RELEASE_OUTPUT_DIR || 'release').trim();
if (!/^[A-Za-z0-9._-]+$/.test(configuredReleaseDirectory) || configuredReleaseDirectory === '.' || configuredReleaseDirectory === '..') {
  throw new Error(`Invalid OSOO_RELEASE_OUTPUT_DIR: ${configuredReleaseDirectory}`);
}
const removableDirectories = [
  'dist',
  'build',
  configuredReleaseDirectory,
  'release-diagnostic',
  'release-photo-diagnostic',
  'release-dongmyeong-hotfix',
  'release-dongmyeong-final',
  'release-dongmyeong-package',
  'release-dongmyeong-final2',
  'artifacts',
  'release-fresh',
  'release-logo-fix',
  'release-token-fix',
  'release-unique-port',
  'release-zip',
  'test-build',
];

function wait(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function moveReleaseAside(target, staleTarget) {
  let lastError;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      fs.renameSync(target, staleTarget);
      return;
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error?.code) || attempt === retryCount) {
        throw error;
      }
      wait(retryDelayMs);
    }
  }
  throw lastError;
}

// Explorer/백신 등이 release 루트 디렉터리만 잠시 열어 둔 경우에는 루트의
// rename/remove은 EPERM이지만 하위 산출물 삭제는 가능합니다. 이 경우 루트를
// 재사용하면 빌더 출력 계약(release/)을 바꾸지 않고도 안전하게 다음 빌드를
// 시작할 수 있습니다.
function emptyReleaseContents(target) {
  const entries = fs.readdirSync(target, { withFileTypes: true });
  for (const entry of entries) {
    fs.rmSync(path.join(target, entry.name), {
      recursive: entry.isDirectory(),
      force: true,
      maxRetries: retryCount,
      retryDelay: retryDelayMs,
    });
  }
  if (fs.readdirSync(target).length !== 0) {
    throw new Error(`Release directory was not emptied: ${target}`);
  }
}

for (const relativePath of removableDirectories) {
  const target = path.resolve(rootDir, relativePath);
  if (!target.startsWith(`${rootDir}${path.sep}`)) {
    throw new Error(`Refusing to remove path outside project: ${target}`);
  }
  if (fs.existsSync(target)) {
    try {
      fs.rmSync(target, {
        recursive: true,
        force: true,
        maxRetries: retryCount,
        retryDelay: retryDelayMs,
      });
      console.log(`[clean] ${relativePath}`);
    } catch (error) {
      if (relativePath !== configuredReleaseDirectory) throw error;
      try {
        emptyReleaseContents(target);
        console.warn('[clean] locked release root retained after its contents were cleared');
        continue;
      } catch (contentsError) {
        console.warn(`[clean] could not clear locked release contents: ${contentsError.message}`);
      }
      const staleTarget = path.resolve(rootDir, `.stale-release-${Date.now()}`);
      if (!staleTarget.startsWith(`${rootDir}${path.sep}`)) {
        throw new Error(`Refusing to move release path outside project: ${staleTarget}`);
      }
      moveReleaseAside(target, staleTarget);
      console.warn(`[clean] locked release moved aside: ${path.basename(staleTarget)}`);
    }
  }
}

console.log('Release artifacts cleaned.');
