#!/usr/bin/env node
'use strict';

// Fast release gate for the concrete save -> local SQLite -> roadwork-helper
// read path. Uses the isolated validation SQLite build, never the app's native ABI.
const path = require('path');
const { spawnSync } = require('child_process');
const projectRoot = path.resolve(__dirname, '..', '..');

try {
  const { prepareSqlite } = require('../diagnostic-runner/lib/validation-environment.cjs');
  const prepared = prepareSqlite();
  console.log(`[Roadwork Harness] isolated SQLite ready (Node ABI ${prepared.abi}, reused=${prepared.reused})`);

  const preload = path.join(__dirname, '..', 'diagnostic-runner', 'lib', 'validation-sqlite-preload.cjs');
  // NODE_OPTIONS reparses this value in a second process; forward slashes keep
  // Windows drive paths intact through that parser, including paths with spaces.
  const preloadForNodeOptions = preload.replace(/\\/g, '/');
  const nodeOptions = [process.env.NODE_OPTIONS, `--require "${preloadForNodeOptions}"`].filter(Boolean).join(' ');
  const result = spawnSync(process.execPath, ['scripts/validate-site-route-isolation.cjs'], {
    cwd: projectRoot,
    env: { ...process.env, NODE_OPTIONS: nodeOptions },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 90_000,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status || 1;
} catch (error) {
  console.error(`[Roadwork Harness] 준비 또는 회귀 시나리오 실패: ${error.message}`);
  process.exitCode = 1;
}
