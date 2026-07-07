#!/usr/bin/env node
/**
 * scripts/validate-release.cjs
 * 
 * 배포 전 검증:
 * 1. 필수 코드 파일 및 자격증명 패키징 제외 여부
 * 2. 라우트 레지스트리 유효성
 * 3. API 스펙 vs 실제 라우트 매칭
 * 4. 모듈 로드 가능 여부
 * 
 * 사용: node scripts/validate-release.cjs [options]
 *   --asar-path: asar 경로 검증 (패키징 후)
 *   --api-test: 개발 서버로 API 테스트 (npm run dev 필수)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE_DIR = path.join(__dirname, '..');
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

let passedChecks = 0;
let failedChecks = 0;
let warnings = 0;

function log(color, prefix, msg) {
  console.log(`${color}[${prefix}]${colors.reset} ${msg}`);
}

function success(msg) { log(colors.green, '✓ PASS', msg); passedChecks++; }
function error(msg) { log(colors.red, '✗ FAIL', msg); failedChecks++; }
function warn(msg) { log(colors.yellow, '⚠ WARN', msg); warnings++; }
function info(msg) { log(colors.cyan, 'ℹ INFO', msg); }

function checkFileExists(filePath, description) {
  if (fs.existsSync(filePath)) {
    success(`${description} 포함됨: ${path.relative(BASE_DIR, filePath)}`);
    return true;
  } else {
    error(`${description} 누락: ${path.relative(BASE_DIR, filePath)}`);
    return false;
  }
}

function validateRequiredFiles() {
  console.log(`\n${colors.blue}▶ 필수 파일 검증${colors.reset}`);
  
  checkFileExists(path.join(BASE_DIR, 'package.json'), 'package.json');
  checkFileExists(path.join(BASE_DIR, 'electron-builder.config.js'), 'electron-builder.config.js');
  checkFileExists(path.join(BASE_DIR, 'server', 'config', 'runtimeConfig.cjs'), '런타임 설정 로더');
  checkFileExists(path.join(BASE_DIR, 'scripts', 'provision-runtime-config.cjs'), '런타임 설정 프로비저닝 도구');

  const configText = fs.readFileSync(path.join(BASE_DIR, 'electron-builder.config.js'), 'utf8');
  if (configText.includes("'.env.local'")) {
    error('electron-builder에 .env.local 포함 규칙이 남아 있습니다');
  } else {
    success('electron-builder에서 .env.local 제외됨');
  }
  const requiredExclusions = [
    '!server/config/google-key.json',
    '!server/config/work-jindan-*.json',
    '!server/config/firebase-service-account.json',
  ];
  for (const exclusion of requiredExclusions) {
    if (configText.includes(exclusion)) success(`자격증명 제외 규칙 확인: ${exclusion}`);
    else error(`자격증명 제외 규칙 누락: ${exclusion}`);
  }
}

function validateRuntimeConfigPackagingContract() {
  console.log(`\n${colors.blue}▶ 런타임 설정 패키징 계약 검증${colors.reset}`);

  const runtimeConfigPath = path.join(BASE_DIR, 'server', 'config', 'runtimeConfig.cjs');
  const runtimeConfigText = fs.readFileSync(runtimeConfigPath, 'utf8');
  if (runtimeConfigText.includes("'Osoo_Handle_App'") || runtimeConfigText.includes('"Osoo_Handle_App"')) {
    success('앱 기본 런타임 설정 경로 확인: %APPDATA%\\Osoo_Handle_App\\config');
  } else {
    error('앱 기본 런타임 설정 경로가 Osoo_Handle_App\\config를 가리키지 않습니다');
  }
  if (runtimeConfigText.includes('LEGACY_RUNTIME_CONFIG_DIR') && runtimeConfigText.includes("'wastewater-treatment-plant'")) {
    success('레거시 런타임 설정 경로 fallback 확인: %APPDATA%\\wastewater-treatment-plant\\config');
  } else {
    error('레거시 런타임 설정 fallback 누락: 기존 현장 설정을 읽을 수 없습니다');
  }

  const pathChecks = [
    ['scripts/provision-runtime-config.cjs', ['Osoo_Handle_App', 'wastewater-treatment-plant']],
    ['scripts/provision-runtime-config.ps1', ['Osoo_Handle_App', 'wastewater-treatment-plant']],
    ['scripts/install-with-provisioning.ps1', ['Osoo_Handle_App']],
    ['scripts/build-integrated-installer.ps1', ['Osoo_Handle_App', 'wastewater-treatment-plant']],
  ];
  for (const [relativePath, tokens] of pathChecks) {
    const filePath = path.join(BASE_DIR, relativePath);
    if (!fs.existsSync(filePath)) {
      error(`런타임 설정 스크립트 누락: ${relativePath}`);
      continue;
    }
    const text = fs.readFileSync(filePath, 'utf8');
    for (const token of tokens) {
      if (text.includes(token)) success(`${relativePath} 경로 토큰 확인: ${token}`);
      else error(`${relativePath} 경로 토큰 누락: ${token}`);
    }
  }

  const installScriptText = fs.readFileSync(path.join(BASE_DIR, 'scripts', 'build-integrated-installer.ps1'), 'utf8');
  const requiredCredentialNames = [
    '.env.local',
    'google-key.json',
    'bigquery-service-account.json',
    'firebase-service-account.json',
  ];
  for (const name of requiredCredentialNames) {
    if (installScriptText.includes(name)) success(`통합 설치파일 자격증명 항목 확인: ${name}`);
    else error(`통합 설치파일 자격증명 항목 누락: ${name}`);
  }
}

function validateRouteRegistry() {
  console.log(`\n${colors.blue}▶ 라우트 레지스트리 검증${colors.reset}`);
  
  try {
    const routeRegistry = require(path.join(BASE_DIR, 'server', 'routeRegistry.cjs'));
    
    if (!Array.isArray(routeRegistry)) {
      error('routeRegistry는 배열이어야 합니다');
      return;
    }
    
    success(`라우트 레지스트리 로드 성공 (${routeRegistry.length}개 라우트)`);
    
    // 라우트별 검증
    routeRegistry.forEach((route, idx) => {
      if (route.tier === undefined || route.tier === null || route.tier < 0 || route.tier > 2) {
        error(`[${idx}] tier 값 invalid: ${route.tier}`);
        return;
      }
      if (!route.path) {
        error(`[${idx}] path 누락`);
        return;
      }
      if (!route.module) {
        error(`[${idx}] module 누락`);
        return;
      }
      
      const modulePath = path.join(BASE_DIR, 'server', route.module);
      if (!fs.existsSync(modulePath)) {
        error(`[${idx}] 모듈 파일 없음: ${route.module}`);
        return;
      }
      
      // 모듈 로드 테스트 (Tier 0만 - 나머지는 lazy load)
      if (route.tier === 0) {
        try {
          const mod = require(modulePath);
          if (typeof mod !== 'function') {
            error(`[${idx}] 모듈 exports는 함수여야 합니다: ${route.module}`);
            return;
          }
          success(`[Tier${route.tier}] ${route.path} → ${route.module}`);
        } catch (e) {
          error(`[${idx}] 모듈 로드 실패 ${route.module}: ${e.message}`);
        }
      } else {
        success(`[Tier${route.tier}] ${route.path} → ${route.module}`);
      }
    });
    
  } catch (e) {
    error(`routeRegistry 로드 실패: ${e.message}`);
  }
}

function validateApiSpec() {
  console.log(`\n${colors.blue}▶ API 스펙 검증${colors.reset}`);
  
  try {
    const { getAllEndpoints } = require(path.join(BASE_DIR, 'server', 'api-spec.cjs'));
    const endpoints = getAllEndpoints();
    
    success(`API 스펙 로드 성공 (${endpoints.length}개 엔드포인트)`);
    
    // 엔드포인트별 검증
    const pathCounts = {};
    endpoints.forEach(ep => {
      const key = `${ep.method} ${ep.fullPath}`;
      pathCounts[key] = (pathCounts[key] || 0) + 1;
      
      if (pathCounts[key] > 1) {
        warn(`중복된 엔드포인트: ${key}`);
      }
    });
    
    // 필수 엔드포인트 확인
    const requiredPaths = [
      'GET /api/ping',
      'GET /api/settings',
      'GET /api/settings/sites',
      'POST /api/auth/login',
    ];
    
    requiredPaths.forEach(required => {
      if (endpoints.some(ep => `${ep.method} ${ep.fullPath}` === required)) {
        success(`필수 엔드포인트 정의됨: ${required}`);
      } else {
        error(`필수 엔드포인트 누락: ${required}`);
      }
    });
    
  } catch (e) {
    error(`API 스펙 로드 실패: ${e.message}`);
  }
}

function validateAsarPackage(asarPath) {
  if (!asarPath) return;
  
  console.log(`\n${colors.blue}▶ ASAR 패키지 검증${colors.reset}`);
  
  const unpackPath = asarPath.replace('.asar', '.asar.unpacked');
  
  // asar 파일 존재 확인
  if (fs.existsSync(asarPath)) {
    success(`asar 파일 존재: ${path.basename(asarPath)}`);
  } else {
    error(`asar 파일 없음: ${asarPath}`);
    return;
  }
  
  // unpacked 경로 확인
  if (fs.existsSync(unpackPath)) {
    success(`asar.unpacked 디렉토리 존재`);
    
    // 필수 파일 확인
    const requiredFiles = [
      'server/routeRegistry.cjs',
      'server/api-spec.cjs',
      'server/routes/authRoutes.cjs',
      'server/routes/settingsRoutes.cjs',
      'server/config/runtimeConfig.cjs',
    ];
    
    requiredFiles.forEach(file => {
      const fullPath = path.join(unpackPath, file);
      checkFileExists(fullPath, `unpacked: ${file}`);
    });

    const forbiddenFiles = [
      '.env.local',
      'server/config/google-key.json',
      'server/config/firebase-service-account.json',
    ];
    forbiddenFiles.forEach((file) => {
      const fullPath = path.join(unpackPath, file);
      if (fs.existsSync(fullPath)) error(`패키지에 자격증명 포함됨: ${file}`);
      else success(`패키지 자격증명 미포함: ${file}`);
    });

    const unpackedConfigDir = path.join(unpackPath, 'server', 'config');
    const leakedBigQueryKeys = fs.existsSync(unpackedConfigDir)
      ? fs.readdirSync(unpackedConfigDir).filter((name) => /^work-jindan-.*\.json$/i.test(name))
      : [];
    if (leakedBigQueryKeys.length) error(`패키지에 BigQuery 키 포함됨: ${leakedBigQueryKeys.join(', ')}`);
    else success('패키지 BigQuery 키 미포함');
  } else {
    warn(`asar.unpacked 디렉토리 없음: ${unpackPath}`);
  }
}

async function testApiEndpoints(devServerUrl) {
  console.log(`\n${colors.blue}▶ API 엔드포인트 테스트${colors.reset}`);
  info(`대상 서버: ${devServerUrl}`);
  
  try {
    const { getAllEndpoints } = require(path.join(BASE_DIR, 'server', 'api-spec.cjs'));
    const endpoints = getAllEndpoints();
    
    // GET 요청만 테스트 (POST는 부작용 가능)
    const testableEndpoints = endpoints.filter(ep => ep.method === 'GET').slice(0, 10);
    
    let tested = 0;
    for (const ep of testableEndpoints) {
      try {
        const response = await fetch(`${devServerUrl}${ep.fullPath}`, {
          method: ep.method,
          timeout: 3000,
        });
        
        if (response.ok || response.status === 401 || response.status === 404) {
          success(`${ep.method} ${ep.fullPath} → ${response.status}`);
          tested++;
        } else if (response.status === 500) {
          error(`${ep.method} ${ep.fullPath} → 500 Server Error`);
        } else {
          warn(`${ep.method} ${ep.fullPath} → ${response.status}`);
        }
      } catch (e) {
        if (e.message.includes('fetch failed') || e.code === 'ECONNREFUSED') {
          warn(`${ep.method} ${ep.fullPath} → ${e.message} (테스트 서버 연결 실패, 실행 중인지 확인하세요)`);
        } else {
          error(`${ep.method} ${ep.fullPath} → ${e.message}`);
        }
      }
    }
    
    info(`테스트 완료: ${tested}/${testableEndpoints.length}`);
    
  } catch (e) {
    error(`API 테스트 실패: ${e.message}`);
  }
}

function validateEnvVariables() {
  console.log(`\n${colors.blue}▶ 환경 변수 검증${colors.reset}`);
  
  try {
    require(path.join(BASE_DIR, 'server', 'config', 'runtimeConfig.cjs')).loadRuntimeEnv();
    
    const requiredVars = [
      'GOOGLE_MEMBERS_SHEET_ID',
    ];
    
    requiredVars.forEach(varName => {
      if (process.env[varName]) {
        success(`환경 변수 설정됨: ${varName}`);
      } else {
        warn(`환경 변수 누락: ${varName} (필수 기능 비활성화됨)`);
      }
    });

    if (process.env.OSOO_SERVER_TOKEN) {
      success('선택 환경 변수 설정됨: OSOO_SERVER_TOKEN');
    } else {
      info('OSOO_SERVER_TOKEN 미설정: 현재 서버는 localhost 바인딩으로 동작합니다');
    }
    
  } catch (e) {
    error(`환경 변수 로드 실패: ${e.message}`);
  }
}

function validateEncodingAndKorean() {
  console.log(`\n${colors.blue}▶ 소스코드 한글 깨짐(Mojibake) 검증${colors.reset}`);
  
  const srcDir = path.join(BASE_DIR, 'src');
  const serverDir = path.join(BASE_DIR, 'server');
  
  let totalGarbledFiles = 0;
  const garbledDictKeys = [
    '?쏀뭹', '?대쫫', '濡쒖뺄', '濡쒓렇', '?대렐', '?딆뒿', '?깆쟻', '?낅줈', '?좎쭨', '?쒖옉', 
    '?뺤떇', '?ъ슜', '?ㅼ젙', '?숆린', '?꾩옣', '?놁쓬', '?섏젙', '??젣', '?볤?', '?묒꽦',
    '?대씪', '?덉슜', '異쒓결', '?뺤긽', '?꾩슂', '?뚯씪', '?щ컮', '?뺤텞', '?댁꽍', '異춈',
    '寃곌낵', '?묒떇', '?대낫', '?댁뿀', '醫낅즺', '愿€由ъ옄'
  ];

  const garbledPattern = /[^\x00-\x7F가-힣ㄱ-ㅎㅏ-ㅣ\s]/;

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    files.forEach(file => {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (file === 'node_modules' || file === '.git' || file === 'dist' || file === 'build' || file === 'release') return;
        scanDir(fullPath);
      } else if (stat.isFile() && /\.(js|jsx|cjs)$/.test(file)) {
        checkFileGarbled(fullPath);
      }
    });
  }

  function checkFileGarbled(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    let fileGarbled = false;
    let fileReported = false;

    lines.forEach((line, idx) => {
      let isGarbled = garbledDictKeys.some(key => line.includes(key));
      
      if (!isGarbled && garbledPattern.test(line)) {
        // 허용하는 유니코드 특수문자들(화살표, 대쉬, 이모지, 한자 등)을 제거한 후 깨짐 판단 진행 (오진 방지)
        const cleanLine = line
          .replace(/[가-힣]\?/g, '')
          .replace(/[\u4e00-\u9fa5]/g, '') // 한자(Hanja) 허용
          .replace(/[\u0370-\u03FF]/g, '') // 그리스 문자(φ, Δ, λ 등) 허용
          .replace(/[₀₁₂₃₄₅₆₇₈₉⁰¹²³⁴⁵⁶⁷⁸⁹⁻₋－]/g, '') // 화학식/숫자 정규화용 위·아래첨자 허용
          .replace(/[\uD83C\uDFED\u23F8]/g, '') // 🏭, ⏸ 이모지 허용
          .replace(/[─—→←↔–—⚠️✅❌⚠✓✗ℹ🔍▶║═⭐●│┌┐└┘├┤┬┴┼※≈·³✚▲▼📷➕📸🛠⚙⚙️🔧⚡💡📊📈📉📝📂📁📎🔗🗑📅⏰🕰⏱🧭📍🗺💾📥📤📡🔊🔔🏷📌🔎“”「」…↳💬×✕✖‹›]/g, ''); // 특수 문자 및 이모지 허용
        if (garbledPattern.test(cleanLine)) {
          isGarbled = true;
        }
      }

      if (isGarbled) {
        if (!fileReported) {
          error(`한글 깨짐 감지: ${path.relative(BASE_DIR, filePath)}`);
          fileReported = true;
          fileGarbled = true;
          totalGarbledFiles++;
        }
        console.log(`   └─ [Line ${idx + 1}] 깨진 텍스트 의심: "${line.trim().slice(0, 80)}"`);
      }
    });
  }

  scanDir(srcDir);
  scanDir(serverDir);

  if (totalGarbledFiles === 0) {
    success('모든 소스코드 한글 인코딩 정상 (Mojibake 미검출)');
  } else {
    error(`총 ${totalGarbledFiles}개의 파일에서 한글 깨짐이 감지되었습니다. 배포를 진행할 수 없습니다.`);
  }
}

function printSummary() {
  console.log(`\n${colors.blue}${'═'.repeat(50)}${colors.reset}`);
  console.log(`${colors.green}✓ PASS: ${passedChecks}${colors.reset}`);
  console.log(`${colors.red}✗ FAIL: ${failedChecks}${colors.reset}`);
  console.log(`${colors.yellow}⚠ WARN: ${warnings}${colors.reset}`);
  console.log(`${colors.blue}${'═'.repeat(50)}${colors.reset}\n`);
  
  if (failedChecks > 0) {
    console.log(`${colors.red}❌ 배포 불가: ${failedChecks}개 검증 실패${colors.reset}`);
    process.exit(1);
  } else if (warnings > 0) {
    console.log(`${colors.yellow}⚠️ 경고: ${warnings}개 항목 확인 필요${colors.reset}`);
    process.exit(0);
  } else {
    console.log(`${colors.green}✅ 모든 검증 통과. 배포 가능합니다.${colors.reset}`);
    process.exit(0);
  }
}

// ===== 실행 =====
(async function() {
  console.log(`\n${colors.cyan}🔍 배포 전 검증 스크립트${colors.reset}`);
  console.log(`${colors.cyan}${'═'.repeat(50)}${colors.reset}`);
  
  const args = process.argv.slice(2);
  const hasAsarTest = args.includes('--asar-path');
  const hasApiTest = args.includes('--api-test');
  
  validateRequiredFiles();
  validateRuntimeConfigPackagingContract();
  validateRouteRegistry();
  validateApiSpec();
  validateEnvVariables();
  validateEncodingAndKorean();
  
  if (hasAsarTest) {
    const asarPath = args[args.indexOf('--asar-path') + 1];
    validateAsarPackage(asarPath);
  }
  
  if (hasApiTest) {
    const devServerUrl = 'http://127.0.0.1:18731';
    await testApiEndpoints(devServerUrl);
  }
  
  printSummary();
})();
