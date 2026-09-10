/**
 * server/routes/equipmentRoutes.cjs
 * 장비이력카드 API 라우트. 요청/응답 변환만 담당하며 업무 로직은
 * server/services/equipment/* 서비스가 소유한다(ROUTE_CREATION_GUIDE).
 *
 * 계약 문서: docs/EQUIPMENT_CARD_DEVELOPMENT_PLAN.md §4-4, §5
 */
const express = require('express');
const multer = require('multer');
const {
  COMMON_MULTIPART_LIMITS,
  MAX_IMAGE_BYTES,
  imageFileFilter,
} = require('../middleware/uploadSecurity.cjs');
const createEquipmentAssetService = require('../services/equipment/equipmentAssetService.cjs');
const createEquipmentHistoryService = require('../services/equipment/equipmentHistoryService.cjs');
const createEquipmentPhotoService = require('../services/equipment/equipmentPhotoService.cjs');
const createEquipmentCatalogService = require('../services/equipment/equipmentCatalogService.cjs');
const createEquipmentSyncService = require('../services/equipment/equipmentSyncService.cjs');
const createEquipmentProvisioningService = require('../services/equipment/equipmentProvisioningService.cjs');

function createEquipmentRoutes(db, appDataPath) {
  const router = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { ...COMMON_MULTIPART_LIMITS, fileSize: MAX_IMAGE_BYTES, files: 10 },
    fileFilter: imageFileFilter,
  });

  const assets = createEquipmentAssetService(db);
  const history = createEquipmentHistoryService(db);
  const photos = createEquipmentPhotoService(db, appDataPath);
  const catalog = createEquipmentCatalogService(db);
  const sync = createEquipmentSyncService(db);
  const provisioning = createEquipmentProvisioningService(db);

  function requireSiteId(req, res) {
    const siteId = String(req.siteContext?.siteId || '').trim();
    if (!siteId) {
      res.status(409).json({ success: false, code: 'SITE_CONTEXT_REQUIRED', message: '현장 정보가 필요합니다.' });
      return null;
    }
    return siteId;
  }

  function sendError(res, error) {
    const status = error.status || 500;
    if (status >= 500) console.error('[equipment] 처리 실패:', error.message);
    return res.status(status).json({
      success: false,
      code: error.code || '',
      message: error.message,
    });
  }

  // 데이터 변경 후 전송 대기 행을 BigQuery로 비차단 푸시한다.
  function triggerSync() {
    setImmediate(() => {
      sync.syncEquipmentData().catch((error) => {
        console.warn('[equipment] BigQuery 동기화 트리거 실패:', error.message);
      });
    });
  }

  // ----------------------------------------------------------------
  // 장비 마스터
  // ----------------------------------------------------------------
  router.get('/api/equipment', (req, res) => {
    try {
      const siteId = requireSiteId(req, res);
      if (!siteId) return;
      // 기본 설비 목록 1회 프로비저닝(§7 Phase 2-5): 목록이 비어 있고 공법이 지정된 경우에만
      provisioning.ensureProvisioned(siteId, req.siteContext?.siteName || '', assets.methodOfSite(siteId));
      return res.json(assets.list(siteId, req.query.q));
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/api/equipment/meta', (req, res) => {
    try {
      const siteId = requireSiteId(req, res);
      if (!siteId) return;
      return res.json({ method: assets.methodOfSite(siteId), equipmentCount: assets.countVisible(siteId) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/api/equipment/next-management-no', (req, res) => {
    try {
      const siteId = requireSiteId(req, res);
      if (!siteId) return;
      const { name = '', category2 = '', category3 = '' } = req.query;
      return res.json({
        success: true,
        managementNo: assets.nextManagementNoFor(siteId, name, category2, category3),
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/api/equipment', (req, res) => {
    try {
      const siteId = requireSiteId(req, res);
      if (!siteId) return;
      const created = assets.create(siteId, req.siteContext?.siteName || '', req.body);
      triggerSync();
      return res.json({ success: true, ...created });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.put('/api/equipment/:id', (req, res) => {
    try {
      const siteId = requireSiteId(req, res);
      if (!siteId) return;
      const updated = assets.update(req.params.id, siteId, req.body);
      triggerSync();
      return res.json({ success: true, ...updated });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.put('/api/equipment/:id/status', (req, res) => {
    try {
      const siteId = requireSiteId(req, res);
      if (!siteId) return;
      const updated = assets.updateStatus(req.params.id, siteId, String((req.body || {}).status || ''));
      triggerSync();
      return res.json({ success: true, ...updated });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.put('/api/equipment/:id/visibility', (req, res) => {
    try {
      const siteId = requireSiteId(req, res);
      if (!siteId) return;
      const updated = assets.updateVisibility(req.params.id, siteId, Boolean((req.body || {}).is_visible));
      triggerSync();
      return res.json({ success: true, ...updated });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.delete('/api/equipment/:id', (req, res) => {
    try {
      const siteId = requireSiteId(req, res);
      if (!siteId) return;
      const result = assets.remove(req.params.id, siteId);
      photos.removeEquipmentPhotoFiles(req.params.id);
      triggerSync();
      return res.json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  });

  // ----------------------------------------------------------------
  // 장비 대표사진
  // ----------------------------------------------------------------
  router.post('/api/equipment/:id/photos', upload.single('photo'), (req, res) => {
    try {
      const siteId = requireSiteId(req, res);
      if (!siteId) return;
      if (!assets.findById(siteId, req.params.id)) {
        return res.status(404).json({ success: false, message: '장비를 찾을 수 없습니다.' });
      }
      const result = photos.saveEquipmentMainPhoto(req.params.id, req.file);
      triggerSync();
      return res.json({ success: true, photoUrl: result.url });
    } catch (error) {
      return sendError(res, error);
    }
  });

  // ----------------------------------------------------------------
  // 이력 (facility_logs)
  // ----------------------------------------------------------------
  router.get('/api/equipment/history', (req, res) => {
    try {
      const siteId = requireSiteId(req, res);
      if (!siteId) return;
      return res.json(history.list(siteId, req.query.equipmentId));
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/api/equipment/history', (req, res) => {
    try {
      const siteId = requireSiteId(req, res);
      if (!siteId) return;
      const created = history.create(
        siteId,
        req.siteContext?.siteName || '',
        req.siteContext?.managerName || '',
        req.body,
      );
      triggerSync();
      return res.json({ success: true, ...created });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.put('/api/equipment/history/:id', (req, res) => {
    try {
      const siteId = requireSiteId(req, res);
      if (!siteId) return;
      const updated = history.update(req.params.id, siteId, req.body);
      triggerSync();
      return res.json({ success: true, ...updated });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.delete('/api/equipment/history/:id', (req, res) => {
    try {
      const siteId = requireSiteId(req, res);
      if (!siteId) return;
      const result = history.remove(req.params.id, siteId);
      photos.cleanupHistoryFiles(result.localKey, result.removedPhotoPaths);
      triggerSync();
      return res.json({ success: true });
    } catch (error) {
      return sendError(res, error);
    }
  });

  // ----------------------------------------------------------------
  // 이력 사진 (facility_log_photos)
  // ----------------------------------------------------------------
  router.get('/api/equipment/history/:id/photos', (req, res) => {
    try {
      const siteId = requireSiteId(req, res);
      if (!siteId) return;
      const row = history.findById(siteId, req.params.id);
      if (!row) return res.status(404).json({ success: false, message: '이력을 찾을 수 없습니다.' });
      return res.json(photos.listHistoryPhotos(row));
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/api/equipment/history/:id/photos', upload.array('photos', 10), (req, res) => {
    try {
      const siteId = requireSiteId(req, res);
      if (!siteId) return;
      const row = history.findById(siteId, req.params.id);
      if (!row) return res.status(404).json({ success: false, message: '이력을 찾을 수 없습니다.' });
      const result = photos.addHistoryPhotos(row, req.files || []);
      triggerSync();
      return res.json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.delete('/api/equipment/history/:id/photos/:photoId', (req, res) => {
    try {
      const siteId = requireSiteId(req, res);
      if (!siteId) return;
      const row = history.findById(siteId, req.params.id);
      if (!row) return res.status(404).json({ success: false, message: '이력을 찾을 수 없습니다.' });
      const result = photos.removeHistoryPhoto(row, req.params.photoId);
      triggerSync();
      return res.json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  });

  // ----------------------------------------------------------------
  // 연결된 업무기록 (work_record_equipment_links)
  // ----------------------------------------------------------------
  router.get('/api/equipment/work-records', (req, res) => {
    try {
      const siteId = requireSiteId(req, res);
      if (!siteId) return;
      const equipmentId = String(req.query.equipmentId || '').trim();
      if (!equipmentId) return res.status(400).json({ success: false, message: 'equipmentId가 필요합니다.' });
      const rows = db.prepare(`
        SELECT wr.id, wr.date, wr.title, wr.content, wr.author,
          (SELECT COUNT(*) FROM work_record_photos p WHERE p.work_record_id = wr.id) AS photo_count,
          (SELECT GROUP_CONCAT(l2.equipment_id) FROM work_record_equipment_links l2
            WHERE l2.work_record_id = wr.id) AS linked_equipment_ids
        FROM work_records wr
        JOIN work_record_equipment_links l ON l.work_record_id = wr.id
        WHERE l.equipment_id = ? AND wr.site_id = ?
        ORDER BY wr.date DESC, wr.id DESC
      `).all(equipmentId, siteId);
      return res.json(rows);
    } catch (error) {
      return sendError(res, error);
    }
  });

  // ----------------------------------------------------------------
  // 카탈로그 일괄 등록
  // ----------------------------------------------------------------
  router.post('/api/equipment/catalog', (req, res) => {
    try {
      const siteId = requireSiteId(req, res);
      if (!siteId) return;
      const result = catalog.apply(siteId, req.siteContext?.siteName || '', (req.body || {}).selections);
      triggerSync();
      return res.json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  });

  return router;
}

module.exports = createEquipmentRoutes;
