import React, { useEffect, useRef, useState } from 'react';
import { useRoadworkHelperViewModel } from './useRoadworkHelperViewModel';
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
    return { isDailyLog: false, canAutoFill: false, date: '' };
  }

  const saveButton = daily.document.getElementById('btn_Save');
  const date = normalizeDate(
    daily.regDate?.getValue?.()
    || daily.document.getElementById('regDate_input')?.value
    || daily.document.getElementById('regDate')?.innerText
  );

  return {
    isDailyLog: true,
    canAutoFill: isVisible(saveButton),
    date,
  };
})()
`;

function buildRoadworkAutoFillScript(payload) {
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
    .replace(new RegExp(String.fromCharCode(13221), 'g'), '')
    .replace(/[\\s()]/g, '')
    .replace(/슬러지/g, '')
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
    const needle = normalize(itemName);
    const count = gridRowCount(gridId);
    for (let index = 0; index < count; index += 1) {
      const text = normalize(getCellText(gridId, index, colIds));
      if (text && (text.includes(needle) || needle.includes(text))) {
        return index;
      }
    }
    return -1;
  };

  const setGridCell = (gridId, rowIndex, colId, value) => {
    if (rowIndex < 0 || value === null || value === undefined || value === '') return false;
    const text = toText(value);
    const grid = daily[gridId];
    try {
      if (grid?.setCellData) {
        grid.setCellData(rowIndex, colId, text);
        return true;
      }
    } catch {
      // Continue with DOM fallback.
    }

    const row = daily.document.querySelectorAll('#' + gridId + '_body_tbody tr')[rowIndex];
    const cell = row?.querySelector('[col_id="' + colId + '"]');
    if (!cell) return false;
    const target = cell.querySelector('.w2grid_input') || cell;
    target.textContent = text;
    cell.dispatchEvent(new Event('input', { bubbles: true }));
    cell.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
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
  const webviewRef = useRef(null);
  const [loadError, setLoadError] = useState(null);
  const [preloadPath, setPreloadPath] = useState('');
  const [webviewUrl, setWebviewUrl] = useState('');
  const [roadworkStatus, setRoadworkStatus] = useState({ isDailyLog: false, canAutoFill: false, date: '' });
  const [filledKey, setFilledKey] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [isFilling, setIsFilling] = useState(false);

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
        setRoadworkStatus(nextStatus || { isDailyLog: false, canAutoFill: false, date: '' });
      } catch {
        setRoadworkStatus({ isDailyLog: false, canAutoFill: false, date: '' });
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
      setFilledKey('');
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
    };

    webview.addEventListener('did-fail-load', handleFailLoad);

    return () => {
      webview.removeEventListener('did-fail-load', handleFailLoad);
    };
  }, []);

  const handleAutoFill = React.useCallback(async () => {
    const webview = webviewRef.current;
    if (!webview || isFilling || !vm.hasFillData) return;

    try {
      setIsFilling(true);
      setStatusMessage('');
      const result = await webview.executeJavaScript(buildRoadworkAutoFillScript(vm.fillPayload));
      if (result?.success) {
        setFilledKey(`${roadworkStatus.date || vm.date}:filled`);
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
  }, [isFilling, roadworkStatus.date, vm]);

  const statusKey = `${roadworkStatus.date || vm.date}:filled`;
  const showAutoFill = roadworkStatus.canAutoFill && filledKey !== statusKey;
  const disableAutoFill = vm.loading || isFilling || !vm.hasFillData;
  const autoFillLabel = vm.loading
    ? '데이터 확인 중'
    : isFilling
      ? '채우는 중'
      : vm.hasFillData
        ? '자동 채우기'
        : '데이터 없음';

  return (
    <div className="roadwork-page">
      {loadError && (
        <div className="roadwork-load-error">
          <span className="material-icons">error_outline</span>
          <h3>페이지 로드 실패</h3>
          <p>{loadError}</p>
          <button
            type="button"
            onClick={() => {
              setLoadError(null);
              webviewRef.current?.reload();
            }}
          >
            다시 시도
          </button>
        </div>
      )}

      {webviewUrl ? (
        <webview
          key={`${webviewUrl}-${preloadPath}`}
          ref={webviewRef}
          src={webviewUrl}
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
    </div>
  );
}
