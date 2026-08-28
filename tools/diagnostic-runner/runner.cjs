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

const { PROJECT_ROOT, createRunWorkspace, cleanupRunWorkspace } = require('./lib/temp-workspace.cjs');
const { resolveFreePort, preflightAbi, startServer, waitForReady, stopServer } = require('./lib/app-process.cjs');
const { loadFixtures, seedFixtures, inspectDatabase } = require('./lib/fixture-seeder.cjs');
const { createScenarioContext } = require('./lib/scenario-context.cjs');
const { buildResult, writeReports, printSummary } = require('./lib/diagnostic-reporter.cjs');

const RUNNER_ROOT = __dirname;
const SCENARIO_ORDER = ['health', 'auth', 'dailylog', 'recovery'];
const EXIT_CODES = { passed: 0, failed: 1, blocked: 2 };

function parseArgs(argv) {
  const options = { scenario: 'all', mode: 'local', ui: false, keepArtifacts: false, list: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--scenario') options.scenario = argv[++index] || 'all';
    else if (arg === '--mode') options.mode = argv[++index] || 'local';
    else if (arg === '--ui') options.ui = true;
    else if (arg === '--keep-artifacts') options.keepArtifacts = true;
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) process.exit(EXIT_CODES.blocked);

  const runnerRoot = RUNNER_ROOT;
  const scenarioNames = options.scenario === 'all' ? SCENARIO_ORDER : [options.scenario];
  if (options.list) {
    console.log('사용 가능 시나리오:', SCENARIO_ORDER.join(', '));
    for (const name of SCENARIO_ORDER) {
      const scenario = loadScenario(name);
      console.log(`  ${name} v${scenario.version} [${scenario.status}]`);
    }
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
  if (options.ui) {
    console.error('--ui (Playwright) 진단은 Phase 4 예정 항목입니다. 현재 버전은 API/DB 시나리오만 지원합니다.');
    process.exit(EXIT_CODES.blocked);
  }

  const startedAt = new Date();
  const workspace = createRunWorkspace();
  console.log(`[1/9] run 디렉터리 생성: ${workspace.runDir}`);
  let runtime = null;
  let serverProcess = null;

  const restartServer = async () => {
    const stopResult = await stopServer(serverProcess);
    serverProcess = startServer({ projectRoot: PROJECT_ROOT, workspace, port: serverProcess.port, token: serverProcess.token });
    const ready = await waitForReady({ port: serverProcess.port, token: serverProcess.token });
    return { ...stopResult, ready: true, pid: serverProcess.pid, port: serverProcess.port, readyPayload: ready };
  };

  try {
    console.log('[2/9] ABI 프리플라이트 (better-sqlite3 in Node)');
    runtime = preflightAbi(PROJECT_ROOT);
    console.log(`      node ${runtime.nodeVersion} (abi ${runtime.nodeModulesAbi}), better-sqlite3 ${runtime.betterSqlite3Version}`);

    console.log('[3/9] 외부 네트워크 차단 guard 환경 주입');
    const port = await resolveFreePort();
    const token = crypto.randomUUID();
    console.log(`      포트 ${port}, token/redacted`);

    console.log('[4/9] 앱 서버 실행 (격리 환경, guard 포함)');
    serverProcess = startServer({ projectRoot: PROJECT_ROOT, workspace, port, token });

    console.log('[5/9] 서버 readiness 대기');
    await waitForReady({ port, token });
    console.log('      /api/ping ready 확인');

    console.log('[6/9] fixture 직접 seed (임시 osoo.db)');
    const fixtures = loadFixtures(runnerRoot);
    const expected = seedFixtures({ dbPath: path.join(workspace.appData, 'osoo.db'), fixtures });

    console.log('[7/9] 업무 시나리오 실행');
    const executed = [];
    const runContext = { ctx: null, dbPath: path.join(workspace.appData, 'osoo.db'), expected, fixtures, runtime: { restartServer } };
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
        status: ctx.status,
        passedCount: ctx.passedCount,
        failedCount: ctx.failedCount,
        steps: ctx.steps,
      });
    }

    console.log('[8/9] 서버 종료 및 잔존 확인');
    const stopResult = await stopServer(serverProcess);
    serverProcess = null;
    if (stopResult.orphaned) throw new Error('서버 종료 후 자식 프로세스가 잔존합니다.');

    console.log('[9/9] 결과 집계');
    const database = inspectDatabase({ dbPath: path.join(workspace.appData, 'osoo.db'), expected });
    const externalCalls = summarizeGuardLog(workspace.guardLog);
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
      artifacts: { runDir: workspace.runDir, resultJson: workspace.resultJson, reportHtml: workspace.reportHtml },
    });
    result.status = status;
    writeReports({ result, resultJsonPath: workspace.resultJson, reportHtmlPath: workspace.reportHtml });
    printSummary(result);

    const cleanup = cleanupRunWorkspace(workspace, { keep: options.keepArtifacts, success: status === 'passed' });
    if (cleanup.removed) console.log(`성공 실행 산출물을 정리했습니다(result.json 유지): ${workspace.runDir}`);
    else if (!options.keepArtifacts && status === 'failed') console.log(`실패 산출물을 보존했습니다: ${workspace.runDir}`);
    else console.log(`산출물을 보존했습니다(--keep-artifacts): ${workspace.runDir}`);
    process.exitCode = EXIT_CODES[status] ?? EXIT_CODES.failed;
  } catch (error) {
    console.error(`진단 실행 실패(${error.message})`);
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
