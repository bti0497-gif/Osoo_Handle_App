import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles/index.css'
import { initServerConfig } from './core/api/serverConfig.js'
import SplashLoadingView from './components/SplashLoadingView.jsx'

import { DialogProvider } from './components/common/DialogProvider.jsx'

const root = ReactDOM.createRoot(document.getElementById('root'));

// 최초 서버 탐색부터 App의 세션 복구가 끝날 때까지 같은 브랜드 인트로를 유지한다.
// 인트로는 시작 작업을 가리기만 하며 서버·인증 순서를 변경하지 않는다.
root.render(<SplashLoadingView percent={0} label="" showProgress={false} />);

initServerConfig().then(() => {
  root.render(
    <React.StrictMode>
      <DialogProvider>
        <App />
      </DialogProvider>
    </React.StrictMode>
  );
});
