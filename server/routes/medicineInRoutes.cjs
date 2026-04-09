const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');

const { resolveReportTemplatePath } = require('../services/reportTemplateService.cjs');
const { replaceHwpxPlaceholders } = require('../services/hwpPdfService.cjs');
const { getCurrentRecordMetadata } = require('../services/syncMetadataService.cjs');

const router = express.Router();

const BASE_MEDICINES = ['포도당', '중탄산나트륨', '팩(PAC)'];
const BASE_KITS = ['암모니아성질소(NH3-N)', '질산성질소(NO3-N)', '인산염인(PO4-P)', '알칼리도(ALK)'];

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/** 파일명에 사용 불가한 문자 제거 */
function sanitizeName(name) {
  return String(name || '').replace(/[\\/:*?"<>|]/g, '_').trim();
}

/**
 * {appDataPath}/사진관리/약품입고/{year}/{mm}/ 를 스캔해서
 * 약품명/키트명 → { url, localPath, date } 맵을 반환
 */
function scanMedicinePhotos(appDataPath, year, mm) {
  const monthDir = path.join(appDataPath, '사진관리', '약품입고', String(year), mm);
  const map = {}; // sanitizedName → { url, localPath, date }
  if (!fs.existsSync(monthDir)) return map;

  const dateDirs = fs.readdirSync(monthDir).filter(d => {
    try { return fs.statSync(path.join(monthDir, d)).isDirectory(); } catch { return false; }
  });

  for (const dateDir of dateDirs) {
    const dirPath = path.join(monthDir, dateDir);
    let files;
    try { files = fs.readdirSync(dirPath); } catch { continue; }

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (!IMAGE_EXTS.has(ext)) continue;
      // 파일명 패턴: {date}-{약품명}.ext
      const nameWithoutExt = path.basename(file, ext);
      const prefix = dateDir + '-';
      const nameKey = nameWithoutExt.startsWith(prefix)
        ? nameWithoutExt.slice(prefix.length)
        : nameWithoutExt;
      const url = encodeURI(`/사진관리/약품입고/${year}/${mm}/${dateDir}/${file}`);
      map[nameKey] = { url, localPath: path.join(dirPath, file), date: dateDir };
    }
  }
  return map;
}

/**
 * 사진 파일을 구조화된 로컬 디렉토리에 복사
 * {appDataPath}/사진관리/약품입고/{year}/{mm}/{date}/{date}-{약품명}{ext}
 */
function savePhotoToLocal(appDataPath, year, mm, date, medicineName, srcPath) {
  if (!srcPath || !fs.existsSync(srcPath)) return null;
  const ext = path.extname(srcPath).toLowerCase() || '.jpg';
  const fileName = `${date}-${sanitizeName(medicineName)}${ext}`;
  const destDir = path.join(appDataPath, '사진관리', '약품입고', String(year), mm, date);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, fileName);
  fs.copyFileSync(srcPath, destPath);
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

      const allMedicines = [...BASE_MEDICINES, ...extraMedicines].map(name => ({
        name,
        currPurchase: getSum('medicine_logs', 'medicine_name', name, currStart, currEnd),
        prevPurchase: getSum('medicine_logs', 'medicine_name', name, prevStart, prevEnd),
      }));

      const kits = BASE_KITS.map(name => ({
        name,
        currPurchase: getSum('kit_logs', 'kit_name', name, currStart, currEnd),
        prevPurchase: getSum('kit_logs', 'kit_name', name, prevStart, prevEnd),
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
  router.post('/api/medicine-in/save', (req, res) => {
    try {
      const { tab, date, items } = req.body;

      if (!date || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: '유효하지 않은 요청입니다.' });
      }

      const metadata = getCurrentRecordMetadata(db);

      if (tab === 'medicine') {
        const stmt = db.prepare(`
          INSERT INTO medicine_logs
            (medicine_name, date, purchase_amount, usage_amount, current_inventory,
             site_name, author, created_at, last_modified, is_synced)
          VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?, 0)
          ON CONFLICT(medicine_name, date) DO UPDATE SET
            purchase_amount = excluded.purchase_amount,
            last_modified   = excluded.last_modified,
            is_synced       = 0
        `);
        db.transaction((rows) => {
          for (const item of rows) {
            if (!item.name || item.purchase == null) continue;
            stmt.run(item.name, date, Number(item.purchase),
              metadata.siteName, metadata.author, metadata.createdAt, metadata.lastModified);
          }
        })(items);
      } else if (tab === 'kit') {
        const stmt = db.prepare(`
          INSERT INTO kit_logs
            (kit_name, date, purchase_amount, usage_amount, current_inventory,
             site_name, author, created_at, last_modified, is_synced)
          VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?, 0)
          ON CONFLICT(kit_name, date) DO UPDATE SET
            purchase_amount = excluded.purchase_amount,
            last_modified   = excluded.last_modified,
            is_synced       = 0
        `);
        db.transaction((rows) => {
          for (const item of rows) {
            if (!item.name || item.purchase == null) continue;
            stmt.run(item.name, date, Number(item.purchase),
              metadata.siteName, metadata.author, metadata.createdAt, metadata.lastModified);
          }
        })(items);
      } else {
        return res.status(400).json({ success: false, error: '유효하지 않은 tab 값' });
      }

      res.json({ success: true });
    } catch (err) {
      console.error('[medicine-in save]', err);
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
      if (ext !== '.hwpx') {
        return res.status(400).json({ success: false, error: 'HWPX 파일만 지원합니다.' });
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
                savePhotoToLocal(appDataPath, y, mm, useDate, medicineName, filePath);
              } catch (e) {
                console.warn('[medicine-in export] 로컬 사진 저장 실패:', e.message);
              }
            }
          } catch (e) {
            console.warn(`[medicine-in export] 사진 읽기 실패 (${filePath}):`, e.message);
          }
        }
      }

      const outputDir = path.join(os.tmpdir(), 'osoo-medicine-in');
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
      const outputPath = path.join(outputDir, `약품입고일지_${y}_${mm}.hwpx`);

      // HWPX 생성: 텍스트 바인딩 + BinData 이미지 삽입
      await replaceHwpxPlaceholdersWithImages({
        templatePath: templateInfo.absolutePath,
        outputPath,
        bindings,
        imageMap,
      });

      exec(`start "" "${outputPath}"`, { shell: 'cmd.exe' }, (err) => {
        if (err) console.warn('[medicine-in export] 파일 열기 실패:', err.message);
      });

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

  return router;
};

/**
 * HWPX ZIP에 텍스트 플레이스홀더 치환 + 이미지 BinData 삽입
 * imageMap: { '{{약1사진}}': Buffer } — 바인딩에서 값으로 지정한 binFileName과 쌍을 이룸
 */
async function replaceHwpxPlaceholdersWithImages({ templatePath, outputPath, bindings, imageMap = {} }) {
  const JSZip = require('jszip');
  const fsLocal = require('fs');
  const pathLocal = require('path');

  const zipData = fsLocal.readFileSync(templatePath);
  const zip = await JSZip.loadAsync(zipData);

  // 텍스트 치환 (Contents/*.xml)
  const xmlFiles = Object.keys(zip.files).filter(
    name => name.startsWith('Contents/') && name.endsWith('.xml')
  );
  for (const fileName of xmlFiles) {
    let content = await zip.files[fileName].async('string');
    for (const [placeholder, value] of Object.entries(bindings)) {
      const safeValue = String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const encodedPh = placeholder
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      content = content.split(placeholder).join(safeValue);
      if (encodedPh !== placeholder) content = content.split(encodedPh).join(safeValue);
    }
    zip.file(fileName, content);
  }

  // BinData에 이미지 삽입: bindings[placeholder]가 파일명, imageMap[placeholder]가 Buffer
  for (const [placeholder, imageBuffer] of Object.entries(imageMap)) {
    const binFileName = bindings[placeholder]; // e.g. '약1사진.jpg'
    if (binFileName && imageBuffer) {
      zip.file(`BinData/${binFileName}`, imageBuffer);
    }
  }

  const outBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  if (!fsLocal.existsSync(pathLocal.dirname(outputPath))) {
    fsLocal.mkdirSync(pathLocal.dirname(outputPath), { recursive: true });
  }
  fsLocal.writeFileSync(outputPath, outBuffer);
  return outputPath;
}
