'use strict';

const { parentPort, workerData } = require('worker_threads');

function parseDetailsJson(value) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch (_) {
    return { parseError: true };
  }
}

function normalizeSiteName(value) {
  return String(value || 'unknown-site')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

async function upload() {
  const startedAt = Date.now();
  const rows = Array.isArray(workerData?.rows) ? workerData.rows : [];
  const {
    findFolderPath,
    getDriveClient,
    getOrCreateFolderPath,
    getDriveRootFolderId,
    isDriveConfigured,
    uploadBufferToFolder,
  } = require('./driveService.cjs');

  // googleapis 초기화, JSON 직렬화와 네트워크 업로드를 서버 이벤트 루프와
  // 분리한다. 실패 시 메인 스레드에서 재시도하지 않고 다음 동기화로 넘긴다.
  if (!isDriveConfigured()) {
    return { success: false, skipped: true, reason: 'drive-not-configured', isolatedWorker: true };
  }

  if (workerData?.action === 'cleanup') {
    const diagnosticRoot = await findFolderPath(getDriveRootFolderId(), ['앱진단로그']);
    const drive = getDriveClient();
    const cutoffIso = String(workerData?.cutoffIso || '');
    const listChildren = async (folderId) => {
      const items = [];
      let pageToken;
      do {
        const response = await drive.files.list({
          q: `'${String(folderId).replace(/'/g, "\\'")}' in parents and trashed=false`,
          fields: 'nextPageToken, files(id, name, mimeType, createdTime)',
          pageSize: 1000,
          pageToken,
          spaces: 'drive',
          includeItemsFromAllDrives: true,
          supportsAllDrives: true,
        });
        items.push(...(response.data.files || []));
        pageToken = response.data.nextPageToken;
      } while (pageToken);
      return items;
    };
    const deleteOldFiles = async (folderId, depth = 0) => {
      if (!folderId || depth > 4) return 0;
      const children = await listChildren(folderId);
      let deletedCount = 0;
      for (const item of children) {
        if (item.mimeType === 'application/vnd.google-apps.folder') {
          deletedCount += await deleteOldFiles(item.id, depth + 1);
        } else if (item.createdTime && item.createdTime < cutoffIso) {
          await drive.files.delete({ fileId: item.id, supportsAllDrives: true });
          deletedCount += 1;
        }
      }
      return deletedCount;
    };
    return {
      success: true,
      deletedCount: diagnosticRoot?.id ? await deleteOldFiles(diagnosticRoot.id) : 0,
      elapsedMs: Date.now() - startedAt,
      isolatedWorker: true,
    };
  }

  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const fileName = `${stamp}_${normalizeSiteName(workerData?.siteName)}_diagnostics.jsonl`;
  const buffer = Buffer.from(rows.map((row) => JSON.stringify({
    id: row.id,
    created_at: row.created_at,
    level: row.level,
    area: row.area,
    action: row.action,
    result: row.result,
    message: row.message,
    details: parseDetailsJson(row.details_json),
    site_id: row.site_id,
    site_name: row.site_name,
    app_version: row.app_version,
    machine: workerData?.machine || '',
    runtime: workerData?.runtime || 'node',
  })).join('\n') + '\n', 'utf8');

  const folder = await getOrCreateFolderPath(getDriveRootFolderId(), ['앱진단로그', yyyy, mm]);
  const file = await uploadBufferToFolder({
    folderId: folder.id,
    fileName,
    buffer,
    mimeType: 'application/jsonl',
  });
  return {
    success: true,
    count: rows.length,
    driveFileId: file.id || null,
    driveWebViewLink: file.webViewLink || null,
    elapsedMs: Date.now() - startedAt,
    isolatedWorker: true,
  };
}

upload()
  .then((result) => parentPort.postMessage({ ok: true, result }))
  .catch((error) => parentPort.postMessage({
    ok: false,
    error: String(error?.message || error || 'diagnostic-upload-worker-failed').slice(0, 2000),
  }));
