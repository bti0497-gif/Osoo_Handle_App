const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const router = express.Router();

module.exports = function locationRoutes(baseDir) {
  router.get('/api/location/current', (req, res) => {
    const scriptPath = path.join(baseDir, 'scripts', 'get_location.ps1');

    if (!fs.existsSync(scriptPath)) {
      return res.status(500).json({
        success: false,
        code: 'LOCATION_SCRIPT_NOT_FOUND',
        message: `위치 확인 스크립트를 찾을 수 없습니다: ${scriptPath}`,
      });
    }

    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
    ], {
      windowsHide: true,
      timeout: 20000,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      console.error('Location spawn error:', error.message);
      if (res.headersSent) return;
      res.status(500).json({
        success: false,
        code: 'LOCATION_ERROR',
        message: `위치 정보를 가져올 수 없습니다: ${error.message}`,
      });
    });

    child.on('close', (code) => {
      if (res.headersSent) return;

      if (code !== 0) {
        const errMsg = (stderr || stdout || `PowerShell 종료 코드 ${code}`).trim();
        console.error('Location error:', errMsg);

        if (
          errMsg.includes('denied')
          || errMsg.includes('Access')
          || errMsg.includes('0x80070005')
          || errMsg.includes('권한')
        ) {
          return res.status(403).json({
            success: false,
            code: 'LOCATION_DENIED',
            message: 'Windows 위치 서비스가 비활성화되어 있습니다.\n설정 > 개인 정보 > 위치에서 위치 서비스를 켜주세요.',
          });
        }

        return res.status(500).json({
          success: false,
          code: 'LOCATION_ERROR',
          message: `위치 정보를 가져올 수 없습니다: ${errMsg}`,
        });
      }

      const parts = stdout.trim().split(',');
      if (parts.length >= 2) {
        return res.json({
          success: true,
          latitude: parseFloat(parts[0]),
          longitude: parseFloat(parts[1]),
          accuracy: parts[2] ? parseFloat(parts[2]) : null,
        });
      }

      return res.status(500).json({
        success: false,
        code: 'PARSE_ERROR',
        message: '위치 데이터 파싱 실패',
      });
    });
  });

  return router;
};
