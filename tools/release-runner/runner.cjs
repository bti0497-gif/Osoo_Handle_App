#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { createHash } = require('crypto');

const projectRoot = path.resolve(__dirname, '..', '..');
const packageJsonPath = path.join(projectRoot, 'package.json');
const packageLockPath = path.join(projectRoot, 'package-lock.json');
const playbookPath = path.join(projectRoot, 'docs', 'AUTO_UPDATE_PACKAGING_PLAYBOOK.md');
const resultPath = path.join(projectRoot, 'tmp', 'release-runner-result.json');
const progressPath = path.join(projectRoot, 'tmp', 'release-runner-progress.json');
const requiredTemplateSource = path.join(projectRoot, 'templates', 'reports', '설비이력카드.xlsx');
const electronBuilderConfigPath = path.join(projectRoot, 'electron-builder.config.cjs');
const nativeScriptPath = path.join(projectRoot, 'scripts', 'validate-packaged-native.cjs');
const asarScriptPath = path.join(projectRoot, 'scripts', 'validate-release.cjs');
const runnerVersion = '1.1.0';
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
  'PUBLISH',
  'FINAL REPORT',
];

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    dryRun: args.has('--dry-run'),
    help: args.has('--help') || args.has('-h'),
    publish: args.has('--publish'),
    debug: args.has('--debug') || args.has('--verbose'),
    allowExistingTag: args.has('--allow-existing-tag') || args.has('--force-tag'),
  };
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

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}초`;
  return `${minutes}분 ${seconds}초`;
}

function writeProgress(progress) {
  try {
    ensureResultDirectory();
    fs.writeFileSync(progressPath, `${JSON.stringify(progress, null, 2)}\n`, 'utf8');
  } catch {}
}

function cleanStaleReleaseDirectories() {
  const cleaned = [];
  try {
    const entries = fs.readdirSync(projectRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('.stale-release-')) {
        const fullPath = path.join(projectRoot, entry.name);
        try {
          fs.rmSync(fullPath, { recursive: true, force: true });
          cleaned.push(entry.name);
        } catch (err) {
          console.warn(`   [Release Runner] 오래된 임시 디렉터리 삭제 건너뜀 (${entry.name}): ${err.message}`);
        }
      }
    }
  } catch {}
  return cleaned;
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

function runCommandAsync(command, args, options = {}) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const stepName = options.stepName || command;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let lastLogLine = '';
    let lastMilestone = '';

    const child = spawn(command, args, {
      cwd: projectRoot,
      shell: process.platform === 'win32',
      windowsHide: true,
      env: { ...process.env, ...(options.env || {}) },
    });

    let tickCount = 0;
    const heartbeatTimer = setInterval(() => {
      tickCount += 1;
      const elapsed = Date.now() - startTime;
      if (options.onProgress) {
        options.onProgress({
          elapsedMs: elapsed,
          elapsed: formatDuration(elapsed),
          lastLogLine: lastLogLine.slice(0, 200),
        });
      }
      // 디버그 모드가 아닐 때 30초(5초 * 6)마다 콘솔 하트비트 출력
      if (!options.debug && tickCount % 6 === 0) {
        const preview = lastMilestone || lastLogLine ? ` | 최근: ${(lastMilestone || lastLogLine).slice(0, 60)}` : '';
        console.log(`   ⏳ [${stepName}] 진행 중... (${formatDuration(elapsed)}${preview})`);
      }
    }, 5000);

    const milestoneRegex = /(✓|PASS|FAIL|building|packaging|Rebuild Complete|vite|built in|created installer|compiling|cleaning|Lint)/i;

    child.stdout.on('data', (data) => {
      const text = data.toString();
      if (options.debug) {
        process.stdout.write(text);
      }
      stdoutBuffer += text;
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length > 0) {
        lastLogLine = lines[lines.length - 1].trim();
        if (!options.debug) {
          for (const line of lines) {
            const trimmed = line.trim();
            if (milestoneRegex.test(trimmed)) {
              lastMilestone = trimmed;
              console.log(`   → ${trimmed.slice(0, 100)}`);
            }
          }
        }
      }
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      if (options.debug) {
        process.stderr.write(text);
      }
      stderrBuffer += text;
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length > 0) {
        lastLogLine = lines[lines.length - 1].trim();
      }
    });

    child.on('close', (code, signal) => {
      clearInterval(heartbeatTimer);
      const durationMs = Date.now() - startTime;
      resolve({
        command: [command, ...args].join(' '),
        status: code === null ? (signal ? 1 : 0) : code,
        signal,
        error: '',
        durationMs,
        duration: formatDuration(durationMs),
        stdout: stdoutBuffer.slice(-15000),
        stderr: stderrBuffer.slice(-15000),
      });
    });

    child.on('error', (err) => {
      clearInterval(heartbeatTimer);
      const durationMs = Date.now() - startTime;
      resolve({
        command: [command, ...args].join(' '),
        status: 1,
        signal: null,
        error: err.message,
        durationMs,
        duration: formatDuration(durationMs),
        stdout: stdoutBuffer.slice(-15000),
        stderr: stderrBuffer.slice(-15000),
      });
    });
  });
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

function checkExistingRelease(version) {
  const tag = `v${version}`;
  let localTag = false;
  let remoteTag = false;
  let ghRelease = false;
  const details = [];

  const localRes = runCommand('git', ['tag', '-l', tag]);
  if (localRes.status === 0 && localRes.stdout.trim() === tag) {
    localTag = true;
    details.push('로컬 Git 태그');
  }

  const remoteRes = runCommand('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], { timeout: 8000 });
  if (remoteRes.status === 0 && remoteRes.stdout.includes(tag)) {
    remoteTag = true;
    details.push('원격 Git 태그');
  }

  const ghRes = runCommand('gh', ['release', 'view', tag, '--json', 'tagName'], { timeout: 8000 });
  if (ghRes.status === 0) {
    ghRelease = true;
    details.push('GitHub Release');
  }

  const exists = localTag || remoteTag || ghRelease;
  return {
    tag,
    exists,
    localTag,
    remoteTag,
    ghRelease,
    details: details.join(', '),
  };
}

function writeChecksumsFile(version, outputDirectory) {
  const targetDir = path.join(projectRoot, outputDirectory);
  if (!fs.existsSync(targetDir)) return null;

  const filesToHash = [
    `Osoo.Handle.App.Setup.${version}.exe`,
    `Osoo.Handle.App.Setup.${version}.exe.blockmap`,
    'latest.yml',
  ];

  const lines = [];
  for (const fileName of filesToHash) {
    const fullPath = path.join(targetDir, fileName);
    if (fs.existsSync(fullPath)) {
      const hash = sha256(fullPath);
      lines.push(`${hash} *${fileName}`);
    }
  }

  if (lines.length === 0) return null;

  const sumsPath = path.join(targetDir, 'SHA256SUMS.txt');
  fs.writeFileSync(sumsPath, `${lines.join('\n')}\n`, 'utf8');
  return fileInfo(sumsPath);
}

function preflight(packageJson, packageLock, options = {}) {
  const status = gitStatus();
  const processes = conflictingProcesses();
  const tagCheck = checkExistingRelease(packageJson.version);
  const builderConfigText = fs.existsSync(electronBuilderConfigPath)
    ? fs.readFileSync(electronBuilderConfigPath, 'utf8')
    : '';
  const checks = {
    packageVersion: packageJson.version,
    lockVersion: packageLock.version,
    versionsMatch: packageJson.version === packageLock.version,
    gitStatus: status,
    tagCheck,
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
  if (tagCheck.exists) {
    if (options.allowExistingTag) {
      console.warn(`   [WARN] '${tagCheck.tag}'가 이미 존재합니다 (${tagCheck.details}). --allow-existing-tag 플래그로 인해 진행합니다.`);
    } else {
      failures.push(`태그/릴리즈 '${tagCheck.tag}'가 이미 존재합니다 (${tagCheck.details}). 20~30분 소요되는 패키징의 중복 실행을 방지하기 위해 중단합니다. (우회: --allow-existing-tag)`);
    }
  }
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
    path.join(projectRoot, outputDirectory, 'SHA256SUMS.txt'),
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
  console.log('Usage: npm run release:runner [-- [options]]');
  console.log('');
  console.log('Options:');
  console.log('  --publish             모든 검증이 PASS되면 GitHub Release를 자동 생성/업로드합니다.');
  console.log('  --debug, --verbose    자식 프로세스의 모든 출력을 실시간으로 터미널에 스트리밍합니다.');
  console.log('  --allow-existing-tag  이미 Git 태그나 GitHub Release가 존재해도 사전 검사를 우회합니다.');
  console.log('  --dry-run             실제 빌드 없이 사전 검사 및 실행 계획만 확인합니다.');
  console.log('  --help, -h            도움말을 출력합니다.');
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printHelp();
    return 0;
  }

  // [보강 6] 시작 전 잠금 풀린 오래된 임시 디렉터리 자동 청소
  const cleanedStale = cleanStaleReleaseDirectories();
  if (cleanedStale.length > 0) {
    console.log(`[Release Runner] 오래된 임시 디렉터리 정리 완료: ${cleanedStale.join(', ')}`);
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
    publish: options.publish,
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
  console.log(`Mode: ${options.dryRun ? 'DRY-RUN' : (options.publish ? 'PACKAGE & PUBLISH' : 'PACKAGE ONLY')}`);
  if (options.debug) console.log('Debug: ENABLED (상세 로그 실시간 스트리밍)');
  console.log('========================================');

  const preflightResult = preflight(packageJson, packageLock, options);
  result.steps.PREFLIGHT = { status: preflightResult.failures.length ? 'FAIL' : 'PASS', ...preflightResult };
  logStep('Preflight', result.steps.PREFLIGHT.status, `dirty=${preflightResult.checks.gitStatus.length}, conflicts=${preflightResult.checks.conflictingProcesses.length}`);
  if (preflightResult.failures.length) {
    result.failedStep = 'PREFLIGHT';
    for (const fail of preflightResult.failures) {
      console.error(`   ✕ ${fail}`);
    }
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
    for (const name of steps.slice(1, -3)) {
      result.steps[name] = { status: 'DRY-RUN', command: result.plannedCommands.find((item) => item.name === name)?.command || 'cleanup/final report' };
      logStep(name, 'DRY-RUN');
    }
    result.steps['NODE ABI RESTORE'] = { status: 'DRY-RUN', command: 'npm rebuild better-sqlite3' };
    logStep('Node ABI Restore', 'DRY-RUN');
    result.steps.PUBLISH = { status: 'DRY-RUN', command: options.publish ? `gh release create v${packageJson.version} ...` : 'SKIPPED (--publish 옵션 없음)' };
    logStep('Publish', 'DRY-RUN', options.publish ? 'gh release create 예정' : '생략');
    return finish(result, 0, true);
  }

  let packageStarted = false;
  let exitCode = 0;
  const runnerStartTime = Date.now();
  const totalSteps = plannedCommands.length;
  let lastStepIndex = 0;

  try {
    let stepIndex = 0;
    for (const [name, command, args] of plannedCommands) {
      stepIndex += 1;
      lastStepIndex = stepIndex;
      if (name === 'NATIVE/ELECTRON ABI PREPARATION') packageStarted = true;
      console.log(`\n▶ [${stepIndex}/${totalSteps}] ${name} 시작 (${command} ${args.join(' ')})`);

      writeProgress({
        version: packageJson.version,
        stepIndex,
        totalSteps,
        totalSteps: totalSteps + (options.publish ? 1 : 0),
        percentage: Math.round(((stepIndex - 1) / (totalSteps + (options.publish ? 1 : 0))) * 100),
        currentStep: name,
        command: [command, ...args].join(' '),
        status: 'RUNNING',
        stepStartedAt: new Date().toISOString(),
        totalElapsed: formatDuration(Date.now() - runnerStartTime),
      });

      const commandResult = await runCommandAsync(command, args, {
        stepName: name,
        debug: options.debug,
        env: { OSOO_RELEASE_OUTPUT_DIR: outputDirectory },
        onProgress: (info) => {
          writeProgress({
            version: packageJson.version,
            stepIndex,
            totalSteps,
            totalSteps: totalSteps + (options.publish ? 1 : 0),
            percentage: Math.round(((stepIndex - 1) / (totalSteps + (options.publish ? 1 : 0))) * 100),
            currentStep: name,
            command: [command, ...args].join(' '),
            status: 'RUNNING',
            stepElapsed: info.elapsed,
            totalElapsed: formatDuration(Date.now() - runnerStartTime),
            lastLog: info.lastLogLine,
            updatedAt: new Date().toISOString(),
          });
        },
      });

      result.steps[name] = { ...commandResult, status: commandResult.status === 0 ? 'PASS' : 'FAIL' };
      logStep(name, result.steps[name].status, `소요: ${commandResult.duration || '0초'}`);
      writeResult(result);

      if (commandResult.status !== 0) {
        result.failedStep = name;
        exitCode = 1;
        console.error(`\n[ERROR] '${name}' 단계 실패 (종료 코드: ${commandResult.status})`);
        if (commandResult.error) console.error(`시스템 오류: ${commandResult.error}`);
        if (commandResult.stderr && !options.debug) {
          console.error(`--- STDERR ---`);
          console.error(commandResult.stderr.split(/\r?\n/).slice(-30).join('\n'));
        }
        if (commandResult.stdout && !options.debug) {
          console.error(`--- STDOUT ---`);
          console.error(commandResult.stdout.split(/\r?\n/).slice(-30).join('\n'));
        }
        console.error(`--------------\n`);
        break;
      }

      if (name === 'PACKAGE') {
        // [보강 4] SHA256SUMS.txt 생성
        const checksumFile = writeChecksumsFile(packageJson.version, outputDirectory);
        if (checksumFile) {
          console.log(`   → SHA256SUMS.txt 생성 완료`);
        }

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
      console.log('\n▶ Node ABI 복구 중 (npm rebuild better-sqlite3)...');
      const restore = await runCommandAsync('npm', ['rebuild', 'better-sqlite3'], {
        stepName: 'NODE ABI RESTORE',
        debug: options.debug,
      });
      result.steps['NODE ABI RESTORE'] = { ...restore, status: restore.status === 0 ? 'PASS' : 'FAIL' };
      logStep('Node ABI Restore', result.steps['NODE ABI RESTORE'].status, `소요: ${restore.duration || '0초'}`);
      if (restore.status !== 0 && !result.failedStep) {
        result.failedStep = 'NODE ABI RESTORE';
        exitCode = 1;
      }
    }
  }

  // [보강 3] PUBLISH 단계 (모든 검증이 PASS이고 options.publish 활성화 시)
  if (exitCode === 0) {
    if (options.publish) {
      console.log(`\n▶ [PUBLISH] GitHub Release v${packageJson.version} 배포 시작...`);
      const releaseTag = `v${packageJson.version}`;
      const uploadFiles = [
        path.join(outputDirectory, `Osoo.Handle.App.Setup.${packageJson.version}.exe`),
        path.join(outputDirectory, `Osoo.Handle.App.Setup.${packageJson.version}.exe.blockmap`),
        path.join(outputDirectory, 'latest.yml'),
        path.join(outputDirectory, 'SHA256SUMS.txt'),
      ].filter((rel) => fs.existsSync(path.join(projectRoot, rel)));

      writeProgress({
        version: packageJson.version,
        stepIndex: totalSteps + 1,
        totalSteps: totalSteps + 1,
        percentage: 95,
        currentStep: 'PUBLISH',
        command: `gh release ... ${releaseTag}`,
        status: 'RUNNING',
        stepStartedAt: new Date().toISOString(),
        totalElapsed: formatDuration(Date.now() - runnerStartTime),
      });

      const viewCheck = runCommand('gh', ['release', 'view', releaseTag]);
      const isExisting = viewCheck.status === 0;

      const ghArgs = isExisting
        ? ['release', 'upload', releaseTag, ...uploadFiles, '--clobber']
        : ['release', 'create', releaseTag, ...uploadFiles, '--title', releaseTag, '--notes', `Release ${releaseTag}`];

      const publishResult = await runCommandAsync('gh', ghArgs, {
        stepName: 'PUBLISH',
        debug: options.debug,
      });

      result.steps.PUBLISH = { ...publishResult, status: publishResult.status === 0 ? 'PASS' : 'FAIL' };
      logStep('Publish', result.steps.PUBLISH.status, `소요: ${publishResult.duration || '0초'}`);
      if (publishResult.status !== 0) {
        result.failedStep = 'PUBLISH';
        exitCode = 1;
        console.error(`\n[ERROR] GitHub Release 배포 실패`);
        if (publishResult.stderr) console.error(publishResult.stderr);
      }
    } else {
      result.steps.PUBLISH = { status: 'SKIPPED', message: '--publish 옵션 미지정 (수동 배포 모드)' };
      logStep('Publish', 'SKIPPED', '수동 배포 모드');
    }
  } else {
    result.steps.PUBLISH = { status: 'SKIPPED', message: '선행 검증 실패로 배포 생략' };
  }

  const totalDuration = formatDuration(Date.now() - runnerStartTime);
  result.totalDuration = totalDuration;
  writeProgress({
    version: packageJson.version,
    percentage: exitCode === 0 ? 100 : Math.min(99, Math.round((lastStepIndex / totalSteps) * 100)),
    status: exitCode === 0 ? 'COMPLETED' : 'FAILED',
    result: exitCode === 0 ? 'PASS' : 'FAIL',
    failedStep: result.failedStep || '',
    totalDuration,
    completedAt: new Date().toISOString(),
  });
  return finish(result, exitCode);
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
  writeProgress({
    version: result.version,
    status: dryRun ? 'DRY-RUN' : (exitCode === 0 ? 'COMPLETED' : 'FAILED'),
    result: result.result,
    failedStep: result.failedStep || '',
    totalDuration: result.totalDuration || '0초',
    completedAt: new Date().toISOString(),
  });
  console.log('');
  console.log(`RESULT: ${result.result}`);
  console.log(`READY FOR RELEASE: ${result.readyForRelease ? 'YES' : 'NO'}`);
  if (result.totalDuration) console.log(`TOTAL DURATION: ${result.totalDuration}`);
  if (result.failedStep) console.log(`FAILED STEP: ${result.failedStep}`);
  const installer = result.artifacts?.find((artifact) => /Setup\..+\.exe$/.test(artifact.path));
  if (installer) {
    console.log(`Installer: ${installer.path}`);
    console.log(`SHA256: ${installer.sha256 || 'unavailable'}`);
  }
  console.log(`PROGRESS: ${path.relative(projectRoot, progressPath)}`);
  console.log(`REPORT: ${path.relative(projectRoot, resultPath)}`);
  console.log('========================================');
  return exitCode;
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(`[Release Runner] fatal: ${error.stack || error.message}`);
  process.exit(1);
});
