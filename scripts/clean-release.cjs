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
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`[clean] ${relativePath}`);
  }
}

console.log('Release artifacts cleaned.');
