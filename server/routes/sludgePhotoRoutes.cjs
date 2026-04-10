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

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function sanitizeName(name) {
  return String(name || '').replace(/[\\/:*?"<>|]/g, '_').trim();
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

/** BMP → RGB raw 픽셀 디코딩 (24/32bpp, bottom-up) */
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
  const year     = String(date).slice(0, 4);
  const fileName = `${date}-${sanitizeName(label)}.jpg`;
  const destDir  = path.join(appDataPath, '사진관리', '슬러지', year);
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

  const takenAt = isBmp ? null : extractExifDateTime(srcBuf);
  return { destPath, takenAt };
}

function photoUrl(date, label) {
  const year = String(date).slice(0, 4);
  return `/사진관리/슬러지/${year}/${date}-${sanitizeName(label)}.jpg`;
}

function resolvePhotoUrl(appDataPath, date, label) {
  const year     = String(date).slice(0, 4);
  const filePath = path.join(appDataPath, '사진관리', '슬러지', year,
                             `${date}-${sanitizeName(label)}.jpg`);
  return fs.existsSync(filePath) ? photoUrl(date, label) : null;
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
      const rows    = db.prepare(
        'SELECT * FROM sludge_photo_logs WHERE date >= ? AND date <= ? ORDER BY date ASC'
      ).all(start, end);
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

  /** POST /api/sludge-photos/save */
  router.post('/api/sludge-photos/save', async (req, res) => {
    try {
      const { date, sludge_amount, sludge_photo_path, certificate_photo_path, note } = req.body;
      if (!date) return res.status(400).json({ success: false, error: '날짜가 없습니다.' });

      const settings = db.prepare('SELECT site_name, manager_name FROM app_settings WHERE id = 1').get();
      const siteName = settings?.site_name    || '';
      const author   = settings?.manager_name || '';

      const { takenAt: newTakenAt } = await savePhotoToLocal(appDataPath, date, '반출', sludge_photo_path);
      await savePhotoToLocal(appDataPath, date, '청소필증', certificate_photo_path);

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
           certificate_photo_path, note, site_name, author, created_at, last_modified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
          sludge_amount          = excluded.sludge_amount,
          sludge_photo_path      = excluded.sludge_photo_path,
          sludge_photo_taken_at  = excluded.sludge_photo_taken_at,
          certificate_photo_path = excluded.certificate_photo_path,
          note                   = excluded.note,
          site_name              = excluded.site_name,
          author                 = excluded.author,
          last_modified          = excluded.last_modified
      `).run(
        date,
        sludge_amount != null ? Number(sludge_amount) : null,
        sludgeUrl, finalTakenAt, certUrl,
        note || null, siteName, author, now, now
      );

      // flow_readings 동기화
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
              (date, type, sludge_export, site_name, author, created_at, last_modified, is_synced)
            VALUES (?, '슬러지', ?, ?, ?, ?, ?, 0)
          `).run(date, Number(sludge_amount), siteName, author, now, now);
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

  /** POST /api/sludge-photos/upload-photo  (multipart, 웹 환경용) */
  router.post('/api/sludge-photos/upload-photo', upload.single('photo'), async (req, res) => {
    try {
      const { date, type } = req.query;
      if (!date || !type) return res.status(400).json({ success: false, error: '날짜/타입 없음' });
      if (!req.file)       return res.status(400).json({ success: false, error: '파일 없음' });

      const label    = type === 'certificate' ? '청소필증' : '반출';
      const sharp    = require('sharp');
      const year     = String(date).slice(0, 4);
      const fileName = `${date}-${sanitizeName(label)}.jpg`;
      const destDir  = path.join(appDataPath, '사진관리', '슬러지', year);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      const destPath = path.join(destDir, fileName);

      const srcBuf = req.file.buffer;
      const isBmp  = srcBuf[0] === 0x42 && srcBuf[1] === 0x4D;
      if (isBmp) {
        const bmpRaw = decodeBmpToRgb(srcBuf);
        await require('sharp')(bmpRaw.data, { raw: { width: bmpRaw.width, height: bmpRaw.height, channels: 3 } })
          .jpeg({ quality: 90 }).toFile(destPath);
      } else {
        await sharp(srcBuf).rotate().jpeg({ quality: 90 }).toFile(destPath);
      }

      const url     = photoUrl(date, label);
      const takenAt = (type === 'sludge' && !isBmp) ? extractExifDateTime(srcBuf) : null;
      const col     = type === 'certificate' ? 'certificate_photo_path' : 'sludge_photo_path';
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
        const s = db.prepare('SELECT site_name, manager_name FROM app_settings WHERE id = 1').get();
        db.prepare(`
          INSERT INTO sludge_photo_logs
            (date, sludge_photo_path, sludge_photo_taken_at, certificate_photo_path,
             site_name, author, created_at, last_modified)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          date,
          type === 'sludge'       ? url : null,
          type === 'sludge'       ? takenAt : null,
          type === 'certificate'  ? url : null,
          s?.site_name || '', s?.manager_name || '', now, now
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
      for (const label of ['반출', '청소필증']) {
        const fp = path.join(appDataPath, '사진관리', '슬러지', year, `${date}-${sanitizeName(label)}.jpg`);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
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
      const rows    = db.prepare(
        'SELECT * FROM sludge_photo_logs WHERE date >= ? AND date <= ? ORDER BY date ASC'
      ).all(start, end);
      const settings = db.prepare('SELECT site_name FROM app_settings WHERE id = 1').get();

      const items = rows.map(r => {
        const sl = path.join(appDataPath, '사진관리', '슬러지', String(year), `${r.date}-반출.jpg`);
        const cl = path.join(appDataPath, '사진관리', '슬러지', String(year), `${r.date}-청소필증.jpg`);
        return {
          ...r,
          sludge_photo_local      : fs.existsSync(sl) ? sl : null,
          certificate_photo_local : fs.existsSync(cl) ? cl : null,
        };
      });

      const outputFileName = `슬러지사진대지_${year}_${mm}_${Date.now()}.xlsx`;
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

  for (let si = 0; si < totalSheets; si++) {
    let ws;
    if (si === 0) {
      ws = templateSheet;
    } else {
      ws = wb.addWorksheet(`사진대지_${si + 1}`);
      templateSheet.eachRow({ includeEmpty: true }, (srcRow, rowNum) => {
        const dstRow = ws.getRow(rowNum);
        srcRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
          const dstCell = dstRow.getCell(colNum);
          dstCell.value = cell.value;
          dstCell.style = JSON.parse(JSON.stringify(cell.style));
        });
        dstRow.height = srcRow.height;
        dstRow.commit();
      });
      ws.columns = templateSheet.columns.map(c => ({ width: c.width }));
    }

    function setCell(name, value) {
      const info = namedMap[name];
      if (!info) { console.warn(`[sludge export] named range 없음: ${name}`); return; }
      const sheet = wb.getWorksheet(info.sheetName) || ws;
      sheet.getCell(info.address).value = value;
    }

    if (namedMap['시트명']) setCell('시트명', siteName);

    const sheetItems = items.slice(si * ITEMS_PER_SHEET, (si + 1) * ITEMS_PER_SHEET);
    for (let i = 0; i < sheetItems.length; i++) {
      const item = sheetItems[i];
      const n    = i + 1;

      setCell(`날짜${n}`, item.date ? item.date.replace(/-/g, '.') : '');
      if (item.sludge_amount != null)  setCell(`반출량${n}`, Number(item.sludge_amount));
      if (item.sludge_photo_taken_at)  setCell(`반출시간${n}`, item.sludge_photo_taken_at.slice(11, 16));

      // 반출사진 삽입 (named range: 사진1, 사진2) — 가로도 90% 제한
      if (item.sludge_photo_local) {
        const info = namedMap[`사진${n}`];
        if (info) {
          const sheet  = wb.getWorksheet(info.sheetName) || ws;
          const extent = getMergedCellExtent(sheet, info.col, info.row);
          try {
            await insertImageToCell(wb, sheet, extent, item.sludge_photo_local, { widthPct: 0.9 });
          } catch (e) {
            console.error(`[sludge export] 사진${n} 삽입 실패:`, e.message);
          }
        } else {
          console.warn(`[sludge export] 사진${n} named range 없음`);
        }
      }

      // 청소필증 삽입 (named range: 필증1, 필증2)
      if (item.certificate_photo_local) {
        const info = namedMap[`필증${n}`];
        if (info) {
          const sheet  = wb.getWorksheet(info.sheetName) || ws;
          const extent = getMergedCellExtent(sheet, info.col, info.row);
          try {
            await insertImageToCell(wb, sheet, extent, item.certificate_photo_local);
          } catch (e) {
            console.error(`[sludge export] 필증${n} 삽입 실패:`, e.message);
          }
        }
      }
    }
  }

  await wb.xlsx.writeFile(outputPath);
}
