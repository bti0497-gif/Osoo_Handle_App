'use strict';

const OPTIONAL_SITE_ROUTES = [
  ['POST', /^\/api\/auth\/(?:local-login|discovery-login|ui-diagnostic|sync-member|session|logout-current)$/],
  ['GET', /^\/api\/auth\/(?:login-hint|members)$/],
  ['POST', /^\/api\/auth\/members$/],
  ['DELETE', /^\/api\/auth\/members\/[^/]+$/],
  ['GET', /^\/api\/settings(?:\/sites)?$/],
  ['POST', /^\/api\/settings\/(?:sites|select-site|bootstrap-site-member|sync-initial-to-sheets)$/],
  ['DELETE', /^\/api\/settings\/sites\/[^/]+$/],
];

function isSiteOptionalRequest(req) {
  const method = String(req.method || '').toUpperCase();
  const requestPath = String(req.path || '');
  return OPTIONAL_SITE_ROUTES.some(([allowedMethod, pattern]) => (
    method === allowedMethod && pattern.test(requestPath)
  ));
}

function sendSiteContextError(res, status, code, message) {
  return res.status(status).json({ success: false, code, message, userMessage: message });
}

function attachSiteContext(req, site, { injectLegacyFields = true } = {}) {
  req.siteContext = {
    siteId: String(site.id),
    siteName: String(site.site_name || ''),
    managerName: String(site.manager_name || ''),
  };

  if (!injectLegacyFields) return;
  const scopedQuery = {
    ...(req.query && typeof req.query === 'object' ? req.query : {}),
    site_id: req.siteContext.siteId,
    site_name: req.siteContext.siteName,
  };
  Object.defineProperty(req, 'query', {
    value: scopedQuery,
    configurable: true,
    enumerable: true,
    writable: false,
  });
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    req.body.site_id = req.siteContext.siteId;
    req.body.site_name = req.siteContext.siteName;
  }
}

function createSiteContextMiddleware(db) {
  return function siteContextMiddleware(req, res, next) {
    if (!String(req.path || '').startsWith('/api/')) return next();

    try {
      const siteOptional = isSiteOptionalRequest(req);
      const settings = db.prepare(`
        SELECT site_id, multi_site_enabled, primary_site_id, secondary_site_id
        FROM app_settings WHERE id = 1
      `).get() || {};
      const requestedSiteId = String(req.get('x-osoo-site-id') || '').trim();
      const defaultSiteId = Number(settings.multi_site_enabled || 0) === 1
        ? String(settings.primary_site_id || settings.site_id || '').trim()
        : String(settings.site_id || '').trim();
      const siteId = requestedSiteId || defaultSiteId;
      if (!siteId) {
        if (siteOptional) return next();
        return sendSiteContextError(res, 409, 'SITE_CONTEXT_REQUIRED', '현장 설정이 필요합니다. 관리자로 로그인하여 현장을 먼저 설정해 주세요.');
      }

      const allowedSiteIds = Number(settings.multi_site_enabled || 0) === 1
        ? [settings.primary_site_id, settings.secondary_site_id].map((value) => String(value || '').trim()).filter(Boolean)
        : [String(settings.site_id || '').trim()].filter(Boolean);
      if (!allowedSiteIds.includes(siteId)) {
        if (siteOptional) return next();
        return sendSiteContextError(res, 403, 'SITE_CONTEXT_FORBIDDEN', '이 창에서 사용할 수 없는 현장입니다. 창을 닫고 올바른 방향 버튼으로 다시 열어 주세요.');
      }

      const site = db.prepare(`
        SELECT id, site_name, manager_name
        FROM sites WHERE id = ? AND COALESCE(is_active, 1) = 1
      `).get(siteId);
      if (!site) {
        if (siteOptional) return next();
        return sendSiteContextError(res, 409, 'SITE_CONTEXT_INVALID', '선택된 현장 정보를 로컬 DB에서 찾을 수 없습니다. 관리자로 로그인하여 현장 설정을 복구해 주세요.');
      }

      if (siteOptional) {
        attachSiteContext(req, site, { injectLegacyFields: false });
        return next();
      }

      const querySiteId = String(req.query?.site_id || req.query?.siteId || '').trim();
      const bodySiteId = String(req.body?.site_id || req.body?.siteId || '').trim();
      if ((querySiteId && querySiteId !== siteId) || (bodySiteId && bodySiteId !== siteId)) {
        return sendSiteContextError(res, 409, 'SITE_CONTEXT_MISMATCH', '요청 현장과 현재 창의 현장이 일치하지 않아 작업을 중단했습니다.');
      }

      attachSiteContext(req, site);
      return next();
    } catch (error) {
      console.error('[SiteContext] Failed to resolve request scope:', error.message);
      return sendSiteContextError(res, 500, 'SITE_CONTEXT_RESOLUTION_FAILED', '현장 범위를 확인하지 못했습니다. 앱을 다시 시작한 뒤 재시도해 주세요.');
    }
  };
}

module.exports = { createSiteContextMiddleware, isSiteOptionalRequest };
