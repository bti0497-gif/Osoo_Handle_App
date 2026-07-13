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
const { runUnifiedRecordModalRegressionTests } = require('./validate-unified-record-modal.cjs');

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

function validateReportTemplateFiles(rootDir, description) {
  const reportsDir = path.join(rootDir, 'templates', 'reports');
  const requiredTemplates = [
    '일일업무일지.xlsx',
    '일일업무일지(A2O).hwpx',
    '일일업무일지(MBR).hwpx',
    '수질분석일지.xlsx',
    '약품관리대장.xlsx',
    '약품입고일지.xlsx',
    '슬러지반출관리대장.xlsx',
    '슬러지사진대지.xlsx',
  ];

  for (const fileName of requiredTemplates) {
    const filePath = path.join(reportsDir, fileName);
    if (fs.existsSync(filePath)) {
      success(`${description} 일지 양식 확인: ${path.relative(BASE_DIR, filePath)}`);
    } else {
      error(`${description} 일지 양식 누락: ${filePath}`);
    }
  }
}

function validateRequiredFiles() {
  console.log(`\n${colors.blue}▶ 필수 파일 검증${colors.reset}`);
  
  checkFileExists(path.join(BASE_DIR, 'package.json'), 'package.json');
  checkFileExists(path.join(BASE_DIR, 'electron-builder.config.js'), 'electron-builder.config.js');
  checkFileExists(path.join(BASE_DIR, 'electron-builder.config.cjs'), 'electron-builder.config.cjs');
  checkFileExists(path.join(BASE_DIR, 'server', 'config', 'runtimeConfig.cjs'), '런타임 설정 로더');
  checkFileExists(path.join(BASE_DIR, 'scripts', 'provision-runtime-config.cjs'), '런타임 설정 프로비저닝 도구');
  validateReportTemplateFiles(BASE_DIR, '원본');

  const wrapperConfigText = fs.readFileSync(path.join(BASE_DIR, 'electron-builder.config.js'), 'utf8');
  const configText = fs.readFileSync(path.join(BASE_DIR, 'electron-builder.config.cjs'), 'utf8');
  if (wrapperConfigText.includes("import config from './electron-builder.config.cjs'")) {
    success('electron-builder.config.js가 CommonJS 본문 대신 .cjs 설정을 참조함');
  } else {
    error('electron-builder.config.js가 .cjs 설정 wrapper가 아닙니다');
  }
  if (configText.includes("'.env.local'")) {
    error('electron-builder에 .env.local 포함 규칙이 남아 있습니다');
  } else {
    success('electron-builder에서 .env.local 제외됨');
  }
  const requiredExclusions = [
    '!server/config/google-key.json',
    '!server/config/bigquery-service-account.json',
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

  if (!runtimeConfigText.includes('process.env.OSOO_APP_DATA_PATH')) {
    success('런타임 기본 경로의 외부 환경변수 덮어쓰기 차단 확인');
  } else {
    error('OSOO_APP_DATA_PATH가 런타임 기본 경로를 덮어쓸 수 있습니다');
  }

  const electronMainText = fs.readFileSync(path.join(BASE_DIR, 'electron', 'main.cjs'), 'utf8');
  const canonicalElectronPath = /const osooAppDataPath = path\.join\([\s\S]*?'Osoo_Handle_App'[\s\S]*?\);/.test(electronMainText);
  const passesCanonicalPath = electronMainText.includes('OSOO_APP_DATA_PATH: osooAppDataPath');
  const passesElectronUserData = /OSOO_APP_DATA_PATH:\s*app\.getPath\(['"]userData['"]\)/.test(electronMainText);
  if (canonicalElectronPath && passesCanonicalPath && !passesElectronUserData) {
    success('Electron 내장 서버가 고정 AppData 경로 계약을 전달함');
  } else {
    error('Electron 내장 서버의 AppData 경로가 Osoo_Handle_App 계약과 다릅니다');
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
  const provisionScriptText = fs.readFileSync(path.join(BASE_DIR, 'scripts', 'provision-runtime-config.cjs'), 'utf8');
  const installWithProvisioningText = fs.readFileSync(path.join(BASE_DIR, 'scripts', 'install-with-provisioning.ps1'), 'utf8');
  const requiredCredentialNames = [
    '.env.local',
    'google-key.json',
    'bigquery-service-account.json',
    'firebase-service-account.json',
  ];
  for (const name of requiredCredentialNames) {
    if (installScriptText.includes(name)) success(`통합 설치파일 자격증명 항목 확인: ${name}`);
    else error(`통합 설치파일 자격증명 항목 누락: ${name}`);

    const hasPrimaryInstallDir = installScriptText.includes('SetOutPath "$APPDATA\\Osoo_Handle_App\\config"');
    const hasLegacyInstallDir = installScriptText.includes('SetOutPath "$APPDATA\\wastewater-treatment-plant\\config"');
    const genericInstallFileCount = (installScriptText.match(/File \/oname=\$\(\$entry\.Key\)/g) || []).length;
    if (hasPrimaryInstallDir && hasLegacyInstallDir && genericInstallFileCount >= 2) success(`통합 설치파일 양쪽 config 경로 복사 확인: ${name}`);
    else error(`통합 설치파일이 ${name}을 기본/레거시 config 경로 양쪽에 복사하지 않습니다`);

    if (installScriptText.includes('$APPDATA\\Osoo_Handle_App\\config\\$($entry.Key)')) {
      success(`통합 설치파일 기본 config 검증 확인: ${name}`);
    } else {
      error(`통합 설치파일 기본 config 검증 누락: ${name}`);
    }

    if (provisionScriptText.includes(`target: '${name}'`) && provisionScriptText.includes('runtimeConfigDir') && provisionScriptText.includes('legacyRuntimeConfigDir')) {
      success(`provision-runtime-config.cjs 양쪽 config 복사 계약 확인: ${name}`);
    } else {
      error(`provision-runtime-config.cjs ${name} 복사 계약 누락`);
    }

    if (installWithProvisioningText.includes(`Name = '${name}'`) && installWithProvisioningText.includes(`Join-Path $runtimeConfigRoot $_`)) {
      success(`install-with-provisioning.ps1 요구/검증 확인: ${name}`);
    } else {
      error(`install-with-provisioning.ps1 ${name} 요구/검증 누락`);
    }
  }
}

function validateInstallerProcessGuardContract() {
  console.log(`\n${colors.blue}▶ 설치 프로세스 종료 보호 계약 검증${colors.reset}`);

  const guardPath = path.join(BASE_DIR, 'scripts', 'installer-process-guard.nsh');
  if (!fs.existsSync(guardPath)) {
    error('설치 프로세스 종료 보호 스크립트가 없습니다');
    return;
  }

  const guardText = fs.readFileSync(guardPath, 'utf8');
  const builderText = fs.readFileSync(path.join(BASE_DIR, 'electron-builder.config.cjs'), 'utf8');
  const integratedText = fs.readFileSync(path.join(BASE_DIR, 'scripts', 'build-integrated-installer.ps1'), 'utf8');

  if (
    guardText.includes('!macro customInit')
    && guardText.includes('taskkill /F /T /IM "Osoo Handle App.exe"')
    && guardText.includes('Sleep 1500')
  ) {
    success('설치 시작 전 기존 앱·수동 서버 종료 및 대기 계약 확인');
  } else {
    error('설치 프로세스 종료 보호 스크립트가 필수 종료/대기 계약을 충족하지 않습니다');
  }

  if (builderText.includes("include: 'scripts/installer-process-guard.nsh'")) {
    success('일반 자동업데이트 설치판에 프로세스 종료 보호 적용');
  } else {
    error('일반 자동업데이트 설치판에 프로세스 종료 보호가 적용되지 않았습니다');
  }

  if (
    integratedText.includes("$processGuardFile = Join-Path $projectRoot 'scripts\\installer-process-guard.nsh'")
    && integratedText.includes('$processGuardSourcePath = ConvertTo-NsisSourcePath $processGuardFile')
    && integratedText.includes('!include')
  ) {
    success('통합 현장 설치판에 프로세스 종료 보호 적용');
  } else {
    error('통합 현장 설치판에 프로세스 종료 보호가 적용되지 않았습니다');
  }
}

function validateNativeModuleReleaseContract() {
  console.log(`\n${colors.blue}▶ Electron 네이티브 모듈 릴리즈 계약 검증${colors.reset}`);

  const packageJson = JSON.parse(fs.readFileSync(path.join(BASE_DIR, 'package.json'), 'utf8'));
  const buildScript = packageJson.scripts?.['electron:build'] || '';
  const nativeValidationScript = packageJson.scripts?.['validate:native'] || '';
  const fieldInstallerScript = packageJson.scripts?.['package:field-installer'] || '';
  const safeReleaseScript = packageJson.scripts?.['release:safe'] || '';
  const devRunnerText = fs.readFileSync(path.join(BASE_DIR, 'run-all.cjs'), 'utf8');
  const serverIndexText = fs.readFileSync(path.join(BASE_DIR, 'server', 'index.cjs'), 'utf8');
  const workflowText = fs.readFileSync(path.join(BASE_DIR, '.github', 'workflows', 'release.yml'), 'utf8');
  const integratedInstallerText = fs.readFileSync(
    path.join(BASE_DIR, 'scripts', 'build-integrated-installer.ps1'),
    'utf8'
  );

  if (
    integratedInstallerText.includes("$asarUnpackSection = '  asarUnpack: base.asarUnpack,'")
    && !integratedInstallerText.includes("'node_modules/better-sqlite3/**/*',")
  ) {
    success('통합 설치판이 서버 전체 node_modules 압축 해제 계약을 유지함');
  } else {
    error('통합 설치판이 일부 네이티브 모듈만 압축 해제하여 express 등 서버 의존성을 누락할 수 있습니다');
  }

  if (nativeValidationScript && fs.readFileSync(path.join(BASE_DIR, 'scripts', 'validate-packaged-native.cjs'), 'utf8').includes("'express'")) {
    success('패키지 검증기가 express 서버 의존성 누락을 차단함');
  } else {
    error('패키지 검증기에 express 서버 의존성 검사가 없습니다');
  }
  const validatorPath = path.join(BASE_DIR, 'scripts', 'validate-packaged-native.cjs');
  const smokePath = path.join(BASE_DIR, 'scripts', 'smoke-packaged-sqlite.cjs');

  if (buildScript.includes('@electron/rebuild') && buildScript.includes('validate:native')) {
    success('로컬 Electron 빌드가 네이티브 재빌드와 패키지 실행 검증을 강제함');
  } else {
    error('로컬 Electron 빌드의 네이티브 재빌드/실행 검증 계약이 누락되었습니다');
  }

  if (nativeValidationScript.includes('validate-packaged-native.cjs')) {
    success('패키지 네이티브 모듈 검증 명령 확인');
  } else {
    error('validate:native 명령이 패키지 검증기를 실행하지 않습니다');
  }

  if (fs.existsSync(validatorPath) && fs.existsSync(smokePath)) {
    success('패키지 better-sqlite3 실행 검증기 포함');
  } else {
    error('패키지 better-sqlite3 실행 검증기 파일이 누락되었습니다');
  }

  const rebuildIndex = workflowText.indexOf('Rebuild native modules for Electron');
  const smokeIndex = workflowText.indexOf('Smoke test packaged native modules');
  const publishIndex = workflowText.indexOf('Build installer and publish verified package');
  if (rebuildIndex >= 0 && smokeIndex > rebuildIndex && publishIndex > smokeIndex) {
    success('GitHub Release가 Electron 재빌드 → 실행 검증 → 게시 순서를 강제함');
  } else {
    error('GitHub Release 네이티브 모듈 검증 순서가 훼손되었습니다');
  }

  if (workflowText.includes('--prepackaged release/win-unpacked --publish always')) {
    success('검증된 win-unpacked 패키지만 GitHub Release에 게시함');
  } else {
    error('GitHub Release가 검증된 사전 패키지를 게시하지 않습니다');
  }

  if (integratedInstallerText.includes('validate-packaged-native.cjs $unpackedRoot')) {
    success('신규 현장 통합 설치파일도 패키지 네이티브 모듈 실행 검증을 강제함');
  } else {
    error('신규 현장 통합 설치파일의 네이티브 모듈 실행 검증이 누락되었습니다');
  }

  if (
    fieldInstallerScript.includes('build-integrated-installer.ps1')
    && safeReleaseScript.includes('package:field-installer')
    && safeReleaseScript.includes('validate:field-installer')
  ) {
    success('안전 릴리즈가 업데이트용/신규 현장용 설치본과 배포 매니페스트 검증을 함께 강제함');
  } else {
    error('안전 릴리즈의 신규 현장 통합 설치본 강제 계약이 누락되었습니다');
  }

  const nodeRebuildIndex = safeReleaseScript.indexOf('npm rebuild better-sqlite3');
  const validateIndex = safeReleaseScript.indexOf('npm run validate');
  const electronBuildIndex = safeReleaseScript.indexOf('npm run electron:build');
  if (nodeRebuildIndex >= 0 && validateIndex > nodeRebuildIndex && electronBuildIndex > validateIndex) {
    success('안전 릴리즈가 Node DB 검증 후 Electron ABI 패키징 순서를 강제함');
  } else {
    error('release:safe의 Node 검증 → Electron 패키징 ABI 전환 순서가 잘못되었습니다');
  }

  if (
    integratedInstallerText.includes('field-installer-manifest.json')
    && integratedInstallerText.includes('nativeSqliteSmokeTest = $true')
    && fs.existsSync(path.join(BASE_DIR, 'scripts', 'validate-field-installer.cjs'))
  ) {
    success('신규 현장 설치본 버전/해시/config 대상 검증 매니페스트 계약 확인');
  } else {
    error('신규 현장 설치본 배포 매니페스트 계약이 누락되었습니다');
  }

  if (
    devRunnerText.includes("['@electron/rebuild', '--force', '--arch=x64', '--electron-version=40.6.0']")
    && devRunnerText.includes('/api/auth/login-hint')
    && !devRunnerText.includes('const url = `http://127.0.0.1:${port}/api/ping`')
  ) {
    success('개발 실행이 Electron 네이티브 재빌드 후 로그인 API 준비 상태를 강제함');
  } else {
    error('dev:all이 Electron ABI 재빌드 또는 로그인 API 준비 확인을 강제하지 않습니다');
  }

  if (
    serverIndexText.includes("console.error('[Server] full-stack-init 실패:', e);")
    && serverIndexText.includes('setTimeout(() => process.exit(1), 100);')
  ) {
    success('DB/인증 초기화 실패 시 ping-only 반쪽 서버 종료 계약 확인');
  } else {
    error('서버 초기화 실패 후 ping만 응답하는 반쪽 서버가 남을 수 있습니다');
  }
}

function validateInstallerNamingPolicy() {
  console.log(`\n${colors.blue}▶ 설치파일 네이밍 정책 검증${colors.reset}`);

  const builderConfigPath = path.join(BASE_DIR, 'electron-builder.config.cjs');
  const integratedBuilderScriptPath = path.join(BASE_DIR, 'scripts', 'build-integrated-installer.ps1');
  const installWithProvisioningPath = path.join(BASE_DIR, 'scripts', 'install-with-provisioning.ps1');
  const deploymentPackageScriptPath = path.join(BASE_DIR, 'scripts', 'prepare-deployment-package.ps1');
  const latestYmlPath = path.join(BASE_DIR, 'release', 'latest.yml');

  const builderConfigText = fs.readFileSync(builderConfigPath, 'utf8');
  const integratedBuilderScriptText = fs.readFileSync(integratedBuilderScriptPath, 'utf8');
  const installWithProvisioningText = fs.readFileSync(installWithProvisioningPath, 'utf8');
  const deploymentPackageScriptText = fs.readFileSync(deploymentPackageScriptPath, 'utf8');

  if (builderConfigText.includes("artifactName: 'Osoo.Handle.App.Setup.${version}.${ext}'")) {
    success('electron-builder 기본 설치파일명 정책 확인: Osoo.Handle.App.Setup.{version}.{ext}');
  } else {
    error('electron-builder 기본 설치파일명 정책이 점(.) 규칙이 아닙니다');
  }

  if (integratedBuilderScriptText.includes("artifactName: 'Osoo.Handle.App.Integrated.Setup.`${version}.`${ext}'")) {
    success('통합 설치파일명 정책 확인: Osoo.Handle.App.Integrated.Setup.{version}.{ext}');
  } else {
    error('통합 설치파일명 정책이 점(.) 규칙이 아닙니다');
  }

  if (installWithProvisioningText.includes("-Filter 'Osoo.Handle.App.Setup.*.exe'")) {
    success('프로비저닝 설치 스크립트가 점(.) 설치파일 패턴을 사용함');
  } else {
    error('프로비저닝 설치 스크립트가 점(.) 설치파일 패턴을 사용하지 않습니다');
  }

  if (deploymentPackageScriptText.includes("-Filter 'Osoo.Handle.App.Setup.*.exe'")) {
    success('배포 패키지 준비 스크립트가 점(.) 설치파일 패턴을 사용함');
  } else {
    error('배포 패키지 준비 스크립트가 점(.) 설치파일 패턴을 사용하지 않습니다');
  }

  if (fs.existsSync(latestYmlPath)) {
    const latestYmlText = fs.readFileSync(latestYmlPath, 'utf8');
    if (
      latestYmlText.includes('url: Osoo.Handle.App.Setup.')
      && latestYmlText.includes('path: Osoo.Handle.App.Setup.')
    ) {
      success('release/latest.yml 자동업데이트 파일명이 점(.) 정책과 일치함');
    } else {
      error('release/latest.yml의 url/path 파일명이 점(.) 정책과 일치하지 않습니다');
    }
  } else {
    warn('release/latest.yml이 없어 자동업데이트 파일명 정책 검증을 건너뜁니다');
  }
}

function validateRegressionContracts() {
  console.log(`\n${colors.blue}▶ 현장 회귀 방지 계약 검증${colors.reset}`);

  const unifiedViewModelPath = path.join(BASE_DIR, 'src', 'features', 'records', 'useUnifiedRecordViewModel.js');
  const unifiedModalPath = path.join(BASE_DIR, 'src', 'features', 'records', 'UnifiedRecordModal.jsx');
  const dailyWorkLogRoutesPath = path.join(BASE_DIR, 'server', 'routes', 'dailyWorkLogRoutes.cjs');
  const reportTemplateServicePath = path.join(BASE_DIR, 'server', 'services', 'reportTemplateService.cjs');
  const flowRoutesPath = path.join(BASE_DIR, 'server', 'routes', 'flowRoutes.cjs');
  const medicineRoutesPath = path.join(BASE_DIR, 'server', 'routes', 'medicineRoutes.cjs');
  const kitRoutesPath = path.join(BASE_DIR, 'server', 'routes', 'kitRoutes.cjs');
  const settingsModelPath = path.join(BASE_DIR, 'src', 'features', 'settings', 'SettingsModel.js');
  const settingsViewModelPath = path.join(BASE_DIR, 'src', 'features', 'settings', 'useSettingsViewModel.js');
  const settingsViewPath = path.join(BASE_DIR, 'src', 'features', 'settings', 'SettingsView.jsx');
  const basicSitePanelPath = path.join(BASE_DIR, 'src', 'features', 'settings', 'panels', 'BasicSitePanel.jsx');
  const settingsRoutesPath = path.join(BASE_DIR, 'server', 'routes', 'settingsRoutes.cjs');
  const mappingServicePath = path.join(BASE_DIR, 'server', 'services', 'settings', 'mappingSettingsService.cjs');
  const inventoryMappingPanelPath = path.join(BASE_DIR, 'src', 'features', 'settings', 'panels', 'InventoryMappingPanel.jsx');
  const flowMappingPanelPath = path.join(BASE_DIR, 'src', 'features', 'settings', 'panels', 'FlowMappingPanel.jsx');
  const excelCellMapperPath = path.join(BASE_DIR, 'src', 'features', 'settings', 'widgets', 'ExcelCellMapper.jsx');
  const templateUploadCardPath = path.join(BASE_DIR, 'src', 'features', 'settings', 'widgets', 'TemplateUploadCard.jsx');
  const useMappingSettingsPath = path.join(BASE_DIR, 'src', 'features', 'settings', 'hooks', 'useMappingSettings.js');
  const templateSettingsServicePath = path.join(BASE_DIR, 'server', 'services', 'settings', 'templateSettingsService.cjs');
  const appSettingsServicePath = path.join(BASE_DIR, 'server', 'services', 'settings', 'appSettingsService.cjs');
  const electronBuilderConfigPath = path.join(BASE_DIR, 'electron-builder.config.cjs');
  const excelMappingTemplateContractPath = path.join(BASE_DIR, 'EXCEL_MAPPING_TEMPLATE_CONTRACT.md');
  const unifiedRecordModalContractPath = path.join(BASE_DIR, 'UNIFIED_RECORD_MODAL_CONTRACT.md');
  const flowManagementViewPath = path.join(BASE_DIR, 'src', 'features', 'flow', 'FlowManagementView.jsx');
  const medicineManagementViewPath = path.join(BASE_DIR, 'src', 'features', 'medicine', 'MedicineManagementView.jsx');
  const kitManagementViewPath = path.join(BASE_DIR, 'src', 'features', 'kit', 'KitManagementView.jsx');
  const waterQualityViewPath = path.join(BASE_DIR, 'src', 'features', 'water', 'WaterQualityView.jsx');
  const waterQualityViewModelPath = path.join(BASE_DIR, 'src', 'features', 'water', 'useWaterQualityViewModel.js');
  const inventoryCascadeServicePath = path.join(BASE_DIR, 'server', 'services', 'inventoryCascadeService.cjs');
  const flowModelPath = path.join(BASE_DIR, 'src', 'features', 'flow', 'FlowModel.js');
  const flowViewModelPath = path.join(BASE_DIR, 'src', 'features', 'flow', 'useFlowViewModel.js');
  const medicineModelPath = path.join(BASE_DIR, 'src', 'features', 'medicine', 'MedicineModel.js');
  const kitModelPath = path.join(BASE_DIR, 'src', 'features', 'kit', 'KitModel.js');
  const waterQualityModelPath = path.join(BASE_DIR, 'src', 'features', 'water', 'WaterQualityModel.js');
  const waterQualityRoutesPath = path.join(BASE_DIR, 'server', 'routes', 'waterQualityRoutes.cjs');
  const sitesSheetsServicePath = path.join(BASE_DIR, 'server', 'services', 'sitesSheetsService.cjs');
  const siteSettingsServicePath = path.join(BASE_DIR, 'server', 'services', 'settings', 'siteSettingsService.cjs');
  const dashboardModelPath = path.join(BASE_DIR, 'src', 'features', 'dashboard', 'DashboardModel.js');
  const dashboardViewModelPath = path.join(BASE_DIR, 'src', 'features', 'dashboard', 'useDashboardViewModel.js');
  const inventoryLevelWidgetPath = path.join(BASE_DIR, 'src', 'features', 'dashboard', 'widgets', 'InventoryLevelWidget.jsx');
  const medicineInRoutesPath = path.join(BASE_DIR, 'server', 'routes', 'medicineInRoutes.cjs');
  const excelRoutesPath = path.join(BASE_DIR, 'server', 'routes', 'excelRoutes.cjs');
  const roadworkHelperRoutesPath = path.join(BASE_DIR, 'server', 'routes', 'roadworkHelperRoutes.cjs');
  const bigQueryRestoreServicePath = path.join(BASE_DIR, 'server', 'services', 'bigQueryRestoreService.cjs');
  const diagnosticLogServicePath = path.join(BASE_DIR, 'server', 'services', 'diagnosticLogService.cjs');
  const serverIndexPath = path.join(BASE_DIR, 'server', 'index.cjs');
  const sludgePhotoRoutesPath = path.join(BASE_DIR, 'server', 'routes', 'sludgePhotoRoutes.cjs');
  const localDataBackupContractPath = path.join(BASE_DIR, 'LOCAL_DATA_BACKUP_CONTRACT.md');

  const readText = (filePath) => (fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '');
  const viewModelText = readText(unifiedViewModelPath);
  const modalText = readText(unifiedModalPath);
  const dailyWorkLogText = readText(dailyWorkLogRoutesPath);
  const reportTemplateText = readText(reportTemplateServicePath);
  const flowRoutesText = readText(flowRoutesPath);
  const medicineRoutesText = readText(medicineRoutesPath);
  const kitRoutesText = readText(kitRoutesPath);
  const settingsBigQueryClearText = [
    settingsModelPath,
    settingsViewModelPath,
    settingsViewPath,
    basicSitePanelPath,
    settingsRoutesPath,
  ].map(readText).join('\n');
  const mappingServiceText = readText(mappingServicePath);
  const inventoryMappingPanelText = readText(inventoryMappingPanelPath);
  const flowMappingPanelText = readText(flowMappingPanelPath);
  const excelCellMapperText = readText(excelCellMapperPath);
  const templateUploadCardText = readText(templateUploadCardPath);
  const useMappingSettingsText = readText(useMappingSettingsPath);
  const templateSettingsServiceText = readText(templateSettingsServicePath);
  const settingsRoutesText = readText(settingsRoutesPath);
  const appSettingsServiceText = readText(appSettingsServicePath);
  const basicSitePanelText = readText(basicSitePanelPath);
  const electronBuilderConfigText = readText(electronBuilderConfigPath);
  const excelMappingTemplateContractText = readText(excelMappingTemplateContractPath);
  const unifiedRecordModalContractText = readText(unifiedRecordModalContractPath);
  const flowManagementViewText = readText(flowManagementViewPath);
  const medicineManagementViewText = readText(medicineManagementViewPath);
  const kitManagementViewText = readText(kitManagementViewPath);
  const waterQualityViewText = readText(waterQualityViewPath);
  const waterQualityViewModelText = readText(waterQualityViewModelPath);
  const inventoryCascadeServiceText = readText(inventoryCascadeServicePath);
  const flowModelText = readText(flowModelPath);
  const flowViewModelText = readText(flowViewModelPath);
  const medicineModelText = readText(medicineModelPath);
  const kitModelText = readText(kitModelPath);
  const waterQualityModelText = readText(waterQualityModelPath);
  const waterQualityRoutesText = readText(waterQualityRoutesPath);
  const sitesSheetsServiceText = readText(sitesSheetsServicePath);
  const siteSettingsServiceText = readText(siteSettingsServicePath);
  const dashboardModelText = readText(dashboardModelPath);
  const dashboardViewModelText = readText(dashboardViewModelPath);
  const inventoryLevelWidgetText = readText(inventoryLevelWidgetPath);
  const medicineInRoutesText = readText(medicineInRoutesPath);
  const excelRoutesText = readText(excelRoutesPath);
  const roadworkHelperRoutesText = readText(roadworkHelperRoutesPath);
  const bigQueryRestoreServiceText = readText(bigQueryRestoreServicePath);
  const diagnosticLogServiceText = readText(diagnosticLogServicePath);
  const serverIndexText = readText(serverIndexPath);
  const sludgePhotoRoutesText = readText(sludgePhotoRoutesPath);
  const localDataBackupContractText = readText(localDataBackupContractPath);
  const parentManagementViews = [
    ['유량', flowManagementViewText],
    ['약품', medicineManagementViewText],
    ['키트', kitManagementViewText],
    ['수질', waterQualityViewText],
  ];

  const checkSource = (condition, passMessage, failMessage) => {
    if (condition) success(passMessage);
    else error(failMessage);
  };

  checkSource(
    viewModelText.includes('SettingsModel.getMedicineDefaults()') &&
      viewModelText.includes('SettingsModel.getKitDefaults()') &&
      viewModelText.includes('medicineDefaultMap') &&
      viewModelText.includes('kitDefaultMap') &&
      viewModelText.includes('defaultPurchase: defaultAmount'),
    '통합 모달 약품/키트 기본 구매량 로딩 계약 유지',
    '통합 모달에서 약품/키트 기본 구매량 로딩 또는 defaultPurchase 매핑이 빠졌습니다'
  );

  checkSource(
    modalText.includes('defaultPurchaseAppliedByTab') &&
      modalText.includes('Number(item.defaultPurchase)') &&
      modalText.includes('purchase: nextApplied'),
    '통합 모달 구매량 적용 버튼 계약 유지',
    '통합 모달 구매량 적용 버튼이 기본 구매량을 구매량 칸에 반영하지 못할 수 있습니다'
  );

  checkSource(
    modalText.includes('hasDraftForItem') &&
      modalText.includes('const purchase = item.values?.purchase ?? 0;') &&
      modalText.includes('const usage = item.values?.usage ?? 0;') &&
      modalText.includes('inventory_is_manual'),
    '약품/키트 저장 대상 및 재고 기준점 계약 유지',
    '약품/키트 미사용일 저장 또는 직접 재고 수정 기준점 계약이 깨졌습니다'
  );

  const handleCloseMatch = modalText.match(/const handleClose = async \(\) => \{[\s\S]*?\n    const renderWaterSidebar/);
  const handleCloseBody = handleCloseMatch ? handleCloseMatch[0] : '';
  checkSource(
    handleCloseBody &&
      !handleCloseBody.includes('savePlan(') &&
      !handleCloseBody.includes('buildSavePlan(') &&
      !handleCloseBody.includes('자동 저장') &&
      handleCloseBody.includes('저장하지 않고 닫을까요?'),
    '통합 모달 닫기 버튼 저장 금지 계약 유지',
    '통합 모달 닫기/X 버튼에서 자동 저장이 다시 동작할 수 있습니다'
  );

  checkSource(
    unifiedRecordModalContractText.includes('If a user selects a date and clicks the open-input button') &&
      unifiedRecordModalContractText.includes('The modal body must not use a blanket `pointer-events: none`') &&
      unifiedRecordModalContractText.includes('Editing inventory marks that date as a manual inventory baseline') &&
      unifiedRecordModalContractText.includes('inventory must be clamped at zero') &&
      unifiedRecordModalContractText.includes('Flow server save must upsert by `(date, type)`') &&
      unifiedRecordModalContractText.includes('After a successful save, the modal must force reload only the saved tabs') &&
      unifiedRecordModalContractText.includes('parent grid must not refresh after each save') &&
      unifiedRecordModalContractText.includes('only when the modal closes'),
    '통합 입력 모달 날짜/입력/계산 계약 문서 확인',
    'UNIFIED_RECORD_MODAL_CONTRACT.md가 누락되었거나 핵심 계약 문구가 빠졌습니다'
  );

  checkSource(
    flowManagementViewText.includes('const modalDate = selectedDate || todayStr;') &&
      medicineManagementViewText.includes('initialDate={selectedDate || todayStr}') &&
      kitManagementViewText.includes('initialDate={selectedDate || todayStr}') &&
      waterQualityViewText.includes('date: selectedRow?.date || todayStr,') &&
      flowManagementViewText.includes('onCellDoubleClick={() => openModal(\'edit\')}') &&
      medicineManagementViewText.includes('onCellDoubleClick={() => openModal(\'edit\')}') &&
      kitManagementViewText.includes('onCellDoubleClick={() => openModal(\'edit\')}') &&
      waterQualityViewText.includes('onCellDoubleClick={() => openModal(\'edit\')}'),
    '통합 모달 선택 날짜 우선 열기 계약 유지',
    '선택 날짜가 add/edit 모드에 의해 오늘 날짜로 덮일 수 있습니다'
  );

  checkSource(
    modalText.includes("if (!isSludge && field === 'reading')") &&
      modalText.includes("if (!isSludge && field === 'calculatedFlow')") &&
      modalText.includes('nextDraft.reading = round1(previousReading + calculatedFlow)') &&
      flowRoutesText.includes('일반/임포트/관리자 값은 raw 차이로 정규화') &&
      flowRoutesText.includes('recalculateFlowTypeCascade(db, type, metadata, [...dates].sort()[0], dates)') &&
      flowRoutesText.includes('recalculateFlowTypeCascade(db, type, metadata, date, new Set([date]))'),
    '유량 검침값/유량값 상호 계산 및 이후 재계산 계약 유지',
    '유량 검침값/유량값 상호 계산 또는 이후 유량 재계산 계약이 깨졌습니다'
  );

  checkSource(
      modalText.includes("if (field === 'purchase' || field === 'usage')") &&
      modalText.includes('Object.assign(nextDraft, recalculateInventoryDraft(item, nextDraft));') &&
      modalText.includes('const handleAdjustKitUsage = (delta) =>') &&
      /const handleAdjustKitUsage = \(delta\) => \{[\s\S]*?currentItems\.forEach\(\(item\) => \{[\s\S]*?usage: nextUsage,[\s\S]*?recalculateInventoryDraft\(item, updated\)/.test(modalText) &&
      modalText.includes('const clampInventory = (value) => Math.max(0, round1(Number(value || 0)));') &&
      modalText.includes('inventory_is_manual: Boolean(values.__dirty?.inventory)') &&
      medicineRoutesText.includes('item.inventory_is_manual || item.inventoryIsManual') &&
      kitRoutesText.includes('item.inventory_is_manual || item.inventoryIsManual') &&
      inventoryCascadeServiceText.includes('normalizedExplicitDates.has(row.date)') &&
      inventoryCascadeServiceText.includes('function clampInventory(value)') &&
      inventoryCascadeServiceText.includes('runningInventory + Number(row.purchase_amount || 0) - Number(row.usage_amount || 0)'),
    '약품/키트 구매·사용·재고 자동계산 및 이후 재계산 계약 유지',
    '약품/키트 구매/사용/재고 자동계산 또는 이후 재고 재계산 계약이 깨졌습니다'
  );

  checkSource(
    !modalText.includes("pointerEvents: isLoadingUnifiedData || isSaving ? 'none' : 'auto'") &&
      modalText.includes("pointerEvents: 'auto'") &&
      modalText.includes('onChange={(e) => setFlowDraftFieldForItem(item, field, e.target.value)}') &&
      modalText.includes('onChange={(e) => setInventoryDraftFieldForItem(activeTab, item, field, e.target.value)}') &&
      modalText.includes('onChange={(e) => {') &&
      modalText.includes("if (enabled) setWaterDraftField(item, field.id, e.target.value);"),
    '통합 모달 텍스트 입력 클릭/수정 가능 계약 유지',
    '통합 모달 입력 영역이 포인터 차단되거나 입력 onChange 연결이 깨졌습니다'
  );

  checkSource(
    modalText.includes('const handleSave = async () =>') &&
      modalText.includes('tabIds: [activeTab]') &&
      modalText.includes('const result = await savePlan(plan);') &&
      modalText.includes('if (!result) return;') &&
      viewModelText.includes('const result = await FlowModel.bulkSave(date, flowItems);') &&
      viewModelText.includes('const result = await MedicineModel.bulkSave(medicineItems);') &&
      viewModelText.includes('const result = await WaterQualityModel.bulkSave(waterItems);') &&
      viewModelText.includes('const result = await KitModel.bulkSave(kitItems);') &&
      viewModelText.includes('if (!result?.success) throw new Error') &&
      viewModelText.includes('await reloadContexts({ force: true, tabs: savedTabs });') &&
      viewModelText.includes("targetTabs.has('flow') ? FlowModel.fetchHistory({ force }) : null") &&
      viewModelText.includes("targetTabs.has('medicine') ? MedicineModel.fetchHistory({ force }) : null") &&
      viewModelText.includes("targetTabs.has('kit') ? KitModel.fetchHistory({ force }) : null") &&
      viewModelText.includes("targetTabs.has('water') ? WaterQualityModel.fetchHistory({ force }) : null") &&
      parentManagementViews.every(([, source]) => (
        source.includes('pendingParentRefreshRef.current = true;') &&
        source.includes('const handleModalClose = () =>') &&
        source.includes('refresh({ force: false });') &&
        source.includes('onClose={handleModalClose}') &&
        !source.includes('await refresh({ force: false });')
      )),
    '통합 모달 저장 탭 단일 갱신 및 부모 닫기 시점 갱신 계약 유지',
    '통합 모달 저장 중 부모 화면이 즉시 재조회되거나 닫기 시점 갱신 계약이 깨졌습니다'
  );

  for (const [label, source] of parentManagementViews) {
    checkSource(
      source.includes('pendingParentRefreshRef.current = true;') &&
        source.includes('const handleModalClose = () =>') &&
        source.includes('onClose={handleModalClose}') &&
        !source.includes('await refresh({ force: false });'),
      `통합 모달 ${label} 부모 화면 닫기 시점 갱신 계약 유지`,
      `통합 모달 ${label} 부모 화면이 저장 중 재조회하거나 닫기 갱신 연결이 깨졌습니다`
    );
  }

  try {
    const regressionResult = runUnifiedRecordModalRegressionTests();
    success(`통합 모달 약품/키트 재고 실제 DB 회귀검증 (${regressionResult.scenarios}개 시나리오)`);
  } catch (regressionError) {
    error(`통합 모달 약품/키트 실제 DB 회귀검증 실패: ${regressionError.message}`);
  }

  checkSource(
    modalText.includes("reading: item.values?.reading ?? (isSludge ? 0 : '')") &&
      modalText.includes('const purchase = item.values?.purchase ?? 0;') &&
      modalText.includes('const usage = item.values?.usage ?? 0;') &&
      unifiedRecordModalContractText.includes('Empty medicine and kit purchase/usage inputs default to zero') &&
      unifiedRecordModalContractText.includes('Empty sludge export defaults to zero'),
    '슬러지·약품·키트 미사용일 0 기본값 계약 유지',
    '미사용일의 0 저장 또는 전일 누계/재고 유지 규칙이 깨졌습니다'
  );

  checkSource(
    flowModelText.includes('clearHistoryCache();') &&
      flowModelText.includes("return apiClient.post('/api/flows/bulk', { date, items });") &&
      medicineModelText.includes('clearHistoryCache();') &&
      medicineModelText.includes("return apiClient.post('/api/medicines/bulk', { items });") &&
      kitModelText.includes('clearHistoryCache();') &&
      kitModelText.includes("return apiClient.post('/api/kits/bulk', { items });") &&
      waterQualityModelText.includes('clearHistoryCache();') &&
      waterQualityModelText.includes("return apiClient.post('/api/water-quality/bulk', { items });"),
    '통합 모달 Model bulk 저장 및 캐시 무효화 계약 유지',
    '통합 모달 저장 Model이 bulk API를 호출하지 않거나 저장 전 캐시를 비우지 않습니다'
  );

  checkSource(
    flowRoutesText.includes("router.post('/api/flows/bulk'") &&
      flowRoutesText.includes('ON CONFLICT(date, type) DO UPDATE SET') &&
      flowRoutesText.includes('raw_value = excluded.raw_value') &&
      flowRoutesText.includes('calculated_flow = excluded.calculated_flow') &&
      medicineRoutesText.includes("router.post('/api/medicines/bulk'") &&
      medicineRoutesText.includes('ON CONFLICT(medicine_name, date) DO UPDATE SET') &&
      medicineRoutesText.includes('purchase_amount = excluded.purchase_amount') &&
      medicineRoutesText.includes('usage_amount = excluded.usage_amount') &&
      kitRoutesText.includes("router.post('/api/kits/bulk'") &&
      kitRoutesText.includes('ON CONFLICT(kit_name, date) DO UPDATE SET') &&
      kitRoutesText.includes('current_inventory = excluded.current_inventory') &&
      waterQualityRoutesText.includes("router.post('/api/water-quality/bulk'") &&
      waterQualityRoutesText.includes('ON CONFLICT(date, measurement_group, location, item_code) DO UPDATE SET') &&
      waterQualityRoutesText.includes('result_numeric = excluded.result_numeric'),
    '통합 모달 서버 upsert 수정 저장 계약 유지',
    '통합 모달 서버 저장이 같은 날짜/항목을 수정 저장하는 upsert 계약에서 벗어났습니다'
  );

  checkSource(
    dailyWorkLogText.includes('getCurrentMethod') &&
      dailyWorkLogText.includes('method: context.method') &&
      reportTemplateText.includes("'일일업무일지(A2O)'") &&
      reportTemplateText.includes("'일일업무일지(MBR)'") &&
      reportTemplateText.includes('getDailyWorkLogTemplateCandidates'),
    '공법별 일일업무일지 HWPX 양식 선택 계약 유지',
    '공법별 일일업무일지 HWPX 양식 선택 로직이 빠졌습니다'
  );

  checkSource(
    dashboardModelText.includes("apiClient.get('/api/settings/medicine-defaults')") &&
      dashboardModelText.includes("apiClient.get('/api/settings/kit-defaults')") &&
      dashboardViewModelText.includes('medicineDefaultsResponse') &&
      dashboardViewModelText.includes('kitDefaultsResponse') &&
      inventoryLevelWidgetText.includes('item.inventory / item.defaultAmount') &&
      !inventoryLevelWidgetText.includes('Math.max(1, ...items.map((i) => i.inventory))'),
    '대시보드 품목별 기본구매량 재고율 계약 유지',
    '대시보드 재고율이 설정 기본구매량이 아닌 품목 간 최대 재고를 기준으로 계산될 수 있습니다'
  );

  checkSource(
    medicineInRoutesText.includes("category = 'medicine' AND is_active = 1") &&
      medicineInRoutesText.includes("category = 'kit' AND is_active = 1") &&
      medicineInRoutesText.includes("item_name NOT LIKE '%\\\\_purchase' ESCAPE '\\\\'") &&
      medicineInRoutesText.includes("item_name NOT LIKE '%\\\\_usage' ESCAPE '\\\\'") &&
      medicineInRoutesText.includes("item_name NOT LIKE '%\\\\_inventory' ESCAPE '\\\\'") &&
      medicineInRoutesText.includes('activeMedicineRows.length > 0') &&
      medicineInRoutesText.includes('activeKitRows.length > 0'),
    '약품 입고 화면 활성 품목 및 내부 매핑키 제외 계약 유지',
    '약품 입고 화면에 비활성 품목 또는 _purchase/_usage/_inventory 내부 키가 노출될 수 있습니다'
  );

  checkSource(
    dailyWorkLogText.includes('function isHwpAutomationUnavailable') &&
      dailyWorkLogText.includes("code: 'HWP_AUTOMATION_UNAVAILABLE'") &&
      dailyWorkLogText.includes("userMessage: 'PDF 출력에는 한글 프로그램 설치가 필요합니다.'"),
    '한글 미설치 PDF 사용자 안내 계약 유지',
    '한글 미설치 현장에서 복잡한 COM 오류가 사용자에게 노출될 수 있습니다'
  );

  checkSource(
    !dailyWorkLogText.includes('restoreOperationalData') &&
      !excelRoutesText.includes('restoreOperationalData') &&
      !roadworkHelperRoutesText.includes('restoreOperationalData') &&
      bigQueryRestoreServiceText.includes('Disaster-recovery service only') &&
      bigQueryRestoreServiceText.includes('WHERE flow_readings.is_synced = 1') &&
      bigQueryRestoreServiceText.includes('WHERE qntech_water_quality.is_synced = 1') &&
      localDataBackupContractText.includes('local SQLite database is the operational source of truth') &&
      localDataBackupContractText.includes('future admin-only disaster-recovery command'),
    '로컬 DB 원본 및 BigQuery 재해복구 전용 계약 유지',
    '일반 업무 경로가 BigQuery 복원으로 로컬 데이터를 덮어쓸 수 있습니다'
  );

  checkSource(
    mappingServiceText.includes("date >= '2000-01-01'") &&
      mappingServiceText.includes('date <= getTodayKst()') &&
      mappingServiceText.includes("DELETE FROM flow_readings WHERE input_status = 'imported'") &&
      mappingServiceText.includes("DELETE FROM ${options.tableName} WHERE input_status = 'imported'") &&
      flowViewModelText.includes("historyData.history.filter((row) => String(row?.date || '') <= todayStr)") &&
      waterQualityViewModelText.includes("historyData.history.filter((record) => String(record?.date || '') <= todayStr)"),
    '엑셀 비정상·미래 날짜 차단 및 화면 미래 실데이터 숨김 계약 유지',
    '1901년 또는 오늘 이후의 실제 데이터가 유량·수질 화면에 다시 노출될 수 있습니다'
  );

  checkSource(
    sludgePhotoRoutesText.includes("SELECT site_id, site_name FROM app_settings WHERE id = 1") &&
      sludgePhotoRoutesText.includes('amount <= 0') &&
      sludgePhotoRoutesText.includes('hasPositiveAmount || hasAttachedRecord'),
    '슬러지사진대지 현장 범위 및 실제 반출행 계약 유지',
    '슬러지사진대지에 다른 현장 또는 0 반출 기본행이 표시될 수 있습니다'
  );

  checkSource(
    diagnosticLogServiceText.includes('async function cleanupOldDiagnosticsOnVersionStart') &&
      diagnosticLogServiceText.includes("findFolderPath(getDriveRootFolderId(), ['앱진단로그'])") &&
      diagnosticLogServiceText.includes("entry.name.slice(0, 10) >= todayKst") &&
      serverIndexText.includes('cleanupOldDiagnosticsOnVersionStart(db, appDataPath)') &&
      localDataBackupContractText.includes('Logs created on the current KST date must remain'),
    '버전 첫 실행 오늘 이전 진단로그 정리 계약 유지',
    '업데이트 후 과거 진단로그 정리 또는 오늘 로그 보존 규칙이 깨졌습니다'
  );

  checkSource(
    diagnosticLogServiceText.includes('machine: os.hostname()') &&
      diagnosticLogServiceText.includes("runtime: process.versions?.electron ? 'electron' : 'node'"),
    'Drive 진단로그 PC/실행환경 식별 계약 유지',
    '현장과 개발 PC를 구분할 machine/runtime 진단 필드가 누락되었습니다'
  );

  checkSource(
    diagnosticLogServiceText.includes('function buildDatabaseDiagnosticDetails') &&
      diagnosticLogServiceText.includes("path.join(appDataPath, 'osoo.db')") &&
      diagnosticLogServiceText.includes('tableCounts') &&
      serverIndexText.includes('details: buildDatabaseDiagnosticDetails(db, appDataPath)') &&
      serverIndexText.includes('responseCount = parsedResponse.history.length'),
    'Drive 진단로그 DB 경로·식별정보·테이블/API 행 개수 계약 유지',
    'Drive 진단로그 DB 식별 및 데이터 행 개수 계약이 누락되었습니다'
  );

  checkSource(
    !settingsBigQueryClearText.includes('clear-operational-data') &&
      !settingsBigQueryClearText.includes('clearBigQueryOperationalData') &&
      !settingsBigQueryClearText.includes('handleClearBigQueryOperationalData') &&
      !settingsBigQueryClearText.includes('BigQuery 운영데이터 초기화') &&
      !settingsBigQueryClearText.includes('BigQuery 운영 데이터 초기화'),
    '설정 메뉴 BigQuery 운영데이터 초기화 제거 계약 유지',
    '설정 메뉴 BigQuery 운영데이터 초기화 UI/API 호출이 다시 추가되었습니다'
  );

  checkSource(
    excelMappingTemplateContractText.includes('Saved column letters are the source of truth') &&
      excelMappingTemplateContractText.includes('become the sole import source') &&
      excelMappingTemplateContractText.includes('purchase from `cols.purchase`') &&
      excelMappingTemplateContractText.includes('Report templates under `templates/reports` are release assets'),
    '엑셀 매핑/기본설정/양식 패키징 계약 문서 확인',
    'EXCEL_MAPPING_TEMPLATE_CONTRACT.md가 누락되었거나 핵심 계약 문구가 빠졌습니다'
  );

  checkSource(
    templateUploadCardText.includes("e.target.value = '';") &&
      templateSettingsServiceText.includes('function cleanupInactiveExcelOriginals') &&
      templateSettingsServiceText.includes('cleanupInactiveExcelOriginals(excelOriginalsDir, original.filename)') &&
      templateSettingsServiceText.indexOf('const sheets = await parseAndStoreExcel(db, filePath);') <
        templateSettingsServiceText.indexOf("db.prepare('UPDATE app_settings SET excel_template_path = ? WHERE id = 1')"),
    '현장 엑셀 AppData 단일 원본 및 동일 파일 재업로드 계약 유지',
    '현장 엑셀 재업로드 또는 AppData 단일 원본 정리 계약이 깨졌습니다'
  );

  checkSource(
    mappingServiceText.includes('function groupInventoryMappings(mapping)') &&
      mappingServiceText.includes("const purchase = toRoundedNumber(getRangeCell(rows, r, cols.purchase || ''), null);") &&
      mappingServiceText.includes("const usage = toRoundedNumber(getRangeCell(rows, r, cols.usage || ''), null);") &&
      mappingServiceText.includes("const inventory = toRoundedNumber(getRangeCell(rows, r, cols.inventory || ''), null);") &&
      mappingServiceText.includes("deleteSqlPrefix: 'DELETE FROM kit_logs WHERE'") &&
      mappingServiceText.includes("deleteSqlPrefix: 'DELETE FROM medicine_logs WHERE'"),
    '약품/키트 엑셀 칼럼 1:1 임포트 계약 유지',
    '약품/키트 구매/사용/재고가 저장된 칼럼 문자와 1:1로 읽히지 않을 수 있습니다'
  );

  checkSource(
    inventoryMappingPanelText.includes("const SUFFIXES = ['purchase', 'usage', 'inventory'];") &&
      inventoryMappingPanelText.includes('setMapping({ ...mapping, [row.key]: e.target.value })') &&
      inventoryMappingPanelText.includes('sampleRowData[colKey]') &&
      !inventoryMappingPanelText.includes('nextColIdx') &&
      !inventoryMappingPanelText.includes('alphabet.indexOf'),
    '약품/키트 매핑 UI 직접 선택 계약 유지',
    '약품/키트 매핑 UI에 다음 칼럼 자동선택 또는 비직접 매핑 로직이 들어갔습니다'
  );

  checkSource(
    mappingServiceText.includes("const rawValue = toRoundedNumber(getRangeCell(rows, r, cols.raw || ''), null);") &&
      mappingServiceText.includes("const calcFlow = toRoundedNumber(getRangeCell(rows, r, cols.flow || ''), null);") &&
      flowMappingPanelText.includes("row.key.endsWith('_raw')") &&
      flowMappingPanelText.includes("row.key.replace('_raw', '_flow')") &&
      flowMappingPanelText.includes('alphabet[nextColIdx + 1]'),
    '유량 매핑 UI 편의 기능과 1:1 임포트 계약 유지',
    '유량 raw/flow 저장 칼럼 직접 임포트 또는 raw→flow UI 편의 기능 계약이 깨졌습니다'
  );

  checkSource(
    excelCellMapperText.includes('const end = start + 30;') &&
      excelCellMapperText.includes('onStartRowChange?.(start, end);') &&
      excelCellMapperText.includes('onEndRowChange?.(end);') &&
      !excelCellMapperText.includes('setMapping'),
    '엑셀 시작/종료 행 위젯이 칼럼 매핑을 건드리지 않는 계약 유지',
    '엑셀 행 범위 위젯이 칼럼 매핑 상태를 변경할 수 있습니다'
  );

  checkSource(
    useMappingSettingsText.includes('SettingsModel.getImportProgress(type)') &&
      settingsRoutesText.includes('importProgressByType') &&
      settingsRoutesText.includes("flow: createIdleImportProgress()") &&
      settingsRoutesText.includes("kit: createIdleImportProgress()") &&
      settingsRoutesText.includes("medicine: createIdleImportProgress()") &&
      settingsRoutesText.includes("water: createIdleImportProgress()") &&
      settingsRoutesText.includes("setImportProgress('flow'") &&
      settingsRoutesText.includes("setImportProgress('kit'") &&
      settingsRoutesText.includes("setImportProgress('medicine'") &&
      settingsRoutesText.includes("setImportProgress('water'"),
    '엑셀 임포트 진행률 타입별 분리 계약 유지',
    '엑셀 임포트 진행률이 타입별로 분리되지 않아 매핑 저장 결과가 섞일 수 있습니다'
  );

  checkSource(
    basicSitePanelText.includes('BasicSiteHeaderPanel') &&
      basicSitePanelText.includes('ItemManagementPanel') &&
      basicSitePanelText.includes('MeasurementPlacePanel') &&
      basicSitePanelText.includes('TemplateFilePanel') &&
      appSettingsServiceText.includes('UPDATE app_settings') &&
      appSettingsServiceText.includes('SET site_id = COALESCE(NULLIF(?, \'\'), site_id)') &&
      appSettingsServiceText.includes('UPDATE config_items SET is_active = ?, display_order = ?') &&
      appSettingsServiceText.includes('INSERT OR IGNORE INTO config_items'),
    '기본정보 저장 위젯 및 설정 저장 계약 유지',
    '기본정보 저장 위젯 구성 또는 설정 저장 계약이 바뀌었습니다'
  );

  checkSource(
    electronBuilderConfigText.includes("'templates/**/*'") &&
      electronBuilderConfigText.includes("{ from: 'templates', to: 'templates' }") &&
      reportTemplateText.includes("'일일업무일지(A2O)'") &&
      reportTemplateText.includes("'일일업무일지(MBR)'") &&
      reportTemplateText.includes('process.resourcesPath') &&
      reportTemplateText.includes('syncBundledTemplatesToAppData') &&
      reportTemplateText.includes('shouldReplacePlaceholder'),
    '일지 양식 패키징 및 AppData 동기화 계약 유지',
    '일지 양식이 패키지 리소스에 포함되거나 AppData로 동기화되는 계약이 깨졌습니다'
  );

  checkSource(
    sitesSheetsServiceText.includes("const SITE_LOCATIONS_SHEET_NAME = 'Wastewater_Site_Locations';") &&
      sitesSheetsServiceText.includes("const SITE_LOCATIONS_HEADER_ROW = ['id', 'site_name', 'target_lat', 'target_lng', 'radius_m', 'map_url', 'notes'];") &&
      sitesSheetsServiceText.includes('function rowToSiteLocation') &&
      sitesSheetsServiceText.includes('async function getSiteLocationSettings') &&
      sitesSheetsServiceText.includes('locationSettings.byId.get') &&
      sitesSheetsServiceText.includes('target_lat: location?.target_lat ?? site.target_lat') &&
      siteSettingsServiceText.includes('target_lat: site.target_lat') &&
      siteSettingsServiceText.includes('target_lat: matched.target_lat'),
    '구글시트 현장 위치 좌표 병합 계약 유지',
    'Wastewater_Site_Locations 시트의 target_lat/target_lng/radius_m 병합 로직이 깨졌습니다'
  );

  checkSource(
    waterQualityRoutesText.includes("status: 'processing'") &&
      waterQualityRoutesText.includes('res.status(202).json') &&
      waterQualityRoutesText.includes('void (async () =>') &&
      waterQualityRoutesText.includes("status: 'completed'") &&
      waterQualityRoutesText.includes('result: completedResult') &&
      waterQualityViewModelText.includes('WaterQualityModel.fetchRangeImportProgress()') &&
      waterQualityViewModelText.includes("progress.status === 'completed'") &&
      waterQualityViewText.includes('handleImportRangeFromQntech(startDate, endDate') &&
      !waterQualityViewText.includes('datesToImport'),
    'QnTECH 기간 가져오기가 창 상태와 무관한 서버 백그라운드 작업으로 유지됨',
    'QnTECH 기간 가져오기가 다시 렌더러 날짜 반복에 의존하거나 서버 작업 상태 계약이 깨졌습니다'
  );

  const roadworkContractText = readText(path.join(BASE_DIR, 'ROADWORK_HELPER_CONTRACT.md'));
  const roadworkModelText = readText(path.join(BASE_DIR, 'src', 'features', 'roadwork-helper', 'RoadworkHelperModel.js'));
  const roadworkViewModelText = readText(path.join(BASE_DIR, 'src', 'features', 'roadwork-helper', 'useRoadworkHelperViewModel.js'));
  const roadworkViewText = readText(path.join(BASE_DIR, 'src', 'features', 'roadwork-helper', 'RoadworkHelperView.jsx'));

  checkSource(
    roadworkContractText.includes('Auto-fill may populate only a newly editable daily-log screen') &&
      roadworkContractText.includes("must never invoke the roadwork site's save action") &&
      roadworkContractText.includes('A date mismatch must disable auto-fill') &&
      roadworkContractText.includes('GET /api/roadwork-helper/all?date=YYYY-MM-DD'),
    '공사입력 도우미 보호 계약 문서 유지',
    'ROADWORK_HELPER_CONTRACT.md의 핵심 보호 문구가 누락되었습니다'
  );

  checkSource(
    roadworkModelText.includes("apiClient.get('/api/roadwork-helper/all', { date })") &&
      roadworkViewModelText.includes('flow: res.flow || []') &&
      roadworkViewModelText.includes('electricity: res.electricity || []') &&
      roadworkViewModelText.includes('medicine: res.medicine || []') &&
      roadworkViewModelText.includes('navigator.clipboard.writeText'),
    '공사입력 도우미 Model/ViewModel 데이터 계약 유지',
    '공사입력 도우미의 일괄 조회 또는 안전한 데이터 정규화 계약이 깨졌습니다'
  );

  checkSource(
    roadworkViewText.includes('nodeintegration="false"') &&
      roadworkViewText.includes('enableremotemodule="false"') &&
      roadworkViewText.includes('roadworkStatus.date !== vm.date') &&
      roadworkViewText.includes('RoadworkHelperModel.fetchAll(roadworkStatus.date)') &&
      roadworkViewText.includes("document.getElementById('btn_Save')") &&
      !roadworkViewText.includes('saveButton.click'),
    '공사입력 도우미 웹뷰·날짜·비저장 보호 계약 유지',
    '공사입력 도우미가 웹뷰 보안, 날짜 불일치 차단 또는 비저장 원칙을 위반할 수 있습니다'
  );

  checkSource(
    roadworkHelperRoutesText.includes("router.get('/api/roadwork-helper/all'") &&
      roadworkHelperRoutesText.includes('flow') &&
      roadworkHelperRoutesText.includes('electricity') &&
      roadworkHelperRoutesText.includes('inventory') &&
      roadworkHelperRoutesText.includes('medicine'),
    '공사입력 도우미 서버 일괄 조회 계약 유지',
    '공사입력 도우미 서버의 /all 구성 데이터 계약이 깨졌습니다'
  );
}

function validateAuthSessionContract() {
  console.log(`\n${colors.blue}▶ Auth/session/attendance contract validation${colors.reset}`);
  try {
    execSync('node scripts/validate-auth-contract.cjs', {
      cwd: BASE_DIR,
      stdio: 'inherit',
    });
    success('Auth/session/attendance contract validation passed');
  } catch (e) {
    error('Auth/session/attendance contract validation failed');
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
  const resourcesPath = path.dirname(asarPath);
  
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
      'server/config/bigquery-service-account.json',
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

    validateReportTemplateFiles(resourcesPath, '패키지 리소스');
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
  validateInstallerProcessGuardContract();
  validateNativeModuleReleaseContract();
  validateInstallerNamingPolicy();
  validateRegressionContracts();
  validateAuthSessionContract();
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
