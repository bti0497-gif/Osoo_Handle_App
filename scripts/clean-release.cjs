#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const retryDelayMs = 200;
const retryCount = 30;
const removableDirectories = [
  'dist',
  'build',
  'release',
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
      if (relativePath !== 'release') throw error;
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
