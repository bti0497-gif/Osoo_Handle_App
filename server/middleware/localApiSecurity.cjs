'use strict';

const crypto = require('crypto');

const TOKEN_HEADER = 'x-osoo-server-token';

function tokensMatch(expected, provided) {
  const expectedBuffer = Buffer.from(String(expected || ''), 'utf8');
  const providedBuffer = Buffer.from(String(provided || ''), 'utf8');
  return expectedBuffer.length > 0
    && expectedBuffer.length === providedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function createLocalApiAuthMiddleware(expectedToken) {
  const requiredToken = String(expectedToken || '').trim();
  return (req, res, next) => {
    const pathName = String(req.path || req.url || '').split('?')[0];
    if (!requiredToken || req.method === 'OPTIONS' || pathName === '/api/ping' || !pathName.startsWith('/api/')) {
      return next();
    }
    if (!tokensMatch(requiredToken, req.get?.(TOKEN_HEADER) || req.headers?.[TOKEN_HEADER])) {
      return res.status(401).json({ success: false, code: 'LOCAL_API_UNAUTHORIZED', message: '앱 서버 인증에 실패했습니다.' });
    }
    return next();
  };
}

function isAllowedLocalOrigin(origin) {
  if (!origin || origin === 'null') return true;
  try {
    const url = new URL(origin);
    return (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1')
      && (!url.port || url.port === '18735');
  } catch (_) {
    return false;
  }
}

module.exports = { TOKEN_HEADER, tokensMatch, createLocalApiAuthMiddleware, isAllowedLocalOrigin };
