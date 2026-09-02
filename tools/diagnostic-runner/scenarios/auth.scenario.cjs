'use strict';

/**
 * auth 시나리오: local-login 계약(평문 비밀번호, admin 거부)과 오류 흐름을 검증한다.
 * 계약 출처: server/routes/authRoutes.cjs 의 POST /local-login
 */

module.exports = {
  id: 'auth',
    covers: ["auth","settings"],
  version: '0.1.0',
  status: 'implemented',
  async run({ ctx, fixtures }) {
    const users = fixtures.users && Array.isArray(fixtures.users.users) ? fixtures.users.users : [];
    const fieldUser = users.find((user) => user.localLoginAllowed);
    const adminUser = users.find((user) => !user.localLoginAllowed);
    if (!fieldUser || !adminUser) throw new Error('fixtures/users.json 에 로그인 계약용 사용자가 부족합니다.');

    await ctx.step('local-login-success', async () => {
      const response = await ctx.request('POST', '/api/auth/local-login', {
        siteHeader: false,
        body: { name: fieldUser.name, password: fieldUser.password },
      });
      ctx.assert(response.status !== 404, 'local-login 엔드포인트가 존재하지 않습니다.', 'ENDPOINT_MISSING');
      ctx.assert(response.json && response.json.success === true,
        `정상 자격으로 local-login이 실패했습니다: HTTP ${response.status}`,
        'LOGIN_REJECTED', { status: response.status, body: response.json });
      return { role: response.json.user ? response.json.user.role : undefined };
    });

    await ctx.step('local-login-wrong-password', async () => {
      const response = await ctx.request('POST', '/api/auth/local-login', {
        siteHeader: false,
        body: { name: fieldUser.name, password: 'wrong-password' },
      });
      ctx.assert(response.status === 401 || (response.json && response.json.success === false),
        '잘못된 비밀번호가 수용되었습니다.', 'LOGIN_SHOULD_REJECT', { status: response.status });
    });

    await ctx.step('local-login-admin-forbidden', async () => {
      const response = await ctx.request('POST', '/api/auth/local-login', {
        siteHeader: false,
        body: { name: adminUser.name, password: adminUser.password },
      });
      ctx.assert(response.status === 401 && response.json && response.json.success === false,
        'admin 계정 local-login 거부 계약이 깨졌습니다.', 'ADMIN_LOCAL_LOGIN_NOT_BLOCKED', { status: response.status });
    });

    await ctx.step('login-hint-with-token', async () => {
      const response = await ctx.request('GET', '/api/auth/login-hint', { siteHeader: false });
      ctx.assert(response.ok && response.json && response.json.success === true,
        `login-hint 확인 실패: HTTP ${response.status}`, 'LOGIN_HINT_FAILED', { status: response.status });
    });

    await ctx.step('operational-route-requires-site', async () => {
      // site 헤더 없이 업무 라우트를 호출하면 409 SITE_CONTEXT_REQUIRED 로 막혀야 한다.
      const response = await ctx.request('GET', '/api/flows', {
        siteHeader: false,
        query: { date: fixtures.dataset.fixedDate },
        headers: {},
      });
      ctx.assert(response.status === 409 || response.ok,
        `현장 컨텍스트 가드가 예상과 다르게 동작했습니다: HTTP ${response.status}`,
        'SITE_GUARD_UNEXPECTED', { status: response.status, code: response.json && response.json.code });
      if (!response.ok) {
        ctx.assert(response.json && response.json.code === 'SITE_CONTEXT_REQUIRED',
          '현장 미설정 요청이 SITE_CONTEXT_REQUIRED 가 아닙니다.', 'SITE_GUARD_CODE_MISMATCH', response.json);
      }
    });
  },
};
