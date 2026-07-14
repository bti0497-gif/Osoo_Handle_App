const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const appSettingsService = require('../services/settings/appSettingsService.cjs');
const defaultSettingsService = require('../services/settings/defaultSettingsService.cjs');
const externalCredentialService = require('../services/settings/externalCredentialService.cjs');
const initialSyncService = require('../services/settings/initialSyncService.cjs');
const mappingSettingsService = require('../services/settings/mappingSettingsService.cjs');
const siteSettingsService = require('../services/settings/siteSettingsService.cjs');
const templateSettingsService = require('../services/settings/templateSettingsService.cjs');
const {
  getCustomReportTemplatesDir,
  syncBundledTemplatesToAppData,
} = require('../services/reportTemplateService.cjs');
const router = express.Router();

function triggerBigQuerySync(reason) {
  try {
    require('../services/bigQueryTriggerService.cjs').triggerSync(reason);
  } catch (err) {
    console.warn('[Settings] BigQuery 동기화 예약 실패:', err.message);
  }
}

// 기본 설정: 사원/사이트 마스터는 중앙관서에서 직접 관리하며 앱의 초기 셋업 동기화 비활성화
const ENABLE_INITIAL_SYNC_TO_SHEETS = process.env.ENABLE_INITIAL_SYNC_TO_SHEETS === 'true';
const ENABLE_SITE_MEMBER_BIGQUERY_SYNC = process.env.ENABLE_SITE_MEMBER_BIGQUERY_SYNC === 'true';

function createIdleImportProgress() {
  return { current: 0, total: 0, status: 'idle', result: null };
}

const importProgressByType = {
  flow: createIdleImportProgress(),
  kit: createIdleImportProgress(),
  medicine: createIdleImportProgress(),
  water: createIdleImportProgress(),
};

function setImportProgress(type, progress) {
  importProgressByType[type] = progress;
  return importProgressByType[type];
}

function getImportProgress(type) {
  const normalizedType = String(type || '').trim();
  if (normalizedType && importProgressByType[normalizedType]) {
    return importProgressByType[normalizedType];
  }
  return importProgressByType;
}

function openLocalFolder(folderPath) {
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  if (process.platform === 'win32') {
    const launchWithPowerShell = () => {
      const child = spawn('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'Start-Process -FilePath explorer.exe -ArgumentList @($args[0])',
        folderPath,
      ], { detached: true, stdio: 'ignore', windowsHide: false });
      child.unref();
    };

    try {
      const explorer = spawn('explorer.exe', [folderPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      explorer.once('error', launchWithPowerShell);
      explorer.unref();
    } catch {
      launchWithPowerShell();
    }
    return;
  }
  if (process.platform === 'darwin') {
    spawn('open', [folderPath], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  spawn('xdg-open', [folderPath], { detached: true, stdio: 'ignore' }).unref();
}

module.exports = function (db, baseDir, appDataPath) {
  const defaultQntechPhotoRoot = path.join(appDataPath, '사진관리', '수질분석');
  const reportsDir = getCustomReportTemplatesDir(appDataPath);
  const excelOriginalsDir = path.join(appDataPath, 'templates', 'excel-originals');
  const siteStorageRoot = path.join(appDataPath, 'storage-sites');
  if (!fs.existsSync(siteStorageRoot)) fs.mkdirSync(siteStorageRoot, { recursive: true });
  if (!fs.existsSync(excelOriginalsDir)) fs.mkdirSync(excelOriginalsDir, { recursive: true });
  syncBundledTemplatesToAppData(baseDir, appDataPath);

  const reportStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, file.fieldname === 'excel_original' ? excelOriginalsDir : reportsDir),
    filename: (req, file, cb) => {
      try {
        const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8');
        cb(null, decoded.normalize('NFC'));
      } catch (e) {
        cb(null, String(file.originalname || '').normalize('NFC'));
      }
    }
  });
  const reportUpload = multer({ storage: reportStorage });

  // 설정 조회 API
  router.get('/api/settings', async (req, res) => {
    try {
      try {
        await externalCredentialService.syncCommonAppSettingsToLocal(db);
      } catch (sheetErr) {
        console.warn('[Settings] App settings sheets lookup failed, keeping local credentials:', sheetErr.message);
      }
      templateSettingsService.cleanupDisallowedReportTemplates(reportsDir);
      const result = appSettingsService.getSettingsOverview(db, baseDir, appDataPath);
      res.json({ success: true, ...result });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // 설정 업데이트 API
  router.post('/api/settings', async (req, res) => {
    try {
      const storageResult = await appSettingsService.saveSettings(db, req.body || {}, siteStorageRoot);
      res.json({
        success: true,
        message: 'Settings saved successfully',
        ...storageResult,
      });
    } catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
  });

  // 기본설정 사이트 위치 수정 API(리셋 시 유지)
  router.post('/api/settings/site-location', (req, res) => {
    const { targetLat, targetLng } = req.body || {};
    try {
      const result = appSettingsService.saveSiteLocation(db, targetLat, targetLng);
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(e.statusCode || 500).json({ success: false, message: e.message });
    }
  });

  // 사이트 목록 조회 API
  router.get('/api/settings/sites', async (req, res) => {
    try {
      const result = await siteSettingsService.listSites(db);
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(e.statusCode || 500).json({ success: false, message: e.message });
    }
  });

  // 사이트 추가/수정 API
  router.post('/api/settings/sites', async (req, res) => {
    try {
      const site = await siteSettingsService.saveSite(req.body || {});
      res.json({ success: true, site });
    } catch (e) {
      res.status(e.statusCode || 500).json({ success: false, message: e.message });
    }
  });

  // 사이트 삭제(비활성화) API
  router.delete('/api/settings/sites/:siteId', async (req, res) => {
    try {
      const deletedSiteId = await siteSettingsService.deleteSite(db, req.params.siteId);
      res.json({ success: true, deletedSiteId });
    } catch (e) {
      res.status(e.statusCode || 500).json({ success: false, message: e.message });
    }
  });

  // 현재 로컬 사이트 선택 API
  router.post('/api/settings/select-site', async (req, res) => {
    try {
      const site = await siteSettingsService.selectSite(db, req.body?.siteId);
      res.json({ success: true, site });
    } catch (e) {
      res.status(e.statusCode || 500).json({ success: false, message: e.message });
    }
  });

  // 사이트/사원 부트스트랩(로컬 + BigQuery 이중 동기화)
  router.post('/api/settings/bootstrap-site-member', async (req, res) => {
    try {
      const result = await siteSettingsService.bootstrapSiteMember(db, {
        ...(req.body || {}),
        enableBigQuerySync: ENABLE_SITE_MEMBER_BIGQUERY_SYNC,
      });
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(e.statusCode || 500).json({ success: false, message: e.message });
    }
  });

  // 흐름 매핑 종류 입력 API
  router.post('/api/settings/save-flow-option', (req, res) => {
    try {
      appSettingsService.saveFlowOption(db, req.body?.flowOption);
      res.json({ success: true, message: '흐름 매핑 종류 정보 저장되었습니다.' });
    } catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
  });

  router.post('/api/settings/web-app-credentials', async (req, res) => {
    try {
      const credential = await externalCredentialService.saveWebAppCredentials(db, req.body || {});
      res.json({ success: true, credential, message: '크리덴셜 설정이 저장되었습니다.' });
    } catch (e) {
      res.status(e.statusCode || 500).json({ success: false, message: e.message });
    }
  });

  router.post('/api/settings/qntech-import-settings', (req, res) => {
    try {
      const settings = externalCredentialService.saveQntechImportSettings(db, req.body || {}, defaultQntechPhotoRoot);
      res.json({ success: true, settings, message: 'QnTECH 부트스트랩 설정이 저장되었습니다.' });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // 설정 항목 임시 추가 API
  router.post('/api/settings/add-item', (req, res) => {
    try {
      const item = appSettingsService.addConfigItem(db, req.body || {});
      res.json({ success: true, item });
    } catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
  });

  // 설정 항목 활성/비활성화 토글 API
  router.post('/api/settings/toggle-item', (req, res) => {
    try {
      appSettingsService.toggleConfigItem(db, req.body || {});
      res.json({ success: true });
    } catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
  });

  // 엑셀 상태 조회(DB에 저장되어 있는지 임시 체인) API
  router.get('/api/settings/excel-status', (req, res) => {
    try {
      res.json(appSettingsService.getExcelStatus(db));
    } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
  });

  // 엑셀 미리보기(DB에서 임시 조회) API
  router.post('/api/settings/excel-preview', async (req, res) => {
    try {
      res.json(await appSettingsService.getExcelPreview(db, appDataPath, req.body || {}));
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // 임포트 진행 상태 확인 API
  router.get('/api/settings/import-progress', (req, res) => { res.json(getImportProgress(req.query?.type)); });

  // 흐름 매핑 설정 + DB에서 임포트 수행
  router.post('/api/settings/save-flow-mapping', async (req, res) => {
    const { config, mapping } = req.body;
    const importProgress = setImportProgress('flow', mappingSettingsService.createProgress(config));
    try {
      const result = await mappingSettingsService.saveFlowMapping(db, appDataPath, config, mapping, importProgress);
      triggerBigQuerySync('settings:flow-mapping-import');
      res.json({ success: true, ...result });
    } catch (e) {
      console.error('Flow mapping error:', e);
      importProgress.status = 'error';
      importProgress.result = e.message;
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // 킷 매핑 설정 + DB에서 임포트 수행
  // mapping 형식: "킷명_purchase", "킷명_usage", "킷명_inventory"
  router.post('/api/settings/save-kit-mapping', async (req, res) => {
    const { config, mapping } = req.body;
    const importProgress = setImportProgress('kit', mappingSettingsService.createProgress(config));
    try {
      const result = await mappingSettingsService.saveKitMapping(db, appDataPath, config, mapping, importProgress);
      triggerBigQuerySync('settings:kit-mapping-import');
      res.json({ success: true, ...result });
    } catch (e) {
      console.error('Kit mapping error:', e);
      importProgress.status = 'error';
      importProgress.result = e.message;
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // 약품 매핑 설정 + DB에서 임포트 수행
  // mapping 형식: "약품명_purchase", "약품명_usage", "약품명_inventory"
  router.post('/api/settings/save-medicine-mapping', async (req, res) => {
    const { config, mapping } = req.body;
    const importProgress = setImportProgress('medicine', mappingSettingsService.createProgress(config));
    try {
      const result = await mappingSettingsService.saveMedicineMapping(db, appDataPath, config, mapping, importProgress);
      triggerBigQuerySync('settings:medicine-mapping-import');
      res.json({ success: true, ...result });
    } catch (e) {
      console.error('Medicine mapping error:', e);
      importProgress.status = 'error';
      importProgress.result = e.message;
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // 수질 매핑 설정 + DB에서 임포트 수행
  router.post('/api/settings/save-water-mapping', async (req, res) => {
    const { config, mapping } = req.body;
    const importProgress = setImportProgress('water', mappingSettingsService.createProgress(config));
    try {
      const result = await mappingSettingsService.saveWaterMapping(db, appDataPath, config, mapping, importProgress);
      triggerBigQuerySync('settings:water-mapping-import');
      res.json({ success: true, ...result });
    } catch (e) {
      console.error('Water mapping error:', e);
      importProgress.status = 'error';
      importProgress.result = e.message;
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // 파일 업로드(엑셀 원본 + 템플릿 리셋 시 파일 초기화 + DB 준비 확인)
  router.post('/api/settings/upload', reportUpload.fields([
    { name: 'excel_original', maxCount: 1 },
    { name: 'report_templates' }
  ]), async (req, res) => {
    try {
      const result = await templateSettingsService.handleSettingsUpload(db, req.files, {
        baseDir,
        appDataPath,
        reportsDir,
        excelOriginalsDir,
      });
      res.json({ success: true, message: '파일 업로드 및 데이터 정보 수집 완료', ...result });
    } catch (err) {
      console.error('Upload error:', err);
      res.status(err.statusCode || 500).json({ success: false, message: err.message, ...(err.payload || {}) });
    }
  });

  router.post('/api/settings/open-local-folder', (req, res) => {
    try {
      const target = String(req.body?.target || '').trim();
      const openInServer = req.body?.openInServer !== false;
      const folderMap = {
        'excel-originals': excelOriginalsDir,
        reports: reportsDir,
      };
      const folderPath = folderMap[target];
      if (!folderPath) {
        return res.status(400).json({ success: false, message: '열 수 없는 폴더입니다.' });
      }
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
      }
      if (openInServer) {
        openLocalFolder(folderPath);
      }
      res.json({ success: true, path: folderPath });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 약품 기본 보관량 조회 API
  router.get('/api/settings/medicine-defaults', (req, res) => {
    try {
      const items = defaultSettingsService.getMedicineDefaults(db);
      res.json({ success: true, items });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // 약품 기본 보관량 업데이트
  router.post('/api/settings/medicine-defaults', (req, res) => {
    const { items } = req.body;
    try {
      const { rows, matchedCount, changedCount, skipped } = defaultSettingsService.saveItemDefaults(db, 'medicine', items);

      if (rows.length > 0 && matchedCount === 0) {
        return res.json({
          success: false,
          message:
            'DB의 약품 항목과 대조표의 이름이 일치하지 않음을 확인할 수 없습니다. 설정 > 약품 항목에서 약품 이름 목록을 먼저 사용 가능하게 기본 보관량을 설정 시 진행해주세요.',
          updatedCount: 0,
        });
      }

      res.json({
        success: true,
        updatedCount: matchedCount,
        changedCount,
        ...(skipped > 0
          ? {
              warning: `${skipped}개 항목이 config_items 약품명과 일치하지 않아 반영되지 않았습니다`,
            }
          : {}),
      });
    } catch (e) {
      res.status(e.statusCode || 500).json({ success: false, message: e.message });
    }
  });

  // 킷 기본 보관량 조회 API
  router.get('/api/settings/kit-defaults', (req, res) => {
    try {
      const items = defaultSettingsService.getKitDefaults(db);
      res.json({ success: true, items });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // 킷 기본 보관량 업데이트
  router.post('/api/settings/kit-defaults', (req, res) => {
    const { items } = req.body;
    try {
      const { rows, matchedCount, changedCount, skipped } = defaultSettingsService.saveItemDefaults(db, 'kit', items);

      if (rows.length > 0 && matchedCount === 0) {
        return res.json({
          success: false,
          message:
            'DB의 킷 항목과 대조표의 이름이 일치하지 않음을 확인할 수 없습니다. 설정 > 킷 항목에서 킷 목록을 먼저 사용 가능하게 기본 보관량을 설정 시 진행해주세요.',
          updatedCount: 0,
        });
      }

      res.json({
        success: true,
        updatedCount: matchedCount,
        changedCount,
        ...(skipped > 0
          ? {
              warning: `${skipped}개 항목이 config_items 킷명과 일치하지 않아 반영되지 않았습니다`,
            }
          : {}),
      });
    } catch (e) {
      res.status(e.statusCode || 500).json({ success: false, message: e.message });
    }
  });

  // 슬러지 반출 관리용 기본설정 조회/업데이트
  router.get('/api/settings/sludge-export-settings', (req, res) => {
    try {
      const settings = defaultSettingsService.getSludgeExportSettings(db);
      res.json({ success: true, settings });
    } catch (e) {
      res.status(e.statusCode || 500).json({ success: false, message: e.message });
    }
  });

  router.post('/api/settings/sludge-export-settings', (req, res) => {
    try {
      const settings = defaultSettingsService.saveSludgeExportSettings(db, req.body || {});
      res.json({ success: true, settings });
    } catch (e) {
      res.status(e.statusCode || 500).json({ success: false, message: e.message });
    }
  });

  // 초기 동기화 로컬 DB의 모든 사원/사이트를 Google Sheets로
  router.post('/api/settings/sync-initial-to-sheets', async (req, res) => {
    try {
      const result = await initialSyncService.syncInitialToSheets(db, {
        enabled: ENABLE_INITIAL_SYNC_TO_SHEETS,
      });
      res.json(result);
    } catch (e) {
      res.status(e.statusCode || 500).json({ success: false, message: e.message });
    }
  });

  return router;
};
