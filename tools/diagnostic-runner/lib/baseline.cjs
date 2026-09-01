'use strict';

/**
 * 기준선 비교: 직전 '성공' 실행의 result.json과 이번 실행을 비교한다(회귀 판정 보조).
 * - 공통 시나리오만 비교한다(--changed 로 부분 집합 실행 시 제거 오탐 방지).
 * - 새로 생긴/사라진 단계, 소요시간 급증(기준치 초과)을 보고한다.
 * - 판정은 경고 수준이다(실행 실패로 바꾸지 않는다). 성능 회귀는 사람/에이전트 판단 대상.
 */

const fs = require('fs');
const path = require('path');

const SPIKE_MIN_MS = 500;
const SPIKE_RATIO = 2.0;

/** 가장 최근의 성공 실행 결과를 찾는다(현재 실행 제외). */
function findBaselineRun(diagnosticsBase, excludeRunId) {
  let dirs = [];
  try {
    dirs = fs.readdirSync(diagnosticsBase).filter((dir) => /^run-/.test(dir)).sort().reverse();
  } catch (_) {
    return null;
  }
  for (const dir of dirs) {
    const resultPath = path.join(diagnosticsBase, dir, 'result.json');
    try {
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      if (result.runId !== excludeRunId && result.status === 'passed' && Array.isArray(result.steps)) {
        return result;
      }
    } catch (_) { /* 손상된/부분 result.json 무시 */ }
  }
  return null;
}

function stepKey(step) {
  return `${step.scenario}/${step.name}`;
}

function diffAgainstBaseline(current, baseline) {
  if (!baseline) return { compared: false, reason: '기준선(직전 성공 실행) 없음' };
  const currentScenarios = new Set((current.scenarios || []).map((item) => item.id));
  const baselineScenarios = new Set((baseline.scenarios || []).map((item) => item.id));
  const shared = [...currentScenarios].filter((id) => baselineScenarios.has(id));
  if (shared.length === 0) {
    return { compared: false, reason: '공통 시나리오 없음', baselineRunId: baseline.runId };
  }
  const baselineSteps = new Map(
    baseline.steps.filter((step) => shared.includes(step.scenario)).map((step) => [stepKey(step), step]),
  );
  const currentSteps = new Map(
    current.steps.filter((step) => shared.includes(step.scenario)).map((step) => [stepKey(step), step]),
  );
  const newSteps = [...currentSteps.keys()].filter((key) => !baselineSteps.has(key));
  const removedSteps = [...baselineSteps.keys()].filter((key) => !currentSteps.has(key));
  const durationSpikes = [];
  for (const [key, step] of currentSteps) {
    const base = baselineSteps.get(key);
    if (!base || step.durationMs === undefined || base.durationMs === undefined) continue;
    if (step.durationMs > SPIKE_MIN_MS && step.durationMs >= base.durationMs * SPIKE_RATIO) {
      durationSpikes.push({ step: key, baselineMs: base.durationMs, currentMs: step.durationMs });
    }
  }
  const scenariosAdded = [...currentScenarios].filter((id) => !baselineScenarios.has(id));
  const scenariosRemoved = [...baselineScenarios].filter((id) => !currentScenarios.has(id));
  return {
    compared: true,
    baselineRunId: baseline.runId,
    sharedScenarios: shared.length,
    scenariosAdded,
    scenariosRemoved,
    newSteps,
    removedSteps,
    durationSpikes,
  };
}

module.exports = { findBaselineRun, diffAgainstBaseline };
