#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const removableDirectories = [
  'dist',
  'build',
  'release',
  'artifacts',
  'release-fresh',
  'release-logo-fix',
  'release-token-fix',
  'release-unique-port',
  'release-zip',
  'test-build',
];

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
        maxRetries: 30,
        retryDelay: 200,
      });
      console.log(`[clean] ${relativePath}`);
    } catch (error) {
      if (relativePath !== 'release') throw error;
      const staleTarget = path.resolve(rootDir, `.stale-release-${Date.now()}`);
      if (!staleTarget.startsWith(`${rootDir}${path.sep}`)) {
        throw new Error(`Refusing to move release path outside project: ${staleTarget}`);
      }
      fs.renameSync(target, staleTarget);
      console.warn(`[clean] locked release moved aside: ${path.basename(staleTarget)}`);
    }
  }
}

console.log('Release artifacts cleaned.');
