const express = require('express');
const sqlite3 = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const multer = require('multer');
const sharp = require('sharp');
const ExcelJS = require('exceljs');
require('dotenv').config({ path: '.env.local' });

const upload = multer({ storage: multer.memoryStorage() });

const app = express();
const port = process.env.VITE_PORT || 8900;

app.use(cors());
app.use(express.json());

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
    is_remote BOOLEAN DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    author TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    view_count INTEGER DEFAULT 0,
    attachments TEXT
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

// API Endpoints

// Authentication & Member Sync
app.post('/api/auth/login', (req, res) => {
  const { name, password } = req.body;

  // 1. Check local DB first
  const member = db.prepare('SELECT * FROM members WHERE name = ? AND password = ?').get(name, password);

  if (member) {
    return res.json({ success: true, user: member, source: 'local' });
  }

  // 2. If not found, frontend will handle cloud sync (Drive API)
  // After cloud sync, frontend will call /api/members to "install" the user locally
  res.status(404).json({ success: false, message: 'User not found locally' });
});

app.post('/api/members', (req, res) => {
  const { name, password, phone, site_name1, site_name2, target_lat, target_lng, radius_m, notes, role } = req.body;
  try {
    const info = db.prepare(`
            INSERT OR REPLACE INTO members (name, password, phone, site_name1, site_name2, target_lat, target_lng, radius_m, notes, role, last_sync_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(name, password, phone, site_name1, site_name2, target_lat, target_lng, radius_m, notes, role);

    res.json({ success: true, id: info.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Attendance tracking
app.post('/api/attendance/login', (req, res) => {
  const { name, is_remote } = req.body;
  const date = new Date().toISOString().split('T')[0];
  try {
    const info = db.prepare(`
            INSERT INTO attendance (member_name, date, login_time, is_remote)
            VALUES (?, ?, CURRENT_TIMESTAMP, ?)
        `).run(name, date, is_remote ? 1 : 0);
    res.json({ success: true, id: info.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/attendance/logout', (req, res) => {
  const { name } = req.body;
  const date = new Date().toISOString().split('T')[0];
  try {
    db.prepare(`
            UPDATE attendance 
            SET logout_time = CURRENT_TIMESTAMP 
            WHERE member_name = ? AND date = ? AND logout_time IS NULL
        `).run(name, date);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/attendance', (req, res) => {
  const { date } = req.query;
  try {
    const logs = db.prepare('SELECT * FROM attendance WHERE date = ? ORDER BY login_time DESC').all(date);
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
