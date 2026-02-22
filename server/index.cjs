const express = require('express');
const path = require('path');
const fs = require('fs');
const net = require('net');
const cors = require('cors');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const { db, appDataPath } = require('./database.cjs');

const BASE_DIR = path.join(__dirname, '..');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(path.join(BASE_DIR, 'uploads')));

process.on('uncaughtException', (err) => {
  console.error('[UncaughtException]', err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection]', reason instanceof Error ? reason.message : reason);
});

app.get('/', (req, res) => {
  res.send(`
    <div style="font-family: sans-serif; padding: 2rem; line-height: 1.6;">
      <h1 style="color: #1e293b;">Osoo Handle App - Local Bridge Server</h1>
      <p>백엔드 API 서버가 정상적으로 작동 중입니다.</p>
      <p><strong>참고:</strong> 사용자 인터페이스(UI)를 보려면 프론트엔드 개발 서버(포트 8900)를 실행해야 합니다.</p>
      <div style="background: #f1f5f9; padding: 1rem; border-radius: 8px; display: inline-block;">
        <code>npm run dev</code> 를 터미널에서 실행하세요.
      </div>
    </div>
  `);
});

app.get('/api/ping', (req, res) => res.json({ ok: true }));

app.use(require('./routes/flowRoutes.cjs')(db));
app.use(require('./routes/medicineRoutes.cjs')(db));
app.use(require('./routes/waterQualityRoutes.cjs')(db));
app.use(require('./routes/facilityRoutes.cjs')(db));
app.use(require('./routes/settingsRoutes.cjs')(db, BASE_DIR));
app.use(require('./routes/uploadRoutes.cjs')(BASE_DIR));
app.use(require('./routes/locationRoutes.cjs')(BASE_DIR));
app.use(require('./routes/excelRoutes.cjs')(db, BASE_DIR));
app.use('/api/auth', require('./routes/authRoutes.cjs')(db));

async function findFreePort(startPort, endPort) {
  for (let p = startPort; p <= endPort; p++) {
    const free = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.once('listening', () => { srv.close(); resolve(true); });
      srv.listen(p, '127.0.0.1');
    });
    if (free) return p;
  }
  return startPort;
}

const API_PORT_MIN = (Number(process.env.VITE_PORT) || 8900) + 1;
const API_PORT_MAX = API_PORT_MIN + 50;

findFreePort(API_PORT_MIN, API_PORT_MAX).then((actualPort) => {
  const portFilePath = path.join(appDataPath, 'server.port');
  try { fs.writeFileSync(portFilePath, String(actualPort), 'utf8'); } catch (_) { }

  const server = app.listen(actualPort, '127.0.0.1', () => {
    console.log(`Local Bridge Server running at http://localhost:${actualPort}`);
    if (actualPort !== API_PORT_MIN) {
      console.warn(`[주의] 기본 포트(${API_PORT_MIN})가 이미 사용 중이어서 포트 ${actualPort}로 시작했습니다.`);
    }
  });
  server.on('error', (err) => { console.error('[Server Error]', err.message); });
});
