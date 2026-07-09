#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const unpackedRoot = path.resolve(process.argv[2] || path.join(projectRoot, 'release', 'win-unpacked'));
const electronExe = path.join(unpackedRoot, 'Osoo Handle App.exe');
const sqlitePackage = path.join(
  unpackedRoot,
  'resources',
  'app.asar.unpacked',
  'node_modules',
  'better-sqlite3'
);
const smokeScript = path.join(__dirname, 'smoke-packaged-sqlite.cjs');

for (const requiredPath of [electronExe, sqlitePackage, smokeScript]) {
  if (!fs.existsSync(requiredPath)) {
    console.error(`[Packaged Native FAIL] Required path is missing: ${requiredPath}`);
    process.exit(1);
  }
}

console.log(`[Packaged Native] Electron: ${electronExe}`);
console.log(`[Packaged Native] better-sqlite3: ${sqlitePackage}`);

const result = spawnSync(electronExe, [smokeScript, sqlitePackage], {
  cwd: projectRoot,
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
  },
  encoding: 'utf8',
  timeout: 60_000,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.error) {
  console.error(`[Packaged Native FAIL] ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`[Packaged Native FAIL] Electron exited with code ${result.status}.`);
  process.exit(result.status || 1);
}

console.log('[Packaged Native PASS] Packaged Electron loaded and used better-sqlite3 successfully.');
