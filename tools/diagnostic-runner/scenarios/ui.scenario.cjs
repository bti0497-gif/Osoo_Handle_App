'use strict';

/**
 * UI 시나리오: 로그인 → 메인 셸 → 메뉴 진입 → viewport별 레이아웃 계약 검사(§Phase 4).
 * 브라우저/Vite 수명은 러너(runner.cjs --ui)가 관리하고, 이 모듈은 화면 검증만 담당한다.
 */

const { runLayoutChecks } = require('../playwright/layout-checks.cjs');
const { capture } = require('../playwright/screenshots.cjs');

const RELEASE_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
];
const REFERENCE_VIEWPORT = { width: 390, height: 844 };

function createRecorder() {
  const steps = [];
  return {
    steps,
    async step(name, fn) {
      const startedAt = Date.now();
      try {
        const details = await fn();
        steps.push({ name, status: 'passed', durationMs: Date.now() - startedAt, ...(details ? { details } : {}) });
        console.log(`    [PASS] ${name} (${Date.now() - startedAt}ms)`);
        return true;
      } catch (error) {
        steps.push({
          name,
          status: 'failed',
          durationMs: Date.now() - startedAt,
          errorCode: error.errorCode || 'UI_STEP_FAILED',
          message: String(error.message).slice(0, 400),
          ...(error.details ? { details: error.details } : {}),
        });
        console.log(`    [FAIL] ${name} — ${error.errorCode || ''} ${String(error.message).slice(0, 120)}`);
        return false;
      }
    },
  };
}

/**
 * UI 시나리오 실행. 반환: { steps, uiDiag, shimViolations }
 */
async function runUiScenario({ page, uiDiag, screenshotsDir, viteUrl, siteId, fixtures }) {
  const recorder = createRecorder();
  const fieldUser = fixtures.users.find((user) => user.localLoginAllowed);
  const entryUrl = `${viteUrl}/?siteId=${encodeURIComponent(siteId)}`;

  await recorder.step('login-page-renders', async () => {
    await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 60 * 1000 });
    await page.waitForSelector('.login-card', { timeout: 45 * 1000 });
    await page.waitForSelector('.btn-login-new', { timeout: 10 * 1000 });
  });

  await recorder.step('login-layout', async () => {
    const checks = await runLayoutChecks(page, { requireShell: false, label: 'login' });
    if (!checks.ok) { const e = new Error(checks.failures.join(' / ')); e.details = checks.failures; throw e; }
    await capture(page, screenshotsDir, 'login');
  });

  await recorder.step('login-success', async () => {
    await page.fill('input[placeholder="이름"]', fieldUser.name);
    await page.fill('input[placeholder="비밀번호"]', fieldUser.password);
    await page.click('.btn-login-new');
    await page.waitForSelector('.app-shell', { timeout: 45 * 1000 });
  });

  await recorder.step('shell-contract', async () => {
    const checks = await runLayoutChecks(page, { requireShell: true, label: 'shell' });
    if (!checks.ok) { const e = new Error(checks.failures.join(' / ')); e.details = checks.failures; throw e; }
    await capture(page, screenshotsDir, 'shell');
  });

  await recorder.step('menu-navigation-water-quality', async () => {
    await page.getByText('수질관리', { exact: true }).first().click();
    await page.getByText('수질분석', { exact: true }).first().click();
    await page.waitForTimeout(800);
    const checks = await runLayoutChecks(page, { requireShell: true, label: '수질분석' });
    if (!checks.ok) { const e = new Error(checks.failures.join(' / ')); e.details = checks.failures; throw e; }
    await capture(page, screenshotsDir, 'water-quality');
  });

  await recorder.step('viewport-matrix', async () => {
    const failures = [];
    const notes = [];
    for (const viewport of RELEASE_VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(500);
      const checks = await runLayoutChecks(page, { requireShell: true, label: `${viewport.width}x${viewport.height}` });
      await capture(page, screenshotsDir, `viewport-${viewport.width}x${viewport.height}`);
      if (!checks.ok) failures.push(`${viewport.width}x${viewport.height}: ${checks.failures.join(' / ')}`);
    }
    // 모바일 390x844는 참고용 경고 검사(릴리즈 실패 기준 아님, §Phase 4).
    await page.setViewportSize(REFERENCE_VIEWPORT);
    await page.waitForTimeout(500);
    const mobileChecks = await runLayoutChecks(page, { requireShell: true, label: 'mobile-참고용' });
    await capture(page, screenshotsDir, 'viewport-390x844-참고용');
    if (!mobileChecks.ok) notes.push(`모바일(참고용): ${mobileChecks.failures.join(' / ')}`);
    await page.setViewportSize({ width: 1440, height: 900 });
    if (failures.length > 0) {
      const error = new Error(failures.join(' / '));
      error.errorCode = 'VIEWPORT_LAYOUT_BROKEN';
      error.details = { failures, notes };
      throw error;
    }
    return { notes };
  });

  await recorder.step('browser-console-clean', async () => {
    if (uiDiag.consoleErrors.length > 0 || uiDiag.pageErrors.length > 0) {
      const error = new Error(`콘솔 오류 ${uiDiag.consoleErrors.length}건 / 페이지 오류 ${uiDiag.pageErrors.length}건`);
      error.errorCode = 'BROWSER_ERRORS';
      error.details = { consoleErrors: uiDiag.consoleErrors.slice(0, 5), pageErrors: uiDiag.pageErrors.slice(0, 5) };
      throw error;
    }
  });

  await recorder.step('network-requests-clean', async () => {
    if (uiDiag.requestFailures.length > 0) {
      const error = new Error(`실패한 요청 ${uiDiag.requestFailures.length}건 (차단 분제 제외)`);
      error.errorCode = 'REQUEST_FAILURES';
      error.details = { samples: uiDiag.requestFailures.slice(0, 5) };
      throw error;
    }
  });

  return { steps: recorder.steps };
}

module.exports = { runUiScenario, RELEASE_VIEWPORTS, REFERENCE_VIEWPORT };
