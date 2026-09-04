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
  // 동일 초 병렬 실행 충돌 방지: 밀리초·PID·난수 접미. 날짜 선두라 정렬(기준선 탐색)은 유지된다.
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  const rand = Math.random().toString(36).slice(2, 6);
  return [
    now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
    '-', pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds()),
    '-', ms, '-', process.pid, '-', rand,
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
async function cleanupRunWorkspace(paths, { keep = false, success = false } = {}) {
  if (!paths || !paths.runDir || keep) return { removed: false, keptDir: paths ? paths.runDir : null };
  if (!success) return { removed: false, keptDir: paths.runDir };
  // 성공 실행은 result.json 외 최대한 정리한다. 서버가 띄운 Excel(리포트 사전 준비)이
  // 임시 프로필 로그를 잡고 있으면 삭제가 막히므로, 항목별로 최선을 다하고 잔존을 보고한다.
  const removeBestEffort = async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let busy = false;
      for (const entry of fs.readdirSync(paths.runDir)) {
        if (entry === 'result.json' || entry === 'agent-report.md') continue;
        try {
          fs.rmSync(path.join(paths.runDir, entry), { recursive: true, force: true });
        } catch (_) { busy = true; }
      }
      if (!busy) return true;
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    return fs.readdirSync(paths.runDir).every((entry) => entry === 'result.json' || entry === 'agent-report.md');
  };
  const removed = await removeBestEffort();
  return { removed, keptDir: paths.runDir };
}

/**
 * 실행 산출물 보존 정책: 최근 keep개 run 디렉터만 유지하고 나머지를 정리한다.
 * Excel 등이 잠근 항목은 최선형으로 건너뛴다(수동 정리가 히스토리를 지우는 사고 방지).
 */
function pruneOldRuns(diagnosticsBase, keep = 10) {
  try {
    const dirs = fs.readdirSync(diagnosticsBase).filter((dir) => /^run-/.test(dir)).sort().reverse();
    for (const dir of dirs.slice(keep)) {
      try { fs.rmSync(path.join(diagnosticsBase, dir), { recursive: true, force: true }); } catch (_) {}
    }
    return dirs.length;
  } catch (_) {
    return 0;
  }
}

module.exports = {
  PROJECT_ROOT,
  DIAGNOSTICS_BASE,
  pruneOldRuns,
  createRunId,
  createRunWorkspace,
  cleanupRunWorkspace,
};
