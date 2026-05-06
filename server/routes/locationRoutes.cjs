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
            return res.status(403).json({ success: false, code: 'LOCATION_DENIED', message: 'Windows ?꾩튂 ?쒕퉬?ㅺ? 鍮꾪솢?깊솕?섏뼱 ?덉뒿?덈떎.\n?ㅼ젙 > 媛쒖씤 ?뺣낫 > ?꾩튂 ?먯꽌 ?꾩튂 ?쒕퉬?ㅻ? 耳쒖＜?몄슂.' });
          }
          return res.status(500).json({ success: false, code: 'LOCATION_ERROR', message: '?꾩튂 ?뺣낫瑜?媛?몄삱 ???놁뒿?덈떎: ' + errMsg.trim() });
        }
        const parts = stdout.trim().split(',');
        if (parts.length >= 2) {
          res.json({ success: true, latitude: parseFloat(parts[0]), longitude: parseFloat(parts[1]), accuracy: parts[2] ? parseFloat(parts[2]) : null });
        } else {
          res.status(500).json({ success: false, code: 'PARSE_ERROR', message: '?꾩튂 ?곗씠???뚯떛 ?ㅽ뙣' });
        }
      }
    );
  });

  return router;
};
