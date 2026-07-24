import React, { useEffect, useRef, useState } from 'react';
import { useRoadworkHelperViewModel } from './useRoadworkHelperViewModel';
import { RoadworkHelperModel } from './RoadworkHelperModel';
import './components/RoadworkHelperModal.css';

const DEFAULT_ROADWORK_URL = 'https://nwpo.ex.co.kr:5002/security/login.do';

const ROADWORK_KEEP_ALIVE_SCRIPT = `
(() => {
  const url = new URL('/websquare/websquare.jsp', location.origin);
  url.searchParams.set('roadworkKeepAlive', Date.now());
  return fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  }).then(() => true).catch(() => false);
})()
`;

const ROADWORK_STATUS_SCRIPT = `
(() => {
  const normalizeDate = (value) => {
    const text = String(value || '').trim();
    const match = text.match(/(20\\d{2})\\D?(\\d{2})\\D?(\\d{2})/);
    return match ? match.slice(1, 4).join('-') : '';
  };

  const isVisible = (element) => {
    if (!element) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.offsetParent !== null;
  };

  const getDailyWindow = () => {
    const windows = [];
    const visit = (target) => {
      if (!target || windows.includes(target)) return;
      windows.push(target);
      let frames = [];
      try {
        frames = Array.from(target.document?.querySelectorAll('iframe, webview') || []);
      } catch {
        return;
      }
      for (const frame of frames) {
        try {
          if (frame.contentWindow) visit(frame.contentWindow);
        } catch {
          // Ignore cross-origin frames.
        }
      }
    };
    visit(window);
    return windows.find((target) => {
      try {
        return Boolean(
          target.document?.getElementById('DalyOpDllgPros')
          || target.document?.getElementById('regDate_input')
          || target.document?.getElementById('regDate')
          || target.DalyOpDllgPros
          || target.regDate
        );
      } catch {
        return false;
      }
    });
  };

  const daily = getDailyWindow();
  if (!daily) {
    return { isDailyLog: false, canAutoFill: false, date: '', isEditableDate: false };
  }

  const saveButton = daily.document.getElementById('btn_Save');
  const dateInput = daily.document.getElementById('regDate_input') || daily.document.getElementById('regDate');
  const date = normalizeDate(
    daily.regDate?.getValue?.()
    || dateInput?.value
    || dateInput?.innerText
  );
  const componentDisabled = Boolean(
    daily.regDate?.getDisabled?.()
    || daily.regDate?.getReadOnly?.()
    || daily.regDate?.disabled
  );
  const inputDisabled = Boolean(
    dateInput?.disabled
    || dateInput?.getAttribute?.('disabled') !== null
    || dateInput?.getAttribute?.('aria-disabled') === 'true'
    || dateInput?.closest?.('.w2input_disabled,.w2calendar_disabled,.disabled')
  );
  const isEditableDate = Boolean(date && !componentDisabled && !inputDisabled);

  return {
    isDailyLog: true,
    canAutoFill: isVisible(saveButton) && isEditableDate,
    date,
    isEditableDate,
  };
})()
`;

const ROADWORK_STRUCTURE_SCRIPT = `
(() => {
  const clean = (value, max = 120) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, max);
  const safePath = (target) => {
    try { return new URL(target.location.href).pathname; } catch { return ''; }
  };
  const describe = (element, includeText = true) => ({
    tag: String(element?.tagName || '').toLowerCase(),
    id: clean(element?.id, 100),
    name: clean(element?.getAttribute?.('name'), 100),
    role: clean(element?.getAttribute?.('role'), 60),
    type: clean(element?.getAttribute?.('type'), 40),
    className: clean(element?.className, 140),
    ariaLabel: clean(element?.getAttribute?.('aria-label'), 100),
    text: includeText ? clean(element?.innerText || element?.textContent, 100) : '',
  });
  const methodNames = (target, pattern) => {
    if (!target) return [];
    const names = new Set();
    let current = target;
    for (let depth = 0; current && depth < 5; depth += 1) {
      for (const name of Object.getOwnPropertyNames(current)) {
        try {
          if (pattern.test(name) && typeof target[name] === 'function') names.add(name);
        } catch {}
      }
      current = Object.getPrototypeOf(current);
    }
    return Array.from(names).sort().slice(0, 100);
  };
  const componentById = (target, id) => {
    try {
      return target[id]
        || target.WebSquare?.util?.getComponentById?.(id)
        || null;
    } catch {
      return null;
    }
  };
  const getDataList = (target, grid) => {
    try {
      const candidate = grid?.getDataList?.();
      if (!candidate) return null;
      return typeof candidate === 'string' ? componentById(target, candidate) : candidate;
    } catch {
      return null;
    }
  };
  const rowKeys = (dataList) => {
    try {
      const row = dataList?.getRowJSON?.(0) || dataList?.getRowData?.(0);
      return row && typeof row === 'object' ? Object.keys(row).sort().slice(0, 100) : [];
    } catch {
      return [];
    }
  };
  const componentProbe = (target, id) => {
    const component = componentById(target, id);
    const dataList = getDataList(target, component);
    const count = (source) => {
      try { return Number(source?.getRowCount?.() ?? source?.getTotalRow?.() ?? 0) || 0; } catch { return 0; }
    };
    return {
      id,
      found: Boolean(component),
      dataListFound: Boolean(dataList),
      componentMethods: methodNames(component, /row|cell|select|click|data|event|focus/i),
      dataListMethods: methodNames(dataList, /row|cell|column|data|value|filter/i),
      componentRowCount: count(component),
      dataListRowCount: count(dataList),
      firstRowKeys: rowKeys(dataList),
    };
  };
  const pages = [];
  const visited = [];
  const visit = (target, depth = 0) => {
    if (!target || visited.includes(target) || depth > 5) return;
    visited.push(target);
    let doc;
    try { doc = target.document; } catch { return; }
    if (!doc) return;
    const tables = Array.from(doc.querySelectorAll('table')).slice(0, 40).map((table) => ({
      id: clean(table.id, 100),
      className: clean(table.className, 140),
      rowCount: table.querySelectorAll('tbody tr').length,
      headers: Array.from(table.querySelectorAll('thead th, thead td, tr:first-child th'))
        .slice(0, 30).map((cell) => clean(cell.innerText || cell.textContent, 80)).filter(Boolean),
    }));
    const controls = Array.from(doc.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="grid"], [role="row"]'))
      .filter((element) => element.id || element.getAttribute('name') || element.getAttribute('role') || element.tagName === 'BUTTON')
      .slice(0, 500)
      .map(describe);
    const likelyComponents = Array.from(doc.querySelectorAll('[id]'))
      .filter((element) => /(grid|list|search|select|detail|date|day|daly|opdllg|pros|chmc|regdate)/i.test(element.id))
      .slice(0, 500)
      .map((element) => describe(element, false));
    const frames = Array.from(doc.querySelectorAll('iframe, frame')).map((frame) => describe(frame));
    const apiProbe = [
      'grd_01',
      'regDate',
      'DalyOpDllgPros',
      'DalyOpDllgChmc',
    ].map((id) => componentProbe(target, id)).filter((item) => item.found);
    pages.push({
      depth,
      path: safePath(target),
      title: clean(doc.title, 120),
      bodyId: clean(doc.body?.id, 100),
      tables,
      controls,
      likelyComponents,
      apiProbe,
      frames,
    });
    for (const frame of doc.querySelectorAll('iframe, frame')) {
      try { visit(frame.contentWindow, depth + 1); } catch {}
    }
  };
  visit(window);
  return { pages };
})()
`;

function buildRoadworkAutoFillScriptV2(payload) {
  return `
(() => {
  const payload = ${JSON.stringify(payload)};
  const toText = (value) => {
    if (value === null || value === undefined || value === '') return '';
    const n = Number(value);
    if (Number.isFinite(n)) return String(Math.round(n * 10) / 10);
    return String(value);
  };
  const normalize = (value) => String(value || '')
    .replace(/[₀⁰]/g, '0')
    .replace(/[₁¹]/g, '1')
    .replace(/[₂²]/g, '2')
    .replace(/[₃³]/g, '3')
    .replace(/[₄⁴]/g, '4')
    .replace(/[₅⁵]/g, '5')
    .replace(/[₆⁶]/g, '6')
    .replace(/[₇⁷]/g, '7')
    .replace(/[₈⁸]/g, '8')
    .replace(/[₉⁹]/g, '9')
    .replace(/[⁻₋－–—]/g, '-')
    .replace(new RegExp(String.fromCharCode(13221), 'g'), '')
    .replace(/[\\s()]/g, '')
    .toLowerCase();
  const ALIASES = {
    '\\uBC29\\uB958\\uC720\\uB7C9\\uACC4': ['\\uBC29\\uB958\\uC720\\uB7C9\\uACC4', '\\uBC29\\uB958\\uC218\\uC720\\uB7C9\\uACC4', '\\uBC29\\uB958\\uC218', '\\uBC29\\uB958\\uB7C9', '\\uBC29\\uB958'],
    '\\uC720\\uC785\\uC720\\uB7C9\\uACC4': ['\\uC720\\uC785\\uC720\\uB7C9\\uACC4', '\\uC720\\uC785\\uC218\\uC720\\uB7C9\\uACC4', '\\uC720\\uC785\\uC218', '\\uC720\\uC785\\uB7C9', '\\uC720\\uC785'],
    '\\uB0B4\\uBD80\\uBC18\\uC1A1\\uC720\\uB7C9\\uACC4': ['\\uB0B4\\uBD80\\uBC18\\uC1A1\\uC720\\uB7C9\\uACC4', '\\uB0B4\\uBD80\\uBC18\\uC1A1', '\\uB0B4\\uBD80\\uBC18\\uC1A1\\uC2AC\\uB7EC\\uC9C0'],
    '\\uC678\\uBD80\\uBC18\\uC1A1\\uC720\\uB7C9\\uACC4': ['\\uC678\\uBD80\\uBC18\\uC1A1\\uC720\\uB7C9\\uACC4', '\\uC678\\uBD80\\uBC18\\uC1A1'],
    '\\uC2AC\\uB7EC\\uC9C0': ['\\uC778\\uBC1C\\uC2AC\\uB7EC\\uC9C0', '\\uC2AC\\uB7EC\\uC9C0\\uBC18\\uCD9C', '\\uC2AC\\uB7EC\\uC9C0\\uBC18\\uCD9C\\uB7C9'],
    '\\uD329(PAC)': ['\\uD329(PAC)', 'PAC', '\\uC751\\uC9D1\\uC81C'],
    '\\uC554\\uBAA8\\uB2C8\\uC544\\uC131\\uC9C8\\uC18C(NH3-N)': ['\\uC554\\uBAA8\\uB2C8\\uC544\\uC131\\uC9C8\\uC18C(NH3-N)', '\\uC554\\uBAA8\\uB2C8\\uC544\\uC131\\uC9C8\\uC18C', 'NH3-N', 'NH\\u2083-N'],
    '\\uC9C8\\uC0B0\\uC131\\uC9C8\\uC18C(NO3-N)': ['\\uC9C8\\uC0B0\\uC131\\uC9C8\\uC18C(NO3-N)', '\\uC9C8\\uC0B0\\uC131\\uC9C8\\uC18C', 'NO3-N', 'NO\\u2083-N', 'NO\\u2083\\u207B-N'],
    '\\uC778\\uC0B0\\uC5FC\\uC778(PO4-P)': ['\\uC778\\uC0B0\\uC5FC\\uC778(PO4-P)', '\\uC778\\uC0B0\\uC5FC\\uC778', 'PO4-P', 'PO\\u2084-P', 'PO\\u2084\\u00B3\\u207B-P'],
    '\\uC54C\\uCE7C\\uB9AC\\uB3C4(ALK)': ['\\uC54C\\uCE7C\\uB9AC\\uB3C4(ALK)', '\\uC54C\\uCE7C\\uB9AC\\uB3C4', 'ALK']
  };
  const getDailyWindow = () => {
    const windows = [];
    const visit = (target) => {
      if (!target || windows.includes(target)) return;
      windows.push(target);
      let frames = [];
      try { frames = Array.from(target.document?.querySelectorAll('iframe, webview') || []); } catch { return; }
      for (const frame of frames) {
        try { if (frame.contentWindow) visit(frame.contentWindow); } catch {}
      }
    };
    visit(window);
    return windows.find((target) => {
      try {
        return Boolean(
          target.document?.getElementById('DalyOpDllgPros')
          || target.document?.getElementById('regDate_input')
          || target.document?.getElementById('regDate')
          || target.DalyOpDllgPros
          || target.regDate
        );
      }
      catch { return false; }
    });
  };
  const daily = getDailyWindow();
  if (!daily) return { success: false, filled: 0, message: 'daily log window not found' };
  const getDataList = (grid) => {
    try {
      const candidate = grid?.getDataList?.();
      if (!candidate) return null;
      if (typeof candidate === 'string') {
        return daily[candidate]
          || daily.WebSquare?.util?.getComponentById?.(candidate)
          || daily.document?.getElementById?.(candidate)
          || null;
      }
      return candidate;
    } catch {
      return null;
    }
  };
  const describeGrid = (gridId) => {
    const grid = daily[gridId];
    const dl = getDataList(grid);
    const gridMethods = grid ? Object.keys(grid).filter((key) => /cell|column|data|row|value/i.test(key)).slice(0, 20) : [];
    const dlMethods = dl ? Object.keys(dl).filter((key) => /cell|column|data|row|value/i.test(key)).slice(0, 20) : [];
    return { gridId, hasGrid: Boolean(grid), hasDataList: Boolean(dl), gridMethods, dlMethods };
  };
  const getDataCell = (dl, row, col) => {
    try { const v = dl?.getCellData?.(row, col); if (v !== undefined && v !== null && String(v).trim() !== '') return v; } catch {}
    try { const v = dl?.getColumnValue?.(row, col); if (v !== undefined && v !== null && String(v).trim() !== '') return v; } catch {}
    try { const r = dl?.getRowJSON?.(row) || dl?.getRowData?.(row); return r?.[col] ?? ''; } catch {}
    return '';
  };
  const rowCount = (gridId) => {
    const grid = daily[gridId];
    const dl = getDataList(grid);
    const dlCount = Number(dl?.getRowCount?.()) || Number(dl?.getTotalRow?.()) || 0;
    if (dlCount) return { data: dlCount, view: Number(grid?.getRowCount?.()) || 0 };
    return { data: 0, view: Number(grid?.getRowCount?.()) || daily.document.querySelectorAll('#' + gridId + '_body_tbody tr').length };
  };
  const aliasesFor = (name) => (ALIASES[name] || [name]).map(normalize).filter(Boolean);
  const COLUMN_INDEX = {
    DalyOpDllgPros: {
      prvdDrwtMsrmVal: 1,
      tdayDrwtMsrmVal: 2,
      drwtProsAmnt: 3,
      drwtProsMnthlCmtlAmnt: 4,
      drwtProsAnulCmtlAmnt: 5
    },
    DalyOpDllgChmc: {
      chmcPuchAmnt: 1,
      chmcUseAmnt: 2,
      chmcUseMnthlCmtlAmnt: 3,
      chmcUseAnulCmtlAmnt: 4,
      chmcRsqnVal: 5
    }
  };
  const findRow = (gridId, itemName, labelCols) => {
    const grid = daily[gridId];
    const dl = getDataList(grid);
    const counts = rowCount(gridId);
    const aliases = aliasesFor(itemName);
    for (let i = 0; i < counts.data; i += 1) {
      const text = normalize(labelCols.map((col) => getDataCell(dl, i, col)).join(' '));
      if (text && aliases.some((a) => text.includes(a) || a.includes(text))) return { viewIndex: i, dataIndex: i };
    }
    const rows = daily.document.querySelectorAll('#' + gridId + '_body_tbody tr');
    for (let i = 0; i < Math.max(counts.view, rows.length); i += 1) {
      const row = rows[i];
      const selector = labelCols.map((col) => '[col_id="' + col + '"]').join(',');
      const text = normalize(row?.querySelector(selector)?.innerText || row?.innerText || '');
      if (!text || !aliases.some((a) => text.includes(a) || a.includes(text))) continue;
      let dataIndex = i;
      try { dataIndex = grid?.getRealRowIndex?.(i) ?? grid?.getDataRowIndex?.(i) ?? i; } catch {}
      return { viewIndex: i, dataIndex };
    }
    return { viewIndex: -1, dataIndex: -1 };
  };
  const setGridCell = (gridId, rowRef, colId, value) => {
    if (value === null || value === undefined || value === '') return false;
    const grid = daily[gridId];
    const dl = getDataList(grid);
    const text = toText(value);
    const viewIndex = Number(rowRef?.viewIndex ?? -1);
    const dataIndex = Number(rowRef?.dataIndex ?? viewIndex);
    if (viewIndex < 0 && dataIndex < 0) return false;
    let wrote = false;
    let verified = false;
    const verifyValue = () => {
      try {
        const v = grid?.getCellData?.(viewIndex, colId);
        if (String(v ?? '').trim() === text) return true;
      } catch {}
      try {
        const v = dl?.getCellData?.(dataIndex, colId);
        if (String(v ?? '').trim() === text) return true;
      } catch {}
      try {
        const v = dl?.getColumnValue?.(dataIndex, colId);
        if (String(v ?? '').trim() === text) return true;
      } catch {}
      return false;
    };
    const calls = [
      () => dl?.setCellData?.(dataIndex, colId, text),
      () => dl?.setColumnValue?.(dataIndex, colId, text)
    ];
    for (const call of calls) {
      try {
        call();
        if (verifyValue()) {
          wrote = true;
          verified = true;
        }
      } catch {}
    }
    if (verified) {
      try { dl?.setRowStatus?.(dataIndex, 'U'); } catch {}
      try { dl?.modifyRowStatus?.(dataIndex, 'U'); } catch {}
      try { grid?.setRowStatus?.(viewIndex, 'U'); } catch {}
    }
    try { grid?.refresh?.(); } catch {}
    try { grid?.reDraw?.(); } catch {}
    return wrote && verified;
  };
  const setInput = (id, value) => {
    if (value === null || value === undefined || value === '') return false;
    const text = toText(value);
    const component = daily[id];
    try { if (component?.setValue) { component.setValue(text); return true; } } catch {}
    const element = daily.document.getElementById(id);
    if (!element) return false;
    element.value = text;
    ['input', 'change', 'blur'].forEach((eventName) => element.dispatchEvent(new Event(eventName, { bubbles: true })));
    return true;
  };
  let filled = 0;
  const missing = [];
  const required = [];
  const workerOk = [
    setInput('totWorkrCnt', 1),
    setInput('workTnop', 1)
  ].every(Boolean);
  required.push('근무자 현황');
  if (workerOk) filled += 1; else missing.push('근무자 현황');
  for (const row of payload.flow || []) {
    const ref = findRow('DalyOpDllgPros', row.item, ['insrIdntIdText', 'column17']);
    const ok = [
      setGridCell('DalyOpDllgPros', ref, 'prvdDrwtMsrmVal', row.previousReading),
      setGridCell('DalyOpDllgPros', ref, 'tdayDrwtMsrmVal', row.todayReading),
      setGridCell('DalyOpDllgPros', ref, 'drwtProsAmnt', row.todayFlow),
      setGridCell('DalyOpDllgPros', ref, 'drwtProsMnthlCmtlAmnt', row.monthTotal),
      setGridCell('DalyOpDllgPros', ref, 'drwtProsAnulCmtlAmnt', row.yearTotal)
    ];
    required.push(row.item);
    if (ok.some(Boolean)) filled += 1; else missing.push(row.item);
  }
  const electricity = (payload.electricity || [])[0];
  let electricityOk = true;
  if (electricity) {
    electricityOk = [
      setInput('prvdElpwMsrmVal', electricity.previousReading),
      setInput('tdayElpwMsrmVal', electricity.todayReading),
      setInput('elpwUsmn', electricity.usage)
    ].every(Boolean);
    required.push(electricity.item || 'electricity');
    if (electricityOk) filled += 1; else missing.push(electricity.item || 'electricity');
  }
  for (const row of [...(payload.medicine || []), ...(payload.kit || [])]) {
    const ref = findRow('DalyOpDllgChmc', row.item, ['chmcClssNmText', 'column29']);
    const ok = [
      setGridCell('DalyOpDllgChmc', ref, 'chmcPuchAmnt', row.purchase),
      setGridCell('DalyOpDllgChmc', ref, 'chmcUseAmnt', row.usage),
      setGridCell('DalyOpDllgChmc', ref, 'chmcUseMnthlCmtlAmnt', row.monthUsage),
      setGridCell('DalyOpDllgChmc', ref, 'chmcUseAnulCmtlAmnt', row.yearUsage),
      setGridCell('DalyOpDllgChmc', ref, 'chmcRsqnVal', row.inventory)
    ];
    required.push(row.item);
    if (ok.some(Boolean)) filled += 1; else missing.push(row.item);
  }
  const success = required.length > 0 && missing.length === 0;
  return {
    success,
    filled,
    missing,
    required: required.length,
    diagnostics: success ? undefined : [describeGrid('DalyOpDllgPros'), describeGrid('DalyOpDllgChmc')],
    message: success ? 'auto fill done' : 'auto fill failed: ' + missing.join(', ')
  };
})()
`;
}

function buildRoadworkAutoFillScript(payload) {
  return buildRoadworkAutoFillScriptV2(payload);
  // eslint-disable-next-line no-unreachable
  return `
(() => {
  const payload = ${JSON.stringify(payload)};

  const toText = (value) => {
    if (value === null || value === undefined || value === '') return '';
    const n = Number(value);
    if (Number.isFinite(n)) return String(Math.round(n * 10) / 10);
    return String(value);
  };

  const FLOW_ALIAS_MAP = {
    '방류유량계': ['방류유량계', '방류수유량계', '방류수', '방류'],
    '유입유량계': ['유입유량계', '유입수유량계', '유입수', '유입'],
    '내부반송유량계': ['내부반송유량계', '내부반송', '내부반송유량'],
    '외부반송유량계': ['외부반송유량계', '외부반송', '외부반송유량'],
    '슬러지': ['인발슬러지', '슬러지반출', '슬러지반출량', '인발슬러지유량계']
  };

  const INVENTORY_ALIAS_MAP = {
    '팩(PAC)': ['팩(PAC)', 'PAC', '응집제'],
    '암모니아성질소(NH3-N)': ['암모니아성질소(NH3-N)', '암모니아성질소', 'NH3-N'],
    '질산성질소(NO3-N)': ['질산성질소(NO3-N)', '질산성질소', 'NO3-N'],
    '인산염인(PO4-P)': ['인산염인(PO4-P)', '인산염인', 'PO4-P'],
    '알칼리도(ALK)': ['알칼리도(ALK)', '알칼리도', 'ALK']
  };

  const normalize = (value) => String(value || '')
    .replace(new RegExp(String.fromCharCode(13221), 'g'), '')
    .replace(/[\\s()]/g, '')
    .toLowerCase();

  const getDailyWindow = () => {
    const windows = [window];
    const outer = document.querySelector('#mdi_subWindow1_iframe')?.contentWindow;
    if (outer) windows.push(outer);
    const center = outer?.document.querySelector('#centerFrame')?.contentWindow;
    if (center) windows.push(center);
    return windows.find((target) => {
      try {
        return Boolean(target.document?.getElementById('DalyOpDllgPros') || target.DalyOpDllgPros);
      } catch {
        return false;
      }
    });
  };

  const daily = getDailyWindow();
  if (!daily) {
    return { success: false, message: '일일운영일지 화면을 찾지 못했습니다.' };
  }

  const setInput = (id, value) => {
    const text = toText(value);
    const component = daily[id];
    if (component?.setValue) {
      component.setValue(text);
      return true;
    }

    const element = daily.document.getElementById(id);
    if (!element) return false;
    element.value = text;
    for (const eventName of ['input', 'change', 'blur']) {
      element.dispatchEvent(new Event(eventName, { bubbles: true }));
    }
    return true;
  };

  const gridRowCount = (gridId) => {
    const grid = daily[gridId];
    if (grid?.getRowCount) return Number(grid.getRowCount()) || 0;
    return daily.document.querySelectorAll('#' + gridId + '_body_tbody tr').length;
  };

  const getCellText = (gridId, rowIndex, colIds) => {
    const grid = daily[gridId];
    for (const colId of colIds) {
      try {
        const value = grid?.getCellData?.(rowIndex, colId);
        if (value !== null && value !== undefined && String(value).trim() !== '') return String(value);
      } catch {
        // Continue with DOM fallback.
      }
    }

    const row = daily.document.querySelectorAll('#' + gridId + '_body_tbody tr')[rowIndex];
    if (!row) return '';
    const selector = colIds.map((colId) => '[col_id="' + colId + '"]').join(',');
    return row.querySelector(selector)?.innerText || row.innerText || '';
  };

  const findRow = (gridId, itemName, colIds) => {
    const count = gridRowCount(gridId);
    const aliasSource = FLOW_ALIAS_MAP[itemName] || INVENTORY_ALIAS_MAP[itemName] || [itemName];
    const aliases = aliasSource.map(normalize).filter(Boolean);
    const grid = daily[gridId];
    const dl = grid?.getDataList?.();
    const dataCount = Number(dl?.getRowCount?.()) || 0;

    for (let index = 0; index < dataCount; index += 1) {
      const values = colIds.map((colId) => {
        try {
          return dl?.getCellData?.(index, colId) ?? dl?.getColumnValue?.(index, colId) ?? '';
        } catch {
          return '';
        }
      }).join(' ');
      const text = normalize(values);
      if (!text) continue;
      const isMatched = aliases.some(alias => text.includes(alias) || alias.includes(text));
      if (isMatched) {
        return { viewIndex: index, dataIndex: index };
      }
    }

    for (let index = 0; index < count; index += 1) {
      const text = normalize(getCellText(gridId, index, colIds));
      if (!text) continue;
      const isMatched = aliases.some(alias => text.includes(alias) || alias.includes(text));
      if (isMatched) {
        let dataIndex = index;
        try {
          dataIndex = grid?.getRealRowIndex?.(index) ?? grid?.getDataRowIndex?.(index) ?? index;
        } catch {
          dataIndex = index;
        }
        return { viewIndex: index, dataIndex };
      }
    }
    return { viewIndex: -1, dataIndex: -1 };
  };

  const setGridCell = (gridId, rowRef, colId, value) => {
    const rowIndex = typeof rowRef === 'object' ? rowRef.viewIndex : rowRef;
    const dataIndex = typeof rowRef === 'object' ? rowRef.dataIndex : rowRef;
    if ((rowIndex < 0 && dataIndex < 0) || value === null || value === undefined || value === '') return false;
    const text = toText(value);
    const grid = daily[gridId];
    let wrote = false;
    const dataRowIndex = (() => {
      if (Number.isFinite(Number(dataIndex)) && Number(dataIndex) >= 0) return Number(dataIndex);
      try {
        return grid?.getRealRowIndex?.(rowIndex) ?? grid?.getDataRowIndex?.(rowIndex) ?? rowIndex;
      } catch {
        return rowIndex;
      }
    })();

    try {
      if (grid?.setColumnValue) {
        grid.setColumnValue(rowIndex, colId, text);
        wrote = true;
      }
    } catch {
      // Continue with other WebSquare APIs.
    }

    try {
      if (grid?.setCellData) {
        grid.setCellData(rowIndex, colId, text);
        wrote = true;
      }
    } catch {
      // Continue with other WebSquare APIs.
    }

    try {
      const dl = grid?.getDataList?.();
      if (dl?.setCellData) {
        dl.setCellData(dataRowIndex, colId, text);
        wrote = true;
      }
      if (dl?.setColumnValue) {
        dl.setColumnValue(dataRowIndex, colId, text);
        wrote = true;
      }
      if (grid?.refresh) {
        grid.refresh();
      }
      if (grid?.reDraw) {
        grid.reDraw();
      }
    } catch {
      // Continue with DOM fallback.
    }

    const row = daily.document.querySelectorAll('#' + gridId + '_body_tbody tr')[rowIndex];
    const cell = row?.querySelector('[col_id="' + colId + '"]');
    if (cell) {
      const target = cell.querySelector('input,textarea') || cell.querySelector('.w2grid_input') || cell;
      if ('value' in target) {
        target.value = text;
      }
      target.textContent = text;
      for (const eventName of ['input', 'change', 'blur']) {
        target.dispatchEvent(new Event(eventName, { bubbles: true }));
        cell.dispatchEvent(new Event(eventName, { bubbles: true }));
      }
      wrote = true;
    }

    return wrote;
  };

  const fillFlow = (row) => {
    const rowIndex = findRow('DalyOpDllgPros', row.item, ['insrIdntIdText', 'column17']);
    const ok = [
      setGridCell('DalyOpDllgPros', rowIndex, 'prvdDrwtMsrmVal', row.previousReading),
      setGridCell('DalyOpDllgPros', rowIndex, 'tdayDrwtMsrmVal', row.todayReading),
      setGridCell('DalyOpDllgPros', rowIndex, 'drwtProsAmnt', row.todayFlow),
      setGridCell('DalyOpDllgPros', rowIndex, 'drwtProsMnthlCmtlAmnt', row.monthTotal),
      setGridCell('DalyOpDllgPros', rowIndex, 'drwtProsAnulCmtlAmnt', row.yearTotal),
    ];
    return ok.some(Boolean);
  };

  const fillInventory = (row) => {
    const rowIndex = findRow('DalyOpDllgChmc', row.item, ['chmcClssNmText', 'column29']);
    const ok = [
      setGridCell('DalyOpDllgChmc', rowIndex, 'chmcPuchAmnt', row.purchase),
      setGridCell('DalyOpDllgChmc', rowIndex, 'chmcUseAmnt', row.usage),
      setGridCell('DalyOpDllgChmc', rowIndex, 'chmcUseMnthlCmtlAmnt', row.monthUsage),
      setGridCell('DalyOpDllgChmc', rowIndex, 'chmcUseAnulCmtlAmnt', row.yearUsage),
      setGridCell('DalyOpDllgChmc', rowIndex, 'chmcRsqnVal', row.inventory),
    ];
    return ok.some(Boolean);
  };

  let filled = 0;
  for (const row of payload.flow || []) {
    if (fillFlow(row)) filled += 1;
  }

  const electricity = (payload.electricity || [])[0];
  if (electricity) {
    if (setInput('prvdElpwMsrmVal', electricity.previousReading)) filled += 1;
    if (setInput('tdayElpwMsrmVal', electricity.todayReading)) filled += 1;
    if (setInput('elpwUsmn', electricity.usage)) filled += 1;
  }

  for (const row of [...(payload.medicine || []), ...(payload.kit || [])]) {
    if (fillInventory(row)) filled += 1;
  }

  return {
    success: filled > 0,
    filled,
    message: filled > 0 ? '자동 채우기가 완료되었습니다. 화면을 확인한 뒤 직접 저장하세요.' : '채울 수 있는 칸을 찾지 못했습니다.',
  };
})()
`;
}

export default function RoadworkHelperView() {
  const vm = useRoadworkHelperViewModel();
  const rootRef = useRef(null);
  const webviewRef = useRef(null);
  const lastRefreshAtRef = useRef(0);
  const wasLoginPageRef = useRef(true);
  const [loadError, setLoadError] = useState(null);
  const [preloadPath, setPreloadPath] = useState('');
  const [webviewUrl, setWebviewUrl] = useState('');
  const [webviewGeneration, setWebviewGeneration] = useState(0);
  const [showRefreshToast, setShowRefreshToast] = useState(true);
  const [roadworkStatus, setRoadworkStatus] = useState({ isDailyLog: false, canAutoFill: false, date: '', isEditableDate: false });
  const [statusMessage, setStatusMessage] = useState('');
  const [isFilling, setIsFilling] = useState(false);
  const [isDumpingStructure, setIsDumpingStructure] = useState(false);

  const fetchConfig = React.useCallback(async () => {
    if (!window.electronAPI?.invokeRoadwork) {
      setWebviewUrl(DEFAULT_ROADWORK_URL);
      return;
    }

    try {
      const resolvedPreloadPath = await window.electronAPI.invokeRoadwork('roadwork:getPreloadPath');
      if (resolvedPreloadPath) {
        setPreloadPath(resolvedPreloadPath);
      }

      const urlRes = await window.electronAPI.invokeRoadwork('roadwork:getRoadworkUrl');
      const targetUrl = String(urlRes?.url || DEFAULT_ROADWORK_URL)
        .replace(':5002//security', ':5002/security');
      setWebviewUrl(targetUrl);
    } catch (err) {
      console.warn('[Roadwork Helper] Failed to resolve config:', err.message);
      setWebviewUrl(DEFAULT_ROADWORK_URL);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const recordRoadworkDiagnostic = React.useCallback((event, details = {}) => {
    RoadworkHelperModel.recordDiagnostic(event, details).catch((error) => {
      console.warn('[Roadwork Helper] Failed to record diagnostic:', error?.message || error);
    });
  }, []);

  const handleRefresh = React.useCallback((source = 'button') => {
    const now = Date.now();
    if (now - lastRefreshAtRef.current < 500) return;
    lastRefreshAtRef.current = now;

    const currentUrl = webviewRef.current?.getURL?.() || webviewUrl;
    setLoadError(null);
    setShowRefreshToast(true);
    wasLoginPageRef.current = true;
    setStatusMessage('도로공사 페이지를 새로 불러오는 중입니다.');
    setRoadworkStatus({ isDailyLog: false, canAutoFill: false, date: '', isEditableDate: false });
    setWebviewGeneration((value) => value + 1);
    recordRoadworkDiagnostic('webview-refresh', {
      source,
      pageOrigin: (() => {
        try {
          return currentUrl ? new URL(currentUrl).origin : '';
        } catch {
          return '';
        }
      })(),
    });
    window.setTimeout(() => setStatusMessage(''), 3500);
  }, [recordRoadworkDiagnostic, webviewUrl]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== 'F5' || event.repeat) return;
      if (!rootRef.current || rootRef.current.getClientRects().length === 0) return;
      event.preventDefault();
      handleRefresh('keyboard');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleRefresh]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const webview = webviewRef.current;
      if (!webview) return;
      webview.executeJavaScript(ROADWORK_KEEP_ALIVE_SCRIPT).catch(() => undefined);
    }, 4 * 60 * 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(async () => {
      const webview = webviewRef.current;
      if (!webview) return;

      try {
        const nextStatus = await webview.executeJavaScript(ROADWORK_STATUS_SCRIPT);
        setRoadworkStatus(nextStatus || { isDailyLog: false, canAutoFill: false, date: '', isEditableDate: false });
      } catch {
        setRoadworkStatus({ isDailyLog: false, canAutoFill: false, date: '', isEditableDate: false });
      }
    }, 1200);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const nextDate = roadworkStatus.date;
    if (nextDate && nextDate !== vm.date) {
      vm.setDate(nextDate);
    }
  }, [roadworkStatus.date, vm]);

  useEffect(() => {
    if (!roadworkStatus.canAutoFill) {
      setStatusMessage('');
    }
  }, [roadworkStatus.canAutoFill]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return undefined;

    const handleFailLoad = (event) => {
      const nextError = `도로공사 페이지를 불러오지 못했습니다: ${event.errorDescription} (코드: ${event.errorCode})`;
      console.warn('[Roadwork Helper] Webview failed to load URL:', event.validatedURL, event.errorDescription);
      setLoadError((prev) => (prev === nextError ? prev : nextError));
      recordRoadworkDiagnostic('webview-load-failed', {
        errorCode: event.errorCode,
        errorDescription: event.errorDescription,
      });
    };

    const handleDidFinishLoad = () => {
      const currentUrl = webview.getURL();
      let pageOrigin = '';
      try {
        pageOrigin = new URL(currentUrl).origin;
      } catch {
        pageOrigin = '';
      }
      const isLoginPage = /\/security\/login\.do(?:[?#]|$)/i.test(currentUrl);
      setShowRefreshToast(isLoginPage);
      recordRoadworkDiagnostic('webview-load-finished', { pageOrigin });
      if (wasLoginPageRef.current && !isLoginPage) {
        recordRoadworkDiagnostic('webview-login-transition', { result: 'login-page-exited', pageOrigin });
      }
      wasLoginPageRef.current = isLoginPage;
    };

    const handleNavigate = (event) => {
      const currentUrl = String(event.url || '');
      const isLoginPage = /\/security\/login\.do(?:[?#]|$)/i.test(currentUrl);
      setShowRefreshToast(isLoginPage);
      if (wasLoginPageRef.current && !isLoginPage) {
        let pageOrigin = '';
        try {
          pageOrigin = new URL(currentUrl).origin;
        } catch {
          pageOrigin = '';
        }
        recordRoadworkDiagnostic('webview-login-transition', { result: 'login-page-exited', pageOrigin });
      }
      wasLoginPageRef.current = isLoginPage;
    };

    const handleBeforeInput = (event) => {
      if (event.input?.key !== 'F5' || event.input?.type === 'keyUp') return;
      event.preventDefault();
      handleRefresh('keyboard');
    };

    webview.addEventListener('did-fail-load', handleFailLoad);
    webview.addEventListener('did-finish-load', handleDidFinishLoad);
    webview.addEventListener('did-navigate', handleNavigate);
    webview.addEventListener('did-navigate-in-page', handleNavigate);
    webview.addEventListener('before-input-event', handleBeforeInput);

    return () => {
      webview.removeEventListener('did-fail-load', handleFailLoad);
      webview.removeEventListener('did-finish-load', handleDidFinishLoad);
      webview.removeEventListener('did-navigate', handleNavigate);
      webview.removeEventListener('did-navigate-in-page', handleNavigate);
      webview.removeEventListener('before-input-event', handleBeforeInput);
    };
  }, [handleRefresh, recordRoadworkDiagnostic, webviewGeneration]);

  const handleAutoFill = React.useCallback(async () => {
    const webview = webviewRef.current;
    if (!webview || isFilling || !roadworkStatus.canAutoFill || roadworkStatus.date !== vm.date || !vm.hasFillData) return;

    try {
      setIsFilling(true);
      setStatusMessage('');
      const latestPayload = await RoadworkHelperModel.fetchAll(roadworkStatus.date);
      const result = await webview.executeJavaScript(buildRoadworkAutoFillScript({
        flow: latestPayload.flow || [],
        electricity: latestPayload.electricity || [],
        medicine: latestPayload.medicine || [],
        kit: latestPayload.kit || [],
      }));
      if (result?.success) {
        setStatusMessage(result.message || '자동 채우기가 완료되었습니다. 화면을 확인한 뒤 직접 저장하세요.');
      } else {
        setStatusMessage(result?.message || '자동 채우기에 실패했습니다.');
      }
    } catch (error) {
      setStatusMessage(error?.message || '자동 채우기 중 오류가 발생했습니다.');
    } finally {
      setIsFilling(false);
      window.setTimeout(() => setStatusMessage(''), 3500);
    }
  }, [isFilling, roadworkStatus.canAutoFill, roadworkStatus.date, vm]);

  const handleStructureDiagnostic = React.useCallback(async () => {
    const webview = webviewRef.current;
    if (!import.meta.env.DEV || !webview || isDumpingStructure) return;
    try {
      setIsDumpingStructure(true);
      const structure = await webview.executeJavaScript(ROADWORK_STRUCTURE_SCRIPT);
      const result = await window.electronAPI.invokeRoadwork('roadwork:dumpStructure', {
        label: roadworkStatus.isDailyLog ? 'daily-detail' : 'list-or-menu',
        pages: structure?.pages || [],
      });
      setStatusMessage(result?.success
        ? `구조 진단 저장 완료: ${result.fileName}`
        : `구조 진단 저장 실패: ${result?.error || '알 수 없는 오류'}`);
    } catch (error) {
      setStatusMessage(`구조 진단 저장 실패: ${error?.message || error}`);
    } finally {
      setIsDumpingStructure(false);
    }
  }, [isDumpingStructure, roadworkStatus.isDailyLog]);

  const showAutoFill = Boolean(webviewUrl);
  const disableAutoFill = !roadworkStatus.canAutoFill || roadworkStatus.date !== vm.date || vm.loading || isFilling || !vm.hasFillData;
  const autoFillLabel = vm.loading
    ? '데이터 확인 중'
    : isFilling
      ? '채우는 중'
      : vm.hasFillData
        ? '자동 채우기'
        : '데이터 없음';

  return (
    <div className="roadwork-page" ref={rootRef}>
      {loadError && (
        <div className="roadwork-load-error">
          <span className="material-icons">error_outline</span>
          <h3>페이지 로드 실패</h3>
          <p>{loadError}</p>
          <button
            type="button"
            onClick={() => {
              handleRefresh('load-error');
            }}
          >
            다시 시도
          </button>
        </div>
      )}

      {webviewUrl ? (
        <webview
          key={`${webviewUrl}-${preloadPath}-${webviewGeneration}`}
          ref={webviewRef}
          src={webviewUrl}
          partition="persist:osoo-roadwork"
          className="roadwork-webview"
          nodeintegration="false"
          enableremotemodule="false"
          allowpopups="true"
          preload={preloadPath || undefined}
        />
      ) : (
        <div className="roadwork-loading">도로공사 입력 화면을 준비하는 중입니다.</div>
      )}

      {showAutoFill ? (
        <button
          type="button"
          className="roadwork-autofill-button"
          onClick={handleAutoFill}
          disabled={disableAutoFill}
          title={vm.hasFillData ? '현재 신규 일지에 로컬 데이터를 채웁니다.' : '이 날짜에 채울 로컬 데이터가 없습니다.'}
        >
          <span className="material-icons">auto_fix_high</span>
          {autoFillLabel}
        </button>
      ) : null}

      {statusMessage ? (
        <div className="roadwork-autofill-status">
          {statusMessage}
        </div>
      ) : null}

      {showRefreshToast && webviewUrl ? (
        <div className="roadwork-refresh-toast" role="status">
        <button
          type="button"
          className="roadwork-refresh-button"
          onClick={() => handleRefresh('button')}
          disabled={!webviewUrl}
          title="도로공사 페이지를 초기 상태로 다시 불러옵니다."
        >
          <span className="material-icons" aria-hidden="true">refresh</span>
          새로고침 (F5)
        </button>
        </div>
      ) : null}
      {import.meta.env.DEV && webviewUrl ? (
        <button
          type="button"
          className="roadwork-structure-diagnostic-button"
          onClick={handleStructureDiagnostic}
          disabled={isDumpingStructure}
          title="개발용: 도로공사 목록/상세 구조만 저장합니다."
        >
          {isDumpingStructure ? '구조 읽는 중…' : '구조 진단 저장'}
        </button>
      ) : null}
    </div>
  );
}
