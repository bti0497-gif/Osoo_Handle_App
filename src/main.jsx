import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles/index.css'
import { initServerConfig } from './core/api/serverConfig.js'
import SplashLoadingView from './components/SplashLoadingView.jsx'

import { DialogProvider } from './components/common/DialogProvider.jsx'
import { FocusDiagnostics } from './features/diagnostics/FocusDiagnostics.jsx'

const root = ReactDOM.createRoot(document.getElementById('root'));

// 최초 서버 탐색부터 App의 세션 복구가 끝날 때까지 같은 브랜드 인트로를 유지한다.
// 인트로는 시작 작업을 가리기만 하며 서버·인증 순서를 변경하지 않는다.
root.render(<SplashLoadingView percent={0} label="앱을 준비하고 있습니다..." showProgress={false} />);

const renderApplication = () => {
  root.render(
    <React.StrictMode>
      <DialogProvider>
        <FocusDiagnostics />
        <App />
      </DialogProvider>
    </React.StrictMode>
  );
};

const bootstrapApplication = async () => {
  try {
    // 로그인 화면은 로컬 API의 ready 응답을 받은 뒤에만 표시한다.
    await initServerConfig({ waitForReady: true });
    renderApplication();
  } catch (error) {
    console.warn('[Bootstrap] local server is not ready yet:', error?.message || error);
    root.render(<SplashLoadingView percent={0} label="로컬 서버를 다시 준비하고 있습니다..." showProgress={false} />);
    window.setTimeout(bootstrapApplication, 2000);
  }
};

void bootstrapApplication();
