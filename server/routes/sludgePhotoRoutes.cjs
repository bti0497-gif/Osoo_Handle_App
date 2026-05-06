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

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function sanitizeName(name) {
  return String(name || '').replace(/[\\/:*?"<>|]/g, '_').trim();
}

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

  // 理쒖떊 ?щ㎎: YYYYMMDD-슬러지N.jpg
  let m = normalized.match(new RegExp(`^${stamp}-슬러지(\\d+)\\.jpg$`));
  if (m) {
    return { kind: 'sludge', index: Number(m[1]) || 0 };
  }

  // ?덇굅???щ㎎: YYYY-MM-DD-슬러지N.jpg
  m = normalized.match(new RegExp(`^${dateHyphen}-슬러지(\\d+)\\.jpg$`));
  if (m) {
    return { kind: 'sludge', index: Number(m[1]) || 0 };
  }

  // ?덇굅???⑥씪 ?щ㎎: YYYY-MM-DD-諛섏텧.jpg
  if (normalized === `${dateHyphen}-諛섏텧.jpg`) {
    return { kind: 'sludge', index: 1 };
  }

  // 理쒖떊/?덇굅??泥?냼?꾩쬆
  if (normalized === `${stamp}-泥?냼?꾩쬆.jpg` || normalized === `${dateHyphen}-泥?냼?꾩쬆.jpg`) {
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
    url: `/사진관리슬러지/${String(date).slice(0, 4)}/${last.fileName}`,
  };
}

function buildCertificateFileName(date) {
  return `${toDateStamp(date)}-泥?냼?꾩쬆.jpg`;
}

/**
 * JPEG/PNG EXIF?먯꽌 珥ъ쁺 ?쒓컖 異붿텧
 * EXIF DateTimeOriginal ?щ㎎: "YYYY:MM:DD HH:MM:SS" ??"YYYY-MM-DD HH:MM:SS"
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
 * ?ъ쭊 ?뚯씪??JPG濡?蹂?????+ EXIF 珥ъ쁺 ?쒓컖 諛섑솚
 * { destPath: string|null, takenAt: string|null }
 */
async function savePhotoToLocal(appDataPath, date, label, srcPath) {
  if (!srcPath || !fs.existsSync(srcPath)) return { destPath: null, takenAt: null };
  const sharp    = require('sharp');
  const srcBuf   = fs.readFileSync(srcPath);
  const year     = String(date).slice(0, 4);
  const stamp    = toDateStamp(date);
  const isSludge = label === '諛섏텧';
  const fileName = isSludge
    ? `${stamp}-슬러지${(resolveLatestSludgePhotoInfo(appDataPath, date)?.index || 0) + 1}.jpg`
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

function photoUrl(date, label) {
  const year = String(date).slice(0, 4);
  if (label === '諛섏텧') {
    const stamp = toDateStamp(date);
    return `/사진관리슬러지/${year}/${stamp}-슬러지1.jpg`;
  }
  return `/사진관리슬러지/${year}/${buildCertificateFileName(date)}`;
}

function resolvePhotoUrl(appDataPath, date, label) {
  if (label === '諛섏텧') {
    return resolveLatestSludgePhotoInfo(appDataPath, date)?.url || null;
  }
  const year = String(date).slice(0, 4);
  const hyphenName = `${String(date || '').slice(0, 10)}-泥?냼?꾩쬆.jpg`;
  const stampName = buildCertificateFileName(date);
  const candidates = [hyphenName, stampName];
  for (const fileName of candidates) {
    const filePath = path.join(getSludgePhotoDir(appDataPath, date), fileName);
    if (fs.existsSync(filePath)) {
      return `/사진관리슬러지/${year}/${fileName}`;
    }
  }
  return null;
}

function resolveLocalPathFromUrl(appDataPath, url) {
  const raw = String(url || '').trim();
  if (!raw.startsWith('/사진관리슬러지/')) return null;
  const relative = raw.replace(/^\/사진관리/슬러지\//, '');
  const candidate = path.join(appDataPath, '사진관리', '슬러지', relative);
  return fs.existsSync(candidate) ? candidate : null;
}

function getMergedSludgeRows(db, start, end) {
  const photoRows = db.prepare(
    'SELECT * FROM sludge_photo_logs WHERE date >= ? AND date <= ? ORDER BY date ASC'
  ).all(start, end);

  const flowRows = db.prepare(
    "SELECT date, sludge_export, raw_value, calculated_flow FROM flow_readings WHERE type = '슬러지' AND date >= ? AND date <= ? ORDER BY date ASC"
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
      // flow_readings留??덈뒗 ?좎쭨???ㅼ젣 諛섏텧??媛믪씠 ?덉쓣 ?뚮쭔 ?쒖떆
      if (amount == null || !Number.isFinite(amount)) continue;
      map.set(date, {
        date,
        sludge_amount: amount,
        sludge_photo_path: null,
        sludge_photo_taken_at: null,
        certificate_photo_path: null,
        note: null,
        site_name: null,
        author: null,
        created_at: null,
        last_modified: null,
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
        return res.status(400).json({ success: false, error: '?좏슚?섏? ?딆? ?곗썡?낅땲??' });
      }
      const mm      = String(month).padStart(2, '0');
      const start   = `${year}-${mm}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const end     = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
      const rows = getMergedSludgeRows(db, start, end);
      const items = rows.map(r => ({
        ...r,
        sludge_photo_url      : resolvePhotoUrl(appDataPath, r.date, '諛섏텧'),
        certificate_photo_url : resolvePhotoUrl(appDataPath, r.date, '泥?냼?꾩쬆'),
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
      if (!date) return res.status(400).json({ success: false, error: '?좎쭨媛 ?놁뒿?덈떎.' });
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
        return res.status(400).json({ success: false, error: '?좏슚?섏? ?딆? ?곗썡?낅땲??' });
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
      if (!date) return res.status(400).json({ success: false, error: '?좎쭨媛 ?놁뒿?덈떎.' });

      const metadata = getCurrentRecordMetadata(db, req.body);

      const { takenAt: newTakenAt } = await savePhotoToLocal(appDataPath, date, '諛섏텧', sludge_photo_path);
      await savePhotoToLocal(appDataPath, date, '泥?냼?꾩쬆', certificate_photo_path);

      const sludgeUrl = resolvePhotoUrl(appDataPath, date, '諛섏텧');
      const certUrl   = resolvePhotoUrl(appDataPath, date, '泥?냼?꾩쬆');
      const now       = new Date().toISOString();

      // 湲곗〈 EXIF ?좎? (???ъ쭊 ?낅줈???쒖뿉留???뼱?곌린)
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

      // flow_readings ?숆린??
      if (sludge_amount != null && sludge_amount !== '') {
        const flowRow = db.prepare(
          "SELECT id FROM flow_readings WHERE date = ? AND type = '슬러지'"
        ).get(date);
        if (flowRow) {
          db.prepare(
            "UPDATE flow_readings SET sludge_export = ?, last_modified = ? WHERE date = ? AND type = '슬러지'"
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
      if (!date || !type) return res.status(400).json({ success: false, error: '?좎쭨/????놁쓬' });
      if (!req.file)       return res.status(400).json({ success: false, error: '?뚯씪 ?놁쓬' });

      const label    = type === 'certificate' ? '泥?냼?꾩쬆' : '諛섏텧';
      const sharp    = require('sharp');
      const year     = String(date).slice(0, 4);
      const stamp    = toDateStamp(date);
      const isSludge = label === '諛섏텧';
      const fileName = isSludge
        ? `${stamp}-슬러지${(resolveLatestSludgePhotoInfo(appDataPath, date)?.index || 0) + 1}.jpg`
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

      const url     = label === '諛섏텧'
        ? `/사진관리슬러지/${year}/${fileName}`
        : `/사진관리슬러지/${year}/${buildCertificateFileName(date)}`;
      const takenAt = type === 'sludge'
        ? (isBmp
            ? (clientTakenAt || nowDateTimeString())
            : (extractExifDateTime(srcBuf) || clientTakenAt || nowDateTimeString()))
        : null;
      const now     = new Date().toISOString();

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

  /** DELETE /api/sludge-photos/:date */
  router.delete('/api/sludge-photos/:date', (req, res) => {
    try {
      const { date } = req.params;
      const year = String(date).slice(0, 4);
      const sludgeDir = getSludgePhotoDir(appDataPath, date);
      const stamp = toDateStamp(date);
      if (fs.existsSync(sludgeDir)) {
        const re = new RegExp(`^${stamp}-슬러지\\d+\\.jpg$`);
        for (const fileName of fs.readdirSync(sludgeDir)) {
          if (re.test(String(fileName))) {
            const fp = path.join(sludgeDir, fileName);
            if (fs.existsSync(fp)) fs.unlinkSync(fp);
          }
        }
        const cert = path.join(sludgeDir, buildCertificateFileName(date));
        if (fs.existsSync(cert)) fs.unlinkSync(cert);
      }
      db.prepare('DELETE FROM sludge_photo_logs WHERE date = ?').run(date);
      res.json({ success: true });
    } catch (err) {
      console.error('[sludge-photos DELETE]', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /** POST /api/sludge-photos/export  body: { year, month } */
  router.post('/api/sludge-photos/export', async (req, res) => {
    try {
      const { year, month } = req.body;
      if (!year || !month) return res.status(400).json({ success: false, error: '?곗썡 ?놁쓬' });

      const { resolveReportTemplatePath } = require('../services/reportTemplateService.cjs');
      const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, '슬러지?ъ쭊?吏');
      if (!templateInfo?.absolutePath) {
        return res.status(404).json({
          success: false,
          error: '슬러지?ъ쭊?吏 ?쒗뵆由우씠 ?놁뒿?덈떎. ?ㅼ젙?먯꽌 ?낅줈?쒗빐 二쇱꽭??',
        });
      }
      const templatePath = templateInfo.absolutePath;
      if (!['.xlsx', '.xls', '.xlsm'].includes(path.extname(templatePath).toLowerCase())) {
        return res.status(400).json({ success: false, error: '?묒? ?뺤떇???쒗뵆由용쭔 吏?먰빀?덈떎.' });
      }

      const mm      = String(month).padStart(2, '0');
      const start   = `${year}-${mm}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const end     = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
      const rows = getMergedSludgeRows(db, start, end);
      const settings = db.prepare('SELECT site_name FROM app_settings WHERE id = 1').get();

      const items = rows.map(r => {
        const sl = resolveLocalPathFromUrl(appDataPath, r.sludge_photo_path);
        const cl = resolveLocalPathFromUrl(appDataPath, r.certificate_photo_path);
        return {
          ...r,
          sludge_photo_local      : sl && fs.existsSync(sl) ? sl : null,
          certificate_photo_local : cl && fs.existsSync(cl) ? cl : null,
        };
      }).sort((a, b) => {
        const toKey = (d) => {
          const s = String(d || '');
          const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
          if (!m) return Number.MAX_SAFE_INTEGER;
          return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
        };
        return toKey(a.date) - toKey(b.date);
      });

      const outputFileName = `슬러지?ъ쭊?吏_${year}_${mm}_${Date.now()}.xlsx`;
      const outputPath = buildExcelTempPath('osoo-sludge-photo', outputFileName);
      await exportSludgePhotoXlsx({
        templatePath, outputPath, year, month, items, siteName: settings?.site_name || ''
      });
      await openExcelFile(outputPath);
      res.json({ success: true });
    } catch (err) {
      console.error('[sludge-photos export]', err);
      if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
    }
  });

  /** POST /api/sludge-photos/export-ledger  body: { year, month } */
  router.post('/api/sludge-photos/export-ledger', async (req, res) => {
    try {
      const { year, month } = req.body;
      if (!year || !month) return res.status(400).json({ success: false, error: '?곗썡 ?놁쓬' });

      const { resolveReportTemplatePath } = require('../services/reportTemplateService.cjs');
      const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, '슬러지諛섏텧愿由щ???);
      if (!templateInfo?.absolutePath) {
        return res.status(404).json({
          success: false,
          error: '슬러지諛섏텧愿由щ????쒗뵆由우씠 ?놁뒿?덈떎. ?ㅼ젙?먯꽌 ?낅줈?쒗빐 二쇱꽭??',
        });
      }

      const templatePath = templateInfo.absolutePath;
      if (!['.xlsx', '.xls', '.xlsm'].includes(path.extname(templatePath).toLowerCase())) {
        return res.status(400).json({ success: false, error: '?묒? ?뺤떇???쒗뵆由용쭔 吏?먰빀?덈떎.' });
      }

      const mm = String(month).padStart(2, '0');
      const start = `${year}-${mm}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const end = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
      const rows = getMergedSludgeRows(db, start, end);

      const settings = db.prepare('SELECT site_name FROM app_settings WHERE id = 1').get();
      const ledgerSettings = db.prepare('SELECT company_name, default_amount FROM sludge_export_settings WHERE id = 1').get();
      const outputFileName = `슬러지諛섏텧愿由щ???${year}_${mm}_${Date.now()}.xlsx`;
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

// ??? xlsx export ??????????????????????????????????????????????????????????????
async function exportSludgePhotoXlsx({ templatePath, outputPath, year, month, items, siteName }) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templatePath);

  // 湲곗〈 ?대?吏 珥덇린??
  wb.media = [];
  wb.worksheets.forEach(ws => { ws._media = []; });

  // named range 留?(excelOpenService 怨듯넻 紐⑤뱢)
  const namedMap = parseNamedRanges(wb);
  console.log('[sludge export] named ranges:', Object.keys(namedMap));

  const ITEMS_PER_SHEET = 2;
  const totalSheets = Math.ceil(items.length / ITEMS_PER_SHEET) || 1;
  const templateSheet = wb.worksheets[0];

  function cloneTemplateToSheet(src, dst) {
    const deep = (v) => JSON.parse(JSON.stringify(v || {}));

    // ?쒗듃 湲곕낯 ?띿꽦 蹂듭궗
    dst.properties = deep(src.properties);
    dst.pageSetup = deep(src.pageSetup);
    dst.headerFooter = deep(src.headerFooter);
    dst.views = deep(src.views || []);
    dst.state = src.state;

    // ??蹂듭궗
    dst.columns = (src.columns || []).map(c => ({
      width: c.width,
      hidden: c.hidden,
      outlineLevel: c.outlineLevel,
      style: c.style ? deep(c.style) : undefined,
    }));

    // ???믪씠/???ㅽ???蹂듭궗
    src.eachRow({ includeEmpty: true }, (srcRow, rowNum) => {
      const dstRow = dst.getRow(rowNum);
      dstRow.height = srcRow.height;
      dstRow.hidden = srcRow.hidden;
      dstRow.outlineLevel = srcRow.outlineLevel;
      dstRow.style = deep(srcRow.style);
      dstRow.commit();
    });

    // 蹂묓빀 踰붿쐞瑜?癒쇱? 蹂듭궗????? ?ㅽ???媛믪쓣 ?ㅼ떆 梨꾩슫??
    // (ExcelJS merge 泥섎━ 怨쇱젙?먯꽌 ?쇰? 寃쎄퀎 ?ㅽ??쇱씠 ?뚯떎?섎뒗 耳?댁뒪 諛⑹?)
    const merges = src.model?.merges || [];
    for (const m of merges) {
      try { dst.mergeCells(m); } catch (_) {}
    }

    // ? ?꾩껜 留ㅽ듃由?뒪 蹂듭궗 (鍮?? ?ы븿)
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

  // 1) 癒쇱? 鍮??쒗뵆由??쒗듃瑜?紐⑤몢 以鍮?(?먮낯 蹂???놁씠)
  const sheets = [templateSheet];
  for (let si = 1; si < totalSheets; si++) {
    const ws = wb.addWorksheet(`?ъ쭊?吏_${si + 1}`);
    cloneTemplateToSheet(templateSheet, ws);
    sheets.push(ws);
  }

  // 2) 洹??ㅼ쓬 ?쒗듃蹂꾨줈 ?곗씠??諛붿씤??(??긽 ?꾩옱 ?쒗듃 湲곗?)
  for (let si = 0; si < sheets.length; si++) {
    const ws = sheets[si];

    // ?묒떇 怨좎젙 醫뚰몴/?ш린(?ъ씤??pt) ???ъ슜???ㅼ륫媛?
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
      if (!info) { console.warn(`[sludge export] named range ?놁쓬: ${name}`); return; }
      ws.getCell(info.address).value = value;
    }

    // ?댁쟾 媛??붿〈 諛⑹?: ?щ’ 1~2瑜?癒쇱? 珥덇린??
    for (let n = 1; n <= ITEMS_PER_SHEET; n++) {
      setCellOnSheet(`?좎쭨${n}`, '');
      setCellOnSheet(`諛섏텧??{n}`, null);
    }

    if (namedMap['?쒗듃紐?]) setCellOnSheet('?쒗듃紐?, siteName || '');

    const sheetItems = items.slice(si * ITEMS_PER_SHEET, (si + 1) * ITEMS_PER_SHEET);
    for (let i = 0; i < sheetItems.length; i++) {
      const item = sheetItems[i];
      const n = i + 1;

      setCellOnSheet(`?좎쭨${n}`, item.date ? item.date.replace(/-/g, '.') : '');
      if (item.sludge_amount != null) setCellOnSheet(`諛섏텧??{n}`, Number(item.sludge_amount));

      // 諛섏텧?ъ쭊 ?쎌엯: ? 媛濡쒖쓽 90% 湲곗?, 鍮꾩쑉 ?좎? + 以묒븰 ?뺣젹
      if (item.sludge_photo_local) {
        const info = namedMap[`?ъ쭊${n}`];
        if (info) {
          const extent = getMergedCellExtent(ws, info.col, info.row);
          try {
            await insertImageToCell(wb, ws, extent, item.sludge_photo_local, {
              fitBy: 'width',
              pct: 1.0,
              ...photoBoxBySlot[n],
            });
          } catch (e) {
            console.error(`[sludge export] ?ъ쭊${n} ?쎌엯 ?ㅽ뙣:`, e.message);
          }
        }
      }

      // 泥?냼?꾩쬆 ?쎌엯: ? ?몃줈??80% 湲곗?, 鍮꾩쑉 ?좎? + 以묒븰 ?뺣젹
      if (item.certificate_photo_local) {
        const info = namedMap[`?꾩쬆${n}`];
        if (info) {
          const extent = getMergedCellExtent(ws, info.col, info.row);
          try {
            await insertImageToCell(wb, ws, extent, item.certificate_photo_local, {
              fitBy: 'height',
              pct: 1.0,
              ...certBoxBySlot[n],
            });
          } catch (e) {
            console.error(`[sludge export] ?꾩쬆${n} ?쎌엯 ?ㅽ뙣:`, e.message);
          }
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

  // Excel ?좎쭨 ?(Date 媛앹껜)
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return _toDateKey(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  // ?レ옄留??ㅼ뼱??寃쎌슦: ?대떦 ?붿쓽 day濡??댁꽍
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

  // dd (?쒖닔 ?쇱옄 臾몄옄??
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
  if (!ws) throw new Error('슬러지諛섏텧愿由щ????쒗뵆由??쒗듃瑜?李얠쓣 ???놁뒿?덈떎.');

  const namedMap = parseNamedRanges(wb);
  const seqCells = parseNamedRangeCells(wb, '?쒕쾲');
  const dateCells = parseNamedRangeCells(wb, '?좎쭨');
  const companyCells = parseNamedRangeCells(wb, '?낆껜紐?);
  const timeCells = parseNamedRangeCells(wb, '?쒓컙');
  const weightCells = parseNamedRangeCells(wb, '以묐웾');
  const noteCells = parseNamedRangeCells(wb, '鍮꾧퀬');

  if (namedMap['??λ챸']) {
    ws.getCell(namedMap['??λ챸'].address).value = `${year}??${Number(month)}??슬러지諛섏텧 愿由щ???;
  }
  if (namedMap['?꾩옣紐?]) {
    ws.getCell(namedMap['?꾩옣紐?].address).value = siteName || '';
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
