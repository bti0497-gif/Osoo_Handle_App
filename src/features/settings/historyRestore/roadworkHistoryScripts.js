const findDailyWindowSource = `
  const windows = [];
  const visit = (target) => {
    if (!target || windows.includes(target)) return;
    windows.push(target);
    let frames = [];
    try { frames = Array.from(target.document?.querySelectorAll('iframe, frame') || []); } catch { return; }
    for (const frame of frames) {
      try { if (frame.contentWindow) visit(frame.contentWindow); } catch {}
    }
  };
  visit(window);
  const daily = windows.find((target) => {
    try {
      return Boolean(
        target.grd_01
        || target.document?.getElementById('grd_01_body_table')
        || target.document?.getElementById('ipt_FromDay_input')
      );
    } catch {
      return false;
    }
  });
`;

export const ROADWORK_RESTORE_STATUS_SCRIPT = `
(() => {
  ${findDailyWindowSource}
  const currentUrl = String(location.href || '');
  const loginVisible = windows.some((target) => {
    try {
      return /\\/security\\/login\\.do/i.test(String(target.location?.href || ''))
        || Boolean(target.document?.querySelector('input[type="password"]'));
    } catch {
      return false;
    }
  });
  if (loginVisible) {
    return { authenticated: false, dailyScreenReady: false, reason: 'login-required', currentUrl };
  }
  if (!daily) {
    return { authenticated: true, dailyScreenReady: false, reason: 'daily-screen-required', currentUrl };
  }
  const grid = daily.grd_01;
  let rowCount = 0;
  let handlerNames = [];
  let gridSelectionMethods = [];
  let firstCellId = '';
  try {
    const candidate = grid?.getDataList?.();
    const dataList = typeof candidate === 'string'
      ? daily[candidate] || daily.WebSquare?.util?.getComponentById?.(candidate)
      : candidate;
    rowCount = Number(dataList?.getRowCount?.() || grid?.getRowCount?.() || 0);
    handlerNames = Object.keys(daily.scwin || daily)
      .filter((name) => /grd_01/i.test(name) && typeof (daily.scwin || daily)[name] === 'function')
      .sort();
    const candidates = ['setFocusedCell', 'setSelectedIndex', 'click', 'bodyClick', 'callSelectedAPI', 'getFocusedRowIndex', 'getSelectedIndex'];
    gridSelectionMethods = candidates.filter((name) => typeof grid?.[name] === 'function');
    firstCellId = daily.document?.querySelector('[id^="grd_01_cell_"]')?.id || '';
  } catch {}
  return {
    authenticated: true,
    dailyScreenReady: true,
    reason: 'ready',
    rowCount,
    currentUrl,
    handlerNames,
    gridSelectionMethods,
    firstCellId,
  };
})()
`;

export function buildRoadworkHistoryListScript() {
  return `
(async () => {
  ${findDailyWindowSource}
  if (!daily) return { success: false, code: 'DAILY_SCREEN_REQUIRED', message: '일일업무 조회 화면을 먼저 열어주세요.' };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalizeDate = (value) => {
    const digits = String(value || '').replace(/\\D/g, '').slice(0, 8);
    return digits.length === 8 ? digits.slice(0, 4) + '-' + digits.slice(4, 6) + '-' + digits.slice(6, 8) : '';
  };
  const component = (id) => {
    try { return daily[id] || daily.WebSquare?.util?.getComponentById?.(id) || null; } catch { return null; }
  };
  const setValue = (id, value) => {
    const item = component(id);
    const input = daily.document?.getElementById(id + '_input') || daily.document?.getElementById(id);
    try { item?.setValue?.(value); } catch {}
    if (input && 'value' in input) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };
  const getDataList = (grid) => {
    try {
      const candidate = grid?.getDataList?.();
      return typeof candidate === 'string' ? component(candidate) : candidate;
    } catch { return null; }
  };
  const getRows = () => {
    const grid = component('grd_01');
    const dataList = getDataList(grid);
    const count = Number(dataList?.getRowCount?.() || dataList?.getTotalRow?.() || 0);
    const rows = [];
    for (let index = 0; index < count; index += 1) {
      let row = {};
      try { row = dataList?.getRowJSON?.(index) || dataList?.getRowData?.(index) || {}; } catch {}
      rows.push({
        index,
        registeredAt: normalizeDate(row.fsttmRgstDttm || row.lsttmAltrDttm || ''),
        documentKey: String(row.svarMgmtDocNo || ''),
        approvalStatus: String(row.aprvStatCdText || row.aprvStatCd || ''),
      });
    }
    return rows;
  };

  let rows = getRows();
  let stableCount = 0;
  let previousSignature = '';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(250);
    rows = getRows();
    const signature = rows.map((row) => row.documentKey).join('|');
    if (signature && signature === previousSignature) stableCount += 1;
    else stableCount = 0;
    previousSignature = signature;
    if (stableCount >= 3) break;
  }
  return {
    success: true,
    count: rows.length,
    rows,
  };
})()
`;
}

export function buildRoadworkHistoryPreviewScript(rows) {
  const safeRows = (Array.isArray(rows) ? rows : []).map((row) => ({
    index: Number(row.index),
    documentKey: String(row.documentKey || ''),
    registeredAt: String(row.registeredAt || ''),
  }));
  return `
(async () => {
  ${findDailyWindowSource}
  if (!daily) return { success: false, code: 'DAILY_SCREEN_REQUIRED', message: '일일업무 조회 화면을 먼저 열어주세요.' };
  const targets = ${JSON.stringify(safeRows)};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const component = (id) => {
    try { return daily[id] || daily.WebSquare?.util?.getComponentById?.(id) || null; } catch { return null; }
  };
  const getDataList = (grid) => {
    try {
      const candidate = grid?.getDataList?.();
      return typeof candidate === 'string' ? component(candidate) : candidate;
    } catch { return null; }
  };
  const readRows = (gridId) => {
    const dataList = getDataList(component(gridId));
    const count = Number(dataList?.getRowCount?.() || dataList?.getTotalRow?.() || 0);
    const result = [];
    for (let index = 0; index < count; index += 1) {
      try { result.push(dataList?.getRowJSON?.(index) || dataList?.getRowData?.(index) || {}); } catch { result.push({}); }
    }
    return result;
  };
  const normalizeDate = (value) => {
    const digits = String(value || '').replace(/\\D/g, '').slice(0, 8);
    return digits.length === 8 ? digits.slice(0, 4) + '-' + digits.slice(4, 6) + '-' + digits.slice(6, 8) : '';
  };
  const detailDate = () => normalizeDate(
    component('regDate')?.getValue?.()
    || daily.document?.getElementById('regDate_input')?.value
    || ''
  );
  const detailKey = () => {
    const first = readRows('DalyOpDllgPros')[0] || readRows('DalyOpDllgChmc')[0] || {};
    return String(first.svarMgmtDocNo || '');
  };
  const readValue = (id) => {
    const item = component(id);
    const element = daily.document?.getElementById(id + '_input') || daily.document?.getElementById(id);
    try { return item?.getValue?.() ?? element?.value ?? ''; } catch { return element?.value ?? ''; }
  };
  const selectRow = async (target) => {
    const grid = component('grd_01');
    const beforeKey = detailKey();
    const beforeDate = detailDate();
    const cell = daily.document?.getElementById('grd_01_cell_' + target.index + '_0')
      || daily.document?.querySelector('#grd_01_body_tbody tr:nth-child(' + (target.index + 1) + ') td');
    let invoked = false;
    try {
      grid?.setFocusedCell?.(target.index, 0, false);
      const onCellClick = daily.scwin?.grd_01_oncellclick
        || daily.grd_01_oncellclick;
      if (typeof onCellClick === 'function') {
        onCellClick.call(daily.scwin || daily, target.index, 0);
        invoked = true;
      }
    } catch {}
    if (!invoked) {
      try {
        grid?.click?.(target.index, 0);
        invoked = true;
      } catch {}
    }
    if (!invoked && cell) {
      cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: daily }));
      cell.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: daily }));
      cell.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: daily }));
      invoked = true;
    }
    if (!invoked) return { success: false, code: 'ROW_SELECT_FAILED' };

    for (let attempt = 0; attempt < 40; attempt += 1) {
      await sleep(200);
      const nextKey = detailKey();
      const nextDate = detailDate();
      if ((target.registeredAt && nextDate === target.registeredAt)
        || (target.documentKey && nextKey && nextKey === target.documentKey)
        || (!target.documentKey && !target.registeredAt && nextDate && (nextDate !== beforeDate || nextKey !== beforeKey))) {
        return { success: true, date: nextDate, documentKey: nextKey };
      }
    }
    return {
      success: false,
      code: 'DETAIL_BIND_TIMEOUT',
      targetDocumentKey: target.documentKey,
      beforeDocumentKey: beforeKey,
      afterDocumentKey: detailKey(),
      beforeDate,
      afterDate: detailDate(),
    };
  };

  const documents = [];
  const errors = [];
  for (let offset = 0; offset < targets.length; offset += 1) {
    const target = targets[offset];
    const selected = await selectRow(target);
    if (!selected.success) {
      errors.push({
        index: target.index,
        documentKey: target.documentKey,
        code: selected.code,
        targetDocumentKey: selected.targetDocumentKey || target.documentKey,
        beforeDocumentKey: selected.beforeDocumentKey || '',
        afterDocumentKey: selected.afterDocumentKey || '',
        beforeDate: selected.beforeDate || '',
        afterDate: selected.afterDate || '',
      });
      return { success: documents.length > 0, count: documents.length, documents, errors, fatal: selected.code || 'DETAIL_READ_FAILED' };
    }
    documents.push({
      date: selected.date || target.registeredAt,
      documentKey: selected.documentKey || target.documentKey,
      flow: readRows('DalyOpDllgPros'),
      chemicals: readRows('DalyOpDllgChmc'),
      electricity: {
        previousReading: readValue('prvdElpwMsrmVal'),
        todayReading: readValue('tdayElpwMsrmVal'),
        usage: readValue('elpwUsmn'),
      },
    });
  }
  return { success: documents.length > 0, count: documents.length, documents, errors };
})()
`;
}
