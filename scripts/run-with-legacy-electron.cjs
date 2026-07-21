#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const script = process.argv[2];
if (!script) {
  console.error('Usage: node scripts/run-with-legacy-electron.cjs <script> [...args]');
  process.exit(2);
}

const electronExe = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
const bootstrap = path.join(__dirname, 'legacy-electron-bootstrap.cjs');
const result = spawnSync(electronExe, [bootstrap, path.resolve(script), ...process.argv.slice(3)], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
