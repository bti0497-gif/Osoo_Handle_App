'use strict';

function createSiteContextMiddleware(db) {
  return function siteContextMiddleware(req, res, next) {
    if (!String(req.path || '').startsWith('/api/')) return next();

    try {
      const settings = db.prepare(`
        SELECT site_id, multi_site_enabled, primary_site_id, secondary_site_id
        FROM app_settings WHERE id = 1
      `).get() || {};
      const requestedSiteId = String(req.get('x-osoo-site-id') || '').trim();
      const defaultSiteId = Number(settings.multi_site_enabled || 0) === 1
        ? String(settings.primary_site_id || settings.site_id || '').trim()
        : String(settings.site_id || '').trim();
      const siteId = requestedSiteId || defaultSiteId;
      if (!siteId) return next();

      const allowedSiteIds = Number(settings.multi_site_enabled || 0) === 1
        ? [settings.primary_site_id, settings.secondary_site_id].map((value) => String(value || '').trim()).filter(Boolean)
        : [String(settings.site_id || '').trim()].filter(Boolean);
      if (!allowedSiteIds.includes(siteId)) {
        return res.status(403).json({
          success: false,
          message: '이 창에서 사용할 수 없는 현장입니다. 창을 닫고 올바른 방향 버튼으로 다시 열어 주세요.',
        });
      }

      const site = db.prepare(`
        SELECT id, site_name, manager_name
        FROM sites WHERE id = ? AND COALESCE(is_active, 1) = 1
      `).get(siteId);
      if (!site) {
        return res.status(409).json({ success: false, message: '선택된 현장 정보를 로컬 DB에서 찾을 수 없습니다.' });
      }

      const querySiteId = String(req.query?.site_id || req.query?.siteId || '').trim();
      const bodySiteId = String(req.body?.site_id || req.body?.siteId || '').trim();
      if ((querySiteId && querySiteId !== siteId) || (bodySiteId && bodySiteId !== siteId)) {
        return res.status(409).json({
          success: false,
          message: '요청 현장과 현재 창의 현장이 일치하지 않아 작업을 중단했습니다.',
        });
      }

      req.siteContext = {
        siteId: String(site.id),
        siteName: String(site.site_name || ''),
        managerName: String(site.manager_name || ''),
      };
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
      return next();
    } catch (error) {
      return res.status(500).json({ success: false, message: `현장 범위 확인 실패: ${error.message}` });
    }
  };
}

module.exports = { createSiteContextMiddleware };
