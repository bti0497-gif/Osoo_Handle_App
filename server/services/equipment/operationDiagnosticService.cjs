'use strict';
const { recordDiagnostic } = require('../diagnosticLogService.cjs');

function report(db, appDataPath, event) {
  try { recordDiagnostic(db, appDataPath, event); } catch (_) { /* Never fail a business operation for diagnostics. */ }
}

function operationDiagnostics(db, appDataPath, area) {
  return (req, res, next) => {
    const started = Date.now();
    let count = null;
    const json = res.json;
    res.json = function (body) {
      if (Array.isArray(body)) count = body.length;
      else if (Array.isArray(body?.photos)) count = body.photos.length;
      return json.call(this, body);
    };
    res.once('finish', () => report(db, appDataPath, {
      level: res.statusCode >= 400 ? 'warn' : 'info', area,
      siteId: req.siteContext?.siteId, siteName: req.siteContext?.siteName,
      action: `${req.method} ${req.route?.path || req.path}`,
      result: res.statusCode >= 400 ? 'failed' : 'ok',
      details: {
        siteId: req.siteContext?.siteId || null,
        entityId: req.params?.id || null,
        statusCode: res.statusCode, durationMs: Date.now() - started, count,
        isVisible: typeof req.body?.is_visible === 'boolean' ? req.body.is_visible : undefined,
        fileCount: Array.isArray(req.files) ? req.files.length : (req.file ? 1 : undefined),
        equipmentLinkCount: Array.isArray(req.body?.equipmentIds) ? req.body.equipmentIds.length : undefined,
      },
    }));
    next();
  };
}
module.exports = { operationDiagnostics, report };
