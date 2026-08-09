'use strict';

const crypto = require('crypto');

const TOKEN_VERSION = 1;

function toBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function fromBase64Url(value) {
  return Buffer.from(String(value || ''), 'base64url').toString('utf8');
}

function getKstSessionExpiry(now = new Date()) {
  const dateKey = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return Date.parse(`${dateKey}T20:00:00+09:00`);
}

function signingKey(member) {
  // The credential never leaves the server. Changing the local password also
  // invalidates every previously issued session token for that member.
  return `${String(member?.id || '')}\n${String(member?.password || '')}`;
}

function sign(encodedPayload, member) {
  return crypto.createHmac('sha256', signingKey(member)).update(encodedPayload).digest('base64url');
}

function issueLocalSessionToken(member, now = new Date()) {
  const payload = {
    v: TOKEN_VERSION,
    memberId: String(member?.id || ''),
    issuedAt: now.getTime(),
    expiresAt: getKstSessionExpiry(now),
    nonce: crypto.randomBytes(16).toString('base64url'),
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload, member)}`;
}

function verifyLocalSessionToken(token, member, now = new Date()) {
  const [encodedPayload, suppliedSignature, ...extra] = String(token || '').split('.');
  if (!encodedPayload || !suppliedSignature || extra.length > 0) return null;
  const expectedSignature = sign(encodedPayload, member);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload));
    if (
      payload?.v !== TOKEN_VERSION
      || String(payload.memberId || '') !== String(member?.id || '')
      || !Number.isFinite(payload.expiresAt)
      || payload.expiresAt <= now.getTime()
    ) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

module.exports = { issueLocalSessionToken, verifyLocalSessionToken };
