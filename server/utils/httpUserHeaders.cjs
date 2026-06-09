'use strict';

/**
 * Fetch/브라우저?Request 헤더 값을 ISO-8859-1로만 허용한다.
 * 클라이언트는 encodeURIComponent로 넘기고 서버에서 이 함수로복원한다.
 * 안전(미인코딩) 값은 URIError 때문에그대로둔다.
 */
function decodeUserContextHeader(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

module.exports = { decodeUserContextHeader };
