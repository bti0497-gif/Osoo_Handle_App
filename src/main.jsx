import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles/index.css'
import { initServerConfig } from './core/api/serverConfig.js'

console.log('Main.jsx: Root rendering started');

const root = ReactDOM.createRoot(document.getElementById('root'));

// 서버 포트 탐색 중 로딩 화면
root.render(
  <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'#f8fafc', flexDirection:'column', gap:'16px' }}>
    <div style={{ width:36, height:36, border:'4px solid #e2e8f0', borderTopColor:'#1e293b', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    <p style={{ fontSize:'0.875rem', fontWeight:700, color:'#64748b', margin:0 }}>서버 연결 중...</p>
  </div>
);

initServerConfig().then(() => {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
