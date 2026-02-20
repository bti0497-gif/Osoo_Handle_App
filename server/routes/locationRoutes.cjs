const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const router = express.Router();

module.exports = function(baseDir) {
  router.get('/api/location/current', (req, res) => {
    const scriptPath = path.join(baseDir, 'scripts', 'get_location.ps1');

    exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`,
      { timeout: 20000 },
      (error, stdout, stderr) => {
        if (error) {
          const errMsg = stderr || error.message;
          console.error('Location error:', errMsg);
          if (errMsg.includes('denied') || errMsg.includes('Access') || errMsg.includes('0x80070005')) {
            return res.status(403).json({ success: false, code: 'LOCATION_DENIED', message: 'Windows 위치 서비스가 비활성화되어 있습니다.\n설정 > 개인 정보 > 위치 에서 위치 서비스를 켜주세요.' });
          }
          return res.status(500).json({ success: false, code: 'LOCATION_ERROR', message: '위치 정보를 가져올 수 없습니다: ' + errMsg.trim() });
        }
        const parts = stdout.trim().split(',');
        if (parts.length >= 2) {
          res.json({ success: true, latitude: parseFloat(parts[0]), longitude: parseFloat(parts[1]), accuracy: parts[2] ? parseFloat(parts[2]) : null });
        } else {
          res.status(500).json({ success: false, code: 'PARSE_ERROR', message: '위치 데이터 파싱 실패' });
        }
      }
    );
  });

  return router;
};
