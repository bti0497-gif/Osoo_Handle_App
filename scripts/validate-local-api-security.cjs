'use strict';

const assert = require('node:assert/strict');
const {
  createLocalApiAuthMiddleware,
  isAllowedLocalOrigin,
  tokensMatch,
} = require('../server/middleware/localApiSecurity.cjs');
const {
  clearActiveUser,
  requireActiveUser,
  requireAdminSession,
  setActiveUser,
} = require('../server/services/activeUserSessionService.cjs');

function invoke(middleware, { path = '/api/settings', method = 'GET', token = '' } = {}) {
  let nextCalled = false;
  let statusCode = 200;
  let body = null;
  const req = {
    path,
    method,
    headers: { 'x-osoo-server-token': token },
    get(name) { return this.headers[String(name).toLowerCase()]; },
  };
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; },
  };
  middleware(req, res, () => { nextCalled = true; });
  return { nextCalled, statusCode, body };
}

const token = 'test-instance-token-1234';
const middleware = createLocalApiAuthMiddleware(token);

assert.equal(invoke(middleware, { token }).nextCalled, true);
assert.equal(invoke(middleware).statusCode, 401);
assert.equal(invoke(middleware).body.code, 'LOCAL_API_UNAUTHORIZED');
assert.equal(invoke(middleware, { token: 'wrong-token' }).statusCode, 401);
assert.equal(invoke(middleware, { path: '/api/ping' }).nextCalled, true);
assert.equal(invoke(middleware, { method: 'OPTIONS' }).nextCalled, true);
assert.equal(invoke(createLocalApiAuthMiddleware('')).nextCalled, true, '독립 개발 서버는 토큰 없이 동작해야 합니다.');
assert.equal(tokensMatch(token, token), true);
assert.equal(tokensMatch(token, `${token}x`), false);
assert.equal(isAllowedLocalOrigin(undefined), true);
assert.equal(isAllowedLocalOrigin('null'), true);
assert.equal(isAllowedLocalOrigin('http://localhost:18735'), true);
assert.equal(isAllowedLocalOrigin('http://127.0.0.1:18735'), true);
assert.equal(isAllowedLocalOrigin('https://attacker.example'), false);

console.log('✓ 로컬 API capability token·ping 비노출·CORS 출처 경계 검증 통과');

function invokeSessionGuard(guard) {
  let nextCalled = false;
  let statusCode = 200;
  let body = null;
  const req = {};
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; },
  };
  guard(req, res, () => { nextCalled = true; });
  return { nextCalled, statusCode, body, activeUser: req.activeUser };
}

clearActiveUser();
assert.equal(invokeSessionGuard(requireActiveUser).statusCode, 401);
setActiveUser({ id: 'field-1', name: '현장관리자', role: 'user', site_name1: '시험현장' }, 'test');
assert.equal(invokeSessionGuard(requireActiveUser).nextCalled, true);
assert.equal(invokeSessionGuard(requireAdminSession).statusCode, 403);
setActiveUser({ id: 'admin-1', name: 'admin', role: 'admin' }, 'test');
assert.equal(invokeSessionGuard(requireAdminSession).nextCalled, true);
clearActiveUser();
console.log('✓ 서버 활성 사용자·관리자 세션 권한 경계 검증 통과');
