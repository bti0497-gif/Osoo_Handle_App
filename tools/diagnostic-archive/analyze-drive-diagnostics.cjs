#!/usr/bin/env node
'use strict';

const { runCli } = require('./import-drive-diagnostics.cjs');

const args = process.argv.slice(2);
const requestsDeletion = args.includes('--delete-after-analysis');
if (!args.includes('--site') && !args.includes('--help')) {
  args.push('--site', 'cheondeungsan');
}
if (!requestsDeletion && !args.includes('--keep-drive-files')) {
  args.push('--keep-drive-files');
}

runCli(args).catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
