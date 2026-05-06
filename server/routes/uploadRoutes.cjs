const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { drive, getOrCreateBoardUploadsFolder } = require('../services/driveService.cjs');
const router = express.Router();

module.exports = function(appDataPath) {
  const uploadDir = path.join(appDataPath, 'uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const boardUpload = multer({ dest: uploadDir, limits: { fileSize: 50 * 1024 * 1024 } });
  const imageUpload = multer({ storage: multer.memoryStorage() });

  const sanitizeName = (name) => String(name || '').replace(/[\\/:*?"<>|]/g, '_').trim();
  const toDateStamp = (value) => {
    const d = value ? new Date(value) : new Date();
    if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  };
  const buildBoardFileName = (boardId, date, originalName) => {
    const ext = path.extname(originalName || '') || '';
    const base = path.basename(originalName || `file${ext}`, ext);
    const safeBase = sanitizeName(base) || 'file';
    const safeBoardId = sanitizeName(boardId || 'draft');
    const stamp = toDateStamp(date);
    return `${safeBoardId}_${stamp}_${safeBase}${ext.toLowerCase()}`;
  };
  const ensureUniquePath = (dir, fileName) => {
    const ext = path.extname(fileName);
    const base = fileName.slice(0, fileName.length - ext.length);
    let idx = 0;
    let candidate = path.join(dir, fileName);
    while (fs.existsSync(candidate)) {
      idx += 1;
      candidate = path.join(dir, `${base}_${idx}${ext}`);
    }
    return candidate;
  };

  router.post('/api/upload', boardUpload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: '파일이 없습니다.' });

    let originalName = req.file.originalname;
    try {
      if (!/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(originalName)) {
        const decoded = Buffer.from(originalName, 'latin1').toString('utf8');
        if (/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(decoded)) originalName = decoded;
      }
    } catch (e) { console.error("Filename decoding error:", e); }

    const boardId = String(req.body?.boardId || req.body?.postId || 'draft').trim();
    const date = req.body?.date || req.body?.createdAt || null;
    const renamedFileName = buildBoardFileName(boardId, date, originalName);
    const targetLocalPath = ensureUniquePath(uploadDir, renamedFileName);
    fs.renameSync(req.file.path, targetLocalPath);
    const filePath = targetLocalPath;
    const localUrl = `/uploads/${path.basename(filePath)}`;
    try {
      const folderId = await getOrCreateBoardUploadsFolder();
      const driveRes = await drive.files.create({
        resource: { name: originalName, parents: [folderId] },
        media: { mimeType: req.file.mimetype, body: fs.createReadStream(filePath) },
        fields: 'id, webViewLink, webContentLink'
      });
      await drive.permissions.create({
        fileId: driveRes.data.id,
        requestBody: { role: 'reader', type: 'anyone' }
      });
      res.json({
        success: true,
        url: driveRes.data.webViewLink,
        driveUrl: driveRes.data.webViewLink,
        localUrl,
        uploadedToDrive: true,
        originalName,
        storedName: path.basename(filePath),
        size: req.file.size
      });
    } catch (error) {
      console.error('Google Drive upload error:', error);
      // 정책: 로컬 저장을 우선 보장하고, Drive 업로드 실패 시에도 로컬 URL로 계속 사용 가능
      res.json({
        success: true,
        url: localUrl,
        localUrl,
        uploadedToDrive: false,
        originalName,
        storedName: path.basename(filePath),
        size: req.file.size,
        message: '로컬 저장은 완료되었고, Drive 업로드는 실패했습니다: ' + error.message
      });
    }
  });

  router.get('/api/download', (req, res) => {
    const { url, name } = req.query;
    if (!url || !name) return res.status(400).send('잘못된 요청입니다.');
    const fileName = path.basename(url);
    const filePath = path.join(uploadDir, fileName);
    if (!fs.existsSync(filePath)) return res.status(404).send('파일을 찾을 수 없습니다.');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.sendFile(filePath);
  });

  router.post('/api/photo/upload', imageUpload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const date = req.body.date || new Date().toISOString().split('T')[0];
    const type = req.body.type || 'misc';
    const targetDir = path.join(appDataPath, 'resources', 'images', date);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    const fileName = `${type}_${Date.now()}.jpg`;
    const targetPath = path.join(targetDir, fileName);
    try {
      await sharp(req.file.buffer).jpeg({ quality: 80 }).toFile(targetPath);
      res.json({ success: true, path: `resources/images/${date}/${fileName}` });
    } catch (err) {
      res.status(500).json({ error: 'Image processing failed: ' + err.message });
    }
  });

  return router;
};
