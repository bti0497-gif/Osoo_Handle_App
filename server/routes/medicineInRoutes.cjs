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

const BASE_MEDICINES = ['?щ룄??, '以묓깂?곕굹?몃ⅷ', '??PAC)'];
const BASE_KITS = ['?붾え?덉븘?깆쭏??NH3-N)', '吏덉궛?깆쭏??NO3-N)', '?몄궛?쇱씤(PO4-P)', '?뚯뭡由щ룄(ALK)'];

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);

/** ?뚯씪紐낆뿉 ?ъ슜 遺덇???臾몄옄 ?쒓굅 */
function sanitizeName(name) {
  return String(name || '').replace(/[\\/:*?"<>|]/g, '_').trim();
}

function parseMedicinePhotoFileName(fileName) {
  const base = String(fileName || '').trim();
  const ext = path.extname(base).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) return null;
  const stem = path.basename(base, ext);

  // 理쒖떊 ?щ㎎: YYYYMMDD+?쏀뭹紐?
  let m = stem.match(/^(\d{4})(\d{2})(\d{2})\+(.+)$/);
  if (m) {
    return { y: m[1], m: m[2], d: m[3], rawName: m[4] };
  }

  // ?덇굅???щ㎎: YYYY-MM-DD-?쏀뭹紐?
  m = stem.match(/^(\d{4})-(\d{2})-(\d{2})-(.+)$/);
  if (m) {
    return { y: m[1], m: m[2], d: m[3], rawName: m[4] };
  }

  // ?덇굅???щ㎎: YYYY.MM.DD.-?쏀뭹紐?
  m = stem.match(/^(\d{4})\.(\d{2})\.(\d{2})\.-(.+)$/);
  if (m) {
    return { y: m[1], m: m[2], d: m[3], rawName: m[4] };
  }

  return null;
}

/**
 * {appDataPath}/사진관리?쏀뭹?낃퀬/{year}/ 瑜??ㅼ틪?댁꽌
 * ?쏀뭹紐??ㅽ듃紐???{ url, localPath, date } 留듭쓣 諛섑솚
 * ?뚯씪紐??⑦꽩: {YYYYMMDD}+{?쏀뭹紐?.ext
 * 媛숈? ?쏀뭹紐낆씠 ?щ윭 ?좎쭨???덉쑝硫?媛??理쒓렐 寃껋쓣 ?ъ슜
 */
function scanMedicinePhotos(appDataPath, year, mm) {
  const yearDir = path.join(appDataPath, '사진관리', '약품입고', String(year));
  const map = {}; // sanitizedName ??{ url, localPath, date }
  if (!fs.existsSync(yearDir)) return map;

  let files;
  try { files = fs.readdirSync(yearDir); } catch { return map; }

  const mmPrefix = mm + '-'; // '04-'

  for (const file of files) {
    const parsed = parseMedicinePhotoFileName(file);
    if (!parsed) continue;
    const { y, m, d, rawName } = parsed;
    // ?대떦 ?곗썡 ?뚯씪留?(mm媛 null?대㈃ ?꾩껜)
    if (mm && m !== mm) continue;
    const date = `${y}-${m}-${d}`;
    const nameKey = sanitizeName(rawName);
    const localPath = path.join(yearDir, file);
    const url = `/api/medicine-in/photo?p=${encodeURIComponent(`${year}/${file}`)}`;
    // 媛숈? ?쏀뭹紐낆씠硫???理쒓렐 ?좎쭨 ?곗꽑
    if (!map[nameKey] || date > map[nameKey].date) {
      map[nameKey] = { url, localPath, date };
    }
  }
  return map;
}

/**
 * ?ъ쭊 ?뚯씪??濡쒖뺄 ?붾젆?좊━??JPG濡?蹂?????
 * {appDataPath}/사진관리?쏀뭹?낃퀬/{year}/{yyyymmdd}+{?쏀뭹紐?.jpg
 */
async function savePhotoToLocal(appDataPath, year, mm, date, medicineName, srcPath) {
  if (!srcPath || !fs.existsSync(srcPath)) return null;
  const sharp = require('sharp');
  const srcBuf = fs.readFileSync(srcPath);
  const yyyymmdd = String(date || '').replace(/-/g, '').slice(0, 8);
  const fileName = `${yyyymmdd}+${sanitizeName(medicineName)}.jpg`;
  const destDir = path.join(appDataPath, '사진관리', '약품입고', String(year));
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, fileName);
  // BMP??raw ?쎌?濡??붿퐫????蹂??
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
   * ?꾨떖 援щℓ?됱쓣 湲곕낯媛믪쑝濡? ?꾩옱 ?쏀뭹쨌?ㅽ듃 紐⑸줉怨??④퍡 諛섑솚
   */
  router.get('/api/medicine-in/defaults', (req, res) => {
    try {
      const year = parseInt(req.query.year, 10);
      const month = parseInt(req.query.month, 10);

      if (!year || !month || month < 1 || month > 12) {
        return res.status(400).json({ success: false, error: '?좏슚?섏? ?딆? ?곗썡?낅땲??' });
      }

      // ?뱀썡 ?좎쭨 踰붿쐞
      const mm = String(month).padStart(2, '0');
      const currLastDay = new Date(year, month, 0).getDate();
      const currStart = `${year}-${mm}-01`;
      const currEnd = `${year}-${mm}-${String(currLastDay).padStart(2, '0')}`;

      // ?꾨떖 ?좎쭨 踰붿쐞
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;
      const prevMm = String(prevMonth).padStart(2, '0');
      const prevLastDay = new Date(prevYear, prevMonth, 0).getDate();
      const prevStart = `${prevYear}-${prevMm}-01`;
      const prevEnd = `${prevYear}-${prevMm}-${String(prevLastDay).padStart(2, '0')}`;

      const settings = db.prepare('SELECT site_name FROM app_settings WHERE id = 1').get();
      const siteName = settings?.site_name || '';

      // 異붽? ?쏀뭹 (湲곕낯 3醫??쒖쇅)
      const placeholders = BASE_MEDICINES.map(() => '?').join(',');
      const extraMedicines = db.prepare(
        `SELECT item_name FROM config_items
         WHERE category = 'medicine' AND is_active = 1
           AND item_name NOT IN (${placeholders})
         ORDER BY display_order ASC
         LIMIT 3`
      ).all(...BASE_MEDICINES).map(r => r.item_name);

      // 援щℓ??議고쉶 ?ы띁
      const getSum = (table, nameCol, name, start, end) =>
        db.prepare(
          `SELECT COALESCE(SUM(purchase_amount), 0) AS v FROM ${table}
           WHERE ${nameCol} = ? AND date >= ? AND date <= ?`
        ).get(name, start, end)?.v ?? 0;

      // ?쏀뭹蹂?湲곕낯 ?낃퀬??留?(config_items.default_amount)
      const defaultAmountRows = db.prepare(
        "SELECT item_name, COALESCE(default_amount, 0) AS default_amount FROM config_items WHERE category = 'medicine'"
      ).all();
      const defaultAmountMap = Object.fromEntries(defaultAmountRows.map(r => [r.item_name, r.default_amount]));

      // ?ㅽ듃蹂?湲곕낯 ?낃퀬??留?(config_items.default_amount)
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

      // 濡쒖뺄 ?ъ쭊 ?ㅼ틪 ???대떦 ???붾젆?좊━?먯꽌 ?쏀뭹紐?留ㅼ묶
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

      const tradePhoto = photoMap['嫄곕옒紐낆꽭??] || null;

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
   * 援щℓ?됱쓣 medicine_logs ?먮뒗 kit_logs??upsert ???
   * body: { tab: 'medicine'|'kit', date: 'YYYY-MM-DD', items: [{name, purchase}] }
   */
  router.post('/api/medicine-in/save', async (req, res) => {
    try {
      const { tab, date, items, photoPaths } = req.body;

      if (!date || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: '?좏슚?섏? ?딆? ?붿껌?낅땲??' });
      }

      const metadata = getCurrentRecordMetadata(db, req.body);

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
        return res.status(400).json({ success: false, error: '?좏슚?섏? ?딆? tab 媛? });
      }

      // ?ъ쭊 濡쒖뺄 ???(photoPaths: { ?쏀뭹紐? 'C:\\...\\file.jpg' })
      if (photoPaths && typeof photoPaths === 'object') {
        const dateParts = date.split('-');
        const yearStr = dateParts[0];
        const mmStr = dateParts[1];
        for (const [medicineName, filePath] of Object.entries(photoPaths)) {
          try {
            await savePhotoToLocal(appDataPath, yearStr, mmStr, date, medicineName, filePath);
          } catch (e) {
            console.warn(`[medicine-in save] ?ъ쭊 ????ㅽ뙣 (${medicineName}):`, e.message);
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
   * 釉뚮씪?곗?(??紐⑤뱶)?먯꽌 ?ъ쭊 ?뚯씪 ?먯껜瑜??낅줈?쒗빐 濡쒖뺄?????
   * multipart: date, medicineName, photo(file)
   */
  const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
  router.post('/api/medicine-in/upload-photo', photoUpload.single('photo'), async (req, res) => {
    try {
      const { date, medicineName } = req.body;
      if (!date || !medicineName || !req.file) {
        return res.status(400).json({ success: false, error: 'date, medicineName, photo ?꾨뱶媛 ?꾩슂?⑸땲??' });
      }
      const yearStr = date.split('-')[0];
      const sharp = require('sharp');
      const yyyymmdd = String(date || '').replace(/-/g, '').slice(0, 8);
      const fileName = `${yyyymmdd}+${sanitizeName(medicineName)}.jpg`;
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
   * HWPX ?앹꽦. ?ъ쭊? 濡쒖뺄 ?뚯씪 寃쎈줈(Electron)濡??꾨떖諛쏆븘 BinData/ ???쎌엯.
   * body: {
   *   year, month,
   *   medicineDate: 'YYYY-MM-DD',
   *   kitDate: 'YYYY-MM-DD',
   *   medicineItems: [{name, purchase}],
   *   kitItems: [{name, purchase}],
   *   photoPaths: { '{{???ъ쭊}}': 'C:\\...\\photo.jpg', ... }  // optional
   * }
   */
  router.post('/api/medicine-in/export', async (req, res) => {
    try {
      const { year, month, medicineDate, kitDate, medicineItems, kitItems, photoPaths } = req.body;

      const y = parseInt(year, 10);
      const m = parseInt(month, 10);
      if (!y || !m || m < 1 || m > 12) {
        return res.status(400).json({ success: false, error: '?좏슚?섏? ?딆? ?곗썡?낅땲??' });
      }

      const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, '?쏀뭹?낃퀬?쇱?', { excelOnly: false });
      if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
        return res.status(404).json({
          success: false,
          code: 'HWP_TEMPLATE_MISSING',
          error: '?쏀뭹?낃퀬?쇱? HWPX ?묒떇??李얠쓣 ???놁뒿?덈떎.',
          userMessage: '?ㅼ젙?먯꽌 ?쏀뭹?낃퀬?쇱? HWPX ?뚯씪???낅줈?쒗빐 二쇱꽭??',
        });
      }

      const ext = path.extname(templateInfo.absolutePath).toLowerCase();
      const EXCEL_EXTS = new Set(['.xlsx', '.xls', '.xlsm']);
      if (!EXCEL_EXTS.has(ext) && ext !== '.hwpx') {
        return res.status(400).json({ success: false, error: `吏?먰븯吏 ?딅뒗 ?묒떇 ?뺤떇?낅땲?? ${ext}` });
      }

      const mm = String(m).padStart(2, '0');
      const fmt = v => (v != null && v !== '') ? String(v) : '';

      // 諛붿씤??援ъ꽦
      const bindings = {
        '{{??}': String(m),
        '{{?좎쭨}}': medicineDate || `${y}.${mm}`,
        '{{?ㅽ듃?좎쭨}}': kitDate || `${y}.${mm}`,
      };

      const meds = Array.isArray(medicineItems) ? medicineItems : [];
      const baseMeds = meds.filter(i => BASE_MEDICINES.includes(i.name));
      const extraMeds = meds.filter(i => !BASE_MEDICINES.includes(i.name));

      // 湲곕낯 ?쏀뭹 (?쒖꽌 蹂댁옣)
      BASE_MEDICINES.forEach((name, idx) => {
        const key = ['??', '??', '??'][idx];
        const item = baseMeds.find(i => i.name === name);
        bindings[`{{${key}援щℓ}}`] = fmt(item?.purchase);
      });

      // 異붽? ?쏀뭹 (理쒕? 2媛?
      [0, 1].forEach(idx => {
        const key = ['異?', '異?'][idx];
        const item = extraMeds[idx];
        bindings[`{{${key}?대쫫}}`] = item?.name || '';
        bindings[`{{${key}援щℓ}}`] = item ? fmt(item.purchase) : '';
      });

      // ?ㅽ듃 援щℓ??(?쒗뵆由우뿉 ?뚮젅?댁뒪??붽? ?덉쓣 寃쎌슦瑜??꾪빐)
      const kits = Array.isArray(kitItems) ? kitItems : [];
      BASE_KITS.forEach((name, idx) => {
        const key = `??{idx + 1}`;
        const item = kits.find(i => i.name === name);
        bindings[`{{${key}援щℓ}}`] = fmt(item?.purchase);
      });

      // ?ъ쭊 諛붿씤?? photoPaths = { '{{???ъ쭊}}': 'C:\\...\\photo.jpg' }
      // ?ъ쭊 ?뚯씪??BinData/ ??蹂듭궗?섍퀬 href 移섑솚 (?쒗뵆由우씠 href 諛⑹떇?쇰줈 ?ㅺ퀎??寃쎌슦 ?숈옉)
      const imageMap = {}; // { '{{???ъ쭊}}': Buffer }

      // placeholder ???쏀뭹紐???ℓ??(濡쒖뺄 ??????ъ슜)
      const placeholderToName = {};
      const mArr = Array.isArray(medicineItems) ? medicineItems : [];
      const bMeds = mArr.filter(i => BASE_MEDICINES.includes(i.name));
      const eMeds = mArr.filter(i => !BASE_MEDICINES.includes(i.name));
      BASE_MEDICINES.forEach((name, idx) => { placeholderToName[`{{??{idx + 1}?ъ쭊}}`] = name; });
      eMeds.slice(0, 2).forEach((item, idx) => { placeholderToName[`{{異?{idx + 1}?ъ쭊}}`] = item.name; });
      placeholderToName['{{嫄곕옒?ъ쭊}}'] = '嫄곕옒紐낆꽭??;
      (Array.isArray(kitItems) ? kitItems : []).slice(0, 2).forEach((item, idx) => {
        placeholderToName[`{{??{idx + 1}?ъ쭊}}`] = item.name;
      });

      if (photoPaths && typeof photoPaths === 'object') {
        for (const [placeholder, filePath] of Object.entries(photoPaths)) {
          if (!filePath || !fs.existsSync(filePath)) continue;
          try {
            imageMap[placeholder] = fs.readFileSync(filePath);
            // BinData???ｌ쓣 ?뚯씪紐?(placeholder?먯꽌 以묎큵???쒓굅)
            const binFileName = placeholder.replace(/[\{\}]/g, '') + path.extname(filePath);
            bindings[placeholder] = binFileName;

            // 濡쒖뺄 援ъ“???붾젆?좊━???ъ쭊 蹂듭궗
            const medicineName = placeholderToName[placeholder];
            if (medicineName) {
              // ?ㅽ듃 ?ъ쭊? kitDate ?ъ슜, ?섎㉧吏??medicineDate
              const isKit = placeholder.startsWith('{{??);
              const useDate = isKit ? (kitDate || `${y}-${mm}-01`) : (medicineDate || `${y}-${mm}-01`);
              try {
                await savePhotoToLocal(appDataPath, y, mm, useDate, medicineName, filePath);
              } catch (e) {
                console.warn('[medicine-in export] 濡쒖뺄 ?ъ쭊 ????ㅽ뙣:', e.message);
              }
            }
          } catch (e) {
            console.warn(`[medicine-in export] ?ъ쭊 ?쎄린 ?ㅽ뙣 (${filePath}):`, e.message);
          }
        }
      }

      // Fallback: photoPaths濡??꾨떖?섏? ?딆? ?ъ쭊? 濡쒖뺄 ?ㅼ틪?먯꽌 ?먮룞 蹂댁셿
      const photoMap = scanMedicinePhotos(appDataPath, y, mm);
      for (const [placeholder, medicineName] of Object.entries(placeholderToName)) {
        if (imageMap[placeholder]) continue; // ?대? 泥섎━??
        const key = sanitizeName(medicineName);
        const found = photoMap[key];
        if (!found?.localPath || !fs.existsSync(found.localPath)) continue;
        try {
          imageMap[placeholder] = fs.readFileSync(found.localPath);
          const binFileName = placeholder.replace(/[\{\}]/g, '') + path.extname(found.localPath);
          bindings[placeholder] = binFileName;
          console.log(`[medicine-in export] fallback ?ъ쭊 ?곸슜: ${medicineName} ??${found.localPath}`);
        } catch (e) {
          console.warn(`[medicine-in export] fallback ?ъ쭊 ?쎄린 ?ㅽ뙣 (${medicineName}):`, e.message);
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
        userMessage: `?앹꽦???ㅽ뙣?덉뒿?덈떎: ${err.message}`,
      });
    }
  });

  /**
   * GET /api/medicine-in/photo?p=<year>/<filename>
   * 濡쒖뺄 ?쏀뭹 ?ъ쭊 ?쒕튃 (?쒓? 寃쎈줈 static 誘몃뱾?⑥뼱 ???
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
 * Named range ?⑥씪 ? ?뚯떛
 * "'?쏀뭹'!$C$3" ??{ sheetName: '?쏀뭹', col: 'C', row: 3, address: 'C3' }
 */
function parseNamedRangeSingle(rangeStr) {
  const m = String(rangeStr || '').match(/^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)$/);
  if (!m) return null;
  return { sheetName: m[1], col: m[2], row: parseInt(m[3], 10), address: `${m[2]}${m[3]}` };
}

/**
 * ????ы븿??蹂묓빀 踰붿쐞 諛섑솚 (?놁쑝硫??⑥씪 ?)
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

// HWPX placeholder ??Excel named cell 留ㅽ븨
const PHOTO_HWPX_TO_NAMED = {
  '{{???ъ쭊}}': '???ъ쭊',
  '{{???ъ쭊}}': '???ъ쭊',
  '{{???ъ쭊}}': '???ъ쭊',
  '{{異??ъ쭊}}': '異??ъ쭊',
  '{{異??ъ쭊}}': '異??ъ쭊',
  '{{嫄곕옒?ъ쭊}}': '嫄곕옒?ъ쭊',
  '{{???ъ쭊}}': '?ъ쭊1',
  '{{???ъ쭊}}': '?ъ쭊2',
};

// ?ㅽ듃 ?쏀뭹紐???Excel named cell 留ㅽ븨
const KIT_NAME_TO_NAMED = {
  '?붾え?덉븘?깆쭏??NH3-N)': '?붾え?덉븘??,
  '吏덉궛?깆쭏??NO3-N)': '吏덉궛??,
  '?몄궛?쇱씤(PO4-P)': '?몃웾',
  '?뚯뭡由щ룄(ALK)': '?뚯뭡由щ웾',
};

/**
 * ?쏀뭹?낃퀬?쇱? xlsx ?앹꽦
 * imageMap: { '{{???ъ쭊}}': Buffer, ... }
 */
async function exportMedicineInXlsx({ templatePath, outputPath, year, month, medicineDate, kitDate, baseMeds, extraMeds, kits, imageMap }) {
  const ExcelJS = require('exceljs');
  const sharp = require('sharp');
  const fsLocal = require('fs');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templatePath);

  // 湲곗〈 ?대?吏 ?쒓굅
  wb.media = [];
  wb.worksheets.forEach(ws => { ws._media = []; });

  const mm = String(month).padStart(2, '0');

  // Named cell 留?援ъ꽦
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

  const medSheet = wb.getWorksheet('?쏀뭹');

  // ?ㅻ뜑 (named cells ?ъ슜)
  setNamed('?쏀뭹?쒗듃紐?, `(${month})???쏀뭹?낃퀬?쇱?`);
  setNamed('?ㅽ듃?쒗듃紐?, `(${month})???ㅽ듃?낃퀬?쇱?`);

  // ?좎쭨: ?쏀뭹 ?쒗듃??吏곸젒, ?ㅽ듃 ?쒗듃??named cell
  if (medSheet) {
    medSheet.getCell('A2').value = medicineDate || `${year}.${mm}`;
  }
  setNamed('?좎쭨', kitDate || `${year}.${mm}`);

  // 湲곕낯 ?쏀뭹
  BASE_MEDICINES.forEach((name, idx) => {
    const item = baseMeds.find(i => i.name === name);
    setNamed(`??{idx + 1}紐?, name);
    setNamed(`??{idx + 1}??, item?.purchase ?? '');
  });

  // 異붽? ?쏀뭹
  [0, 1].forEach(idx => {
    const item = extraMeds[idx];
    setNamed(`異?{idx + 1}紐?, item?.name || '');
    setNamed(`異?{idx + 1}??, item ? (item.purchase ?? '') : '');
  });

  // ?ㅽ듃 援щℓ??
  for (const [kitName, namedKey] of Object.entries(KIT_NAME_TO_NAMED)) {
    const item = kits.find(i => i.name === kitName);
    setNamed(namedKey, item?.purchase ?? '');
  }

  // ?ъ쭊 ?쎌엯
  for (const [hwpxKey, namedKey] of Object.entries(PHOTO_HWPX_TO_NAMED)) {
    const imgBuf = imageMap[hwpxKey];
    if (!imgBuf) continue;

    const info = namedMap[namedKey];
    if (!info) continue;
    const ws = wb.getWorksheet(info.sheetName);
    if (!ws) continue;

    const extent = getMergedCellExtent(ws, info.col, info.row);

    // ? ?쎌? ?ш린 怨꾩궛
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
      // BMP ??sharp??raw ?쎌?濡?蹂????泥섎━
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
      console.log(`[medicine-in xlsx] ?ъ쭊 ?쎌엯: ${namedKey} (${renderW}횞${renderH}px)`);
    } catch (e) {
      console.warn(`[medicine-in xlsx] ?ъ쭊 ?쎌엯 ?ㅽ뙣 (${namedKey}):`, e.message);
    }
  }

  await wb.xlsx.writeFile(outputPath);
  return outputPath;
}

/**
 * 24/32bit 臾댁븬異?BMP 踰꾪띁 ??RGB raw ?쎌? 蹂??
 */
function decodeBmpToRgb(buf) {
  const dataOffset = buf.readUInt32LE(10);
  const width = buf.readInt32LE(18);
  const rawHeight = buf.readInt32LE(22);
  const height = Math.abs(rawHeight);
  const bitsPerPixel = buf.readUInt16LE(28);
  const compression = buf.readUInt32LE(30);
  if (compression !== 0) throw new Error(`?뺤텞 BMP??吏?먰븯吏 ?딆뒿?덈떎 (compression=${compression})`);
  if (bitsPerPixel !== 24 && bitsPerPixel !== 32) throw new Error(`BMP ${bitsPerPixel}bpp??吏?먰븯吏 ?딆뒿?덈떎`);

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
 * ?대?吏 踰꾪띁?먯꽌 ?쎌? ?ш린 ?쎄린 (BMP / PNG / JPEG ?쒖닔 JS ?뚯꽌)
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

/** ?쎌? ??HMM (1/100mm) 蹂?? 96dpi 湲곗? */
function pxToHmm(px) { return Math.round((px * 2540) / 96); }

/** ? ?ш린 ?덉뿉 鍮꾩쑉 ?좎??섎ŉ 留욎땄 */
function fitToCell(imgW, imgH, cellW, cellH) {
  if (!imgW || !imgH) return { w: cellW, h: cellH };
  const scale = Math.min(cellW / imgW, cellH / imgH, 1);
  return { w: Math.round(imgW * scale), h: Math.round(imgH * scale) };
}

// placeholder ??? ?ш린 (HMM ?⑥쐞, ?쒗뵆由우뿉??痢≪젙)
const PHOTO_CELL_SIZES = {
  '{{???ъ쭊}}':  { w: 8033, h: 10264 },
  '{{???ъ쭊}}':  { w: 8033, h: 10264 },
  '{{???ъ쭊}}':  { w: 8033, h: 10264 },
  '{{異??ъ쭊}}':  { w: 8033, h: 10264 },
  '{{異??ъ쭊}}':  { w: 8033, h: 10264 },
  '{{???ъ쭊}}':  { w: 36878, h: 20526 },
  '{{???ъ쭊}}':  { w: 36878, h: 20526 },
  '{{嫄곕옒?ъ쭊}}': { w: 15500, h: 14112 },
};

/** ?뺤옣????MIME type */
function imgMime(ext) {
  return ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
            '.bmp': 'image/bmp', '.gif': 'image/gif', '.webp': 'image/webp' })[ext.toLowerCase()] || 'image/bmp';
}

/**
 * hp:pic XML 議곌컖 ?앹꽦
 * binaryItemId: content.hpf 諛?binaryItemIDRef ?????앸퀎??(?? '???ъ쭊')
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
    `<hp:shapeComment>?ъ쭊</hp:shapeComment>`,
    `</hp:pic>`,
  ].join('');
}

/**
 * HWPX ZIP???띿뒪???뚮젅?댁뒪???移섑솚 + ?대?吏瑜?hp:pic ?붿냼濡??쎌엯
 * imageMap: { '{{???ъ쭊}}': Buffer }
 */
async function replaceHwpxPlaceholdersWithImages({ templatePath, outputPath, bindings, imageMap = {} }) {
  const JSZip = require('jszip');
  const fsLocal = require('fs');
  const pathLocal = require('path');

  const zip = await JSZip.loadAsync(fsLocal.readFileSync(templatePath));

  const xmlFiles = Object.keys(zip.files).filter(
    name => name.startsWith('Contents/') && name.endsWith('.xml')
  );

  const manifestItems = []; // content.hpf???깅줉???대?吏 ??ぉ
  let instIdSeed = 100000001;

  for (const fileName of xmlFiles) {
    let content = await zip.files[fileName].async('string');

    // 1. ?대?吏 placeholder ??hp:pic 援먯껜
    for (const [placeholder, imgBuf] of Object.entries(imageMap)) {
      if (!imgBuf) continue;
      const binFileName = bindings[placeholder]; // '???ъ쭊.png'
      if (!binFileName) continue;
      const ext = pathLocal.extname(binFileName);
      const binaryItemId = placeholder.replace(/[{}]/g, ''); // '???ъ쭊'
      const cellSize = PHOTO_CELL_SIZES[placeholder] || { w: 8033, h: 10264 };
      const picXml = buildPicXml(binaryItemId, imgBuf, cellSize, instIdSeed++);

      // <hp:t>{{???ъ쭊}}</hp:t> ??<hp:pic .../> (hp:run ?쒓렇???좎?)
      const search = `<hp:t>${placeholder}</hp:t>`;
      if (content.includes(search)) {
        content = content.split(search).join(picXml);
        zip.file(`BinData/${binFileName}`, imgBuf);
        manifestItems.push({ id: binaryItemId, href: `BinData/${binFileName}`, mime: imgMime(ext) });
        console.log(`[medicine-in export] ?대?吏 ?쎌엯: ${placeholder} ??${binFileName} (${cellSize.w}횞${cellSize.h} HMM)`);
      } else {
        console.warn(`[medicine-in export] placeholder 紐살갼?? ${placeholder}`);
      }
    }

    // 2. ?섎㉧吏 ?띿뒪??諛붿씤??
    for (const [placeholder, value] of Object.entries(bindings)) {
      if (imageMap[placeholder]) continue; // ?대?吏???꾩뿉??泥섎━??
      const safeValue = String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      content = content.split(placeholder).join(safeValue);
    }

    zip.file(fileName, content);
  }

  // 3. content.hpf manifest???대?吏 ??ぉ ?깅줉
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
