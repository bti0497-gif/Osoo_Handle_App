'use strict';

/**
 * --changed 선택 실행: git 변경 파일을 시나리오로 매핑한다(계획 §Phase 5).
 * 안전 원칙: 매핑에 실패한 코드 파일이 하나라도 있으면 전체 실행으로 돌아간다.
 * 문서/로그류는 매핑 대상에서 제외된다.
 */

const { spawnSync } = require('child_process');

// 경로 패턴 → 시나리오 목록. '__all__' 은 전체 실행을 뜻한다.
const RULES = [
  { test: /(^|\/)tools\/diagnostic-runner\//, scenarios: ['__all__'] },
  { test: /(^|\/)(server\/index\.cjs|server\.cjs|server\/database\.cjs|server\/middleware\/|server\/config\/|server\/routeRegistry\.cjs|package(-lock)?\.json|electron\/|vite\.config\.|eslint\.config\.)/, scenarios: ['__all__'] },
  { test: /src\/components\/|src\/core\/|src\/styles\/|src\/App\.jsx|(^|\/)index\.html/, scenarios: ['__all__'] },

  { test: /src\/features\/medicine\//, scenarios: ['medicine'] },
  { test: /server\/routes\/medicine(In|Register)?Routes\.cjs|server\/services\/[^]*medicine/, scenarios: ['medicine'] },

  { test: /src\/features\/flow\//, scenarios: ['dailylog'] },
  { test: /server\/routes\/flowRoutes\.cjs/, scenarios: ['dailylog'] },
  { test: /src\/features\/dailylog\//, scenarios: ['dailylog'] },
  { test: /server\/routes\/dailyWorkLogRoutes\.cjs|server\/services\/[^]*(hwp|excelPdf|dailyWorkLog)/, scenarios: ['dailylog'] },
  { test: /(^|\/)templates\//, scenarios: ['dailylog'] },

  { test: /src\/features\/water\//, scenarios: ['water-quality'] },
  { test: /server\/routes\/waterQualityRoutes\.cjs/, scenarios: ['water-quality'] },

  { test: /src\/features\/kit\//, scenarios: ['kit'] },
  { test: /server\/routes\/kitRoutes\.cjs/, scenarios: ['kit'] },

  { test: /src\/features\/operation\//, scenarios: ['operation-status'] },
  { test: /server\/routes\/operationStatusRoutes\.cjs/, scenarios: ['operation-status'] },

  { test: /src\/features\/(facility|equipment)\//, scenarios: ['facility', 'menus-light'] },
  { test: /server\/routes\/facilityRoutes\.cjs/, scenarios: ['facility', 'menus-light'] },

  { test: /src\/features\/board\//, scenarios: ['board'] },
  { test: /server\/routes\/boardRoutes\.cjs|server\/services\/[^]*board/, scenarios: ['board'] },

  { test: /src\/features\/(settings|members|attendance|auth)\//, scenarios: ['auth', 'menus-light'] },
  { test: /server\/routes\/(settings|auth)Routes\.cjs/, scenarios: ['auth', 'menus-light'] },

  { test: /src\/features\/(certificate|dashboard|sludge|monthly-report|records|diagnostics|roadwork-helper)\//, scenarios: ['menus-light'] },
  { test: /server\/routes\/(certificate|sludgePhoto|monthlyOperationReport|roadworkHelper|upload|location)Routes\.cjs/, scenarios: ['menus-light'] },

  // 문서·로그·에디터 부산물은 검증 대상이 아니다.
  { test: /(^|\/)docs\/|\.(md|pen|log|png|db)$/, scenarios: [] },
  // 진단 임시산출물/에이전트 스크래치 디렉터는 변경 대상에서 제외한다(--changed 오탐 방지).
  { test: /(^|\/)tmp\/|^\.tmp-/, scenarios: [] },
];

/** 변경 파일 목록. ref를 주면 그 커밋과의 diff, 없으면 작업사본(HEAD+추적안됨). */
function listChangedFiles(cwd, ref) {
  const run = (spec) => {
    const result = spawnSync('git', spec, { cwd, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) return [];
    return String(result.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  };
  const files = new Set(run(['diff', '--name-only', ...(ref ? [ref] : [])]));
  if (!ref) {
    for (const file of run(['ls-files', '--others', '--exclude-standard'])) files.add(file);
  }
  return [...files];
}

/**
 * 파일 → 시나리오 매핑.
 * 반환: { all, scenarios, unmapped } — scenarios에는 기본 증명용 'health'가 항상 포함된다.
 */
function mapFilesToScenarios(files) {
  const selected = new Set(['health']);
  const unmapped = [];
  let all = false;
  for (const file of files) {
    const normalized = file.split('\\').join('/');
    const rule = RULES.find((entry) => entry.test.test(normalized));
    if (!rule) { unmapped.push(normalized); continue; }
    if (rule.scenarios.includes('__all__')) { all = true; continue; }
    for (const scenario of rule.scenarios) selected.add(scenario);
  }
  const codeLikeUnmapped = unmapped.filter((file) => /\.(cjs|js|jsx|json|html|css|nsh)$/.test(file));
  if (codeLikeUnmapped.length > 0) all = true;
  return { all, scenarios: [...selected], unmapped };
}

module.exports = { listChangedFiles, mapFilesToScenarios };
