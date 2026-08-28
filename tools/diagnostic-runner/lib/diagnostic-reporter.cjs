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

module.exports = { buildResult, writeReports, printSummary };
