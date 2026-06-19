const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const {
  parseNamedRanges,
  getMergedCellExtent,
  insertImageToCell,
  buildExcelTempPath,
  openExcelFile,
} = require('../services/excelOpenService.cjs');
const { getCurrentRecordMetadata } = require('../services/syncMetadataService.cjs');
const {
  isDriveConfigured,
  drive,
  getDriveRootFolderId,
  getOrCreateFolderPath,
  findFileInFolder,
  uploadBufferToFolder,
} = require('../services/driveService.cjs');
const {
  sludgePhotoSegments,
} = require('../services/drivePathService.cjs');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function sanitizeName(name) {
  return String(name || '').replace(/[\\/:*?"<>|]/g, '_').trim();
}

// Canonical local storage:
//   {appDataPath}/사진관리/슬러지/{YYYY}/{YYYYMMDD}-슬러지{N}.jpg
//   {appDataPath}/사진관리/슬러지/{YYYY}/{YYYYMMDD}-청소필증.jpg
// DB columns store only the app URL form, never absolute paths:
//   /사진관리슬러지/{YYYY}/{fileName}
function toDateStamp(date) {
  return String(date || '').replace(/-/g, '').slice(0, 8);
}

function getSludgePhotoDir(appDataPath, date) {
  const year = String(date || '').slice(0, 4);
  return path.join(appDataPath, '사진관리', '슬러지', year);
}

function parseSludgePhotoFileName(fileName, date) {
  const stamp = toDateStamp(date);
  const dateHyphen = String(date || '').slice(0, 10);
  const normalized = String(fileName || '').trim();

  // 최신 포맷: YYYYMMDD-슬러지N.jpg
  let m = normalized.match(new RegExp(`^${stamp}-슬러지(\\d+)\\.jpg$`));
  if (m) {
    return { kind: 'sludge', index: Number(m[1]) || 0 };
  }

  // 레거시 포맷: YYYY-MM-DD-슬러지N.jpg
  m = normalized.match(new RegExp(`^${dateHyphen}-슬러지(\\d+)\\.jpg$`));
  if (m) {
    return { kind: 'sludge', index: Number(m[1]) || 0 };
  }

  // 레거시 단일 포맷: YYYY-MM-DD-반출.jpg
  if (normalized === `${dateHyphen}-반출.jpg`) {
    return { kind: 'sludge', index: 1 };
  }

  // 최신/레거시 청소필증
  if (normalized === `${stamp}-청소필증.jpg` || normalized === `${dateHyphen}-청소필증.jpg`) {
    return { kind: 'certificate', index: 0 };
  }

  return null;
}

function listSludgeSequenceFiles(appDataPath, date) {
  const dir = getSludgePhotoDir(appDataPath, date);
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const fileName of fs.readdirSync(dir)) {
    const parsed = parseSludgePhotoFileName(fileName, date);
    if (!parsed || parsed.kind !== 'sludge') continue;
    files.push({ fileName, index: parsed.index || 0 });
  }
  files.sort((a, b) => a.index - b.index);
  return files;
}

function resolveLatestSludgePhotoInfo(appDataPath, date) {
  const dir = getSludgePhotoDir(appDataPath, date);
  const files = listSludgeSequenceFiles(appDataPath, date);
  if (files.length === 0) return null;
  const last = files[files.length - 1];
  return {
    fileName: last.fileName,
    index: last.index,
    filePath: path.join(dir, last.fileName),
    url: buildSludgePhotoUrl(date, last.fileName),
  };
}

function buildCertificateFileName(date) {
  return `${toDateStamp(date)}-청소필증.jpg`;
}

function buildSludgePhotoFileName(date, index = 1) {
  const safeIndex = Number(index) > 0 ? Number(index) : 1;
  return `${toDateStamp(date)}-슬러지${safeIndex}.jpg`;
}

function buildSludgePhotoUrl(date, fileName) {
  return `/사진관리슬러지/${String(date || '').slice(0, 4)}/${fileName}`;
}

/**
 * JPEG/PNG EXIF에서 촬영 시각 추출
 * EXIF DateTimeOriginal 포맷: "YYYY:MM:DD HH:MM:SS" → "YYYY-MM-DD HH:MM:SS"
 */
function extractExifDateTime(buf) {
  function isDigit(b) { return b >= 0x30 && b <= 0x39; }
  try {
    for (let i = 0; i < buf.length - 19; i++) {
      if (
        isDigit(buf[i])    && isDigit(buf[i+1])  && isDigit(buf[i+2])  && isDigit(buf[i+3])  &&
        buf[i+4]  === 0x3A &&
        isDigit(buf[i+5])  && isDigit(buf[i+6])  &&
        buf[i+7]  === 0x3A &&
        isDigit(buf[i+8])  && isDigit(buf[i+9])  &&
        buf[i+10] === 0x20 &&
        isDigit(buf[i+11]) && isDigit(buf[i+12]) &&
        buf[i+13] === 0x3A &&
        isDigit(buf[i+14]) && isDigit(buf[i+15]) &&
        buf[i+16] === 0x3A &&
        isDigit(buf[i+17]) && isDigit(buf[i+18])
      ) {
        const year = parseInt(buf.slice(i, i+4).toString('ascii'), 10);
        if (year < 2000 || year > 2099) continue;
        const mo  = buf.slice(i+5,  i+7).toString('ascii');
        const day = buf.slice(i+8,  i+10).toString('ascii');
        const hr  = buf.slice(i+11, i+13).toString('ascii');
        const mn  = buf.slice(i+14, i+16).toString('ascii');
        const sc  = buf.slice(i+17, i+19).toString('ascii');
        return `${year}-${mo}-${day} ${hr}:${mn}:${sc}`;
      }
    }
  } catch (_) {}
  return null;
}

function nowDateTimeString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function toLocalDateTimeString(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

/** BMP ??RGB raw ?쎌? ?붿퐫??(24/32bpp, bottom-up) */
function decodeBmpToRgb(buf) {
  const dataOffset    = buf.readUInt32LE(10);
  const width         = buf.readInt32LE(18);
  const heightRaw     = buf.readInt32LE(22);
  const height        = Math.abs(heightRaw);
  const bitsPerPixel  = buf.readUInt16LE(28);
  const bytesPerPixel = bitsPerPixel === 32 ? 4 : 3;
  const rowSize       = Math.floor((bitsPerPixel * width + 31) / 32) * 4;
  const bottomUp      = heightRaw > 0;
  const outBuf        = Buffer.alloc(width * height * 3);
  for (let row = 0; row < height; row++) {
    const srcRow = bottomUp ? height - 1 - row : row;
    const srcOff = dataOffset + srcRow * rowSize;
    const dstOff = row * width * 3;
    for (let col = 0; col < width; col++) {
      const s = srcOff + col * bytesPerPixel;
      outBuf[dstOff + col * 3 + 0] = buf[s + 2];
      outBuf[dstOff + col * 3 + 1] = buf[s + 1];
      outBuf[dstOff + col * 3 + 2] = buf[s + 0];
    }
  }
  return { data: outBuf, width, height };
}

/**
 * 사진 파일을 JPG로 변환 저장 + EXIF 촬영 시각 반환
 * { destPath: string|null, takenAt: string|null }
 */
async function savePhotoToLocal(appDataPath, date, label, srcPath) {
  if (!srcPath || !fs.existsSync(srcPath)) return { destPath: null, takenAt: null };
  const sharp    = require('sharp');
  const srcBuf   = fs.readFileSync(srcPath);
  const isSludge = label === '반출';
  const fileName = isSludge
    ? buildSludgePhotoFileName(date, (resolveLatestSludgePhotoInfo(appDataPath, date)?.index || 0) + 1)
    : buildCertificateFileName(date);
  const destDir  = getSludgePhotoDir(appDataPath, date);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, fileName);

  const isBmp = srcBuf[0] === 0x42 && srcBuf[1] === 0x4D;
  if (isBmp) {
    const bmpRaw = decodeBmpToRgb(srcBuf);
    await require('sharp')(bmpRaw.data, { raw: { width: bmpRaw.width, height: bmpRaw.height, channels: 3 } })
      .jpeg({ quality: 90 }).toFile(destPath);
  } else {
    await sharp(srcBuf).rotate().jpeg({ quality: 90 }).toFile(destPath);
  }

  const fileTime = toLocalDateTimeString(fs.statSync(srcPath).mtime);
  const takenAt = isBmp
    ? (fileTime || nowDateTimeString())
    : (extractExifDateTime(srcBuf) || fileTime || nowDateTimeString());
  return { destPath, takenAt };
}

async function uploadSludgePhotoToDrive(db, date, type, localPath, index = 1) {
  if (!localPath || !fs.existsSync(localPath) || !isDriveConfigured()) return null;
  try {
    const settings = db.prepare('SELECT site_name FROM app_settings WHERE id = 1').get() || {};
    const siteName = settings.site_name || 'Unknown Site';
    const folder = await getOrCreateFolderPath(
      getDriveRootFolderId(),
      sludgePhotoSegments(siteName, date)
    );
    const fileName = type === 'certificate'
      ? buildCertificateFileName(date)
      : buildSludgePhotoFileName(date, index);
    return await uploadBufferToFolder({
      folderId: folder.id,
      fileName,
      buffer: fs.readFileSync(localPath),
      mimeType: 'image/jpeg',
    });
  } catch (err) {
    console.warn(`[sludge-photos] Drive 사진 업로드 실패 (${type}):`, err.message);
    return null;
  }
}

async function findRemoteSludgePhoto(db, date, type) {
  if (!date || !type || !isDriveConfigured()) return null;
  try {
    const settings = db.prepare('SELECT site_name FROM app_settings WHERE id = 1').get() || {};
    const siteName = settings.site_name || 'Unknown Site';
    const folder = await getOrCreateFolderPath(
      getDriveRootFolderId(),
      sludgePhotoSegments(siteName, date)
    );
    const dateHyphen = String(date || '').slice(0, 10);
    const candidates = type === 'certificate'
      ? [buildCertificateFileName(date), `${dateHyphen}-청소필증.jpg`]
      : [buildSludgePhotoFileName(date, 1), `${dateHyphen}-슬러지1.jpg`, `${dateHyphen}-슬러지-1.jpg`];
    for (const fileName of candidates) {
      const file = await findFileInFolder(folder.id, fileName);
      if (file) return { ...file, fileName, folderId: folder.id };
    }
    return null;
  } catch (err) {
    console.warn(`[sludge-photos] Drive 사진 조회 실패 (${type}):`, err.message);
    return null;
  }
}

async function restoreSludgePhotoFromDrive(db, appDataPath, date, type) {
  const remote = await findRemoteSludgePhoto(db, date, type);
  if (!remote?.id || !drive) return null;
  const response = await drive.files.get(
    { fileId: remote.id, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  const buffer = Buffer.from(response.data);
  const fileName = type === 'certificate' ? buildCertificateFileName(date) : buildSludgePhotoFileName(date, 1);
  const destDir = getSludgePhotoDir(appDataPath, date);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, fileName);
  fs.writeFileSync(destPath, buffer);
  return {
    localPath: destPath,
    url: buildSludgePhotoUrl(date, fileName),
    remote,
  };
}

function resolvePhotoUrl(appDataPath, date, label) {
  if (label === '반출') {
    return resolveLatestSludgePhotoInfo(appDataPath, date)?.url || null;
  }
  const hyphenName = `${String(date || '').slice(0, 10)}-청소필증.jpg`;
  const stampName = buildCertificateFileName(date);
  const candidates = [hyphenName, stampName];
  for (const fileName of candidates) {
    const filePath = path.join(getSludgePhotoDir(appDataPath, date), fileName);
    if (fs.existsSync(filePath)) {
      return buildSludgePhotoUrl(date, fileName);
    }
  }
  return null;
}

function resolveLocalPathFromUrl(appDataPath, url) {
  const raw = String(url || '').trim();
  if (path.isAbsolute(raw) && fs.existsSync(raw)) return raw;
  if (!raw.startsWith('/사진관리슬러지/')) return null;
  const relative = raw.replace(/^\/사진관리슬러지\//, '');
  const candidate = path.join(appDataPath, '사진관리', '슬러지', relative);
  return fs.existsSync(candidate) ? candidate : null;
}

function resolveLocalSludgePhotoPath(appDataPath, row, label) {
  const storedUrl = label === '반출' ? row?.sludge_photo_path : row?.certificate_photo_path;
  const storedPath = resolveLocalPathFromUrl(appDataPath, storedUrl);
  if (storedPath) return storedPath;

  const resolvedUrl = resolvePhotoUrl(appDataPath, row?.date, label);
  return resolveLocalPathFromUrl(appDataPath, resolvedUrl);
}

function getMergedSludgeRows(db, start, end) {
  const photoRows = db.prepare(
    'SELECT * FROM sludge_photo_logs WHERE date >= ? AND date <= ? ORDER BY date ASC'
  ).all(start, end);

  const flowRows = db.prepare(
    `SELECT date, sludge_export, raw_value, calculated_flow,
            site_name, author, created_at, last_modified
     FROM flow_readings
     WHERE type = '슬러지' AND date >= ? AND date <= ?
     ORDER BY date ASC`
  ).all(start, end);

  const map = new Map();
  for (const r of photoRows) {
    map.set(String(r.date), { ...r });
  }

  for (const fr of flowRows) {
    const date = String(fr.date || '');
    if (!date) continue;
    const rawAmount = fr?.sludge_export != null
      ? fr.sludge_export
      : (fr?.raw_value != null ? fr.raw_value : null);
    const amount = rawAmount != null ? Number(rawAmount) : null;
    if (!map.has(date)) {
      // flow_readings만 있는 날짜는 실제 반출량 값이 있을 때만 표시
      if (amount == null || !Number.isFinite(amount)) continue;
      map.set(date, {
        date,
        sludge_amount: amount,
        sludge_photo_path: null,
        sludge_photo_taken_at: null,
        certificate_photo_path: null,
        note: null,
        site_name: fr.site_name || null,
        author: fr.author || null,
        created_at: fr.created_at || null,
        last_modified: fr.last_modified || fr.created_at || null,
      });
      continue;
    }

    const cur = map.get(date);
    if ((cur.sludge_amount == null || cur.sludge_amount === '') && amount != null) {
      cur.sludge_amount = amount;
    }
  }

  return Array.from(map.values()).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

module.exports = function (db, baseDir, appDataPath) {

  /** GET /api/sludge-photos?year=2026&month=4 */
  router.get('/api/sludge-photos', (req, res) => {
    try {
      const year  = parseInt(req.query.year,  10);
      const month = parseInt(req.query.month, 10);
      if (!year || !month || month < 1 || month > 12) {
        return res.status(400).json({ success: false, error: '유효하지 않은 연월입니다.' });
      }
      const mm      = String(month).padStart(2, '0');
      const start   = `${year}-${mm}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const end     = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
      const rows = getMergedSludgeRows(db, start, end);
      const items = rows.map(r => ({
        ...r,
        sludge_photo_url      : resolvePhotoUrl(appDataPath, r.date, '반출'),
        certificate_photo_url : resolvePhotoUrl(appDataPath, r.date, '청소필증'),
      }));
      res.json({ success: true, items });
    } catch (err) {
      console.error('[sludge-photos GET]', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /** GET /api/sludge-photos/flow-amount?date=YYYY-MM-DD */
  router.get('/api/sludge-photos/flow-amount', (req, res) => {
    try {
      const { date } = req.query;
      if (!date) return res.status(400).json({ success: false, error: '날짜가 없습니다.' });
      const row = db.prepare(
        "SELECT sludge_export FROM flow_readings WHERE date = ? AND type = '슬러지'"
      ).get(date);
      res.json({ success: true, amount: row?.sludge_export ?? null });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /** GET /api/sludge-ledger?year=2026&month=4 */
  router.get('/api/sludge-ledger', (req, res) => {
    try {
      const year = parseInt(req.query.year, 10);
      const month = parseInt(req.query.month, 10);
      if (!year || !month || month < 1 || month > 12) {
        return res.status(400).json({ success: false, error: '유효하지 않은 연월입니다.' });
      }

      const mm = String(month).padStart(2, '0');
      const start = `${year}-${mm}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const end = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
      const rows = getMergedSludgeRows(db, start, end).map((r) => ({
        date: r.date,
        sludge_amount: r.sludge_amount,
        sludge_photo_taken_at: r.sludge_photo_taken_at,
        note: r.note,
        last_modified: r.last_modified,
      }));

      const appSettings = db.prepare('SELECT site_name FROM app_settings WHERE id = 1').get();
      const ledgerSettings = db.prepare('SELECT company_name, default_amount FROM sludge_export_settings WHERE id = 1').get();

      const totalAmount = rows.reduce((sum, row) => {
        const n = Number(row?.sludge_amount);
        return Number.isFinite(n) ? sum + n : sum;
      }, 0);

      res.json({
        success: true,
        year,
        month,
        lastDay,
        siteName: appSettings?.site_name || '',
        companyName: ledgerSettings?.company_name || '',
        defaultAmount: Number(ledgerSettings?.default_amount) || 0,
        summary: {
          records: rows.length,
          totalAmount,
        },
        items: rows,
      });
    } catch (err) {
      console.error('[sludge-ledger GET]', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /** POST /api/sludge-photos/save */
  router.post('/api/sludge-photos/save', async (req, res) => {
    try {
      const { date, sludge_amount, sludge_photo_path, certificate_photo_path, note } = req.body;
      if (!date) return res.status(400).json({ success: false, error: '날짜가 없습니다.' });

      const metadata = getCurrentRecordMetadata(db, req.body);

      const { destPath: sludgeLocalPath, takenAt: newTakenAt } = await savePhotoToLocal(appDataPath, date, '반출', sludge_photo_path);
      const { destPath: certificateLocalPath } = await savePhotoToLocal(appDataPath, date, '청소필증', certificate_photo_path);
      const sludgeIndex = sludgeLocalPath
        ? (parseSludgePhotoFileName(path.basename(sludgeLocalPath), date)?.index || 1)
        : 1;
      await uploadSludgePhotoToDrive(db, date, 'sludge', sludgeLocalPath, sludgeIndex);
      await uploadSludgePhotoToDrive(db, date, 'certificate', certificateLocalPath, 1);

      const sludgeUrl = resolvePhotoUrl(appDataPath, date, '반출');
      const certUrl   = resolvePhotoUrl(appDataPath, date, '청소필증');
      const now       = new Date().toISOString();

      // 기존 EXIF 유지 (새 사진 업로드 시에만 덮어쓰기)
      const existing    = db.prepare('SELECT sludge_photo_taken_at FROM sludge_photo_logs WHERE date = ?').get(date);
      const finalTakenAt = sludge_photo_path
        ? (newTakenAt ?? existing?.sludge_photo_taken_at ?? null)
        : (existing?.sludge_photo_taken_at ?? null);

      db.prepare(`
        INSERT INTO sludge_photo_logs
          (date, sludge_amount, sludge_photo_path, sludge_photo_taken_at,
           certificate_photo_path, note, site_id, site_name, author, created_at, last_modified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
          sludge_amount          = excluded.sludge_amount,
          sludge_photo_path      = excluded.sludge_photo_path,
          sludge_photo_taken_at  = excluded.sludge_photo_taken_at,
          certificate_photo_path = excluded.certificate_photo_path,
          note                   = excluded.note,
          site_id                = excluded.site_id,
          site_name              = excluded.site_name,
          author                 = excluded.author,
          last_modified          = excluded.last_modified
      `).run(
        date,
        sludge_amount != null ? Number(sludge_amount) : null,
        sludgeUrl, finalTakenAt, certUrl,
        note || null, metadata.siteId, metadata.siteName, metadata.author, now, now
      );

      // flow_readings 동기화
      if (sludge_amount != null && sludge_amount !== '') {
        const flowRow = db.prepare(
          "SELECT id FROM flow_readings WHERE date = ? AND type = '슬러지'"
        ).get(date);
        if (flowRow) {
          db.prepare(
            "UPDATE flow_readings SET sludge_export = ?, last_modified = ?, is_synced = 0 WHERE date = ? AND type = '슬러지'"
          ).run(Number(sludge_amount), now, date);
        } else {
          db.prepare(`
            INSERT INTO flow_readings
              (date, type, sludge_export, site_id, site_name, author, created_at, last_modified, is_synced)
            VALUES (?, '슬러지', ?, ?, ?, ?, ?, ?, 0)
          `).run(date, Number(sludge_amount), metadata.siteId, metadata.siteName, metadata.author, now, now);
        }
      }

      res.json({
        success: true,
        sludge_photo_url      : sludgeUrl,
        certificate_photo_url : certUrl,
        sludge_photo_taken_at : finalTakenAt,
      });
    } catch (err) {
      console.error('[sludge-photos save]', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /** POST /api/sludge-photos/upload-photo  (multipart, ???섍꼍?? */
  router.post('/api/sludge-photos/upload-photo', upload.single('photo'), async (req, res) => {
    try {
      const { date, type } = req.query;
      if (!date || !type) return res.status(400).json({ success: false, error: '날짜/타입 없음' });
      if (!req.file)       return res.status(400).json({ success: false, error: '파일 없음' });

      const label    = type === 'certificate' ? '청소필증' : '반출';
      const sharp    = require('sharp');
      const isSludge = label === '반출';
      const fileName = isSludge
        ? buildSludgePhotoFileName(date, (resolveLatestSludgePhotoInfo(appDataPath, date)?.index || 0) + 1)
        : buildCertificateFileName(date);
      const destDir  = getSludgePhotoDir(appDataPath, date);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      const destPath = path.join(destDir, fileName);

      const srcBuf = req.file.buffer;
      const clientTakenAt = typeof req.body?.takenAt === 'string' ? req.body.takenAt.trim() : '';
      const isBmp  = srcBuf[0] === 0x42 && srcBuf[1] === 0x4D;
      if (isBmp) {
        const bmpRaw = decodeBmpToRgb(srcBuf);
        await require('sharp')(bmpRaw.data, { raw: { width: bmpRaw.width, height: bmpRaw.height, channels: 3 } })
          .jpeg({ quality: 90 }).toFile(destPath);
      } else {
        await sharp(srcBuf).rotate().jpeg({ quality: 90 }).toFile(destPath);
      }

      const url     = label === '반출'
        ? buildSludgePhotoUrl(date, fileName)
        : buildSludgePhotoUrl(date, buildCertificateFileName(date));
      const takenAt = type === 'sludge'
        ? (isBmp
            ? (clientTakenAt || nowDateTimeString())
            : (extractExifDateTime(srcBuf) || clientTakenAt || nowDateTimeString()))
        : null;
      const now     = new Date().toISOString();
      const sludgeIndex = isSludge
        ? (parseSludgePhotoFileName(fileName, date)?.index || 1)
        : 1;
      await uploadSludgePhotoToDrive(db, date, type === 'certificate' ? 'certificate' : 'sludge', destPath, sludgeIndex);

      const existingRow = db.prepare('SELECT id FROM sludge_photo_logs WHERE date = ?').get(date);
      if (existingRow) {
        if (type === 'sludge') {
          db.prepare(
            'UPDATE sludge_photo_logs SET sludge_photo_path = ?, sludge_photo_taken_at = ?, last_modified = ? WHERE date = ?'
          ).run(url, takenAt, now, date);
        } else {
          db.prepare(
            'UPDATE sludge_photo_logs SET certificate_photo_path = ?, last_modified = ? WHERE date = ?'
          ).run(url, now, date);
        }
      } else {
        const metadata = getCurrentRecordMetadata(db, req.body);
        db.prepare(`
          INSERT INTO sludge_photo_logs
            (date, sludge_photo_path, sludge_photo_taken_at, certificate_photo_path,
             site_id, site_name, author, created_at, last_modified)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          date,
          type === 'sludge'       ? url : null,
          type === 'sludge'       ? takenAt : null,
          type === 'certificate'  ? url : null,
          metadata.siteId, metadata.siteName, metadata.author, now, now
        );
      }

      res.json({ success: true, url, sludge_photo_taken_at: takenAt });
    } catch (err) {
      console.error('[sludge-photos upload-photo]', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/api/sludge-photos/remote-photos/check', async (req, res) => {
    try {
      const { date, types } = req.body || {};
      if (!date || !Array.isArray(types)) {
        return res.status(400).json({ success: false, error: 'date와 types가 필요합니다.' });
      }
      const items = [];
      for (const type of types) {
        const remote = await findRemoteSludgePhoto(db, date, type);
        if (remote) items.push({ type, fileName: remote.fileName, driveFileId: remote.id });
      }
      res.json({ success: true, count: items.length, items });
    } catch (err) {
      console.error('[sludge-photos remote-photos/check]', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/api/sludge-photos/remote-photos/restore', async (req, res) => {
    try {
      const { date, types } = req.body || {};
      if (!date || !Array.isArray(types)) {
        return res.status(400).json({ success: false, error: 'date와 types가 필요합니다.' });
      }
      const restored = [];
      const now = new Date().toISOString();
      for (const type of types) {
        const result = await restoreSludgePhotoFromDrive(db, appDataPath, date, type);
        if (result?.url) {
          if (type === 'certificate') {
            db.prepare('UPDATE sludge_photo_logs SET certificate_photo_path = ?, last_modified = ? WHERE date = ?')
              .run(result.url, now, date);
          } else {
            db.prepare('UPDATE sludge_photo_logs SET sludge_photo_path = ?, last_modified = ? WHERE date = ?')
              .run(result.url, now, date);
          }
          restored.push({ type, url: result.url });
        }
      }
      res.json({ success: true, count: restored.length, items: restored });
    } catch (err) {
      console.error('[sludge-photos remote-photos/restore]', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /** DELETE /api/sludge-photos/:date */
  router.delete('/api/sludge-photos/:date', (req, res) => {
    try {
      const { date } = req.params;
      const sludgeDir = getSludgePhotoDir(appDataPath, date);
      const stamp = toDateStamp(date);
      if (fs.existsSync(sludgeDir)) {
        const dateHyphen = String(date || '').slice(0, 10);
        const re = new RegExp(`^(?:${stamp}|${dateHyphen})-슬러지-?\\d+\\.jpg$`);
        for (const fileName of fs.readdirSync(sludgeDir)) {
          if (re.test(String(fileName))) {
            const fp = path.join(sludgeDir, fileName);
            if (fs.existsSync(fp)) fs.unlinkSync(fp);
          }
        }
        for (const certName of [buildCertificateFileName(date), `${dateHyphen}-청소필증.jpg`]) {
          const cert = path.join(sludgeDir, certName);
          if (fs.existsSync(cert)) fs.unlinkSync(cert);
        }
      }
      const deletePhotoLog = db.prepare('DELETE FROM sludge_photo_logs WHERE date = ?');
      const deleteFlowReading = db.prepare(
        "DELETE FROM flow_readings WHERE date = ? AND type = '슬러지'"
      );
      const deleted = db.transaction(() => ({
        photoLogs: deletePhotoLog.run(date).changes,
        flowReadings: deleteFlowReading.run(date).changes,
      }))();
      res.json({ success: true, deleted });
    } catch (err) {
      console.error('[sludge-photos DELETE]', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /** POST /api/sludge-photos/export  body: { year, month } */
  router.post('/api/sludge-photos/export', async (req, res) => {
    try {
      const { year, month } = req.body;
      if (!year || !month) return res.status(400).json({ success: false, error: '연월 없음' });

      const { resolveReportTemplatePath } = require('../services/reportTemplateService.cjs');
      const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, '슬러지사진대지');
      if (!templateInfo?.absolutePath) {
        return res.status(404).json({
          success: false,
          error: '슬러지사진대지 템플릿이 없습니다. 설정에서 업로드해 주세요.',
        });
      }
      const templatePath = templateInfo.absolutePath;
      if (!['.xlsx', '.xls', '.xlsm'].includes(path.extname(templatePath).toLowerCase())) {
        return res.status(400).json({ success: false, error: '엑셀 형식의 템플릿만 지원합니다.' });
      }

      const mm      = String(month).padStart(2, '0');
      const start   = `${year}-${mm}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const end     = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
      const rows = getMergedSludgeRows(db, start, end);
      const settings = db.prepare('SELECT site_name FROM app_settings WHERE id = 1').get();

      const items = rows.map(r => {
        const sl = resolveLocalSludgePhotoPath(appDataPath, r, '반출');
        const cl = resolveLocalSludgePhotoPath(appDataPath, r, '청소필증');
        return {
          ...r,
          sludge_photo_local      : sl && fs.existsSync(sl) ? sl : null,
          certificate_photo_local : cl && fs.existsSync(cl) ? cl : null,
        };
      }).filter((item) => {
        const amount = Number(item.sludge_amount);
        return Number.isFinite(amount) && amount > 0;
      }).sort((a, b) => {
        const toKey = (d) => {
          const s = String(d || '');
          const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
          if (!m) return Number.MAX_SAFE_INTEGER;
          return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
        };
        return toKey(a.date) - toKey(b.date);
      });

      const outputFileName = `슬러지사진대지_${year}_${mm}_${Date.now()}.xlsx`;
      const outputPath = buildExcelTempPath('osoo-sludge-photo', outputFileName);
      await exportSludgePhotoXlsx({
        templatePath, outputPath, year, month, items, siteName: settings?.site_name || ''
      });
      await openExcelFile(outputPath);
      res.json({ success: true, itemCount: items.length });
    } catch (err) {
      console.error('[sludge-photos export]', err);
      if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
    }
  });

  /** POST /api/sludge-photos/export-ledger  body: { year, month } */
  router.post('/api/sludge-photos/export-ledger', async (req, res) => {
    try {
      const { year, month } = req.body;
      if (!year || !month) return res.status(400).json({ success: false, error: '연월 없음' });

      const { resolveReportTemplatePath } = require('../services/reportTemplateService.cjs');
      const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, '슬러지반출관리대장');
      if (!templateInfo?.absolutePath) {
        return res.status(404).json({
          success: false,
          error: '슬러지반출관리대장 템플릿이 없습니다. 설정에서 업로드해 주세요.',
        });
      }

      const templatePath = templateInfo.absolutePath;
      if (!['.xlsx', '.xls', '.xlsm'].includes(path.extname(templatePath).toLowerCase())) {
        return res.status(400).json({ success: false, error: '엑셀 형식의 템플릿만 지원합니다.' });
      }

      const mm = String(month).padStart(2, '0');
      const start = `${year}-${mm}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const end = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
      const rows = getMergedSludgeRows(db, start, end);

      const settings = db.prepare('SELECT site_name FROM app_settings WHERE id = 1').get();
      const ledgerSettings = db.prepare('SELECT company_name, default_amount FROM sludge_export_settings WHERE id = 1').get();
      const outputFileName = `슬러지반출관리대장_${year}_${mm}_${Date.now()}.xlsx`;
      const outputPath = buildExcelTempPath('osoo-sludge-ledger', outputFileName);

      await exportSludgeLedgerXlsx({
        templatePath,
        outputPath,
        year,
        month,
        items: rows,
        siteName: settings?.site_name || '',
        companyName: ledgerSettings?.company_name || '',
        defaultAmount: Number(ledgerSettings?.default_amount) || 0,
      });

      await openExcelFile(outputPath);
      res.json({ success: true });
    } catch (err) {
      console.error('[sludge-photos export-ledger]', err);
      if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};

// ─── xlsx export ──────────────────────────────────────────────────────────────
async function exportSludgePhotoXlsx({ templatePath, outputPath, year, month, items, siteName }) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templatePath);

  // 기존 이미지 초기화
  wb.media = [];
  wb.worksheets.forEach(ws => { ws._media = []; });

  // named range 맵 (excelOpenService 공통 모듈)
  const namedMap = parseNamedRanges(wb);
  console.log('[sludge export] named ranges:', Object.keys(namedMap));

  const ITEMS_PER_SHEET = 2;
  const totalSheets = Math.ceil(items.length / ITEMS_PER_SHEET) || 1;
  const templateSheet = wb.worksheets[0];

  function cloneTemplateToSheet(src, dst) {
    const deep = (v) => JSON.parse(JSON.stringify(v || {}));

  // 기존 이미지 초기화
    dst.properties = deep(src.properties);
    dst.pageSetup = deep(src.pageSetup);
    dst.headerFooter = deep(src.headerFooter);
    dst.views = deep(src.views || []);
    dst.state = src.state;

  // 기존 이미지 초기화
    dst.columns = (src.columns || []).map(c => ({
      width: c.width,
      hidden: c.hidden,
      outlineLevel: c.outlineLevel,
      style: c.style ? deep(c.style) : undefined,
    }));

    // 행 높이/행 스타일 복사
    src.eachRow({ includeEmpty: true }, (srcRow, rowNum) => {
      const dstRow = dst.getRow(rowNum);
      dstRow.height = srcRow.height;
      dstRow.hidden = srcRow.hidden;
      dstRow.outlineLevel = srcRow.outlineLevel;
      dstRow.style = deep(srcRow.style);
      dstRow.commit();
    });

    // 시트 기본 속성 복사
    // (ExcelJS merge 처리 과정에서 일부 경계 스타일이 소실되는 케이스 방지)
    const merges = src.model?.merges || [];
    for (const m of merges) {
      try { dst.mergeCells(m); } catch (_) {}
    }

    // 셀 전체 매트릭스 복사 (빈 셀 포함)
    const maxRow = src.rowCount || 0;
    const maxCol = src.columnCount || 0;
    for (let r = 1; r <= maxRow; r++) {
      for (let c = 1; c <= maxCol; c++) {
        const srcCell = src.getCell(r, c);
        const dstCell = dst.getCell(r, c);
        dstCell.value = srcCell.value;
        dstCell.style = deep(srcCell.style);
      }
    }
  }

  // 1) 먼저 빈 템플릿 시트를 모두 준비 (원본 변형 없이)
  const sheets = [templateSheet];
  for (let si = 1; si < totalSheets; si++) {
    const ws = wb.addWorksheet(`사진대지_${si + 1}`);
    cloneTemplateToSheet(templateSheet, ws);
    sheets.push(ws);
  }

  // 2) 그 다음 시트별로 데이터 바인딩 (항상 현재 시트 기준)
  for (let si = 0; si < sheets.length; si++) {
    const ws = sheets[si];

    // 양식 고정 좌표/크기(포인트 pt) — 사용자 실측값
    const photoBoxBySlot = {
      1: { leftPt: 81.75, topPt: 155.91, boxWidthPt: 191.33, boxHeightPt: 141.69 },
      2: { leftPt: 81.45, topPt: 459.54, boxWidthPt: 191.33, boxHeightPt: 141.69 },
    };
    const certBoxBySlot = {
      1: { leftPt: 316.44, topPt: 129.27, boxWidthPt: 94.50, boxHeightPt: 193.50 },
      2: { leftPt: 316.59, topPt: 429.75, boxWidthPt: 94.50, boxHeightPt: 193.50 },
    };

    function setCellOnSheet(name, value) {
      const info = namedMap[name];
      if (!info) { console.warn(`[sludge export] named range 없음: ${name}`); return; }
      ws.getCell(info.address).value = value;
    }

    function findNamedRange(...names) {
      for (const name of names) {
        if (namedMap[name]) return namedMap[name];
      }
      return null;
    }

    // 이전 값 잔존 방지: 슬롯 1~2를 먼저 초기화
    for (let n = 1; n <= ITEMS_PER_SHEET; n++) {
      setCellOnSheet(`날짜${n}`, '');
      setCellOnSheet(`반출량${n}`, null);
    }

    if (namedMap['시트명']) setCellOnSheet('시트명', siteName || '');

    const sheetItems = items.slice(si * ITEMS_PER_SHEET, (si + 1) * ITEMS_PER_SHEET);
    for (let i = 0; i < sheetItems.length; i++) {
      const item = sheetItems[i];
      const n = i + 1;

      setCellOnSheet(`날짜${n}`, item.date ? item.date.replace(/-/g, '.') : '');
      if (item.sludge_amount != null) setCellOnSheet(`반출량${n}`, Number(item.sludge_amount));

      // 반출사진 삽입: 셀 가로의 90% 기준, 비율 유지 + 중앙 정렬
      if (item.sludge_photo_local) {
        const info = findNamedRange(`사진${n}`, `반출사진${n}`, `슬러지사진${n}`);
        if (info) {
          const extent = getMergedCellExtent(ws, info.col, info.row);
          try {
            await insertImageToCell(wb, ws, extent, item.sludge_photo_local, {
              fitBy: 'width',
              pct: 1.0,
              ...photoBoxBySlot[n],
            });
          } catch (e) {
            console.error(`[sludge export] 사진${n} 삽입 실패:`, e.message);
          }
        } else {
          console.warn(`[sludge export] 반출사진 named range 없음: 사진${n}`);
        }
      }

      // 청소필증 삽입: 셀 세로의 80% 기준, 비율 유지 + 중앙 정렬
      if (item.certificate_photo_local) {
        const info = findNamedRange(`청소필증${n}`, `필증${n}`, `증빙${n}`, `사진필증${n}`);
        if (info) {
          const extent = getMergedCellExtent(ws, info.col, info.row);
          try {
            await insertImageToCell(wb, ws, extent, item.certificate_photo_local, {
              fitBy: 'height',
              pct: 1.0,
              ...certBoxBySlot[n],
            });
          } catch (e) {
            console.error(`[sludge export] 사진${n} 삽입 실패:`, e.message);
          }
        } else {
          console.warn(`[sludge export] 청소필증 named range 없음: 청소필증${n}/필증${n}`);
        }
      }
    }
  }

  await wb.xlsx.writeFile(outputPath);
}

function _parseAddressRef(rangeRef) {
  if (!rangeRef) return null;
  const s = String(rangeRef).trim();
  const m = s.match(/^(?:'([^']+)'|([^'!][^!]*))!\$?([A-Z]+)\$?(\d+)$/);
  if (!m) return null;
  const sheetName = (m[1] || m[2] || '').trim();
  const col = m[3];
  const row = parseInt(m[4], 10);
  if (!sheetName || !col || !row) return null;
  return { sheetName, col, row, address: `${col}${row}` };
}

function _colLabel(n) {
  let x = Number(n);
  let out = '';
  while (x > 0) {
    const m = (x - 1) % 26;
    out = String.fromCharCode(65 + m) + out;
    x = Math.floor((x - 1) / 26);
  }
  return out;
}

function _parseRangeRef(rangeRef) {
  if (!rangeRef) return null;
  const s = String(rangeRef).trim();
  const m = s.match(/^(?:'([^']+)'|([^'!][^!]*))!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/);
  if (!m) return null;
  const sheetName = (m[1] || m[2] || '').trim();
  const c1 = _colNum(m[3]);
  const r1 = parseInt(m[4], 10);
  const c2 = _colNum(m[5]);
  const r2 = parseInt(m[6], 10);
  if (!sheetName || !c1 || !c2 || !r1 || !r2) return null;
  return {
    sheetName,
    startCol: Math.min(c1, c2),
    endCol: Math.max(c1, c2),
    startRow: Math.min(r1, r2),
    endRow: Math.max(r1, r2),
  };
}

function _splitRangeRefs(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  const refs = [];
  let token = '';
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'") inQuote = !inQuote;
    if (ch === ',' && !inQuote) {
      if (token.trim()) refs.push(token.trim());
      token = '';
      continue;
    }
    token += ch;
  }
  if (token.trim()) refs.push(token.trim());
  return refs;
}

function _colNum(col) {
  let n = 0;
  for (const c of String(col || '').toUpperCase()) n = (n * 26) + (c.charCodeAt(0) - 64);
  return n;
}

function parseNamedRangeCells(wb, name) {
  const model = wb.definedNames?.model;
  const list = Array.isArray(model) ? model : [];
  const out = [];

  for (const entry of list) {
    if (!entry || String(entry.name || '').trim() !== String(name || '').trim()) continue;
    const ranges = Array.isArray(entry.ranges) ? entry.ranges : [entry.ranges];
    for (const raw of ranges) {
      for (const ref of _splitRangeRefs(raw)) {
        const p = _parseAddressRef(ref);
        if (p) {
          out.push(p);
          continue;
        }

        const rg = _parseRangeRef(ref);
        if (rg) {
          for (let r = rg.startRow; r <= rg.endRow; r++) {
            for (let c = rg.startCol; c <= rg.endCol; c++) {
              const col = _colLabel(c);
              out.push({ sheetName: rg.sheetName, col, row: r, address: `${col}${r}` });
            }
          }
        }
      }
    }
  }

  out.sort((a, b) => {
    const sa = String(a.sheetName).localeCompare(String(b.sheetName), 'ko');
    if (sa !== 0) return sa;
    if (a.row !== b.row) return a.row - b.row;
    return _colNum(a.col) - _colNum(b.col);
  });
  return out;
}

function _toDateKey(y, m, d) {
  const yy = Number(y);
  const mm = Number(m);
  const dd = Number(d);
  if (!yy || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function _resolveDateKeyFromCell(value, year, month) {
  const y = Number(year);
  const m = Number(month);
  if (value == null) return null;

  // Excel 날짜 셀(Date 객체)
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return _toDateKey(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  // 숫자만 들어온 경우: 해당 월의 day로 해석
  if (typeof value === 'number' && Number.isFinite(value)) {
    const day = Math.floor(value);
    return _toDateKey(y, m, day);
  }

  const s = String(value).trim();
  if (!s) return null;

  // yyyy.mm.dd / yyyy-mm-dd / yyyy/mm/dd
  let m1 = s.match(/(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
  if (m1) return _toDateKey(m1[1], m1[2], m1[3]);

  // mm.dd / mm-dd / mm/dd
  m1 = s.match(/^(\d{1,2})[.\/-](\d{1,2})$/);
  if (m1) return _toDateKey(y, m1[1], m1[2]);

  // dd (순수 일자 문자열)
  m1 = s.match(/^(\d{1,2})$/);
  if (m1) return _toDateKey(y, m, m1[1]);

  return null;
}

function _toHHmm(item) {
  const raw = item?.sludge_photo_taken_at || item?.last_modified || '';
  if (!raw) return '';
  return String(raw).slice(11, 16);
}

async function exportSludgeLedgerXlsx({ templatePath, outputPath, year, month, items, siteName, companyName, defaultAmount }) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templatePath);

  const ws = wb.worksheets[0];
  if (!ws) throw new Error('슬러지반출관리대장 템플릿 시트를 찾을 수 없습니다.');

  const namedMap = parseNamedRanges(wb);
  const seqCells = parseNamedRangeCells(wb, '순번');
  const dateCells = parseNamedRangeCells(wb, '날짜');
  const companyCells = parseNamedRangeCells(wb, '업체명');
  const timeCells = parseNamedRangeCells(wb, '시간');
  const weightCells = parseNamedRangeCells(wb, '중량');
  const noteCells = parseNamedRangeCells(wb, '비고');

  if (namedMap['대장명']) {
    ws.getCell(namedMap['대장명'].address).value = `${year}년 ${Number(month)}월 슬러지반출 관리대장`;
  }
  if (namedMap['현장명']) {
    ws.getCell(namedMap['현장명'].address).value = siteName || '';
  }

  const daysInMonth = new Date(Number(year), Number(month), 0).getDate();
  const mm = String(month).padStart(2, '0');
  const rowCount = Math.max(seqCells.length, dateCells.length, companyCells.length, timeCells.length, weightCells.length, noteCells.length);
  const byDate = new Map((items || []).map((it) => [String(it.date || ''), it]));

  for (let i = 0; i < rowCount; i++) {
    const dateInfo = dateCells[i];
    const seqInfo = seqCells[i];
    let dateKey = null;
    const day = i + 1;
    if (day <= daysInMonth) {
      dateKey = _toDateKey(year, month, day);
      if (seqInfo?.sheetName === ws.name) {
        ws.getCell(seqInfo.address).value = day;
      }
      if (dateInfo?.sheetName === ws.name) {
        ws.getCell(dateInfo.address).value = `${year}-${mm}-${String(day).padStart(2, '0')}`;
      }
    } else {
      if (seqInfo?.sheetName === ws.name) {
        ws.getCell(seqInfo.address).value = null;
      }
      if (dateInfo?.sheetName === ws.name) {
        ws.getCell(dateInfo.address).value = '';
      }
    }

    const item = dateKey ? byDate.get(dateKey) : null;

    if (companyCells[i]?.sheetName === ws.name) {
      ws.getCell(companyCells[i].address).value = item ? (companyName || '') : '';
    }
    if (timeCells[i]?.sheetName === ws.name) {
      const t = _toHHmm(item);
      ws.getCell(timeCells[i].address).value = t;
    }
    if (weightCells[i]?.sheetName === ws.name) {
      if (!item) {
        ws.getCell(weightCells[i].address).value = null;
      } else if (item?.sludge_amount != null && item?.sludge_amount !== '') {
        ws.getCell(weightCells[i].address).value = Number(item.sludge_amount);
      } else {
        ws.getCell(weightCells[i].address).value = Number(defaultAmount) || 0;
      }
    }
    if (noteCells[i]?.sheetName === ws.name) {
      ws.getCell(noteCells[i].address).value = item?.note || '';
    }
  }

  await wb.xlsx.writeFile(outputPath);
}
