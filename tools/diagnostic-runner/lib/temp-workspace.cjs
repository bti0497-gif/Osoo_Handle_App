'use strict';

/**
 * 진단 실행용 임시 작업 디렉터리 생성·정리 모듈.
 *
 * - 매 실행마다 새 run 디렉터리를 만들고 운영 AppData 경로(%APPDATA%\Osoo_Handle_App,
 *   %APPDATA%\wastewater-treatment-plant)를 절대 만지지 않는다.
 * - 성공 실행은 기본 정리, 실패 실행은 --keep-artifacts 로 보존한다.
 */

const fs = require('fs');
const path = require('path');

const RUNNER_ROOT = __dirname;
// lib/ → diagnostic-runner/ → tools/ → 프로젝트 루트
const PROJECT_ROOT = path.join(RUNNER_ROOT, '..', '..', '..');
const DIAGNOSTICS_BASE = path.join(PROJECT_ROOT, 'tmp', 'diagnostics');

function pad(value) {
  return String(value).padStart(2, '0');
}

function createRunId(now = new Date()) {
  return [
    now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
    '-', pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds()),
  ].join('');
}

function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

/**
 * run 디렉터리와 하위 구조를 만든다.
 * 산출물 계약은 docs/DIAGNOSTIC_RUNNER_DEVELOPMENT_PLAN.md §4 를 따른다.
 */
function createRunWorkspace(runId = createRunId()) {
  const runDir = path.join(DIAGNOSTICS_BASE, `run-${runId}`);
  const appData = mkdirp(path.join(runDir, 'app-data'));
  const paths = {
    runId,
    runDir,
    appData,
    appDataLogs: mkdirp(path.join(appData, 'logs')),
    profile: mkdirp(path.join(runDir, 'profile')),
    profileAppData: mkdirp(path.join(runDir, 'profile', 'appdata')),
    profileLocalAppData: mkdirp(path.join(runDir, 'profile', 'localappdata')),
    profileTemp: mkdirp(path.join(runDir, 'profile', 'temp')),
    screenshots: mkdirp(path.join(runDir, 'screenshots')),
    traces: mkdirp(path.join(runDir, 'traces')),
    logs: mkdirp(path.join(runDir, 'logs')),
    resultJson: path.join(runDir, 'result.json'),
    reportHtml: path.join(runDir, 'report.html'),
    guardLog: path.join(runDir, 'logs', 'external-call-guard.jsonl'),
    serverStdioLog: path.join(runDir, 'logs', 'server-stdio.log'),
  };
  return paths;
}

/**
 * 실행 종료 후 run 디렉터리를 정리한다.
 * - keep=true 면 아무것도 지우지 않는다(실패 재현 보존).
 * - success=true 면 result.json 만 남기고 나머지를 지운다(성공 실행 기본 정리).
 * - 실패 실행은 전체를 보존한다.
 */
function cleanupRunWorkspace(paths, { keep = false, success = false } = {}) {
  if (!paths || !paths.runDir || keep) return { removed: false, keptDir: paths ? paths.runDir : null };
  if (!success) return { removed: false, keptDir: paths.runDir };
  try {
    const entries = fs.readdirSync(paths.runDir);
    for (const entry of entries) {
      if (entry === 'result.json') continue;
      fs.rmSync(path.join(paths.runDir, entry), { recursive: true, force: true });
    }
    return { removed: true, keptDir: paths.runDir };
  } catch (error) {
    return { removed: false, keptDir: paths.runDir, error: error.message };
  }
}

module.exports = {
  PROJECT_ROOT,
  DIAGNOSTICS_BASE,
  createRunId,
  createRunWorkspace,
  cleanupRunWorkspace,
};
