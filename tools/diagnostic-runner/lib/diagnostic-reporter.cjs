'use strict';

/**
 * 진단 결과 리포트 생성 모듈.
 * - result.json: docs/DIAGNOSTIC_RUNNER_DEVELOPMENT_PLAN.md §8 계약을 따른다.
 * - report.html: 사람이 빠르게 훑는 용도의 최소 리포트.
 * - 민감 값은 scenario-context 의 redactSensitive 로 이미 1차 정리된다.
 */

const fs = require('fs');
const path = require('path');

function buildResult({ runId, mode, scenario, port, runtime, startedAt, durationMs, scenarios, externalCalls, database, artifacts }) {
  const failed = scenarios.some((item) => item.status === 'failed');
  return {
    runId,
    mode,
    scenario: scenario === 'all' ? 'all' : scenario,
    port,
    runtime,
    status: failed ? 'failed' : 'passed',
    startedAt: startedAt.toISOString(),
    durationMs,
    steps: scenarios.flatMap((item) => item.steps.map((step) => ({ scenario: item.id, ...step }))),
    scenarios: scenarios.map((item) => ({
      id: item.id,
      version: item.version,
      moduleStatus: item.moduleStatus || 'implemented',
      status: item.status,
      passed: item.passedCount,
      failed: item.failedCount,
    })),
    externalCalls,
    database,
    artifacts,
  };
}

function renderReportHtml(result) {
  const escape = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const stepRows = result.steps.map((step) => `
    <tr class="${step.status}">
      <td>${escape(step.scenario)}</td>
      <td>${escape(step.name)}</td>
      <td>${escape(step.status)}</td>
      <td>${step.durationMs !== undefined ? `${step.durationMs}ms` : '-'}</td>
      <td>${escape(step.errorCode || '')}</td>
      <td>${escape(step.message || '')}</td>
    </tr>`).join('');
  const external = result.externalCalls || {};
  const db = result.database || {};
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>진단 리포트 ${escape(result.runId)}</title>
<style>
  body { font-family: 'Malgun Gothic', sans-serif; margin: 24px; color: #1e293b; }
  h1 { font-size: 20px; } table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; } tr.failed td { background: #fef2f2; }
  .summary { margin: 12px 0; padding: 12px; background: #f8fafc; border: 1px solid #e2e8f0; }
  .meta { color: #475569; font-size: 13px; }
</style>
</head>
<body>
<h1>업무 시나리오 진단 리포트 — ${escape(result.status.toUpperCase())}</h1>
<div class="summary meta">
  runId ${escape(result.runId)} · mode ${escape(result.mode)} · scenario ${escape(result.scenario)} ·
  port ${escape(result.port)} · ${escape(result.durationMs)}ms · started ${escape(result.startedAt)}<br>
  외부 호출 — drive ${escape(external.drive ?? 0)} / bigquery ${escape(external.bigquery ?? 0)} /
  firebase ${escape(external.firebase ?? 0)} / blocked ${escape(external.blockedRequests ?? 0)}<br>
  DB integrity ${escape(db.integrityCheck || '-')} · fixture ${escape(db.fixtureIntegrity || '-')}
</div>
<table>
<tr><th>시나리오</th><th>단계</th><th>결과</th><th>소요</th><th>errorCode</th><th>메시지</th></tr>
${stepRows}
</table>
</body>
</html>`;
}

function writeReports({ result, resultJsonPath, reportHtmlPath }) {
  fs.writeFileSync(resultJsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  if (reportHtmlPath) {
    fs.writeFileSync(reportHtmlPath, renderReportHtml(result), 'utf8');
  }
  const agentReportPath = path.join(path.dirname(resultJsonPath), 'agent-report.md');
  fs.writeFileSync(agentReportPath, renderAgentReportMd(result), 'utf8');
}

/**
 * 코딩 에이전트 인계용 마크다운 리포트. result.json의 모든 단계 증거를 사람이 읽는 형태로 편다.
 * 성공 실행도 보존되므로(pass 근거) 회귀 비교 기준으로 쓸 수 있다.
 */
function renderAgentReportMd(result) {
  const lines = [];
  const statusMark = (s) => (s === 'passed' ? 'PASS' : '**FAIL**');
  lines.push('# 진단 러너 인계 리포트');
  lines.push('');
  lines.push(`- 실행: ${result.runId} · 전체 상태: **${result.status.toUpperCase()}**`);
  lines.push(`- 시작: ${result.startedAt} · 소요: ${result.durationMs}ms · 모드: ${result.mode}`);
  lines.push(`- 런타임: node ${result.runtime ? result.runtime.nodeVersion : '?'} (abi ${result.runtime ? result.runtime.nodeModulesAbi : '?'}) · better-sqlite3 ${result.runtime ? result.runtime.betterSqlite3Version : '?'} · ${result.runtime ? result.runtime.abiPreflight : '?'}`);
  lines.push(`- 외부 호출: drive ${result.externalCalls.drive} / bigquery ${result.externalCalls.bigquery} / firebase ${result.externalCalls.firebase} / 차단 ${result.externalCalls.blockedRequests}`);
  lines.push(`- DB: integrity ${result.database.integrityCheck} · fixture ${result.database.fixtureIntegrity || '-'}`);
  lines.push('');
  lines.push('## 시나리오 요약');
  lines.push('');
  lines.push('| 시나리오 | 모듈 상태 | 단계(pass/fail) |');
  lines.push('|---|---|---|');
  for (const s of result.scenarios || []) {
    lines.push(`| ${s.id} | ${s.moduleStatus || s.status} | ${statusMark(s.status)} (${s.passed}/${s.failed}) |`);
  }
  lines.push('');
  const contractPending = (result.scenarios || []).filter((s) => s.moduleStatus === 'contract-pending');
  if (contractPending.length > 0) {
    lines.push('> **계약 특이사항**: ' + contractPending.map((s) => s.id).join(', ') + ' 은 현재 동작을 고정한 트립와이어입니다. 앱 동작이 변하면 해당 단계가 실패하며 계약 갱신이 필요합니다.');
    lines.push('');
  }
  if (result.changed) {
    lines.push('## 변경 범위(--changed)');
    lines.push('');
    lines.push(`- 기준: ${result.changed.ref} · 파일 ${result.changed.fileCount}건 · 실행: ${result.changed.all ? '전체' : result.changed.scenarios.join(', ')}`);
    if (result.changed.unmapped && result.changed.unmapped.length > 0) {
      lines.push(`- 미매핑(전체 실행 트리거): ${result.changed.unmapped.join(', ')}`);
    }
    lines.push('');
  }
  if (result.baseline && result.baseline.compared) {
    const b = result.baseline;
    lines.push('## 기준선 비교(직전 성공 실행)');
    lines.push('');
    lines.push(`- 기준선: ${b.baselineRunId} · 공통 시나리오 ${b.sharedScenarios}개`);
    if (b.scenariosAdded && b.scenariosAdded.length > 0) lines.push(`- 신규 시나리오: ${b.scenariosAdded.join(', ')}`);
    if (b.scenariosRemoved && b.scenariosRemoved.length > 0) lines.push(`- 제거된 시나리오: ${b.scenariosRemoved.join(', ')}`);
    if (b.newSteps.length > 0) lines.push(`- 신규 단계: ${b.newSteps.join(', ')}`);
    if (b.removedSteps.length > 0) lines.push(`- 제거된 단계: ${b.removedSteps.join(', ')}`);
    if (b.durationSpikes.length > 0) {
      lines.push('- 소요시간 급증(500ms 초과 & 2배 이상):');
      for (const spike of b.durationSpikes) lines.push(`  - ${spike.step}: ${spike.baselineMs}ms → ${spike.currentMs}ms`);
    }
    if (b.newSteps.length === 0 && b.removedSteps.length === 0 && b.durationSpikes.length === 0) {
      lines.push('- 유의미한 차이 없음');
    }
    lines.push('');
  } else if (result.baseline && !result.baseline.compared) {
    lines.push(`## 기준선 비교: 생략(${result.baseline.reason || '비교 불가'})`);
    lines.push('');
  }
  if (result.uncoveredMenus && result.uncoveredMenus.length > 0) {
    lines.push('## 미커버 메뉴 (시나리오 추가 필요 - 확장 훅)');
    lines.push('');
    for (const id of result.uncoveredMenus) lines.push(`- ${id}`);
    lines.push('');
  }
  lines.push('## 단계별 상세');
  for (const step of result.steps || []) {
    lines.push('');
    lines.push(`### [${statusMark(step.status)}] ${step.scenario} / ${step.name}`);
    lines.push(`- 시각: ${step.at || '-'} · 소요: ${step.durationMs !== undefined ? step.durationMs + 'ms' : '-'}`);
    if (step.errorCode) lines.push('- errorCode: [' + step.errorCode + ']');
    if (step.message) lines.push(`- 메시지: ${step.message}`);
    if (step.details) lines.push('- 검증 증거: ' + JSON.stringify(step.details).slice(0, 400));
    for (const http of step.http || []) {
      const body = http.resBody || http.resText || http.error || '';
      lines.push(`- HTTP ${http.method} ${http.path} → ${http.status} (${http.durationMs}ms)${body ? ' · ' + String(body).slice(0, 200) : ''}`);
    }
  }
  lines.push('');
  lines.push('## 실패 시 재현 안내 (코딩 에이전트용)');
  lines.push('');
  lines.push('1. 동일 명령 재실행: `node tools/diagnostic-runner/runner.cjs --scenario <실패 시나리오> --keep-artifacts`');
  lines.push('2. 서버 로그: 이 디렉터리의 `logs/server-stdio.log` — 실패 단계의 `시각` 기준 앞뒤 20줄.');
  lines.push('3. 외부 호출 차단 기록: `logs/external-call-guard.jsonl`.');
  lines.push('4. 임시 DB: `app-data/osoo.db`(또는 `profile/appdata/Osoo_Handle_App/osoo.db`) — readonly로 열어 단계의 검증 증거와 대조.');
  lines.push('5. 수정 후에는 전체 회귀: `node tools/diagnostic-runner/runner.cjs --scenario all --lint`.');
  lines.push('');
  return lines.join('\n');
}

function printSummary(result) {
  const lines = [];
  lines.push('');
  lines.push(`=== 진단 요약: ${result.status.toUpperCase()} (runId ${result.runId}) ===`);
  for (const item of result.scenarios || []) {
    lines.push(`  ${item.id.padEnd(12)} ${item.status.padEnd(7)} pass ${item.passed} / fail ${item.failed}`);
  }
  const external = result.externalCalls || {};
  lines.push(`  외부 호출 — drive ${external.drive ?? 0}, bigquery ${external.bigquery ?? 0}, firebase ${external.firebase ?? 0}, 차단 ${external.blockedRequests ?? 0}`);
  const db = result.database || {};
  lines.push(`  DB — integrity ${db.integrityCheck}, fixture ${db.fixtureIntegrity}`);
  if (result.artifacts && result.artifacts.runDir) {
    lines.push(`  산출물 — ${result.artifacts.runDir}`);
  }
  console.log(lines.join('\n'));
}

module.exports = { buildResult, writeReports, printSummary, renderAgentReportMd };
