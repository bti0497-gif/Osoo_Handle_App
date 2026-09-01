'use strict';

/**
 * 레이아웃 계약 검사 (LAYOUT_CONTRACT.md 기반).
 * - 고정 셸: Header/Header 영역, Sidebar, main-content-workspace, StatusBar 유지
 * - feature root: width 100%, min-width 0, min-height 0
 * - 수평 overflow, 화면 밖 요소, 넓은 표의 내부 스크롤
 * 픽셀 비교 없이 DOM 위치·크기·overflow로 판정한다(§Phase 4).
 */

const SHELL_SELECTORS = {
  shell: '.app-shell',
  sidebar: 'aside.sidebar',
  workspace: '.main-content-workspace',
  statusBar: 'footer.status-bar',
};

async function isVisible(page, selector) {
  try {
    const element = await page.$(selector);
    if (!element) return { found: false, visible: false };
    const visible = await element.isVisible();
    return { found: true, visible };
  } catch (_) {
    return { found: false, visible: false };
  }
}

/** 문서 수평 overflow 여부. */
async function hasHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

/** 화면 밖으로 나간 버튼/주요 인터랙션 요소. */
async function findOffscreenInteractives(page) {
  return page.evaluate(() => {
    const offenders = [];
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    for (const element of document.querySelectorAll('button, [role="button"], input, select, a[href]')) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.right > width + 2 || rect.bottom > height + 2) {
        offenders.push(`${element.tagName}.${String(element.className).slice(0, 40)} right=${Math.round(rect.right)} bottom=${Math.round(rect.bottom)}`);
      }
      if (offenders.length >= 5) break;
    }
    return offenders;
  });
}

/** 워크스페이스 바로 아래 feature root의 계약(너비 채움, min-width/height 0) 검사. */
async function checkFeatureRoot(page) {
  return page.evaluate(() => {
    const workspace = document.querySelector('.main-content-workspace');
    if (!workspace) return { found: false };
    const root = workspace.firstElementChild;
    if (!root) return { found: false };
    const style = getComputedStyle(root);
    const wsRect = workspace.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    return {
      found: true,
      tag: root.tagName,
      cls: String(root.className).slice(0, 50),
      fillsWidth: Math.abs(rootRect.width - wsRect.width) <= 2,
      minWidthZero: style.minWidth === '0px',
      minHeightZero: style.minHeight === '0px',
    };
  });
}

/** 넓은 표가 내부 스크롤 컨테이너를 갖는지 검사(표가 있을 때만 판정). */
async function checkWideTableScroll(page) {
  return page.evaluate(() => {
    const workspace = document.querySelector('.main-content-workspace');
    if (!workspace) return { hasTable: false };
    const table = workspace.querySelector('table');
    if (!table) return { hasTable: false };
    const wsRect = workspace.getBoundingClientRect();
    const tableWidth = table.scrollWidth;
    if (tableWidth <= wsRect.width) return { hasTable: true, overflowing: false };
    let node = table.parentElement;
    while (node && node !== workspace) {
      const style = getComputedStyle(node);
      if (style.overflowX === 'auto' || style.overflowX === 'scroll' || style.overflow === 'auto' || style.overflow === 'scroll') {
        return { hasTable: true, overflowing: false, scrollContainer: String(node.className).slice(0, 50) };
      }
      node = node.parentElement;
    }
    return { hasTable: true, overflowing: true };
  });
}

/**
 * 하나의 화면에 대한 레이아웃 계약 검사 묶음.
 * requireShell=false이면(로그인 등 셸 없는 화면) 셸 검사를 생략한다.
 */
async function runLayoutChecks(page, { requireShell = true, label = '' } = {}) {
  const failures = [];
  const details = {};

  const horizontal = await hasHorizontalOverflow(page);
  if (horizontal) failures.push(`수평 overflow 발생 (${label})`);

  const offscreen = await findOffscreenInteractives(page);
  if (offscreen.length > 0) failures.push(`화면 밖 인터랙션 요소: ${offscreen.join(' / ')}`);

  if (requireShell) {
    for (const [name, selector] of Object.entries(SHELL_SELECTORS)) {
      const state = await isVisible(page, selector);
      details[name] = state;
      if (!state.found || !state.visible) failures.push(`셸 요소 누락: ${name}(${selector})`);
    }
    const root = await checkFeatureRoot(page);
    details.featureRoot = root;
    if (!root.found) failures.push('feature root를 찾을 수 없습니다');
    else {
      if (!root.fillsWidth) failures.push('feature root가 workspace 너비를 채우지 않음');
      if (!root.minWidthZero) failures.push('feature root min-width가 0이 아님');
      if (!root.minHeightZero) failures.push('feature root min-height가 0이 아님');
    }
    const table = await checkWideTableScroll(page);
    details.wideTable = table;
    if (table.hasTable && table.overflowing) failures.push('넓은 표가 내부 스크롤 컨테이너 없이 넘침');
  }

  return { ok: failures.length === 0, failures, details };
}

module.exports = {
  runLayoutChecks,
  hasHorizontalOverflow,
  checkFeatureRoot,
  checkWideTableScroll,
  SHELL_SELECTORS,
};
