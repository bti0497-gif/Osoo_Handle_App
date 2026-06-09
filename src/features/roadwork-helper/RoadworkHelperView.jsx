import React, { useEffect, useRef, useState } from 'react';
import { useRoadworkHelperViewModel } from './useRoadworkHelperViewModel';
import RoadworkHelperModal from './components/RoadworkHelperModal';

const DEFAULT_ROADWORK_URL = 'https://nwpo.ex.co.kr:5002/security/login.do';

export default function RoadworkHelperView() {
  const vm = useRoadworkHelperViewModel();
  const webviewRef = useRef(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [preloadPath, setPreloadPath] = useState('');
  const [webviewUrl, setWebviewUrl] = useState('');
  const [debugStatus, setDebugStatus] = useState({ hasUserId: false, hasPassword: false, passwordLen: 0 });
  const [debugMessage, setDebugMessage] = useState('');
  const isDev = import.meta.env.DEV;

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

  const handleDumpDom = React.useCallback(async (label = 'manual') => {
    if (!window.electronAPI?.invokeRoadwork) {
      setDebugMessage('Electron IPC가 없어서 DOM 저장을 실행할 수 없습니다.');
      return;
    }

    const webview = webviewRef.current;
    if (!webview) {
      setDebugMessage('웹뷰가 아직 준비되지 않았습니다.');
      return;
    }

    try {
      setDebugMessage('DOM 덤프를 수집하는 중입니다…');
      const html = await webview.executeJavaScript('document.documentElement.outerHTML');
      const result = await window.electronAPI.invokeRoadwork('roadwork:dumpHtml', {
        label,
        html,
        url: webviewUrl || DEFAULT_ROADWORK_URL,
        title: document.title || 'roadwork',
      });

      if (result?.success) {
        setDebugMessage(`DOM 덤프 저장 완료: ${result.fileName}`);
      } else {
        setDebugMessage(result?.error || 'DOM 덤프 저장에 실패했습니다.');
      }
    } catch (error) {
      setDebugMessage(error?.message || 'DOM 덤프 저장 중 오류가 발생했습니다.');
    }
  }, [webviewUrl]);

  const handleCheckCredentials = React.useCallback(async () => {
    if (!window.electronAPI?.invokeRoadwork) {
      setDebugMessage('Electron IPC가 없어서 계정 상태를 확인할 수 없습니다.');
      return;
    }

    try {
      let result;
      try {
        result = await window.electronAPI.invokeRoadwork('roadwork:getCredentialStatus');
      } catch (error) {
        if (!String(error?.message || '').includes('Unauthorized channel')) {
          throw error;
        }

        const legacyResult = await window.electronAPI.invokeRoadwork('roadwork:getCredentials');
        result = {
          success: Boolean(legacyResult?.success),
          hasUserId: Boolean(legacyResult?.userId),
          hasPassword: Boolean(legacyResult?.password),
          passwordLen: String(legacyResult?.password || '').length,
        };
      }

      setDebugStatus({
        hasUserId: Boolean(result?.hasUserId),
        hasPassword: Boolean(result?.hasPassword),
        passwordLen: Number(result?.passwordLen || 0),
      });
      setDebugMessage(result?.success ? '계정 정보 조회 성공' : '저장된 계정 정보가 없습니다.');
    } catch (error) {
      setDebugMessage(error?.message || '계정 상태 확인 실패');
    }
  }, []);

  useEffect(() => {
    if (isDev && window.electronAPI?.invokeRoadwork) {
      handleCheckCredentials();
    }
  }, [handleCheckCredentials, isDev]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return undefined;

    const handleFailLoad = (event) => {
      const nextError = `도로공사 페이지를 불러오지 못했습니다: ${event.errorDescription} (코드: ${event.errorCode})`;
      console.warn('[Roadwork Helper] Webview failed to load URL:', event.validatedURL, event.errorDescription);
      setLoadError((prev) => (prev === nextError ? prev : nextError));
    };

    const handleDomReady = () => {
      if (isDev) {
        try {
          webview.openDevTools({ mode: 'detach' });
        } catch (error) {
          console.warn('[Roadwork Helper] Failed to detach webview DevTools:', error.message);
        }
      }

    };

    webview.addEventListener('did-fail-load', handleFailLoad);
    webview.addEventListener('dom-ready', handleDomReady);

    return () => {
      webview.removeEventListener('did-fail-load', handleFailLoad);
      webview.removeEventListener('dom-ready', handleDomReady);
    };
  }, [isDev]);

  return (
    <div className="roadwork-page">
      {isDev && (
        <section className="roadwork-dev-panel" aria-label="도로공사 개발 디버그 패널">
          <div>
            <strong>개발 디버그</strong>
            <p>현재 URL: {webviewUrl || DEFAULT_ROADWORK_URL}</p>
            <p>계정 상태: hasUserId={String(debugStatus.hasUserId)} / hasPassword={String(debugStatus.hasPassword)} / password_len={debugStatus.passwordLen}</p>
          </div>
          <div className="roadwork-dev-actions">
            <button type="button" className="roadwork-btn-secondary" onClick={() => webviewRef.current?.reload()}>새로고침</button>
            <button type="button" className="roadwork-btn-secondary" onClick={() => webviewRef.current?.openDevTools({ mode: 'detach' })}>DevTools</button>
            <button type="button" className="roadwork-btn-secondary" onClick={() => handleDumpDom('login')}>DOM 저장</button>
            <button type="button" className="roadwork-btn-secondary" onClick={handleCheckCredentials}>계정 상태</button>
          </div>
          {debugMessage ? <p className="roadwork-dev-message">{debugMessage}</p> : null}
        </section>
      )}
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
          preload={preloadPath || undefined}
        />
      ) : (
        <div className="roadwork-loading">도로공사 입력 화면을 준비하는 중입니다.</div>
      )}

      {!isModalOpen && (
        <button type="button" className="roadwork-floating-open" onClick={() => setIsModalOpen(true)}>
          <span className="material-icons">table_view</span>
          입력 도우미
        </button>
      )}

      <RoadworkHelperModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        vm={vm}
      />
    </div>
  );
}
