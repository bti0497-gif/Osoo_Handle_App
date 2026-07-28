const { spawnSync } = require('node:child_process');

const APPROVED_ADVISORIES = new Map([
  [
    'GHSA-MH99-V99M-4GVG',
    'ExcelJS/Google API 내부의 앱 고정 glob 패턴 경로입니다. 사용자 입력을 glob 패턴으로 전달하지 않으며, 상위 패키지의 호환 패치를 추적합니다.',
  ],
  [
    'GHSA-V3M3-F69X-JF25',
    'Quill 2.0.3의 패치 버전이 아직 없습니다. 게시글 HTML은 저장·표시 양쪽에서 정화하고 CSP를 적용합니다.',
  ],
]);

const BLOCKING_SEVERITIES = new Set(['high', 'critical']);
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error('[SECURITY AUDIT] npm 실행 경로(npm_execpath)를 확인하지 못했습니다.');
  process.exit(1);
}

const audit = spawnSync(
  process.execPath,
  [npmCli, 'audit', '--omit=dev', '--json'],
  { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
);

if (audit.error) {
  console.error(`[SECURITY AUDIT] npm audit 실행 실패: ${audit.error.message}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  console.error('[SECURITY AUDIT] npm audit JSON 결과를 해석하지 못했습니다.');
  if (audit.stderr) console.error(audit.stderr.trim());
  process.exit(1);
}

const vulnerabilities = report.vulnerabilities || {};
if (report.error || !report.metadata?.vulnerabilities) {
  console.error(
    `[SECURITY AUDIT] 완전한 감사 결과를 받지 못했습니다.${report.error?.summary ? ` ${report.error.summary}` : ''}`,
  );
  process.exit(1);
}

const advisoryId = (url = '') => url.match(/GHSA-[\w-]+/i)?.[0]?.toUpperCase();

function collectAdvisories(name, visited = new Set()) {
  if (visited.has(name)) return [];
  visited.add(name);

  const vulnerability = vulnerabilities[name];
  if (!vulnerability) return [];

  return (vulnerability.via || []).flatMap((entry) => {
    if (typeof entry === 'string') return collectAdvisories(entry, visited);
    const id = advisoryId(entry.url);
    return id ? [{ ...entry, id }] : [];
  });
}

const blocked = [];
const approvedFound = new Map();

for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
  if (!BLOCKING_SEVERITIES.has(vulnerability.severity)) continue;

  const highAdvisories = collectAdvisories(name).filter((entry) =>
    BLOCKING_SEVERITIES.has(entry.severity),
  );
  const unapproved = highAdvisories.filter((entry) => !APPROVED_ADVISORIES.has(entry.id));

  if (highAdvisories.length === 0 || unapproved.length > 0) {
    blocked.push({
      name,
      severity: vulnerability.severity,
      advisories: unapproved.length > 0 ? unapproved : highAdvisories,
    });
    continue;
  }

  for (const advisory of highAdvisories) approvedFound.set(advisory.id, advisory);
}

for (const [id, reason] of APPROVED_ADVISORIES) {
  const advisory = Object.values(vulnerabilities)
    .flatMap((_, index) => collectAdvisories(Object.keys(vulnerabilities)[index]))
    .find((entry) => entry.id === id);
  if (!advisory) continue;
  approvedFound.set(id, advisory);
  console.log(`[SECURITY AUDIT][APPROVED] ${id} (${advisory.name}, ${advisory.severity})`);
  console.log(`  사유: ${reason}`);
}

if (blocked.length > 0) {
  console.error('\n[SECURITY AUDIT] 승인되지 않은 high/critical 운영 취약점이 발견되었습니다.');
  for (const item of blocked) {
    const ids = item.advisories.map((entry) => entry.id).filter(Boolean);
    console.error(`- ${item.name} (${item.severity})${ids.length ? `: ${ids.join(', ')}` : ''}`);
  }
  process.exit(1);
}

const totals = report.metadata?.vulnerabilities || {};
console.log(
  `[SECURITY AUDIT] PASS - 신규 high/critical 없음 (전체: high ${totals.high || 0}, critical ${totals.critical || 0})`,
);
