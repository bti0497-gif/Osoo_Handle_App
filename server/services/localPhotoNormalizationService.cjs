const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);

function sanitizeName(name) {
  return String(name || '').replace(/[\\/:*?"<>|]/g, '_').trim();
}

function parseMedicineFile(fileName) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) return null;
  const stem = path.basename(fileName, ext);

  let m = stem.match(/^(\d{4})(\d{2})(\d{2})\+(.+)$/);
  if (m) return { yyyymmdd: `${m[1]}${m[2]}${m[3]}`, name: m[4] };

  m = stem.match(/^(\d{4})-(\d{2})-(\d{2})-(.+)$/);
  if (m) return { yyyymmdd: `${m[1]}${m[2]}${m[3]}`, name: m[4] };

  m = stem.match(/^(\d{4})\.(\d{2})\.(\d{2})\.-(.+)$/);
  if (m) return { yyyymmdd: `${m[1]}${m[2]}${m[3]}`, name: m[4] };

  return null;
}

function parseSludgeFile(fileName) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) return null;
  const stem = path.basename(fileName, ext);

  let m = stem.match(/^(\d{8})-슬러지(\d+)$/);
  if (m) return { yyyymmdd: m[1], type: 'sludge', index: Number(m[2]) || 1 };

  m = stem.match(/^(\d{4})-(\d{2})-(\d{2})-슬러지(\d+)$/);
  if (m) return { yyyymmdd: `${m[1]}${m[2]}${m[3]}`, type: 'sludge', index: Number(m[4]) || 1 };

  m = stem.match(/^(\d{4})-(\d{2})-(\d{2})-諛섏텧$/);
  if (m) return { yyyymmdd: `${m[1]}${m[2]}${m[3]}`, type: 'sludge', index: 1 };

  m = stem.match(/^(\d{8})-泥?냼?꾩쬆$/);
  if (m) return { yyyymmdd: m[1], type: 'certificate' };

  m = stem.match(/^(\d{4})-(\d{2})-(\d{2})-泥?냼?꾩쬆$/);
  if (m) return { yyyymmdd: `${m[1]}${m[2]}${m[3]}`, type: 'certificate' };

  return null;
}

function uniquePath(filePath) {
  if (!fs.existsSync(filePath)) return filePath;
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  let i = 1;
  while (true) {
    const candidate = path.join(dir, `${base}_${i}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
    i += 1;
  }
}

async function normalizeImageToJpg(sourcePath, targetPath) {
  const finalTarget = uniquePath(targetPath);
  const buffer = fs.readFileSync(sourcePath);
  await sharp(buffer).rotate().jpeg({ quality: 90 }).toFile(finalTarget);
  if (path.resolve(sourcePath) !== path.resolve(finalTarget)) {
    try { fs.unlinkSync(sourcePath); } catch (_) {}
  }
  return finalTarget;
}

async function normalizeMedicinePhotos(appDataPath) {
  const root = path.join(appDataPath, '사진관리', '약품입고');
  if (!fs.existsSync(root)) return { converted: 0 };
  let converted = 0;

  const years = fs.readdirSync(root).filter((name) => /^\d{4}$/.test(String(name || '').trim()));
  for (const year of years) {
    const yearDir = path.join(root, year);
    const files = fs.readdirSync(yearDir);
    for (const fileName of files) {
      const parsed = parseMedicineFile(fileName);
      if (!parsed) continue;
      const targetName = `${parsed.yyyymmdd}+${sanitizeName(parsed.name)}.jpg`;
      const sourcePath = path.join(yearDir, fileName);
      const targetPath = path.join(yearDir, targetName);
      const sourceExt = path.extname(fileName).toLowerCase();
      const alreadyStandard = sourceExt === '.jpg' && fileName === targetName;
      if (alreadyStandard) continue;
      await normalizeImageToJpg(sourcePath, targetPath);
      converted += 1;
    }
  }
  return { converted };
}

async function normalizeSludgePhotos(appDataPath) {
  const root = path.join(appDataPath, '사진관리', '슬러지');
  if (!fs.existsSync(root)) return { converted: 0 };
  let converted = 0;

  const years = fs.readdirSync(root).filter((name) => /^\d{4}$/.test(String(name || '').trim()));
  for (const year of years) {
    const yearDir = path.join(root, year);
    const files = fs.readdirSync(yearDir);
    for (const fileName of files) {
      const parsed = parseSludgeFile(fileName);
      if (!parsed) continue;
      const targetName = parsed.type === 'certificate'
        ? `${parsed.yyyymmdd}-泥?냼?꾩쬆.jpg`
        : `${parsed.yyyymmdd}-슬러지${parsed.index}.jpg`;
      const sourcePath = path.join(yearDir, fileName);
      const targetPath = path.join(yearDir, targetName);
      const sourceExt = path.extname(fileName).toLowerCase();
      const alreadyStandard = sourceExt === '.jpg' && fileName === targetName;
      if (alreadyStandard) continue;
      await normalizeImageToJpg(sourcePath, targetPath);
      converted += 1;
    }
  }
  return { converted };
}

async function normalizeLegacyPhotoFiles(appDataPath) {
  const medicine = await normalizeMedicinePhotos(appDataPath);
  const sludge = await normalizeSludgePhotos(appDataPath);
  return {
    totalConverted: (medicine.converted || 0) + (sludge.converted || 0),
    medicineConverted: medicine.converted || 0,
    sludgeConverted: sludge.converted || 0,
  };
}

module.exports = {
  normalizeLegacyPhotoFiles,
};

