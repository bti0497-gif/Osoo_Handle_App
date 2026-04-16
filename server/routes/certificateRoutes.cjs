const express = require('express');
const multer = require('multer');
const { drive, getOrCreateFolder, isDriveConfigured } = require('../services/driveService.cjs');

const router = express.Router();

const CERTIFICATE_ROOT_FOLDER_ID =
  String(process.env.CERTIFICATE_DRIVE_FOLDER_ID || '1Po-gd-OKlaeGyL-Ppjc6_wKgSLEM4iX4').trim();
const CERTIFICATE_PREFIX_RE = /^(성적서|mlss)-(\d{8})(\.[^.]+)?$/i;

function toDisplayDate(yyyymmdd) {
  if (!/^\d{8}$/.test(String(yyyymmdd || ''))) return '';
  const y = yyyymmdd.slice(0, 4);
  const m = yyyymmdd.slice(4, 6);
  const d = yyyymmdd.slice(6, 8);
  return `${y}-${m}-${d}`;
}

function parseCertMeta(fileName) {
  const normalized = String(fileName || '').trim();
  const m = normalized.match(CERTIFICATE_PREFIX_RE);
  if (!m) return null;
  const category = m[1].toLowerCase();
  const stamp = m[2];
  return {
    category,
    stamp,
    issuedAt: toDisplayDate(stamp),
    sampledAt: toDisplayDate(stamp),
  };
}

async function listFolders(parentId) {
  const res = await drive.files.list({
    q: [
      "mimeType='application/vnd.google-apps.folder'",
      `'${String(parentId)}' in parents`,
      'trashed=false',
    ].join(' and '),
    fields: 'files(id, name)',
    spaces: 'drive',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 200,
  });
  return res.data.files || [];
}

async function listFiles(parentId) {
  const res = await drive.files.list({
    q: [
      "mimeType!='application/vnd.google-apps.folder'",
      `'${String(parentId)}' in parents`,
      'trashed=false',
    ].join(' and '),
    fields: 'files(id, name, mimeType, modifiedTime, size)',
    spaces: 'drive',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 500,
  });
  return res.data.files || [];
}

function normalizeYear(value) {
  const y = String(value || '').trim();
  return /^\d{4}$/.test(y) ? y : '';
}

function normalizeMonth(value) {
  const m = String(value || '').trim();
  return /^(0[1-9]|1[0-2])$/.test(m) ? m : '';
}

async function resolveMonthFolders({ year, month }) {
  const yearFolders = await listFolders(CERTIFICATE_ROOT_FOLDER_ID);
  if (!year && !month) {
    const monthFolders = [];
    for (const yf of yearFolders) {
      const months = await listFolders(yf.id);
      months.forEach((mf) => monthFolders.push({ year: yf.name, month: mf.name, folderId: mf.id }));
    }
    return monthFolders;
  }

  const yearFolder = yearFolders.find((f) => f.name === year);
  if (!yearFolder) return [];
  const monthFolders = await listFolders(yearFolder.id);
  if (!month) {
    return monthFolders.map((mf) => ({ year, month: mf.name, folderId: mf.id }));
  }
  const monthFolder = monthFolders.find((f) => f.name === month);
  if (!monthFolder) return [];
  return [{ year, month, folderId: monthFolder.id }];
}

module.exports = function () {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

  router.get('/api/certificates', async (req, res) => {
    try {
      if (!isDriveConfigured()) {
        return res.json({ success: true, items: [] });
      }

      const year = normalizeYear(req.query.year);
      const month = normalizeMonth(req.query.month);
      const folders = await resolveMonthFolders({ year, month });
      const items = [];

      for (const folder of folders) {
        const files = await listFiles(folder.folderId);
        for (const file of files) {
          const meta = parseCertMeta(file.name);
          if (!meta) continue;
          items.push({
            id: file.id,
            fileName: file.name,
            siteName: '공통',
            sampledAt: meta.sampledAt,
            issuedAt: meta.issuedAt,
            category: meta.category,
            year: folder.year,
            month: folder.month,
            downloadUrl: `/api/certificates/files/${encodeURIComponent(file.id)}?name=${encodeURIComponent(file.name)}`,
          });
        }
      }

      items.sort((a, b) => {
        if (a.issuedAt !== b.issuedAt) return String(b.issuedAt).localeCompare(String(a.issuedAt));
        return String(a.fileName).localeCompare(String(b.fileName), 'ko');
      });

      res.json({ success: true, items });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  router.get('/api/certificates/:id/download', async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ success: false, message: '성적서 ID가 필요합니다.' });
    return res.json({
      success: true,
      downloadUrl: `/api/certificates/files/${encodeURIComponent(id)}`,
    });
  });

  router.get('/api/certificates/files/:id', async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).send('잘못된 요청입니다.');

      const meta = await drive.files.get({
        fileId: id,
        fields: 'id,name,mimeType,size',
        supportsAllDrives: true,
      });
      const fileName = String(req.query.name || meta.data.name || 'certificate');
      const safeFileName = fileName.replace(/["\r\n]/g, '_');

      const media = await drive.files.get(
        { fileId: id, alt: 'media', supportsAllDrives: true },
        { responseType: 'stream' }
      );

      res.setHeader('Content-Type', meta.data.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeFileName)}`);
      media.data.on('error', () => {
        if (!res.headersSent) res.status(500).end();
      });
      media.data.pipe(res);
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  router.post('/api/certificates/upload', upload.single('certificatePdf'), async (req, res) => {
    try {
      if (!isDriveConfigured()) {
        return res.status(400).json({ success: false, message: 'Drive 설정이 필요합니다.' });
      }
      if (!req.file) {
        return res.status(400).json({ success: false, message: '업로드 파일이 없습니다.' });
      }

      const now = new Date();
      const year = String(now.getFullYear());
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const yearFolder = await getOrCreateFolder(CERTIFICATE_ROOT_FOLDER_ID, year);
      const monthFolder = await getOrCreateFolder(yearFolder.id, month);

      const uploadRes = await drive.files.create({
        resource: { name: req.file.originalname, parents: [monthFolder.id] },
        media: { mimeType: req.file.mimetype || 'application/pdf', body: require('stream').Readable.from(req.file.buffer) },
        fields: 'id,name,webViewLink',
        supportsAllDrives: true,
      });

      res.json({ success: true, item: uploadRes.data });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  return router;
};

