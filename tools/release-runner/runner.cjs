#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createHash } = require('crypto');

const projectRoot = path.resolve(__dirname, '..', '..');
const packageJsonPath = path.join(projectRoot, 'package.json');
const packageLockPath = path.join(projectRoot, 'package-lock.json');
const playbookPath = path.join(projectRoot, 'docs', 'AUTO_UPDATE_PACKAGING_PLAYBOOK.md');
const resultPath = path.join(projectRoot, 'tmp', 'release-runner-result.json');
const requiredTemplateSource = path.join(projectRoot, 'templates', 'reports', '설비이력카드.xlsx');
const electronBuilderConfigPath = path.join(projectRoot, 'electron-builder.config.cjs');
const nativeScriptPath = path.join(projectRoot, 'scripts', 'validate-packaged-native.cjs');
const asarScriptPath = path.join(projectRoot, 'scripts', 'validate-release.cjs');
const runnerVersion = '1.0.0';
const electronVersion = '40.6.0';

const steps = [
  'PREFLIGHT',
  'REGRESSION',
  'PREPARED VALIDATION',
  'NATIVE/ELECTRON ABI PREPARATION',
  'PACKAGE',
  'ARTIFACT VALIDATION',
  'ASAR VALIDATION',
  'NATIVE VALIDATION',
  'SECURITY/RESOURCE VALIDATION',
  'NODE ABI RESTORE',
  'FINAL REPORT',
];

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  if (args.has('--publish')) {
    throw new Error('Release Runner는 게시를 수행하지 않습니다. PUBLISH는 별도 기능으로 남겨둡니다.');
  }
  return { dryRun: args.has('--dry-run'), help: args.has('--help') || args.has('-h') };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fileInfo(filePath) {
  const exists = fs.existsSync(filePath);
  if (!exists) return { path: path.relative(projectRoot, filePath), exists: false, size: 0 };
  const stat = fs.statSync(filePath);
  return { path: path.relative(projectRoot, filePath), exists: true, size: stat.size };
}

function sha256(filePath) {
  if (!fs.existsSync(filePath)) return '';
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true,
    timeout: options.timeout || 0,
    env: { ...process.env, ...(options.env || {}) },
  });
  return {
    command: [command, ...args].join(' '),
    status: result.status === null ? 1 : result.status,
    signal: result.signal || null,
    error: result.error ? result.error.message : '',
    stdout: String(result.stdout || '').slice(-12000),
    stderr: String(result.stderr || '').slice(-12000),
  };
}

function gitStatus() {
  const result = runCommand('git', ['status', '--short']);
  return result.stdout.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
}

function conflictingProcesses() {
  const result = process.platform === 'win32'
    ? runCommand('powershell.exe', ['-NoProfile', '-Command', "Get-Process | Where-Object { $_.ProcessName -match '^(Osoo Handle App|OsooWatchdog)$|electron|electron-builder|makensis|7z' } | Select-Object Id,ProcessName,Path | ConvertTo-Json -Compress"])
    : runCommand('ps', ['-eo', 'pid=,comm=,args=']);
  if (result.status !== 0 || !result.stdout.trim()) return [];
  if (process.platform === 'win32') {
    try {
      const parsed = JSON.parse(result.stdout.trim());
      const projectPrefix = `${path.resolve(projectRoot)}${path.sep}`.toLowerCase();
      return (Array.isArray(parsed) ? parsed : [parsed]).filter((processInfo) => {
        if (!processInfo) return false;
        const name = String(processInfo.ProcessName || '');
        if (/^(electron|electron-builder|makensis|7z)$/i.test(name)) return true;
        // 설치된 현장 앱은 프로젝트 release 폴더를 잡지 않으므로 빌드를 막지 않는다.
        // 반면 이 작업 폴더에서 직접 실행한 앱/워치독은 산출물을 잠글 수 있다.
        return /^(Osoo Handle App|OsooWatchdog)$/i.test(name)
          && String(processInfo.Path || '').toLowerCase().startsWith(projectPrefix);
      });
    } catch {
      return [{ raw: result.stdout.trim() }];
    }
  }
  return result.stdout.split(/\r?\n/).filter(Boolean).filter((line) => /electron|makensis|7z/i.test(line));
}

function logStep(name, status, detail = '') {
  const suffix = detail ? ` - ${detail}` : '';
  console.log(`${name.padEnd(28)} ${status}${suffix}`);
}

function ensureResultDirectory() {
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
}

function writeResult(result) {
  try {
    ensureResultDirectory();
    fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.warn(`[Release Runner] 결과 JSON 저장 실패: ${error.message}`);
  }
}

function preflight(packageJson, packageLock) {
  const status = gitStatus();
  const processes = conflictingProcesses();
  const builderConfigText = fs.existsSync(electronBuilderConfigPath)
    ? fs.readFileSync(electronBuilderConfigPath, 'utf8')
    : '';
  const checks = {
    packageVersion: packageJson.version,
    lockVersion: packageLock.version,
    versionsMatch: packageJson.version === packageLock.version,
    gitStatus: status,
    template: fileInfo(requiredTemplateSource),
    builderConfig: fileInfo(electronBuilderConfigPath),
    approvedTemplateResource: builderConfigText.includes(
      "from: 'templates/reports/설비이력카드.xlsx', to: 'defaults/report-templates/설비이력카드.xlsx'"
    ),
    validationScripts: {
      asar: fileInfo(asarScriptPath),
      native: fileInfo(nativeScriptPath),
      prepared: fileInfo(path.join(projectRoot, 'tools', 'diagnostic-runner', 'validate-prepared.cjs')),
    },
    releaseScripts: {
      releaseRunner: packageJson.scripts?.['release:runner'] || '',
      releaseSafe: packageJson.scripts?.['release:safe'] || '',
      validateAsar: packageJson.scripts?.['validate:asar'] || '',
      validateNative: packageJson.scripts?.['validate:native'] || '',
    },
    conflictingProcesses: processes,
  };
  const failures = [];
  if (!checks.versionsMatch) failures.push('package.json/package-lock.json version mismatch');
  if (!checks.template.exists || checks.template.size <= 0) failures.push('설비이력카드.xlsx missing or empty');
  if (!checks.builderConfig.exists) failures.push('electron-builder.config.cjs missing');
  if (!checks.approvedTemplateResource) failures.push('approved 설비이력카드 extraResources entry missing');
  if (checks.conflictingProcesses.length > 0) failures.push('Electron/electron-builder/makensis/7z process is already running');
  for (const [name, value] of Object.entries(checks.validationScripts)) {
    if (!value.exists) failures.push(`validation script missing: ${name}`);
  }
  for (const name of ['releaseRunner', 'releaseSafe', 'validateAsar', 'validateNative']) {
    if (!checks.releaseScripts[name]) failures.push(`npm script missing: ${name}`);
  }
  return { checks, failures };
}

function expectedArtifacts(version, outputDirectory) {
  return [
    path.join(projectRoot, outputDirectory, 'win-unpacked', 'Osoo Handle App.exe'),
    path.join(projectRoot, outputDirectory, 'win-unpacked', 'resources', 'app.asar'),
    path.join(projectRoot, outputDirectory, 'win-unpacked', 'resources', 'app-update.yml'),
    path.join(projectRoot, outputDirectory, 'win-unpacked', 'resources', 'defaults', 'report-templates', '설비이력카드.xlsx'),
    path.join(projectRoot, outputDirectory, `Osoo.Handle.App.Setup.${version}.exe`),
    path.join(projectRoot, outputDirectory, `Osoo.Handle.App.Setup.${version}.exe.blockmap`),
    path.join(projectRoot, outputDirectory, 'latest.yml'),
  ];
}

function artifactValidation(version, outputDirectory) {
  const artifacts = expectedArtifacts(version, outputDirectory).map(fileInfo);
  const failures = artifacts.filter((item) => !item.exists || item.size <= 0);
  return {
    artifacts: artifacts.map((item) => ({ ...item, sha256: item.exists ? sha256(path.join(projectRoot, item.path)) : '' })),
    failures: failures.map((item) => item.path),
  };
}

function printHelp() {
  console.log('Usage: npm run release:runner [-- --dry-run]');
  console.log('The default runner performs validation and packaging but never publishes.');
  console.log('--dry-run  Run preflight and print planned steps without package/build/rebuild commands.');
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printHelp();
    return 0;
  }

  const packageJson = readJson(packageJsonPath);
  const packageLock = readJson(packageLockPath);
  const outputDirectory = `release-${packageJson.version}`;
  const result = {
    runnerVersion,
    version: packageJson.version,
    timestamp: new Date().toISOString(),
    gitCommit: '',
    dryRun: options.dryRun,
    playbook: path.relative(projectRoot, playbookPath),
    outputDirectory,
    steps: {},
    artifacts: [],
    result: 'FAIL',
    readyForRelease: false,
    failedStep: '',
  };
  try {
    result.gitCommit = runCommand('git', ['rev-parse', 'HEAD']).stdout.trim();
  } catch {}

  console.log('========================================');
  console.log('OSOO RELEASE RUNNER');
  console.log(`Version: ${packageJson.version}`);
  console.log('========================================');

  const preflightResult = preflight(packageJson, packageLock);
  result.steps.PREFLIGHT = { status: preflightResult.failures.length ? 'FAIL' : 'PASS', ...preflightResult };
  logStep('Preflight', result.steps.PREFLIGHT.status, `dirty=${preflightResult.checks.gitStatus.length}, conflicts=${preflightResult.checks.conflictingProcesses.length}`);
  if (preflightResult.failures.length) {
    result.failedStep = 'PREFLIGHT';
    return finish(result, 1);
  }

  const plannedCommands = [
    ['REGRESSION', 'node', ['tools/diagnostic-runner/runner.cjs', '--scenario', 'all', '--lint', '--changed']],
    ['PREPARED VALIDATION', 'node', ['tools/diagnostic-runner/validate-prepared.cjs']],
    ['NATIVE/ELECTRON ABI PREPARATION', 'npx', ['@electron/rebuild', '--force', '--arch=x64', `--version=${electronVersion}`]],
    ['PACKAGE', 'npm', ['run', 'release:safe']],
    ['ASAR VALIDATION', 'node', ['scripts/validate-release.cjs', '--asar-path', `./${outputDirectory}/win-unpacked/resources/app.asar`]],
    ['NATIVE VALIDATION', 'node', ['scripts/validate-packaged-native.cjs', `./${outputDirectory}/win-unpacked`]],
    ['SECURITY/RESOURCE VALIDATION', 'node', ['scripts/validate-release.cjs', '--asar-path', `./${outputDirectory}/win-unpacked/resources/app.asar`]],
  ];
  if (options.dryRun) {
    result.plannedCommands = plannedCommands.map(([name, command, args]) => ({ name, command: [command, ...args].join(' ') }));
    for (const name of steps.slice(1, -2)) {
      result.steps[name] = { status: 'DRY-RUN', command: result.plannedCommands.find((item) => item.name === name)?.command || 'cleanup/final report' };
      logStep(name, 'DRY-RUN');
    }
    result.steps['NODE ABI RESTORE'] = { status: 'DRY-RUN', command: 'npm rebuild better-sqlite3 (finally)' };
    logStep('Node ABI Restore', 'DRY-RUN');
    return finish(result, 0, true);
  }

  let packageStarted = false;
  let exitCode = 0;
  try {
    for (const [name, command, args] of plannedCommands) {
      if (name === 'NATIVE/ELECTRON ABI PREPARATION') packageStarted = true;
      console.log(`\n▶ [${name}] 시작: ${command} ${args.join(' ')}`);
      const commandResult = runCommand(command, args, {
        timeout: 0,
        env: { OSOO_RELEASE_OUTPUT_DIR: outputDirectory },
      });
      result.steps[name] = { ...commandResult, status: commandResult.status === 0 ? 'PASS' : 'FAIL' };
      logStep(name, result.steps[name].status);
      writeResult(result);
      if (commandResult.status !== 0) {
        result.failedStep = name;
        exitCode = 1;
        console.error(`\n[ERROR] '${name}' 단계 실패 (종료 코드: ${commandResult.status})`);
        if (commandResult.error) console.error(`시스템 오류: ${commandResult.error}`);
        if (commandResult.stderr) {
          console.error(`--- STDERR ---`);
          console.error(commandResult.stderr.split(/\r?\n/).slice(-30).join('\n'));
        }
        if (commandResult.stdout) {
          console.error(`--- STDOUT ---`);
          console.error(commandResult.stdout.split(/\r?\n/).slice(-30).join('\n'));
        }
        console.error(`--------------\n`);
        break;
      }
      if (name === 'PACKAGE') {
        const artifacts = artifactValidation(packageJson.version, outputDirectory);
        result.artifacts = artifacts.artifacts;
        result.steps['ARTIFACT VALIDATION'] = { status: artifacts.failures.length ? 'FAIL' : 'PASS', failures: artifacts.failures, artifacts: artifacts.artifacts };
        logStep('Artifact Validation', result.steps['ARTIFACT VALIDATION'].status);
        writeResult(result);
        if (artifacts.failures.length) {
          result.failedStep = 'ARTIFACT VALIDATION';
          console.error(`\n[ERROR] 필수 산출물 누락: ${artifacts.failures.join(', ')}`);
          exitCode = 1;
          break;
        }
      }
    }
  } finally {
    if (packageStarted) {
      const restore = runCommand('npm', ['rebuild', 'better-sqlite3'], { timeout: 0 });
      result.steps['NODE ABI RESTORE'] = { ...restore, status: restore.status === 0 ? 'PASS' : 'FAIL' };
      logStep('Node ABI Restore', result.steps['NODE ABI RESTORE'].status);
      if (restore.status !== 0 && !result.failedStep) {
        result.failedStep = 'NODE ABI RESTORE';
        exitCode = 1;
      }
    }
    return finish(result, exitCode);
  }
}

function finish(result, exitCode, dryRun = false) {
  if (!dryRun && exitCode === 0) {
    result.result = 'PASS';
    result.readyForRelease = true;
  } else if (dryRun) {
    result.result = 'DRY-RUN';
    result.readyForRelease = false;
  }
  if (!result.failedStep && exitCode !== 0) result.failedStep = 'UNKNOWN';
  result.steps['FINAL REPORT'] = { status: dryRun ? 'DRY-RUN' : (exitCode === 0 ? 'PASS' : 'FAIL') };
  writeResult(result);
  console.log('');
  console.log(`RESULT: ${result.result}`);
  console.log(`READY FOR RELEASE: ${result.readyForRelease ? 'YES' : 'NO'}`);
  if (result.failedStep) console.log(`FAILED STEP: ${result.failedStep}`);
  const installer = result.artifacts?.find((artifact) => /Setup\..+\.exe$/.test(artifact.path));
  if (installer) {
    console.log(`Installer: ${installer.path}`);
    console.log(`SHA256: ${installer.sha256 || 'unavailable'}`);
  }
  console.log(`REPORT: ${path.relative(projectRoot, resultPath)}`);
  console.log('========================================');
  return exitCode;
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(`[Release Runner] fatal: ${error.stack || error.message}`);
  process.exit(1);
});
