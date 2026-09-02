#!/usr/bin/env node
'use strict';

/**
 * 업무 시나리오 진단 러너 (개발·검증 전용 — 절대 배포 금지)
 *
 * 사용법:
 *   node tools/diagnostic-runner/runner.cjs --scenario health
 *   node tools/diagnostic-runner/runner.cjs --scenario all
 *   node tools/diagnostic-runner/runner.cjs --scenario all --keep-artifacts
 *
 * 실행 계약은 docs/DIAGNOSTIC_RUNNER_DEVELOPMENT_PLAN.md 를 따른다.
 * - 매 실행 새 임시 DB/프로필, 운영 AppData 미사용
 * - 외부 네트워크 guard는 서버 기동 전에 주입(§4 3단계)
 * - 실패 실행은 tmp/diagnostics/run-<id>/ 에 재현 산출물 보존
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { PROJECT_ROOT, DIAGNOSTICS_BASE, createRunWorkspace, cleanupRunWorkspace, pruneOldRuns } = require('./lib/temp-workspace.cjs');
const { resolveFreePort, preflightAbi, startServer, waitForReady, waitForGuardBoot, waitPortFree, stopServer } = require('./lib/app-process.cjs');
const { loadFixtures, seedFixtures, inspectDatabase } = require('./lib/fixture-seeder.cjs');
const { createScenarioContext } = require('./lib/scenario-context.cjs');
const { buildResult, writeReports, printSummary } = require('./lib/diagnostic-reporter.cjs');
const { listChangedFiles, mapFilesToScenarios } = require('./lib/changed-scope.cjs');
const { findBaselineRun, diffAgainstBaseline } = require('./lib/baseline.cjs');

const RUNNER_ROOT = __dirname;
// 시나리오 자동 발견: scenarios/*.scenario.cjs 를 스캔한다(확장 훅).
// 새 기능 시나리오는 파일만 추가하면 등록된다. recovery(last:true)는 항상 마지막에 실행된다.
function discoverScenarios() {
  const dir = path.join(__dirname, 'scenarios');
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.scenario.cjs'))
    .map((file) => require(path.join(dir, file)))
    .filter((m) => m && typeof m.id === 'string') // ui(실험용) 등 비표준 모듈 제외
    .sort((a, b) => {
      const last = (m) => (m.last === true ? 1 : 0);
      return last(a) - last(b) || a.id.localeCompare(b.id, 'en');
    })
    .map((m) => m.id);
}
const SCENARIO_ORDER = discoverScenarios();
const EXIT_CODES = { passed: 0, failed: 1, blocked: 2 };

function parseArgs(argv) {
  const options = { scenario: 'all', mode: 'local', ui: false, lint: false, coverage: false, changed: null, keepArtifacts: false, list: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--scenario') options.scenario = argv[++index] || 'all';
    else if (arg === '--mode') options.mode = argv[++index] || 'local';
    else if (arg === '--ui') options.ui = true;
    else if (arg === '--keep-artifacts') options.keepArtifacts = true;
    else if (arg === '--lint') options.lint = true;
    else if (arg === '--coverage') options.coverage = true;
    else if (arg === '--changed') {
      options.changed = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
    }
    else if (arg === '--list') options.list = true;
    else {
      console.error(`알 수 없는 옵션: ${arg}`);
      process.exitCode = EXIT_CODES.blocked;
      return null;
    }
  }
  return options;
}

function loadScenario(name) {
  const file = path.join(RUNNER_ROOT, 'scenarios', `${name}.scenario.cjs`);
  if (!fs.existsSync(file)) return null;
  return require(file);
}

/** guard 로그(JSONL)를 읽어 외부 호출 통계로 집계한다. */
function summarizeGuardLog(guardLogPath) {
  const summary = { drive: 0, bigquery: 0, firebase: 0, blockedRequests: 0, sdkModules: [], blockedHosts: [] };
  if (!fs.existsSync(guardLogPath)) return summary;
  const moduleKey = {
    googleapis: 'drive',
    'google-auth-library': 'drive',
    '@google-cloud/bigquery': 'bigquery',
    'firebase-admin': 'firebase',
    firebase: 'firebase',
  };
  for (const line of fs.readFileSync(guardLogPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record.type === 'blocked') {
        summary.blockedRequests += 1;
        summary.blockedHosts.push(`${record.protocol}://${record.host}${record.path || ''}`.slice(0, 120));
      } else if (record.type === 'sdk-load') {
        const key = moduleKey[record.module];
        if (key) summary[key] += 1;
        summary.sdkModules.push(record.module);
      }
    } catch (_) { /* 부분 라인 무시 */ }
  }
  summary.blockedHosts = [...new Set(summary.blockedHosts)].slice(0, 10);
  return summary;
}


/**
 * 선택 린트 실행(--lint). 에이전트가 수정 후 별도로 `npm run lint`를 돌리지 않도록
 * 한 번의 실행에 린트 결과를 함께 기록한다(§ 목적: 쿼터 절감형 원샷 검증).
 */
function runLint(projectRoot) {
  const { spawnSync } = require('child_process');
  const startedAt = Date.now();
  const result = spawnSync('npm run lint --silent', {
    cwd: projectRoot,
    shell: true,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 5 * 60 * 1000,
  });
  const output = String(result.stdout || '') + String(result.stderr || '');
  const lines = output.split(/\r?\n/).filter((l) => l.trim());
  return {
    passed: result.status === 0,
    durationMs: Date.now() - startedAt,
    tail: lines.slice(-8),
  };
}

/** 인프라 단계 실패 시에도 result.json 을 남기고 실패 산출물을 보존한다. */
function writeFailureResult({ workspace, runtime, startedAt, phase, error }) {
  const result = {
    runId: workspace.runId,
    mode: 'local',
    scenario: 'startup',
    port: null,
    runtime: runtime || null,
    status: 'failed',
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    steps: [{ scenario: 'startup', name: phase, status: 'failed', errorCode: error.code || 'RUNNER_ERROR', message: String(error.message).slice(0, 500) }],
    scenarios: [],
    externalCalls: summarizeGuardLog(workspace.guardLog),
    database: { integrityCheck: 'not-run' },
    artifacts: { runDir: workspace.runDir },
  };
  writeReports({ result, resultJsonPath: workspace.resultJson, reportHtmlPath: null });
  return result;
}

/**
 * 서버 파일이 안정화될 때까지 대기한다.
 * 동기화 도구(예: NovaSync)가 파일을 구버전으로 되돌리는 환경에서는 구버전 server/가
 * spawn되어 포트·격리 계약이 깨진다. node 관점(자식과 동일 뷰)에서 내용이 연속 2회
 * 동일하고 필수 마커를 포함할 때까지 기다린다.
 */
async function waitForServerFilesStable(projectRoot, { timeoutMs = 15000 } = {}) {
  const serverFile = path.join(projectRoot, 'server', 'index.cjs');
  const deadline = Date.now() + timeoutMs;
  let lastHash = '';
  let stableCount = 0;
  while (Date.now() < deadline) {
    const content = fs.readFileSync(serverFile, 'utf8');
    const hash = crypto.createHash('md5').update(content).digest('hex');
    if (hash === lastHash) stableCount += 1; else { stableCount = 0; lastHash = hash; }
    if (stableCount >= 2) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const error = new Error();
  error.errorCode = 'SERVER_FILES_UNSTABLE';
  throw error;
}


/**
 * 커버리지 갭 리포트: 앱 메뉴(src/core/constants)와 시나리오 covers를 대조한다.
 * 새 기능이 들어오면 여기에 "미커버"로 표시되어 시나리오 추가를 요구한다(확장 훅).
 */
function buildCoverageReport(scenarioModules) {
  const constantsSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'core', 'constants', 'index.js'), 'utf8');
  // 메뉴 엔트리 단위로 분해해 그룹 컨테이너(children 보유)와 실제 기능(리프)을 구분한다.
  const entries = constantsSrc.split(/(?=\{\s*id:)/);
  const menuIds = [];
  const groupIds = [];
  for (const entry of entries) {
    const idMatch = entry.match(/\{\s*id:\s*'([^']+)'/);
    if (!idMatch) continue;
    if (/children\s*:/.test(entry)) groupIds.push(idMatch[1]);
    else menuIds.push(idMatch[1]);
  }
  const covered = new Set();
  for (const m of scenarioModules) {
    for (const id of m.covers || []) covered.add(id);
  }
  const uncovered = menuIds.filter((id) => !covered.has(id));
  return { menuIds, groupIds, covered: [...covered].sort(), uncovered };
}

async function showCoverage(scenarioModules) {
  const report = buildCoverageReport(scenarioModules);
  console.log('=== 메뉴 커버리지 ===');
  for (const id of report.menuIds) {
    const owners = scenarioModules.filter((m) => (m.covers || []).includes(id)).map((m) => m.id);
    console.log((owners.length ? '  ' + id + ' ← ' + owners.join(', ') : '  [미커버] ' + id));
  }
  console.log(report.uncovered.length === 0 ? '=== 미커버 메뉴 없음 ===' : '=== 미커버: ' + report.uncovered.join(', ') + ' ===');
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) process.exit(EXIT_CODES.blocked);

  const runnerRoot = RUNNER_ROOT;
  let scenarioNames = options.scenario === 'all' ? SCENARIO_ORDER : [options.scenario];
  let changedSelection = null;
  if (options.changed) {
    const ref = options.changed === true ? null : options.changed;
    const files = listChangedFiles(PROJECT_ROOT, ref);
    changedSelection = mapFilesToScenarios(files);
    changedSelection.files = files;
    if (changedSelection.all) {
      console.log(`[changed] 매핑 결과 전체 실행(파일 ${files.length}건 중 infra/미매핑 코드 포함)`);
    } else {
      const picked = SCENARIO_ORDER.filter((name) => changedSelection.scenarios.includes(name));
      console.log(`[changed] 변경 파일 ${files.length}건 → 시나리오: ${picked.join(', ') || '없음(health만)'}`);
      for (const extra of changedSelection.scenarios) {
        if (!SCENARIO_ORDER.includes(extra) && extra !== 'health') console.warn(`[changed] 알 수 없는 시나리오 매핑 무시: ${extra}`);
      }
    }
  }
  if (options.changed && !changedSelection.all) {
    scenarioNames = scenarioNames.filter((name) => changedSelection.scenarios.includes(name) || name === 'health');
    scenarioNames = SCENARIO_ORDER.filter((name) => scenarioNames.includes(name)); // 실행 순서 유지
  }
  if (options.list) {
    console.log('사용 가능 시나리오:', SCENARIO_ORDER.join(', '));
    for (const name of SCENARIO_ORDER) {
      const scenario = loadScenario(name);
      console.log(`  ${name} v${scenario.version} [${scenario.status}]`);
    }
    return;
  }
  if (options.coverage) {
    const modules = scenarioNames.map((name) => loadScenario(name)).filter(Boolean);
    await showCoverage(modules);
    return;
  }

  const scenarios = scenarioNames.map((name) => {
    const scenario = loadScenario(name);
    if (!scenario) {
      console.error(`알 수 없는 시나리오: ${name} (가능: ${SCENARIO_ORDER.join(', ')})`);
      process.exit(EXIT_CODES.blocked);
    }
    return scenario;
  });

  // 모드 계약(§2.4): local 만 1차 구현 대상이다.
  if (options.mode !== 'local') {
    console.error(`mode "${options.mode}" 은 아직 구현되지 않았습니다.`);
    if (options.mode === 'fixture') console.error('fixture mock 주입은 별도 설계 승인 후 구현 대상입니다(§Phase 2).');
    if (options.mode === 'smoke') console.error('smoke 모드는 명시적 허용 절차 확정 전까지 실행할 수 없습니다(§2.4).');
    process.exit(EXIT_CODES.blocked);
  }


  const startedAt = new Date();
  const workspace = createRunWorkspace();
  console.log(`[1/9] run 디렉터리 생성: ${workspace.runDir}`);
  let runtime = null;
  let serverProcess = null;
  let uiBlockedCount = 0;
  let uiViteOrphaned = false;

  // try 블록 밖에서 정의되므로 외부 port 변수를 참조하지 않는 자완결형 클로저다.
  const restartServer = async () => {
    const prevPort = serverProcess.port;
    const prevToken = serverProcess.token;
    const stopResult = await stopServer(serverProcess);
    await waitPortFree(prevPort);
    serverProcess = startServer({ projectRoot: PROJECT_ROOT, workspace, port: prevPort, token: prevToken });
    await waitForGuardBoot(path.join(workspace.runDir, 'guard'), workspace.guardLog, { timeoutMs: 4000 });
    const ready = await waitForReady({ port: serverProcess.port, token: serverProcess.token });
    return { ...stopResult, ready: true, pid: serverProcess.pid, port: serverProcess.port, readyPayload: ready };
  };

  try {
    console.log('[2/9] ABI 프리플라이트 (better-sqlite3 in Node)');
    runtime = preflightAbi(PROJECT_ROOT);
    console.log(`      node ${runtime.nodeVersion} (abi ${runtime.nodeModulesAbi}), better-sqlite3 ${runtime.betterSqlite3Version}`);

    console.log('[3/9] 외부 네트워크 차단 guard 환경 주입');
    await waitForServerFilesStable(PROJECT_ROOT);
    // 포트는 운영 포트(18731)와 충돌하지 않는 임의 포트를 쓴다(ELECTRON 방식 계약).
    const port = await resolveFreePort();
    const token = crypto.randomUUID();
    console.log('      포트 ' + port + '(임시), token/redacted');

    console.log('[4/9] 앱 서버 실행 (격리 환경, guard 포함)');
    const guardDir = path.join(workspace.runDir, 'guard');
    const executed = [];
    serverProcess = startServer({ projectRoot: PROJECT_ROOT, workspace, port, token });

    console.log('[5/9] guard 부팅 확인 및 서버 readiness 대기');
    runtime.guardProbe = await waitForGuardBoot(guardDir, workspace.guardLog);
    if (runtime.guardProbe) {
      console.log(`      guard 부팅 확인 — env 격리 겹수 ${runtime.guardProbe.hasAppDataPath ? '확인됨' : 'APPDATA 경유(위치 파생)'}`);
    } else {
      console.warn('      guard 부팅 증거 미확인 — readiness에서 판정합니다.');
    }
    await waitForReady({ port, token });
    console.log('      /api/ping ready 확인');

    console.log('[6/9] fixture 직접 seed (임시 osoo.db)');
    const fixtures = loadFixtures(runnerRoot);
    // env 유실 여부와 무관하게 DB는 항상 run 디렉터 안에 생성된다(두 후보 위치 자동 감지).
    const dbCandidates = [
      path.join(workspace.appData, 'osoo.db'),
      path.join(workspace.profileAppData, 'Osoo_Handle_App', 'osoo.db'),
    ];
    const dbPath = dbCandidates.find((p) => fs.existsSync(p));
    if (!dbPath) throw new Error('임시 DB를 찾지 못했습니다: ' + dbCandidates.join(', '));
    console.log('      DB 위치: ' + dbPath);
    const expected = seedFixtures({ dbPath, fixtures });

    if (options.lint) {
      console.log('      --lint: npm run lint 실행 중...');
      const lint = runLint(PROJECT_ROOT);
      executed.push({
        id: 'lint',
        version: '0.1.0',
        status: lint.passed ? 'passed' : 'failed',
        passedCount: lint.passed ? 1 : 0,
        failedCount: lint.passed ? 0 : 1,
        steps: [{ name: 'npm-run-lint', status: lint.passed ? 'passed' : 'failed', durationMs: lint.durationMs, errorCode: lint.passed ? null : 'LINT_FAILED', message: lint.passed ? null : 'lint 위반 존재', details: { tail: lint.tail } }],
      });
      console.log('      lint: ' + (lint.passed ? 'PASS' : 'FAIL') + ' (' + lint.durationMs + 'ms)');
    }

    console.log('[7/9] 업무 시나리오 실행');
    const runContext = { ctx: null, dbPath, expected, fixtures, runtime: { restartServer } };
    for (const scenario of scenarios) {
      process.stdout.write(`  - ${scenario.id} v${scenario.version}\n`);
      const ctx = createScenarioContext({
        baseUrl: `http://127.0.0.1:${port}`,
        token,
        siteId: expected.siteId,
        fixtures,
      });
      runContext.ctx = ctx;
      await scenario.run(runContext);
      executed.push({
        id: scenario.id,
        version: scenario.version,
        moduleStatus: scenario.status || 'implemented',
        status: ctx.status,
        passedCount: ctx.passedCount,
        failedCount: ctx.failedCount,
        steps: ctx.steps,
      });
    }

    if (options.ui) {
      console.log('[7.5/9] UI 진단 (Playwright + Vite 18735)');
      let uiSteps = [];
      try {
        const uiSession = require('./playwright/ui-session.cjs');
        const { runUiScenario } = require('./scenarios/ui.scenario.cjs');
        const vite = await uiSession.startVite(PROJECT_ROOT);
        let browser = null;
        let context = null;
        const uiDiag = { consoleErrors: [], pageErrors: [], requestFailures: [], blockedRequests: [] };
        try {
          const pw = require('playwright-core');
          const channels = ['msedge', 'chrome', null];
          let launchError = null;
          for (const channel of channels) {
            try { browser = await pw.chromium.launch(channel ? { channel, headless: true } : { headless: true }); break; }
            catch (e) { launchError = e; }
          }
          if (!browser) {
            const error = new Error('브라우저 실행 실패(msedge/chrome/chromium). ' + String(launchError && launchError.message).slice(0, 120));
            error.errorCode = 'BROWSER_UNAVAILABLE';
            throw error;
          }
          const ui = await uiSession.createUiContext({ browser, token, siteId: expected.siteId, uiDiag });
          context = ui.context;
          const uiResult = await runUiScenario({ page: ui.page, uiDiag, screenshotsDir: workspace.screenshots, viteUrl: uiSession.VITE_URL, siteId: expected.siteId, fixtures });
          uiSteps = uiResult.steps;
          const violations = await uiSession.collectShimViolations(ui.page);
          if (violations.length > 0) {
            uiSteps.push({ name: 'electronapi-shim-allowlist', status: 'failed', errorCode: 'SHIM_UNDEFINED_METHOD', message: '허용목록 외 electronAPI 접근: ' + [...new Set(violations)].join(', ').slice(0, 200) });
          }
        } finally {
          await uiSession.closeBrowser({ browser, context });
          const vStop = await vite.stopProcess();
          uiViteOrphaned = vStop.orphaned;
        }
      } catch (error) {
        uiSteps.push({ name: 'ui-phase', status: 'failed', errorCode: error.errorCode || 'UI_ERROR', message: String(error.message).slice(0, 300) });
      }
      if (uiViteOrphaned) {
        uiSteps.push({ name: 'vite-lifecycle', status: 'failed', errorCode: 'VITE_ORPHANED', message: 'Vite 프로세스가 잔존합니다.' });
      }
      const failedUi = uiSteps.filter((s) => s.status === 'failed').length;
      executed.push({ id: 'ui', version: '0.1.0', status: failedUi > 0 || uiViteOrphaned ? 'failed' : 'passed', passedCount: uiSteps.filter((s) => s.status === 'passed').length, failedCount: failedUi, steps: uiSteps });
      uiBlockedCount = uiDiag.blockedRequests ? uiDiag.blockedRequests.length : 0;
    }

    console.log('[8/9] 서버 종료 및 잔존 확인');
    const stopResult = await stopServer(serverProcess);
    serverProcess = null;
    if (stopResult.orphaned) throw new Error('서버 종료 후 자식 프로세스가 잔존합니다.');

    console.log('[9/9] 결과 집계');
    const database = inspectDatabase({ dbPath, expected });
    const externalCalls = summarizeGuardLog(workspace.guardLog);
    externalCalls.blockedRequests += uiBlockedCount;
    let status = executed.some((item) => item.status === 'failed') || database.integrityCheck !== 'passed' ? 'failed' : 'passed';
    if (externalCalls.blockedRequests > 0) {
      status = 'failed';
      console.error(`  외부 호출 ${externalCalls.blockedRequests}건이 차단되었습니다: ${externalCalls.blockedHosts.join(', ')}`);
    }
    if (status === 'failed' && database.fixtureIntegrity === 'failed') {
      console.error(`  seed 정합성 경고: ${database.fixtureMessages.join(', ')}`);
    }

    const result = buildResult({
      runId: workspace.runId,
      mode: options.mode,
      scenario: options.scenario,
      port,
      runtime,
      startedAt,
      durationMs: Date.now() - startedAt.getTime(),
      scenarios: executed,
      externalCalls,
      database,
      uncoveredMenus: buildCoverageReport(scenarioNames.map((name) => loadScenario(name))).uncovered,
      artifacts: { runDir: workspace.runDir, resultJson: workspace.resultJson, reportHtml: workspace.reportHtml },
    });
    result.status = status;
    if (changedSelection) {
      result.changed = { ref: options.changed === true ? 'working-tree' : options.changed, fileCount: changedSelection.files.length, all: changedSelection.all, scenarios: changedSelection.all ? 'all' : changedSelection.scenarios, unmapped: changedSelection.unmapped.slice(0, 10) };
    }
    result.baseline = diffAgainstBaseline(result, findBaselineRun(DIAGNOSTICS_BASE, result.runId));
    if (result.baseline && result.baseline.compared) {
      const b = result.baseline;
      console.log(`      기준선 비교(대상 ${b.baselineRunId}): 신규 단계 ${b.newSteps.length}, 제거 ${b.removedSteps.length}, 소요 급증 ${b.durationSpikes.length}`);
      if (b.scenariosAdded && b.scenariosAdded.length > 0) console.log(`      신규 시나리오: ${b.scenariosAdded.join(', ')}`);
      if (b.scenariosRemoved && b.scenariosRemoved.length > 0) console.warn(`      제거된 시나리오: ${b.scenariosRemoved.join(', ')} — 의도된 변경인지 확인하세요.`);
      for (const spike of b.durationSpikes.slice(0, 3)) console.warn(`      [성능] ${spike.step}: ${spike.baselineMs}ms → ${spike.currentMs}ms`);
    }
    writeReports({ result, resultJsonPath: workspace.resultJson, reportHtmlPath: workspace.reportHtml });
    printSummary(result);

    const cleanup = await cleanupRunWorkspace(workspace, { keep: options.keepArtifacts, success: status === 'passed' });
    if (cleanup.removed) console.log(`성공 실행 산출물을 정리했습니다(result.json 유지): ${workspace.runDir}`);
    else if (!options.keepArtifacts && status === 'failed') console.log(`실패 산출물을 보존했습니다: ${workspace.runDir}`);
    else console.log(`산출물을 보존했습니다(--keep-artifacts): ${workspace.runDir}`);
    pruneOldRuns(DIAGNOSTICS_BASE, 10);
    process.exitCode = EXIT_CODES[status] ?? EXIT_CODES.failed;
  } catch (error) {
    console.error(`진단 실행 실패(${error.message})`);
    if (error.stack) console.error(error.stack.split(String.fromCharCode(10)).slice(1, 4).join(String.fromCharCode(10)));
    if (serverProcess) await stopServer(serverProcess).catch(() => {});
    const result = writeFailureResult({ workspace, runtime, startedAt, phase: 'runner', error });
    printSummary({ ...result, scenarios: result.scenarios || [] });
    console.log(`실패 산출물을 보존했습니다: ${workspace.runDir}`);
    process.exitCode = EXIT_CODES.failed;
  }
}

main().catch((error) => {
  console.error('러너 내부 오류:', error);
  process.exit(EXIT_CODES.failed);
});
