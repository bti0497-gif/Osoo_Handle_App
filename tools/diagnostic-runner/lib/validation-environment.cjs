'use strict';

// Development only. Never rebuild or replace the application's native module.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const runnerRoot = path.resolve(__dirname, '..');
const sqlitePath = path.join(runnerRoot, 'node_modules', 'better-sqlite3');

function probe() {
  return spawnSync(process.execPath, ['-e',
    `const D=require(${JSON.stringify(sqlitePath)});const d=new D(':memory:');d.exec('CREATE TABLE t(a)');d.close();`],
  { windowsHide: true, encoding: 'utf8', timeout: 30000, env: { ...process.env, NODE_OPTIONS: '' } });
}

function prepareSqlite() {
  const rootPackage = path.resolve(runnerRoot, '../../node_modules/better-sqlite3/package.json');
  const localPackage = path.join(sqlitePath, 'package.json');
  if (!fs.existsSync(localPackage)) throw new Error('ENV_DEPENDENCY_MISSING: tools/diagnostic-runner에서 npm ci가 필요합니다.');
  const version = JSON.parse(fs.readFileSync(localPackage, 'utf8')).version;
  if (version !== JSON.parse(fs.readFileSync(rootPackage, 'utf8')).version) {
    throw new Error('ENV_SQLITE_VERSION_MISMATCH: 앱과 검증용 SQLite 버전을 일치시킨 뒤 실행하세요.');
  }
  const initial = probe();
  if (initial.status === 0) return { abi: process.versions.modules, reused: true, sqlitePath };
  // No fallback to the root copy, and no concurrent rebuild of the isolated copy.
  const lock = path.join(runnerRoot, '.native-prepare.lock');
  let descriptor;
  try { descriptor = fs.openSync(lock, 'wx'); }
  catch (_) { throw new Error('ENV_PREPARE_BUSY: 다른 검증이 SQLite를 준비 중입니다. 잠금이 오래 남으면 실행 프로세스를 먼저 확인하세요.'); }
  try {
    if (!fs.existsSync(path.join(sqlitePath, 'package.json'))) {
      throw new Error('ENV_DEPENDENCY_MISSING: tools/diagnostic-runner에서 npm ci가 필요합니다.');
    }
    const env = { ...process.env, NODE_OPTIONS: '', npm_config_runtime: 'node',
      npm_config_target: process.versions.node, npm_config_arch: process.arch, npm_config_disturl: 'https://nodejs.org/download/release' };
    const result = spawnSync(process.platform === 'win32' ? 'cmd.exe' : 'npm',
      process.platform === 'win32' ? ['/d', '/s', '/c', 'npm rebuild better-sqlite3'] : ['rebuild', 'better-sqlite3'],
      { cwd: runnerRoot, env, windowsHide: true, encoding: 'utf8', timeout: 1200000 });
    if (result.status !== 0 || probe().status !== 0) {
      throw new Error(`ENV_ABI_PREPARE_FAILED: ${(result.stderr || result.stdout || result.error?.message || '').slice(-2000)}`);
    }
    return { abi: process.versions.modules, reused: false, sqlitePath };
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
}
module.exports = { prepareSqlite, sqlitePath };
