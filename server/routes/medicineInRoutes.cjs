const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs');
const multer = require('multer');
const { openExcelFile } = require('../services/excelOpenService.cjs');

const { resolveReportTemplatePath } = require('../services/reportTemplateService.cjs');
const { replaceHwpxPlaceholders } = require('../services/hwpPdfService.cjs');
const { getCurrentRecordMetadata } = require('../services/syncMetadataService.cjs');

const router = express.Router();

const BASE_MEDICINES = ['포도당', '중탄산나트륨', '팩(PAC)'];
const BASE_KITS = ['암모니아성질소(NH3-N)', '질산성질소(NO3-N)', '인산염인(PO4-P)', '알칼리도(ALK)'];

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);

/** 파일명에 사용 불가한 문자 제거 */
function sanitizeName(name) {
  return String(name || '').replace(/[\\/:*?"<>|]/g, '_').trim();
}

/**
 * {appDataPath}/사진관리/약품입고/{year}/ 를 스캔해서
 * 약품명/키트명 → { url, localPath, date } 맵을 반환
 * 파일명 패턴: {YYYY-MM-DD}-{약품명}.ext
 * 같은 약품명이 여러 날짜에 있으면 가장 최근 것을 사용
 */
function scanMedicinePhotos(appDataPath, year, mm) {
  const yearDir = path.join(appDataPath, '사진관리', '약품입고', String(year));
  const map = {}; // sanitizedName → { url, localPath, date }
  if (!fs.existsSync(yearDir)) return map;

  let files;
  try { files = fs.readdirSync(yearDir); } catch { return map; }

  const mmPrefix = mm + '-'; // '04-'

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;
    const nameWithoutExt = path.basename(file, ext);
    // 파일명 패턴: {YYYY-MM-DD}-{약품명}
    const dateMatch = nameWithoutExt.match(/^(\d{4})-(\d{2})-(\d{2})-(.+)$/);
    if (!dateMatch) continue;
    const [, y, m, d, rawName] = dateMatch;
    // 해당 연월 파일만 (mm가 null이면 전체)
    if (mm && m !== mm) continue;
    const date = `${y}-${m}-${d}`;
    const nameKey = sanitizeName(rawName);
    const localPath = path.join(yearDir, file);
    const url = `/api/medicine-in/photo?p=${encodeURIComponent(`${year}/${file}`)}`;
    // 같은 약품명이면 더 최근 날짜 우선
    if (!map[nameKey] || date > map[nameKey].date) {
      map[nameKey] = { url, localPath, date };
    }
  }
  return map;
}

/**
 * 사진 파일을 로컬 디렉토리에 JPG로 변환 저장
 * {appDataPath}/사진관리/약품입고/{year}/{date}-{약품명}.jpg
 */
async function savePhotoToLocal(appDataPath, year, mm, date, medicineName, srcPath) {
  if (!srcPath || !fs.existsSync(srcPath)) return null;
  const sharp = require('sharp');
  const srcBuf = fs.readFileSync(srcPath);
  const fileName = `${date}-${sanitizeName(medicineName)}.jpg`;
  const destDir = path.join(appDataPath, '사진관리', '약품입고', String(year));
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, fileName);
  // BMP는 raw 픽셀로 디코딩 후 변환
  const isBmp = srcBuf[0] === 0x42 && srcBuf[1] === 0x4D;
  if (isBmp) {
    const bmpRaw = decodeBmpToRgb(srcBuf);
    await sharp(bmpRaw.data, { raw: { width: bmpRaw.width, height: bmpRaw.height, channels: 3 } })
      .jpeg({ quality: 90 }).toFile(destPath);
  } else {
    await sharp(srcBuf).rotate().jpeg({ quality: 90 }).toFile(destPath);
  }
  return destPath;
}

module.exports = function (db, baseDir, appDataPath) {
  /**
   * GET /api/medicine-in/defaults?year=2026&month=3
   * 전달 구매량을 기본값으로, 현재 약품·키트 목록과 함께 반환
   */
  router.get('/api/medicine-in/defaults', (req, res) => {
    try {
      const year = parseInt(req.query.year, 10);
      const month = parseInt(req.query.month, 10);

      if (!year || !month || month < 1 || month > 12) {
        return res.status(400).json({ success: false, error: '유효하지 않은 연월입니다.' });
      }

      // 당월 날짜 범위
      const mm = String(month).padStart(2, '0');
      const currLastDay = new Date(year, month, 0).getDate();
      const currStart = `${year}-${mm}-01`;
      const currEnd = `${year}-${mm}-${String(currLastDay).padStart(2, '0')}`;

      // 전달 날짜 범위
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;
      const prevMm = String(prevMonth).padStart(2, '0');
      const prevLastDay = new Date(prevYear, prevMonth, 0).getDate();
      const prevStart = `${prevYear}-${prevMm}-01`;
      const prevEnd = `${prevYear}-${prevMm}-${String(prevLastDay).padStart(2, '0')}`;

      const settings = db.prepare('SELECT site_name FROM app_settings WHERE id = 1').get();
      const siteName = settings?.site_name || '';

      // 추가 약품 (기본 3종 제외)
      const placeholders = BASE_MEDICINES.map(() => '?').join(',');
      const extraMedicines = db.prepare(
        `SELECT item_name FROM config_items
         WHERE category = 'medicine' AND is_active = 1
           AND item_name NOT IN (${placeholders})
         ORDER BY display_order ASC
         LIMIT 3`
      ).all(...BASE_MEDICINES).map(r => r.item_name);

      // 구매량 조회 헬퍼
      const getSum = (table, nameCol, name, start, end) =>
        db.prepare(
          `SELECT COALESCE(SUM(purchase_amount), 0) AS v FROM ${table}
           WHERE ${nameCol} = ? AND date >= ? AND date <= ?`
        ).get(name, start, end)?.v ?? 0;

      // 약품별 기본 입고량 맵 (config_items.default_amount)
      const defaultAmountRows = db.prepare(
        "SELECT item_name, COALESCE(default_amount, 0) AS default_amount FROM config_items WHERE category = 'medicine'"
      ).all();
      const defaultAmountMap = Object.fromEntries(defaultAmountRows.map(r => [r.item_name, r.default_amount]));

      // 키트별 기본 입고량 맵 (config_items.default_amount)
      const kitDefaultAmountRows = db.prepare(
        "SELECT item_name, COALESCE(default_amount, 0) AS default_amount FROM config_items WHERE category = 'kit'"
      ).all();
      const kitDefaultAmountMap = Object.fromEntries(kitDefaultAmountRows.map(r => [r.item_name, r.default_amount]));

      const allMedicines = [...BASE_MEDICINES, ...extraMedicines].map(name => ({
        name,
        currPurchase: getSum('medicine_logs', 'medicine_name', name, currStart, currEnd),
        prevPurchase: getSum('medicine_logs', 'medicine_name', name, prevStart, prevEnd),
        defaultAmount: defaultAmountMap[name] ?? 0,
      }));

      const kits = BASE_KITS.map(name => ({
        name,
        currPurchase: getSum('kit_logs', 'kit_name', name, currStart, currEnd),
        prevPurchase: getSum('kit_logs', 'kit_name', name, prevStart, prevEnd),
        defaultAmount: kitDefaultAmountMap[name] ?? 0,
      }));

      // 로컬 사진 스캔 — 해당 월 디렉토리에서 약품명 매칭
      const photoMap = scanMedicinePhotos(appDataPath, year, mm);

      const medicinesWithPhotos = allMedicines.map(m => {
        const key = sanitizeName(m.name);
        const found = photoMap[key];
        return { ...m, photoUrl: found?.url || null, photoDate: found?.date || null };
      });

      const kitsWithPhotos = kits.map(k => {
        const key = sanitizeName(k.name);
        const found = photoMap[key];
        return { ...k, photoUrl: found?.url || null, photoDate: found?.date || null };
      });

      const tradePhoto = photoMap['거래명세서'] || null;

      res.json({
        success: true, siteName,
        medicines: medicinesWithPhotos,
        kits: kitsWithPhotos,
        extraMedicines,
        tradePhotoUrl: tradePhoto?.url || null,
        tradePhotoDate: tradePhoto?.date || null,
      });
    } catch (err) {
      console.error('[medicine-in defaults]', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/medicine-in/save
   * 구매량을 medicine_logs 또는 kit_logs에 upsert 저장
   * body: { tab: 'medicine'|'kit', date: 'YYYY-MM-DD', items: [{name, purchase}] }
   */
  router.post('/api/medicine-in/save', async (req, res) => {
    try {
      const { tab, date, items, photoPaths } = req.body;

      if (!date || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: '유효하지 않은 요청입니다.' });
      }

      const metadata = getCurrentRecordMetadata(db);

      if (tab === 'medicine') {
        const stmt = db.prepare(`
          INSERT INTO medicine_logs
            (medicine_name, date, purchase_amount, usage_amount, current_inventory,
             site_id, site_name, author, created_at, last_modified, is_synced)
          VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?, ?, 0)
          ON CONFLICT(medicine_name, date) DO UPDATE SET
            purchase_amount = excluded.purchase_amount,
            site_id         = excluded.site_id,
            last_modified   = excluded.last_modified,
            is_synced       = 0
        `);
        db.transaction((rows) => {
          for (const item of rows) {
            if (!item.name || item.purchase == null) continue;
            stmt.run(item.name, date, Number(item.purchase),
              metadata.siteId, metadata.siteName, metadata.author, metadata.createdAt, metadata.lastModified);
          }
        })(items);
      } else if (tab === 'kit') {
        const stmt = db.prepare(`
          INSERT INTO kit_logs
            (kit_name, date, purchase_amount, usage_amount, current_inventory,
             site_id, site_name, author, created_at, last_modified, is_synced)
          VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?, ?, 0)
          ON CONFLICT(kit_name, date) DO UPDATE SET
            purchase_amount = excluded.purchase_amount,
            site_id         = excluded.site_id,
            last_modified   = excluded.last_modified,
            is_synced       = 0
        `);
        db.transaction((rows) => {
          for (const item of rows) {
            if (!item.name || item.purchase == null) continue;
            stmt.run(item.name, date, Number(item.purchase),
              metadata.siteId, metadata.siteName, metadata.author, metadata.createdAt, metadata.lastModified);
          }
        })(items);
      } else {
        return res.status(400).json({ success: false, error: '유효하지 않은 tab 값' });
      }

      // 사진 로컬 저장 (photoPaths: { 약품명: 'C:\\...\\file.jpg' })
      if (photoPaths && typeof photoPaths === 'object') {
        const dateParts = date.split('-');
        const yearStr = dateParts[0];
        const mmStr = dateParts[1];
        for (const [medicineName, filePath] of Object.entries(photoPaths)) {
          try {
            await savePhotoToLocal(appDataPath, yearStr, mmStr, date, medicineName, filePath);
          } catch (e) {
            console.warn(`[medicine-in save] 사진 저장 실패 (${medicineName}):`, e.message);
          }
        }
      }

      res.json({ success: true });
    } catch (err) {
      console.error('[medicine-in save]', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/medicine-in/upload-photo
   * 브라우저(웹 모드)에서 사진 파일 자체를 업로드해 로컬에 저장
   * multipart: date, medicineName, photo(file)
   */
  const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
  router.post('/api/medicine-in/upload-photo', photoUpload.single('photo'), async (req, res) => {
    try {
      const { date, medicineName } = req.body;
      if (!date || !medicineName || !req.file) {
        return res.status(400).json({ success: false, error: 'date, medicineName, photo 필드가 필요합니다.' });
      }
      const yearStr = date.split('-')[0];
      const sharp = require('sharp');
      const fileName = `${date}-${sanitizeName(medicineName)}.jpg`;
      const destDir = path.join(appDataPath, '사진관리', '약품입고', yearStr);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      const destPath = path.join(destDir, fileName);
      const srcBuf = req.file.buffer;
      const isBmp = srcBuf[0] === 0x42 && srcBuf[1] === 0x4D;
      if (isBmp) {
        const bmpRaw = decodeBmpToRgb(srcBuf);
        await sharp(bmpRaw.data, { raw: { width: bmpRaw.width, height: bmpRaw.height, channels: 3 } })
          .jpeg({ quality: 90 }).toFile(destPath);
      } else {
        await sharp(srcBuf).rotate().jpeg({ quality: 90 }).toFile(destPath);
      }
      const url = `/api/medicine-in/photo?p=${encodeURIComponent(`${yearStr}/${fileName}`)}`;
      res.json({ success: true, url });
    } catch (err) {
      console.error('[medicine-in upload-photo]', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/medicine-in/export
   * HWPX 생성. 사진은 로컬 파일 경로(Electron)로 전달받아 BinData/ 에 삽입.
   * body: {
   *   year, month,
   *   medicineDate: 'YYYY-MM-DD',
   *   kitDate: 'YYYY-MM-DD',
   *   medicineItems: [{name, purchase}],
   *   kitItems: [{name, purchase}],
   *   photoPaths: { '{{약1사진}}': 'C:\\...\\photo.jpg', ... }  // optional
   * }
   */
  router.post('/api/medicine-in/export', async (req, res) => {
    try {
      const { year, month, medicineDate, kitDate, medicineItems, kitItems, photoPaths } = req.body;

      const y = parseInt(year, 10);
      const m = parseInt(month, 10);
      if (!y || !m || m < 1 || m > 12) {
        return res.status(400).json({ success: false, error: '유효하지 않은 연월입니다.' });
      }

      const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, '약품입고일지', { excelOnly: false });
      if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
        return res.status(404).json({
          success: false,
          code: 'HWP_TEMPLATE_MISSING',
          error: '약품입고일지 HWPX 양식을 찾을 수 없습니다.',
          userMessage: '설정에서 약품입고일지 HWPX 파일을 업로드해 주세요.',
        });
      }

      const ext = path.extname(templateInfo.absolutePath).toLowerCase();
      const EXCEL_EXTS = new Set(['.xlsx', '.xls', '.xlsm']);
      if (!EXCEL_EXTS.has(ext) && ext !== '.hwpx') {
        return res.status(400).json({ success: false, error: `지원하지 않는 양식 형식입니다: ${ext}` });
      }

      const mm = String(m).padStart(2, '0');
      const fmt = v => (v != null && v !== '') ? String(v) : '';

      // 바인딩 구성
      const bindings = {
        '{{월}}': String(m),
        '{{날짜}}': medicineDate || `${y}.${mm}`,
        '{{키트날짜}}': kitDate || `${y}.${mm}`,
      };

      const meds = Array.isArray(medicineItems) ? medicineItems : [];
      const baseMeds = meds.filter(i => BASE_MEDICINES.includes(i.name));
      const extraMeds = meds.filter(i => !BASE_MEDICINES.includes(i.name));

      // 기본 약품 (순서 보장)
      BASE_MEDICINES.forEach((name, idx) => {
        const key = ['약1', '약2', '약3'][idx];
        const item = baseMeds.find(i => i.name === name);
        bindings[`{{${key}구매}}`] = fmt(item?.purchase);
      });

      // 추가 약품 (최대 2개)
      [0, 1].forEach(idx => {
        const key = ['추1', '추2'][idx];
        const item = extraMeds[idx];
        bindings[`{{${key}이름}}`] = item?.name || '';
        bindings[`{{${key}구매}}`] = item ? fmt(item.purchase) : '';
      });

      // 키트 구매량 (템플릿에 플레이스홀더가 있을 경우를 위해)
      const kits = Array.isArray(kitItems) ? kitItems : [];
      BASE_KITS.forEach((name, idx) => {
        const key = `키${idx + 1}`;
        const item = kits.find(i => i.name === name);
        bindings[`{{${key}구매}}`] = fmt(item?.purchase);
      });

      // 사진 바인딩: photoPaths = { '{{약1사진}}': 'C:\\...\\photo.jpg' }
      // 사진 파일을 BinData/ 에 복사하고 href 치환 (템플릿이 href 방식으로 설계된 경우 동작)
      const imageMap = {}; // { '{{약1사진}}': Buffer }

      // placeholder → 약품명 역매핑 (로컬 저장 시 사용)
      const placeholderToName = {};
      const mArr = Array.isArray(medicineItems) ? medicineItems : [];
      const bMeds = mArr.filter(i => BASE_MEDICINES.includes(i.name));
      const eMeds = mArr.filter(i => !BASE_MEDICINES.includes(i.name));
      BASE_MEDICINES.forEach((name, idx) => { placeholderToName[`{{약${idx + 1}사진}}`] = name; });
      eMeds.slice(0, 2).forEach((item, idx) => { placeholderToName[`{{추${idx + 1}사진}}`] = item.name; });
      placeholderToName['{{거래사진}}'] = '거래명세서';
      (Array.isArray(kitItems) ? kitItems : []).slice(0, 2).forEach((item, idx) => {
        placeholderToName[`{{키${idx + 1}사진}}`] = item.name;
      });

      if (photoPaths && typeof photoPaths === 'object') {
        for (const [placeholder, filePath] of Object.entries(photoPaths)) {
          if (!filePath || !fs.existsSync(filePath)) continue;
          try {
            imageMap[placeholder] = fs.readFileSync(filePath);
            // BinData에 넣을 파일명 (placeholder에서 중괄호 제거)
            const binFileName = placeholder.replace(/[\{\}]/g, '') + path.extname(filePath);
            bindings[placeholder] = binFileName;

            // 로컬 구조화 디렉토리에 사진 복사
            const medicineName = placeholderToName[placeholder];
            if (medicineName) {
              // 키트 사진은 kitDate 사용, 나머지는 medicineDate
              const isKit = placeholder.startsWith('{{키');
              const useDate = isKit ? (kitDate || `${y}-${mm}-01`) : (medicineDate || `${y}-${mm}-01`);
              try {
                await savePhotoToLocal(appDataPath, y, mm, useDate, medicineName, filePath);
              } catch (e) {
                console.warn('[medicine-in export] 로컬 사진 저장 실패:', e.message);
              }
            }
          } catch (e) {
            console.warn(`[medicine-in export] 사진 읽기 실패 (${filePath}):`, e.message);
          }
        }
      }

      // Fallback: photoPaths로 전달되지 않은 사진은 로컬 스캔에서 자동 보완
      const photoMap = scanMedicinePhotos(appDataPath, y, mm);
      for (const [placeholder, medicineName] of Object.entries(placeholderToName)) {
        if (imageMap[placeholder]) continue; // 이미 처리됨
        const key = sanitizeName(medicineName);
        const found = photoMap[key];
        if (!found?.localPath || !fs.existsSync(found.localPath)) continue;
        try {
          imageMap[placeholder] = fs.readFileSync(found.localPath);
          const binFileName = placeholder.replace(/[\{\}]/g, '') + path.extname(found.localPath);
          bindings[placeholder] = binFileName;
          console.log(`[medicine-in export] fallback 사진 적용: ${medicineName} → ${found.localPath}`);
        } catch (e) {
          console.warn(`[medicine-in export] fallback 사진 읽기 실패 (${medicineName}):`, e.message);
        }
      }

      const outputDir = path.join(os.tmpdir(), 'osoo-medicine-in');
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

      let outputPath;
      if (EXCEL_EXTS.has(ext)) {
        outputPath = path.join(outputDir, `약품입고일지_${y}_${mm}.xlsx`);
        await exportMedicineInXlsx({
          templatePath: templateInfo.absolutePath,
          outputPath,
          year: y, month: m, medicineDate, kitDate,
          baseMeds, extraMeds, kits,
          imageMap,
        });
      } else {
        outputPath = path.join(outputDir, `약품입고일지_${y}_${mm}.hwpx`);
        await replaceHwpxPlaceholdersWithImages({
          templatePath: templateInfo.absolutePath,
          outputPath,
          bindings,
          imageMap,
        });
      }

      await openExcelFile(outputPath);
      res.json({ success: true });
    } catch (err) {
      console.error('[medicine-in export]', err);
      res.status(500).json({
        success: false,
        error: err.message,
        userMessage: `생성에 실패했습니다: ${err.message}`,
      });
    }
  });

  /**
   * GET /api/medicine-in/photo?p=<year>/<filename>
   * 로컬 약품 사진 서빙 (한글 경로 static 미들웨어 대안)
   */
  router.get('/api/medicine-in/photo', (req, res) => {
    const relPath = req.query.p || '';
    if (!relPath || relPath.includes('..') || path.isAbsolute(relPath)) {
      return res.status(403).send('Forbidden');
    }
    const segments = relPath.split('/').filter(Boolean);
    const filePath = path.join(appDataPath, '사진관리', '약품입고', ...segments);
    const resolved = path.resolve(filePath);
    const root = path.resolve(path.join(appDataPath, '사진관리', '약품입고'));
    if (!resolved.startsWith(root + path.sep)) {
      return res.status(403).send('Forbidden');
    }
    if (!fs.existsSync(resolved)) {
      return res.status(404).send('Not found');
    }
    res.sendFile(resolved);
  });

  return router;
};

/**
 * Named range 단일 셀 파싱
 * "'약품'!$C$3" → { sheetName: '약품', col: 'C', row: 3, address: 'C3' }
 */
function parseNamedRangeSingle(rangeStr) {
  const m = String(rangeStr || '').match(/^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)$/);
  if (!m) return null;
  return { sheetName: m[1], col: m[2], row: parseInt(m[3], 10), address: `${m[2]}${m[3]}` };
}

/**
 * 셀이 포함된 병합 범위 반환 (없으면 단일 셀)
 * { startCol, startRow, endCol, endRow } (1-indexed)
 */
function getMergedCellExtent(worksheet, colLetter, rowNum) {
  const cellAddr = `${colLetter}${rowNum}`;
  const merges = worksheet.model.merges || [];
  for (const merge of merges) {
    const parts = merge.split(':');
    if (parts.length !== 2) continue;
    const cellA = worksheet.getCell(parts[0]);
    const cellB = worksheet.getCell(parts[1]);
    const target = worksheet.getCell(cellAddr);
    if (
      target.col >= cellA.col && target.col <= cellB.col &&
      target.row >= cellA.row && target.row <= cellB.row
    ) {
      return { startCol: cellA.col, startRow: cellA.row, endCol: cellB.col, endRow: cellB.row };
    }
  }
  const cell = worksheet.getCell(cellAddr);
  return { startCol: cell.col, startRow: cell.row, endCol: cell.col, endRow: cell.row };
}

// HWPX placeholder → Excel named cell 매핑
const PHOTO_HWPX_TO_NAMED = {
  '{{약1사진}}': '약1사진',
  '{{약2사진}}': '약2사진',
  '{{약3사진}}': '약3사진',
  '{{추1사진}}': '추1사진',
  '{{추2사진}}': '추2사진',
  '{{거래사진}}': '거래사진',
  '{{키1사진}}': '사진1',
  '{{키2사진}}': '사진2',
};

// 키트 약품명 → Excel named cell 매핑
const KIT_NAME_TO_NAMED = {
  '암모니아성질소(NH3-N)': '암모니아량',
  '질산성질소(NO3-N)': '질산량',
  '인산염인(PO4-P)': '인량',
  '알칼리도(ALK)': '알칼리량',
};

/**
 * 약품입고일지 xlsx 생성
 * imageMap: { '{{약1사진}}': Buffer, ... }
 */
async function exportMedicineInXlsx({ templatePath, outputPath, year, month, medicineDate, kitDate, baseMeds, extraMeds, kits, imageMap }) {
  const ExcelJS = require('exceljs');
  const sharp = require('sharp');
  const fsLocal = require('fs');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templatePath);

  // 기존 이미지 제거
  wb.media = [];
  wb.worksheets.forEach(ws => { ws._media = []; });

  const mm = String(month).padStart(2, '0');

  // Named cell 맵 구성
  const namedModel = Array.isArray(wb.definedNames?.model) ? wb.definedNames.model : [];
  const namedMap = {};
  for (const n of namedModel) {
    const parsed = parseNamedRangeSingle(n.ranges?.[0]);
    if (parsed) namedMap[n.name] = parsed;
  }

  function setNamed(name, value) {
    const info = namedMap[name];
    if (!info) return;
    const ws = wb.getWorksheet(info.sheetName);
    if (!ws) return;
    ws.getCell(info.address).value = value ?? '';
  }

  const medSheet = wb.getWorksheet('약품');

  // 헤더 (named cells 사용)
  setNamed('약품시트명', `(${month})월 약품입고일지`);
  setNamed('키트시트명', `(${month})월 키트입고일지`);

  // 날짜: 약품 시트는 직접, 키트 시트는 named cell
  if (medSheet) {
    medSheet.getCell('A2').value = medicineDate || `${year}.${mm}`;
  }
  setNamed('날짜', kitDate || `${year}.${mm}`);

  // 기본 약품
  BASE_MEDICINES.forEach((name, idx) => {
    const item = baseMeds.find(i => i.name === name);
    setNamed(`약${idx + 1}명`, name);
    setNamed(`약${idx + 1}량`, item?.purchase ?? '');
  });

  // 추가 약품
  [0, 1].forEach(idx => {
    const item = extraMeds[idx];
    setNamed(`추${idx + 1}명`, item?.name || '');
    setNamed(`추${idx + 1}량`, item ? (item.purchase ?? '') : '');
  });

  // 키트 구매량
  for (const [kitName, namedKey] of Object.entries(KIT_NAME_TO_NAMED)) {
    const item = kits.find(i => i.name === kitName);
    setNamed(namedKey, item?.purchase ?? '');
  }

  // 사진 삽입
  for (const [hwpxKey, namedKey] of Object.entries(PHOTO_HWPX_TO_NAMED)) {
    const imgBuf = imageMap[hwpxKey];
    if (!imgBuf) continue;

    const info = namedMap[namedKey];
    if (!info) continue;
    const ws = wb.getWorksheet(info.sheetName);
    if (!ws) continue;

    const extent = getMergedCellExtent(ws, info.col, info.row);

    // 셀 픽셀 크기 계산
    let totalW = 0;
    for (let c = extent.startCol; c <= extent.endCol; c++) {
      totalW += Math.round((ws.getColumn(c).width || 8) * 7.0);
    }
    let totalH = 0;
    for (let r = extent.startRow; r <= extent.endRow; r++) {
      totalH += Math.round((ws.getRow(r).height || 15) * (96 / 72));
    }

    const renderW = Math.max(20, totalW);
    const renderH = Math.max(20, totalH);

    let tmpImgPath = null;
    try {
      // BMP → sharp는 raw 픽셀로 변환 후 처리
      const isBmp = imgBuf[0] === 0x42 && imgBuf[1] === 0x4D;
      let sharpInstance;
      if (isBmp) {
        const bmpRaw = decodeBmpToRgb(imgBuf);
        sharpInstance = sharp(bmpRaw.data, { raw: { width: bmpRaw.width, height: bmpRaw.height, channels: 3 } });
      } else {
        sharpInstance = sharp(imgBuf);
      }

      const { data: buf } = await sharpInstance
        .rotate()
        .resize({ width: renderW * 2, height: renderH * 2, fit: 'cover', position: 'centre' })
        .jpeg({ quality: 88 })
        .toBuffer({ resolveWithObject: true });

      const imageId = wb.addImage({ buffer: buf, extension: 'jpeg' });
      ws.addImage(imageId, {
        tl: { col: extent.startCol - 1, row: extent.startRow - 1 },
        br: { col: extent.endCol, row: extent.endRow },
        editAs: 'oneCell',
      });
      console.log(`[medicine-in xlsx] 사진 삽입: ${namedKey} (${renderW}×${renderH}px)`);
    } catch (e) {
      console.warn(`[medicine-in xlsx] 사진 삽입 실패 (${namedKey}):`, e.message);
    }
  }

  await wb.xlsx.writeFile(outputPath);
  return outputPath;
}

/**
 * 24/32bit 무압축 BMP 버퍼 → RGB raw 픽셀 변환
 */
function decodeBmpToRgb(buf) {
  const dataOffset = buf.readUInt32LE(10);
  const width = buf.readInt32LE(18);
  const rawHeight = buf.readInt32LE(22);
  const height = Math.abs(rawHeight);
  const bitsPerPixel = buf.readUInt16LE(28);
  const compression = buf.readUInt32LE(30);
  if (compression !== 0) throw new Error(`압축 BMP는 지원하지 않습니다 (compression=${compression})`);
  if (bitsPerPixel !== 24 && bitsPerPixel !== 32) throw new Error(`BMP ${bitsPerPixel}bpp는 지원하지 않습니다`);

  const channels = bitsPerPixel >>> 3; // 3 or 4
  const rowSize = Math.floor((bitsPerPixel * width + 31) / 32) * 4;
  const bottomUp = rawHeight > 0;
  const out = Buffer.alloc(width * height * 3);

  for (let row = 0; row < height; row++) {
    const srcRow = bottomUp ? (height - 1 - row) : row;
    const srcBase = dataOffset + srcRow * rowSize;
    const dstBase = row * width * 3;
    for (let col = 0; col < width; col++) {
      const s = srcBase + col * channels;
      const d = dstBase + col * 3;
      out[d]     = buf[s + 2]; // R (BMP is BGR)
      out[d + 1] = buf[s + 1]; // G
      out[d + 2] = buf[s];     // B
    }
  }
  return { data: out, width, height };
}

/**
 * 이미지 버퍼에서 픽셀 크기 읽기 (BMP / PNG / JPEG 순수 JS 파서)
 */
function getImagePixelSize(buf) {
  if (!buf || buf.length < 24) return { w: 0, h: 0 };
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  // BMP: 42 4D
  if (buf[0] === 0x42 && buf[1] === 0x4D) {
    return { w: buf.readInt32LE(18), h: Math.abs(buf.readInt32LE(22)) };
  }
  // JPEG: FF D8
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    let offset = 2;
    while (offset < buf.length - 8) {
      if (buf[offset] !== 0xFF) break;
      const marker = buf[offset + 1];
      const segLen = buf.readUInt16BE(offset + 2);
      if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
        return { w: buf.readUInt16BE(offset + 7), h: buf.readUInt16BE(offset + 5) };
      }
      offset += 2 + segLen;
    }
  }
  return { w: 0, h: 0 };
}

/** 픽셀 → HMM (1/100mm) 변환, 96dpi 기준 */
function pxToHmm(px) { return Math.round((px * 2540) / 96); }

/** 셀 크기 안에 비율 유지하며 맞춤 */
function fitToCell(imgW, imgH, cellW, cellH) {
  if (!imgW || !imgH) return { w: cellW, h: cellH };
  const scale = Math.min(cellW / imgW, cellH / imgH, 1);
  return { w: Math.round(imgW * scale), h: Math.round(imgH * scale) };
}

// placeholder → 셀 크기 (HMM 단위, 템플릿에서 측정)
const PHOTO_CELL_SIZES = {
  '{{약1사진}}':  { w: 8033, h: 10264 },
  '{{약2사진}}':  { w: 8033, h: 10264 },
  '{{약3사진}}':  { w: 8033, h: 10264 },
  '{{추1사진}}':  { w: 8033, h: 10264 },
  '{{추2사진}}':  { w: 8033, h: 10264 },
  '{{키1사진}}':  { w: 36878, h: 20526 },
  '{{키2사진}}':  { w: 36878, h: 20526 },
  '{{거래사진}}': { w: 15500, h: 14112 },
};

/** 확장자 → MIME type */
function imgMime(ext) {
  return ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
            '.bmp': 'image/bmp', '.gif': 'image/gif', '.webp': 'image/webp' })[ext.toLowerCase()] || 'image/bmp';
}

/**
 * hp:pic XML 조각 생성
 * binaryItemId: content.hpf 및 binaryItemIDRef 에 쓸 식별자 (예: '약1사진')
 */
function buildPicXml(binaryItemId, imgBuf, cellSize, instid) {
  const { w: cellW, h: cellH } = cellSize;
  const { w: pxW, h: pxH } = getImagePixelSize(imgBuf);
  const orgW = pxW > 0 ? pxToHmm(pxW) : cellW;
  const orgH = pxH > 0 ? pxToHmm(pxH) : cellH;
  const { w: curW, h: curH } = fitToCell(orgW, orgH, cellW, cellH);
  const picId = (instid * 17 + 12345) >>> 0;
  const cx = Math.round(curW / 2);
  const cy = Math.round(curH / 2);
  const e1 = orgW > 0 ? (curW / orgW).toFixed(6) : '1.000000';
  const e5 = orgH > 0 ? (curH / orgH).toFixed(6) : '1.000000';
  return [
    `<hp:pic id="${picId}" zOrder="0" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM"`,
    ` textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0"`,
    ` instid="${instid}" reverse="0">`,
    `<hp:offset x="0" y="0"/>`,
    `<hp:orgSz width="${orgW}" height="${orgH}"/>`,
    `<hp:curSz width="${curW}" height="${curH}"/>`,
    `<hp:flip horizontal="0" vertical="0"/>`,
    `<hp:rotationInfo angle="0" centerX="${cx}" centerY="${cy}" rotateimage="0"/>`,
    `<hp:renderingInfo>`,
    `<hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>`,
    `<hc:scaMatrix e1="${e1}" e2="0" e3="0" e4="0" e5="${e5}" e6="0"/>`,
    `<hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>`,
    `</hp:renderingInfo>`,
    `<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${orgW}" y="0"/>`,
    `<hc:pt2 x="${orgW}" y="${orgH}"/><hc:pt3 x="0" y="${orgH}"/></hp:imgRect>`,
    `<hp:imgClip left="0" right="${orgW}" top="0" bottom="${orgH}"/>`,
    `<hp:inMargin left="0" right="0" top="0" bottom="0"/>`,
    `<hp:imgDim dimwidth="${orgW}" dimheight="${orgH}"/>`,
    `<hc:img binaryItemIDRef="${binaryItemId}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>`,
    `<hp:effects/>`,
    `<hp:sz width="${curW}" widthRelTo="ABSOLUTE" height="${curH}" heightRelTo="ABSOLUTE" protect="0"/>`,
    `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0"`,
    ` holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="CENTER"`,
    ` horzAlign="CENTER" vertOffset="0" horzOffset="0"/>`,
    `<hp:outMargin left="0" right="0" top="0" bottom="0"/>`,
    `<hp:shapeComment>사진</hp:shapeComment>`,
    `</hp:pic>`,
  ].join('');
}

/**
 * HWPX ZIP에 텍스트 플레이스홀더 치환 + 이미지를 hp:pic 요소로 삽입
 * imageMap: { '{{약1사진}}': Buffer }
 */
async function replaceHwpxPlaceholdersWithImages({ templatePath, outputPath, bindings, imageMap = {} }) {
  const JSZip = require('jszip');
  const fsLocal = require('fs');
  const pathLocal = require('path');

  const zip = await JSZip.loadAsync(fsLocal.readFileSync(templatePath));

  const xmlFiles = Object.keys(zip.files).filter(
    name => name.startsWith('Contents/') && name.endsWith('.xml')
  );

  const manifestItems = []; // content.hpf에 등록할 이미지 항목
  let instIdSeed = 100000001;

  for (const fileName of xmlFiles) {
    let content = await zip.files[fileName].async('string');

    // 1. 이미지 placeholder → hp:pic 교체
    for (const [placeholder, imgBuf] of Object.entries(imageMap)) {
      if (!imgBuf) continue;
      const binFileName = bindings[placeholder]; // '약1사진.png'
      if (!binFileName) continue;
      const ext = pathLocal.extname(binFileName);
      const binaryItemId = placeholder.replace(/[{}]/g, ''); // '약1사진'
      const cellSize = PHOTO_CELL_SIZES[placeholder] || { w: 8033, h: 10264 };
      const picXml = buildPicXml(binaryItemId, imgBuf, cellSize, instIdSeed++);

      // <hp:t>{{약1사진}}</hp:t> → <hp:pic .../> (hp:run 태그는 유지)
      const search = `<hp:t>${placeholder}</hp:t>`;
      if (content.includes(search)) {
        content = content.split(search).join(picXml);
        zip.file(`BinData/${binFileName}`, imgBuf);
        manifestItems.push({ id: binaryItemId, href: `BinData/${binFileName}`, mime: imgMime(ext) });
        console.log(`[medicine-in export] 이미지 삽입: ${placeholder} → ${binFileName} (${cellSize.w}×${cellSize.h} HMM)`);
      } else {
        console.warn(`[medicine-in export] placeholder 못찾음: ${placeholder}`);
      }
    }

    // 2. 나머지 텍스트 바인딩
    for (const [placeholder, value] of Object.entries(bindings)) {
      if (imageMap[placeholder]) continue; // 이미지는 위에서 처리됨
      const safeValue = String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      content = content.split(placeholder).join(safeValue);
    }

    zip.file(fileName, content);
  }

  // 3. content.hpf manifest에 이미지 항목 등록
  if (manifestItems.length > 0) {
    let hpf = await zip.files['Contents/content.hpf'].async('string');
    const insertTag = '</opf:manifest>';
    const newItems = manifestItems
      .map(i => `<opf:item id="${i.id}" href="${i.href}" media-type="${i.mime}" isEmbeded="1"/>`)
      .join('');
    hpf = hpf.replace(insertTag, newItems + insertTag);
    zip.file('Contents/content.hpf', hpf);
  }

  const outBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  if (!fsLocal.existsSync(pathLocal.dirname(outputPath))) {
    fsLocal.mkdirSync(pathLocal.dirname(outputPath), { recursive: true });
  }
  fsLocal.writeFileSync(outputPath, outBuffer);
  return outputPath;
}
