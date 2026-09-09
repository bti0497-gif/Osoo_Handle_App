'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { prepareSqlite } = require('./lib/validation-environment.cjs');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'tmp', 'diagnostics', `validation-${Date.now()}-${process.pid}`);
fs.mkdirSync(output, { recursive: true });
const result = { status: 'preparing', nodeVersion: process.version, abi: process.versions.modules };
function finish(code) {
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(`\n${result.status}: ${output}`);
  process.exitCode = code;
}
try {
  result.environment = prepareSqlite();
  const preload = path.join(__dirname, 'lib/validation-sqlite-preload.cjs').replace(/\\/g, '/');
  const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require "${preload}"` };
  const log = fs.createWriteStream(path.join(output, 'validate.log'));
  const child = spawn(process.platform === 'win32' ? 'cmd.exe' : 'npm',
    process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run validate'] : ['run', 'validate'],
    { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { log.write(chunk); process.stdout.write(chunk); });
  child.stderr.on('data', chunk => { log.write(chunk); process.stderr.write(chunk); });
  child.on('error', error => { result.error = error.message; });
  child.on('close', code => {
    log.end(); result.exitCode = code;
    result.status = result.error ? 'environment-failed' : code === 0 ? 'passed' : 'validation-failed';
    finish(code === 0 && !result.error ? 0 : 1);
  });
} catch (error) {
  result.status = 'environment-failed'; result.error = error.message; finish(2);
}
