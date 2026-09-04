#!/usr/bin/env node
'use strict';

/**
 * 현장 진단 로그 분석기 — 앱이 남긴 진단 로그(JSONL)를 구조화된 인계 리포트로 바꾼다.
 *
 * 사용법:
 *   node tools/diagnostic-runner/analyzer.cjs <진단로그 디렉터리 또는 파일>
 *   node tools/diagnostic-runner/analyzer.cjs .tmp-diagnostics-current
 *
 * 기능:
 * - 에러 패턴 그룹화(area|action|result): 발생 수, 영향 현장/PC, 최초/최종 발생, 샘플 상세
 * - 슬로우 API 랭킹(durationMs 기준), 이벤트루프 지연·메모리 압박 요약
 * - 현장별 요약표
 * - 규칙 기반 "수정 방향" 힌트 자동 생성(403/404/401/블로킹 짝패임 등)
 * - 직전 분석과 비교: 새로 생긴 에러 / 해결된 에러(릴리즈 안정화 추적용)
 *
 * 산출물: tmp/diagnostics/analysis-<시각>/analysis-report.md + result.json
 *         tmp/diagnostics/analysis-baseline.json (다음 분석의 비교 기준)
 */

const fs = require('fs');
const path = require('path');

const OUT_BASE = path.join(__dirname, '..', '..', 'tmp', 'diagnostics');
const BASELINE_PATH = path.join(OUT_BASE, 'analysis-baseline.json');

// ---------- 수집 ----------

function collectJsonlFiles(inputPath) {
  const stat = fs.statSync(inputPath);
  if (stat.isFile()) return [inputPath];
  return fs.readdirSync(inputPath)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => path.join(inputPath, name));
}

function siteFromFilename(filename) {
  const match = filename.match(/_\((.+)\)_diagnostics|_(.+)_diagnostics/);
  return match ? (match[1] || match[2] || '').slice(0, 40) : '';
}

function parseRecords(files) {
  const records = [];
  for (const file of files) {
    const base = path.basename(file);
    const fileSite = siteFromFilename(base);
    const content = fs.readFileSync(file, 'utf8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        records.push({
          ...rec,
          _file: base,
          _site: rec.site_name || fileSite || '알수없음',
          _machine: rec.machine || '',
          _version: rec.app_version || '',
          _at: rec.created_at || '',
        });
      } catch (_) { /* 부분 라인 무시 */ }
    }
  }
  return records;
}

// ---------- 분석 ----------

function patternKey(rec) {
  return `${rec.area || '?'}|${rec.action || '?'}|${rec.result || ''}`;
}

function buildAnalysis(records) {
  const sites = new Map();
  const errorPatterns = new Map();
  const warnPatterns = new Map();
  const slowRequests = [];
  const eventLoopLags = [];
  const memoryPressure = [];

  for (const rec of records) {
    const site = sites.get(rec._site) || { records: 0, errors: 0, warns: 0, machines: new Set(), versions: new Set() };
    site.records += 1;
    if (rec.level === 'error') site.errors += 1;
    if (rec.level === 'warn') site.warns += 1;
    site.machines.add(rec._machine);
    site.versions.add(rec._version);
    sites.set(rec._site, site);

    if (rec.level === 'error') {
      const key = patternKey(rec);
      const p = errorPatterns.get(key) || {
        key, count: 0, sites: new Set(), firstAt: rec._at, lastAt: rec._at,
        message: String(rec.message || '').slice(0, 120), sample: null,
      };
      p.count += 1;
      p.sites.add(rec._site);
      if (rec._at < p.firstAt) p.firstAt = rec._at;
      if (rec._at > p.lastAt) p.lastAt = rec._at;
      if (!p.sample && rec.details) p.sample = JSON.stringify(rec.details).slice(0, 240);
      errorPatterns.set(key, p);
    }
    if (rec.level === 'warn') {
      const key = `${rec.area || '?'}|${rec.action || '?'}`;
      warnPatterns.set(key, (warnPatterns.get(key) || 0) + 1);
    }
    if (rec.action === 'slow-api-request' && rec.details && rec.details.durationMs) {
      slowRequests.push({ path: rec.details.path || rec.action, durationMs: rec.details.durationMs, site: rec._site, level: rec.level });
    }
    if (rec.action === 'event-loop-lag' && rec.details && rec.details.lagMs) {
      eventLoopLags.push({ lagMs: rec.details.lagMs, site: rec._site, at: rec._at });
    }
    if (rec.action === 'memory-pressure' || (rec.details && rec.details.memory && rec.details.memory.rss > 400 * 1024 * 1024)) {
      memoryPressure.push({ site: rec._site, at: rec._at, rss: rec.details && rec.details.memory ? Math.round(rec.details.memory.rss / 1048576) : null });
    }
  }

  // 슬로우 API 경로별 집계(평균/최대/건수)
  const slowByPath = new Map();
  for (const s of slowRequests) {
    const p = slowByPath.get(s.path) || { path: s.path, count: 0, total: 0, max: 0, sites: new Set() };
    p.count += 1;
    p.total += s.durationMs;
    p.max = Math.max(p.max, s.durationMs);
    p.sites.add(s.site);
    slowByPath.set(s.path, p);
  }

  const versions = new Set();
  const machines = new Set();
  let firstAt = '';
  let lastAt = '';
  for (const rec of records) {
    if (rec._version) versions.add(rec._version);
    if (rec._machine) machines.add(rec._machine);
    if (!firstAt || rec._at < firstAt) firstAt = rec._at;
    if (!lastAt || rec._at > lastAt) lastAt = rec._at;
  }

  return {
    summary: {
      totalRecords: records.length,
      siteCount: sites.size,
      machineCount: machines.size,
      versions: [...versions],
      firstAt,
      lastAt,
    },
    sites: [...sites.entries()].map(([name, s]) => ({
      site: name, records: s.records, errors: s.errors, warns: s.warns,
      machines: [...s.machines].filter(Boolean), versions: [...s.versions].filter(Boolean),
    })).sort((a, b) => b.errors - a.errors || b.records - a.records),
    errorPatterns: [...errorPatterns.values()].map((p) => ({
      ...p, sites: [...p.sites],
    })).sort((a, b) => b.count - a.count),
    warnPatterns: [...warnPatterns.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
    slowApis: [...slowByPath.values()].map((p) => ({
      path: p.path, count: p.count, avgMs: Math.round(p.total / p.count), maxMs: p.max, sites: [...p.sites],
    })).sort((a, b) => b.maxMs - a.maxMs),
    eventLoopLags: eventLoopLags.sort((a, b) => b.lagMs - a.lagMs).slice(0, 5),
    memoryPressureCount: memoryPressure.length,
  };
}

// ---------- 규칙 기반 수정 방향 ----------

function buildFixHints(analysis) {
  const hints = [];
  const hasPattern = (predicate) => analysis.errorPatterns.find(predicate);

  const forbidden = hasPattern((p) => /->\s*403$/.test(p.message) || p.key.includes('|failed') && p.message.includes('403'));
  if (forbidden) {
    hints.push({
      priority: '높음',
      target: forbidden.key.split('|')[1] || 'API',
      hint: `${forbidden.count}건의 403 거부가 ${forbidden.sites.length}개 현장에서 발생. 사이트 컨텍스트가 정상 일치하는데도 거부되므로 라우트 권한 요구사항과 호출자(렌더러 스케줄러) 역할 계약 확인 필요.`,
    });
  }
  const notFound = hasPattern((p) => p.message.includes('-> 404'));
  if (notFound) {
    hints.push({
      priority: '높음',
      target: notFound.key.split('|')[1] || 'API',
      hint: `404 — 호출하는 라우트가 서버에 없음. 진행 중 기능이면 커밋 전 라우트 등록 누락 여부 확인.`,
    });
  }
  const slowest = analysis.slowApis[0];
  const lagged = analysis.eventLoopLags[0];
  if (slowest && slowest.maxMs > 3000) {
    const blockingNote = lagged && lagged.lagMs > 3000 ? ` 같은 시간대 event-loop 지연(${lagged.lagMs}ms)이 함께 기록됨 — 해당 핸들러의 동기 블로킹이 서버 전체를 멈추고 있을 가능성 높음.` : '';
    hints.push({
      priority: lagged && lagged.lagMs > 3000 ? '높음' : '중간',
      target: slowest.path,
      hint: `최대 ${slowest.maxMs}ms(평균 ${slowest.avgMs}ms, ${slowest.sites.length}개 현장).${blockingNote} 핸들러의 동기 I/O·외부 호출·대량 쿼리 비동기화 검토.`,
    });
  }
  const login401 = hasPattern((p) => p.key.includes('local-login') && p.message.includes('401'));
  if (login401 && login401.count <= 3) {
    hints.push({
      priority: '낮음',
      target: 'local-login',
      hint: `${login401.count}건의 401 — 잘못된 자격 시도로 보임(정상 거부). 반복 급증 시 계정/비밀번호 정책 확인.`,
    });
  }
  if (analysis.memoryPressureCount > 10) {
    hints.push({
      priority: '낮음',
      target: '메모리',
      hint: `memory-pressure 경고 ${analysis.memoryPressureCount}건 — 장기 실행 시 RSS 추이 모니터링 지속.`,
    });
  }
  return hints;
}

// ---------- 기준선 diff ----------

function loadBaseline() {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  } catch (_) {
    return null;
  }
}

function diffPatterns(currentKeys, baselineKeys) {
  const current = new Set(currentKeys);
  const baseline = new Set(baselineKeys);
  return {
    newPatterns: [...current].filter((k) => !baseline.has(k)),
    resolvedPatterns: [...baseline].filter((k) => !current.has(k)),
  };
}

// ---------- 렌더링 ----------

function renderReport(analysis, hints, diff) {
  const lines = [];
  const s = analysis.summary;
  lines.push('# 현장 진단 로그 분석 리포트');
  lines.push('');
  lines.push(`- 기간: ${s.firstAt || '?'} ~ ${s.lastAt || '?'} · 레코드 ${s.totalRecords}건`);
  lines.push(`- 현장 ${s.siteCount}개 · PC ${s.machineCount}대 · 버전: ${s.versions.join(', ') || '?'}`);
  lines.push(`- 에러 패턴 ${analysis.errorPatterns.length}종 · 슬로우 API ${analysis.slowApis.length}건종 · memory-pressure ${analysis.memoryPressureCount}건`);
  lines.push('');
  if (diff) {
    lines.push('## 이전 분석 대비 변화');
    lines.push('');
    if (diff.newPatterns.length > 0) {
      lines.push(`- **신규 에러 패턴 ${diff.newPatterns.length}종**: ${diff.newPatterns.slice(0, 5).join(' / ')}`);
    }
    if (diff.resolvedPatterns.length > 0) {
      lines.push(`- **해결(소멸) 패턴 ${diff.resolvedPatterns.length}종**: ${diff.resolvedPatterns.slice(0, 5).join(' / ')}`);
    }
    if (diff.newPatterns.length === 0 && diff.resolvedPatterns.length === 0) {
      lines.push('- 에러 패턴 변화 없음');
    }
    lines.push('');
  }
  if (hints.length > 0) {
    lines.push('## 수정 방향 (규칙 기반 자동 판정)');
    lines.push('');
    for (const h of hints) {
      lines.push(`- **[${h.priority}] ${h.target}** — ${h.hint}`);
    }
    lines.push('');
  }
  lines.push('## 에러 패턴 (발생 수 순)');
  lines.push('');
  lines.push('| 수 | 패턴 | 현장수 | 최초 | 최종 | 메시지 |');
  lines.push('|---|---|---|---|---|---|');
  for (const p of analysis.errorPatterns.slice(0, 15)) {
    lines.push(`| ${p.count} | ${p.key.split('|').slice(0, 2).join(' / ')} (${p.key.split('|')[2] || ''}) | ${p.sites.length} | ${(p.firstAt || '').slice(5, 16)} | ${(p.lastAt || '').slice(5, 16)} | ${p.message.slice(0, 60)} |`);
  }
  lines.push('');
  if (analysis.slowApis.length > 0) {
    lines.push('## 슬로우 API');
    lines.push('');
    lines.push('| 경로 | 건수 | 평균ms | 최대ms | 현장수 |');
    lines.push('|---|---|---|---|---|');
    for (const p of analysis.slowApis.slice(0, 10)) {
      lines.push(`| ${p.path} | ${p.count} | ${p.avgMs} | ${p.maxMs} | ${p.sites.length} |`);
    }
    lines.push('');
  }
  if (analysis.eventLoopLags.length > 0) {
    lines.push('## 이벤트루프 지연 (상위)');
    lines.push('');
    for (const l of analysis.eventLoopLags) lines.push(`- ${l.lagMs}ms @ ${l.site} (${(l.at || '').slice(5, 16)})`);
    lines.push('');
  }
  lines.push('## 현장별 요약');
  lines.push('');
  lines.push('| 현장 | 레코드 | 에러 | 경고 | 버전 |');
  lines.push('|---|---|---|---|---|');
  for (const site of analysis.sites) {
    lines.push(`| ${site.site} | ${site.records} | ${site.errors} | ${site.warns} | ${site.versions.join(',')} |`);
  }
  lines.push('');
  lines.push('## 경고 패턴 (상위 10)');
  lines.push('');
  for (const w of analysis.warnPatterns.slice(0, 10)) lines.push(`- ${w.count}건 · ${w.key}`);
  lines.push('');
  return lines.join('\n');
}

// ---------- 실행 ----------

function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('사용법: node tools/diagnostic-runner/analyzer.cjs <진단로그 디렉터리 또는 파일>');
    process.exit(2);
  }
  const inputPath = path.resolve(input);
  if (!fs.existsSync(inputPath)) {
    console.error(`입력 경로가 없습니다: ${inputPath}`);
    process.exit(2);
  }
  const files = collectJsonlFiles(inputPath);
  if (files.length === 0) {
    console.error('JSONL 파일을 찾지 못했습니다.');
    process.exit(2);
  }

  const records = parseRecords(files);
  const analysis = buildAnalysis(records);
  const hints = buildFixHints(analysis);
  const baseline = loadBaseline();
  const diff = baseline
    ? diffPatterns(analysis.errorPatterns.map((p) => p.key), baseline.errorPatterns)
    : null;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(OUT_BASE, `analysis-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });
  const report = renderReport(analysis, hints, diff);
  fs.writeFileSync(path.join(outDir, 'analysis-report.md'), report, 'utf8');
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ analyzedAt: new Date().toISOString(), input: inputPath, analysis, hints, diff }, null, 2), 'utf8');
  fs.writeFileSync(BASELINE_PATH, JSON.stringify({ analyzedAt: new Date().toISOString(), errorPatterns: analysis.errorPatterns.map((p) => ({ key: p.key, count: p.count })) }, null, 2), 'utf8');

  console.log(report);
  console.log(`\n리포트: ${path.join(outDir, 'analysis-report.md')}`);
}

main();
