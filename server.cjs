const express = require('express');
const sqlite3 = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const cors = require('cors');
const multer = require('multer');
const sharp = require('sharp');
const ExcelJS = require('exceljs');
require('dotenv').config({ path: '.env.local' });

const upload = multer({ storage: multer.memoryStorage() });

const app = express();
const port = Number(process.env.VITE_PORT) || 8900;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Setup AppData directory for the database
const appDataPath = path.join(process.env.APPDATA, 'Osoo_Handle_App');
if (!fs.existsSync(appDataPath)) {
  fs.mkdirSync(appDataPath, { recursive: true });
}

const dbPath = path.join(appDataPath, 'osoo.db');
const db = new sqlite3(dbPath);

// Initialize Database Schema
console.log(`Using database at: ${dbPath}`);

db.exec(`
  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    phone TEXT,
    site_name1 TEXT,
    site_name2 TEXT,
    target_lat REAL,
    target_lng REAL,
    radius_m INTEGER DEFAULT 500,
    notes TEXT,
    role TEXT DEFAULT 'user',
    last_sync_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_name TEXT NOT NULL,
    date DATE NOT NULL,
    login_time DATETIME,
    logout_time DATETIME,
    login_lat REAL,
    login_lng REAL,
    location_matched BOOLEAN DEFAULT 0,
    auto_logout BOOLEAN DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    author TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    view_count INTEGER DEFAULT 0,
    attachments TEXT,
    parent_id INTEGER,
    updated_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    parent_id INTEGER,
    content TEXT NOT NULL,
    author TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_reply BOOLEAN DEFAULT 0,
    FOREIGN KEY (post_id) REFERENCES posts(id)
  );

  CREATE TABLE IF NOT EXISTS flow_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    type TEXT NOT NULL,
    raw_value REAL,
    calculated_flow REAL,
    is_reset BOOLEAN DEFAULT 0,
    is_manual BOOLEAN DEFAULT 0,
    sludge_export REAL,
    UNIQUE(date, type)
  );

  CREATE TABLE IF NOT EXISTS medicine_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    medicine_name TEXT NOT NULL,
    date DATE NOT NULL,
    purchase_amount REAL,
    usage_amount REAL,
    current_inventory REAL,
    UNIQUE(medicine_name, date)
  );

  CREATE TABLE IF NOT EXISTS water_quality (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    location TEXT,
    nh3_n REAL,
    no3_n REAL,
    po4_p REAL,
    alkalinity REAL,
    UNIQUE(date, location)
  );

  CREATE TABLE IF NOT EXISTS facility_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    facility_name TEXT,
    content TEXT,
    company TEXT,
    price INTEGER,
    notes TEXT
  );
`);

// Migration: Add new columns to existing attendance table (safe to run multiple times)
try {
  const attCols = db.pragma('table_info(attendance)').map(c => c.name);
  if (!attCols.includes('login_lat')) db.exec('ALTER TABLE attendance ADD COLUMN login_lat REAL');
  if (!attCols.includes('login_lng')) db.exec('ALTER TABLE attendance ADD COLUMN login_lng REAL');
  if (!attCols.includes('location_matched')) db.exec('ALTER TABLE attendance ADD COLUMN location_matched BOOLEAN DEFAULT 0');
  if (!attCols.includes('auto_logout')) db.exec('ALTER TABLE attendance ADD COLUMN auto_logout BOOLEAN DEFAULT 0');

  // Posts migration
  const postCols = db.pragma('table_info(posts)').map(c => c.name);
  if (!postCols.includes('is_notice')) db.exec('ALTER TABLE posts ADD COLUMN is_notice INTEGER DEFAULT 0');
  if (!postCols.includes('updated_at')) db.exec('ALTER TABLE posts ADD COLUMN updated_at DATETIME');
  if (!postCols.includes('parent_id')) db.exec('ALTER TABLE posts ADD COLUMN parent_id INTEGER');

  console.log('Database migration check complete.');
} catch (e) {
  console.warn('Migration warning:', e.message);
}

// Static uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Windows Location API (WinRT via PowerShell)
app.get('/api/location/current', (req, res) => {
  const scriptPath = path.join(__dirname, 'scripts', 'get_location.ps1');

  exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`,
    { timeout: 20000 },
    (error, stdout, stderr) => {
      if (error) {
        const errMsg = stderr || error.message;
        console.error('Location error:', errMsg);

        if (errMsg.includes('denied') || errMsg.includes('Access') || errMsg.includes('0x80070005')) {
          return res.status(403).json({
            success: false,
            code: 'LOCATION_DENIED',
            message: 'Windows 위치 서비스가 비활성화되어 있습니다.\n설정 > 개인 정보 > 위치 에서 위치 서비스를 켜주세요.'
          });
        }

        return res.status(500).json({
          success: false,
          code: 'LOCATION_ERROR',
          message: '위치 정보를 가져올 수 없습니다: ' + errMsg.trim()
        });
      }

      const parts = stdout.trim().split(',');
      if (parts.length >= 2) {
        res.json({
          success: true,
          latitude: parseFloat(parts[0]),
          longitude: parseFloat(parts[1]),
          accuracy: parts[2] ? parseFloat(parts[2]) : null
        });
      } else {
        res.status(500).json({
          success: false,
          code: 'PARSE_ERROR',
          message: '위치 데이터 파싱 실패'
        });
      }
    }
  );
});

// API Endpoints
app.get('/', (req, res) => {
  res.send(`
    <div style="font-family: sans-serif; padding: 2rem; line-height: 1.6;">
        <h1 style="color: #1e293b;">Osoo Handle App - Local Bridge Server</h1>
        <p>백엔드 API 서버가 정상적으로 작동 중입니다.</p>
        <p><strong>참고:</strong> 사용자 인터페이스(UI)를 보려면 프론트엔드 개발 서버(포트 8900)를 실행해야 합니다.</p>
        <div style="background: #f1f5f9; padding: 1rem; border-radius: 8px; display: inline-block;">
            <code>npm run dev</code> 를 터미널에서 실행하세요.
        </div>
        <br><br>
        <a href="http://localhost:8900" style="color: #0a58ca; font-weight: bold;">프론트엔드로 이동하기 (포트 8900) &rarr;</a>
    </div>
  `);
});

// Authentication & Member Sync
app.post('/api/auth/login', (req, res) => {
  const { name, password } = req.body;
  const member = db.prepare('SELECT * FROM members WHERE name = ? AND password = ?').get(name, password);
  if (member) {
    return res.json({ success: true, user: member, source: 'local' });
  }
  res.status(404).json({ success: false, message: 'User not found locally' });
});

// 회원 목록 조회
app.get('/api/members', (req, res) => {
  try {
    const members = db.prepare('SELECT * FROM members ORDER BY id ASC').all();
    res.json(members);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 회원 등록/수정
app.post('/api/members', (req, res) => {
  const { id, name, password, phone, site_name1, site_name2, target_lat, target_lng, radius_m, notes, role } = req.body;
  try {
    let info;
    if (id) {
      // 기존 회원 수정
      info = db.prepare(`
        UPDATE members SET name=?, password=?, phone=?, site_name1=?, site_name2=?, target_lat=?, target_lng=?, radius_m=?, notes=?, role=?, last_sync_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(name, password, phone, site_name1, site_name2, target_lat, target_lng, radius_m, notes, role, id);
      res.json({ success: true, id: id });
    } else {
      // 신규 등록
      info = db.prepare(`
        INSERT INTO members (name, password, phone, site_name1, site_name2, target_lat, target_lng, radius_m, notes, role, last_sync_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(name, password, phone, site_name1, site_name2, target_lat, target_lng, radius_m, notes, role);
      res.json({ success: true, id: info.lastInsertRowid });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 회원 삭제
app.delete('/api/members/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM members WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Posts (소통게시판)
app.get('/api/posts', (req, res) => {
  try {
    const { user } = req.query;
    let sql, params;
    if (user && user !== 'admin') {
      // 일반사용자: 자기 글 + admin 글만
      sql = `SELECT p.id, p.title, p.author, STRFTIME('%Y-%m-%dT%H:%M:%SZ', p.created_at) as created_at, p.view_count, p.is_notice, p.attachments, p.parent_id,
             (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comment_count
             FROM posts p WHERE p.author = ? OR p.author = 'admin'
             ORDER BY p.is_notice DESC, COALESCE(p.parent_id, p.id) DESC, p.id ASC`;
      params = [user];
    } else {
      // admin: 모든 글
      sql = `SELECT p.id, p.title, p.author, STRFTIME('%Y-%m-%dT%H:%M:%SZ', p.created_at) as created_at, p.view_count, p.is_notice, p.attachments, p.parent_id,
             (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comment_count
             FROM posts p ORDER BY p.is_notice DESC, COALESCE(p.parent_id, p.id) DESC, p.id ASC`;
      params = [];
    }
    const posts = db.prepare(sql).all(...params);
    res.json(posts);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/posts/:id', (req, res) => {
  try {
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: '게시글을 찾을 수 없습니다.' });
    db.prepare('UPDATE posts SET view_count = view_count + 1 WHERE id = ?').run(req.params.id);
    post.view_count += 1;
    res.json(post);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/posts', (req, res) => {
  const { id, title, content, author, attachments, is_notice } = req.body;
  try {
    if (id) {
      db.prepare('UPDATE posts SET title=?, content=?, attachments=?, is_notice=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(title, content, attachments || null, is_notice || 0, id);
      res.json({ success: true, id });
    } else {
      const { parent_id } = req.body;
      const result = db.prepare('INSERT INTO posts (title, content, author, attachments, is_notice, parent_id) VALUES (?, ?, ?, ?, ?, ?)')
        .run(title, content, author, attachments || null, is_notice || 0, parent_id || null);
      res.json({ success: true, id: result.lastInsertRowid });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/posts/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM comments WHERE post_id = ?').run(req.params.id);
    db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Comments (댓글/답글)
app.get('/api/posts/:id/comments', (req, res) => {
  try {
    const comments = db.prepare("SELECT id, post_id, parent_id, content, author, STRFTIME('%Y-%m-%dT%H:%M:%SZ', created_at) as created_at, is_reply FROM comments WHERE post_id = ? ORDER BY created_at ASC").all(req.params.id);
    res.json(comments);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/posts/:id/comments', (req, res) => {
  const { content, author, parent_id } = req.body;
  try {
    const result = db.prepare('INSERT INTO comments (post_id, content, author, parent_id, is_reply) VALUES (?, ?, ?, ?, ?)')
      .run(req.params.id, content, author, parent_id || null, parent_id ? 1 : 0);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/comments/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// File Upload (게시판 첨부파일)
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const boardUpload = multer({ dest: uploadDir, limits: { fileSize: 50 * 1024 * 1024 } }); // 10MB -> 50MB 상향

app.post('/api/upload', boardUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: '파일이 없습니다.' });

  // Multer의 latin1 인코딩 문제를 UTF-8로 보정 (더욱 강력한 보정 로직)
  let originalName = req.file.originalname;
  try {
    // 이미 한글이 포함되어 있다면 파일명이 정상적으로 온 것으로 판단
    if (!/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(originalName)) {
      const decoded = Buffer.from(originalName, 'latin1').toString('utf8');
      // 보정 후 한글이 생겼다면 보정된 이름을 사용
      if (/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(decoded)) {
        originalName = decoded;
      }
    }
  } catch (e) {
    console.error("Filename decoding error:", e);
  }

  const ext = path.extname(originalName);
  const newName = req.file.filename + ext;
  fs.renameSync(req.file.path, path.join(uploadDir, newName));

  res.json({
    success: true,
    url: `/uploads/${newName}`,
    originalName: originalName,
    size: req.file.size
  });
});

// 파일 다운로드 (한글 파일명 보존을 위한 전용 API)
app.get('/api/download', (req, res) => {
  const { url, name } = req.query;
  if (!url || !name) return res.status(400).send('잘못된 요청입니다.');

  const fileName = path.basename(url);
  const filePath = path.join(uploadDir, fileName);

  if (!fs.existsSync(filePath)) return res.status(404).send('파일을 찾을 수 없습니다.');

  // 브라우저에서 올바른 한글 파일명으로 다운로드되도록 헤더 설정
  const encodedName = encodeURIComponent(name);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`);
  res.sendFile(filePath);
});

// Attendance tracking (접속관리)
app.post('/api/attendance/login', (req, res) => {
  const { name, login_lat, login_lng, location_matched } = req.body;
  const date = new Date().toISOString().split('T')[0];
  try {
    const info = db.prepare(`
      INSERT INTO attendance (member_name, date, login_time, login_lat, login_lng, location_matched)
      VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
    `).run(name, date, login_lat || null, login_lng || null, location_matched ? 1 : 0);
    res.json({ success: true, id: info.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/attendance/logout', (req, res) => {
  const { name, auto_logout } = req.body;
  const date = new Date().toISOString().split('T')[0];
  try {
    const result = db.prepare(`
      UPDATE attendance 
      SET logout_time = CURRENT_TIMESTAMP, auto_logout = ?
      WHERE member_name = ? AND date = ? AND logout_time IS NULL
    `).run(auto_logout ? 1 : 0, name, date);
    res.json({ success: true, updated: result.changes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/attendance', (req, res) => {
  const { date } = req.query;
  try {
    const logs = db.prepare("SELECT id, member_name, date, STRFTIME('%Y-%m-%dT%H:%M:%SZ', login_time) as login_time, STRFTIME('%Y-%m-%dT%H:%M:%SZ', logout_time) as logout_time, login_lat, login_lng, logout_lat, logout_lng, location_matched, auto_logout FROM attendance WHERE date = ? ORDER BY login_time DESC").all(date);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Flow Management
app.get('/api/flows', (req, res) => {
  const { date } = req.query;
  const flows = db.prepare('SELECT * FROM flow_readings WHERE date = ?').all(date);
  res.json(flows);
});

app.post('/api/flows', (req, res) => {
  const { date, type, raw_value, is_reset, is_manual, manual_flow, sludge_export } = req.body;

  try {
    // Validation: Current < Previous check (unless is_reset)
    const prevReading = db.prepare('SELECT raw_value FROM flow_readings WHERE type = ? AND date < ? ORDER BY date DESC LIMIT 1').get(type, date);

    if (!is_reset && prevReading && raw_value < prevReading.raw_value) {
      return res.status(400).json({ success: false, message: '검침값이 어제보다 작을 수 없습니다. 초기화가 필요한 경우 체크해주세요.' });
    }

    // Calculate flow
    let calculated_flow = 0;
    if (is_manual) {
      calculated_flow = manual_flow;
    } else if (!is_reset && prevReading) {
      calculated_flow = raw_value - prevReading.raw_value;
    }

    const info = db.prepare(`
            INSERT OR REPLACE INTO flow_readings (date, type, raw_value, calculated_flow, is_reset, is_manual, sludge_export)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(date, type, raw_value, calculated_flow, is_reset ? 1 : 0, is_manual ? 1 : 0, sludge_export);

    res.json({ success: true, id: info.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Medicine Management
app.get('/api/medicines', (req, res) => {
  const { date } = req.query;
  const logs = db.prepare('SELECT * FROM medicine_logs WHERE date = ?').all(date);
  res.json(logs);
});

app.post('/api/medicines', (req, res) => {
  const { medicine_name, date, purchase_amount, usage_amount } = req.body;

  try {
    // Find previous inventory
    const prevLog = db.prepare('SELECT current_inventory FROM medicine_logs WHERE medicine_name = ? AND date < ? ORDER BY date DESC LIMIT 1').get(medicine_name, date);
    const startInventory = prevLog ? prevLog.current_inventory : 0;

    const current_inventory = startInventory + (purchase_amount || 0) - (usage_amount || 0);

    const info = db.prepare(`
            INSERT OR REPLACE INTO medicine_logs (medicine_name, date, purchase_amount, usage_amount, current_inventory)
            VALUES (?, ?, ?, ?, ?)
        `).run(medicine_name, date, purchase_amount || 0, usage_amount || 0, current_inventory);

    res.json({ success: true, id: info.lastInsertRowid, current_inventory });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Water Quality Management
app.get('/api/water-quality', (req, res) => {
  const { date } = req.query;
  const logs = db.prepare('SELECT * FROM water_quality WHERE date = ?').all(date);
  res.json(logs);
});

app.post('/api/water-quality', (req, res) => {
  const { date, location, nh3_n, no3_n, po4_p, alkalinity } = req.body;
  try {
    const info = db.prepare(`
            INSERT OR REPLACE INTO water_quality (date, location, nh3_n, no3_n, po4_p, alkalinity)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(date, location || 'default', nh3_n, no3_n, po4_p, alkalinity);
    res.json({ success: true, id: info.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Facility Management
app.get('/api/facilities', (req, res) => {
  const { date } = req.query;
  const logs = db.prepare('SELECT * FROM facility_logs WHERE date = ?').all(date);
  res.json(logs);
});

app.post('/api/facilities', (req, res) => {
  const { date, facility_name, content, company, price, notes } = req.body;
  try {
    const info = db.prepare(`
            INSERT INTO facility_logs (date, facility_name, content, company, price, notes)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(date, facility_name, content, company, price, notes);
    res.json({ success: true, id: info.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Secure Photo Upload
app.post('/api/upload', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const date = req.body.date || new Date().toISOString().split('T')[0];
  const type = req.body.type || 'misc';
  const targetDir = path.join(__dirname, 'resources', 'images', date);

  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  const fileName = `${type}_${Date.now()}.jpg`;
  const targetPath = path.join(targetDir, fileName);

  try {
    // Security: Re-encode image to strip malware/metadata
    await sharp(req.file.buffer)
      .jpeg({ quality: 80 })
      .toFile(targetPath);

    const relativePath = `resources/images/${date}/${fileName}`;
    res.json({ success: true, path: relativePath });
  } catch (err) {
    res.status(500).json({ error: 'Image processing failed: ' + err.message });
  }
});

// Excel Log Generation
app.get('/api/logs/generate-excel', async (req, res) => {
  const { date, templateName } = req.query;
  const mappingPath = path.join(__dirname, 'templates', 'mapping.json');
  const templatePath = path.join(__dirname, 'templates', templateName);

  if (!fs.existsSync(templatePath)) {
    return res.status(404).json({ error: 'Template file not found' });
  }

  try {
    const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    const worksheet = workbook.worksheets[0];

    // Fetch data for the date
    const flows = db.prepare('SELECT * FROM flow_readings WHERE date = ?').all(date);
    const medicines = db.prepare('SELECT * FROM medicine_logs WHERE date = ?').all(date);
    const water = db.prepare('SELECT * FROM water_quality WHERE date = ?').all(date);
    const facilities = db.prepare('SELECT * FROM facility_logs WHERE date = ?').all(date);

    // Utility to find data by type/field
    const getDataValue = (fieldName) => {
      // Simplified logic: matches mapping.json fields to DB results
      if (fieldName === 'date') return date;

      // Flow logic
      const flowMatch = fieldName.match(/^flow_(\w+)_(\w+)$/);
      if (flowMatch) {
        const [_, type, valType] = flowMatch;
        const r = flows.find(f => f.type === type);
        return r ? (valType === 'raw' ? r.raw_value : r.calculated_flow) : '';
      }

      // Medicine logic
      const medMatch = fieldName.match(/^medicine_(\w+)_(\w+)$/);
      if (medMatch) {
        const [_, name, valType] = medMatch;
        const m = medicines.find(med => med.medicine_name.includes(name));
        return m ? m[valType === 'usage' ? 'usage_amount' : 'purchase_amount'] : '';
      }

      return '';
    };

    // Fill Cells
    const excelMapping = mapping.excel || {};
    for (const [cellAddr, config] of Object.entries(excelMapping)) {
      const field = typeof config === 'string' ? config : config.field;
      const type = typeof config === 'string' ? 'text' : config.type;

      if (type === 'text' || type === 'number') {
        worksheet.getCell(cellAddr).value = getDataValue(field);
      } else if (type === 'image') {
        // Image insertion logic (simplified placeholder)
        // In real use, we'd find the image file path from DB or convention
        const imagePath = path.join(__dirname, 'resources', 'images', date, `${field}.jpg`);
        if (fs.existsSync(imagePath)) {
          const imgId = workbook.addImage({
            filename: imagePath,
            extension: 'jpeg',
          });
          worksheet.addImage(imgId, {
            tl: { col: worksheet.getCell(cellAddr).col - 1, row: worksheet.getCell(cellAddr).row - 1 },
            ext: { width: config.width || 200, height: config.height || 150 }
          });
        }
      }
    }

    // Send file
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Log_${date}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    res.status(500).json({ error: 'Excel generation failed: ' + err.message });
  }
});

// Start Server
app.listen(port + 1, () => {
  console.log(`Local Bridge Server running at http://localhost:${port + 1}`);
});
