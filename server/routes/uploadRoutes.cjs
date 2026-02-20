const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { drive, getOrCreateBoardUploadsFolder } = require('../services/driveService.cjs');
const router = express.Router();

module.exports = function(baseDir) {
  const uploadDir = path.join(baseDir, 'uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const boardUpload = multer({ dest: uploadDir, limits: { fileSize: 50 * 1024 * 1024 } });
  const imageUpload = multer({ storage: multer.memoryStorage() });

  router.post('/api/upload', boardUpload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: '파일이 없습니다.' });

    let originalName = req.file.originalname;
    try {
      if (!/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(originalName)) {
        const decoded = Buffer.from(originalName, 'latin1').toString('utf8');
        if (/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(decoded)) originalName = decoded;
      }
    } catch (e) { console.error("Filename decoding error:", e); }

    const filePath = req.file.path;
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
      fs.unlinkSync(filePath);
      res.json({ success: true, url: driveRes.data.webViewLink, originalName, size: req.file.size });
    } catch (error) {
      console.error('Google Drive upload error:', error);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      res.status(500).json({ success: false, message: '구글 드라이브 업로드 실패: ' + error.message });
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
    const targetDir = path.join(baseDir, 'resources', 'images', date);
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
