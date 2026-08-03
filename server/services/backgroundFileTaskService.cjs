const fs = require('fs');

function ensureTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS background_file_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_type TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_run_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    UPDATE background_file_tasks
    SET status = 'pending', updated_at = CURRENT_TIMESTAMP
    WHERE status = 'running';
  `);
}

function enqueueBackgroundFileTask(db, { taskType, dedupeKey, payload }) {
  ensureTable(db);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO background_file_tasks
      (task_type, dedupe_key, payload_json, status, attempts, next_run_at, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)
    ON CONFLICT(dedupe_key) DO UPDATE SET
      task_type = excluded.task_type,
      payload_json = excluded.payload_json,
      status = 'pending',
      attempts = 0,
      last_error = NULL,
      next_run_at = excluded.next_run_at,
      updated_at = excluded.updated_at
  `).run(taskType, dedupeKey, JSON.stringify(payload || {}), now, now, now);
  // 상위 유휴 작업도 즉시 pending으로 되돌린다. 실제 실행은 렌더러의
  // 30분 무입력 스케줄러가 담당하므로 저장 요청에서는 외부 통신이 없다.
  const hasBackgroundTasks = db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'background_tasks'
  `).get();
  if (hasBackgroundTasks) {
    db.prepare(`
      INSERT INTO background_tasks (task_type, status, attempts, next_run_at, updated_at)
      VALUES ('file-sync', 'pending', 0, ?, ?)
      ON CONFLICT(task_type) DO UPDATE SET
        status = 'pending', attempts = 0, last_error = NULL,
        next_run_at = excluded.next_run_at, updated_at = excluded.updated_at
    `).run(now, now);
  }
}

async function executeTask(db, task) {
  const payload = JSON.parse(task.payload_json || '{}');
  if (!payload.localPath || !fs.existsSync(payload.localPath)) {
    throw new Error(`로컬 사진 파일을 찾을 수 없습니다: ${payload.localPath || '(없음)'}`);
  }

  if (task.task_type === 'sludge-photo-drive') {
    const routes = require('../routes/sludgePhotoRoutes.cjs');
    const result = await routes.__uploadSludgePhotoToDrive(
      db, payload.date, payload.type, payload.localPath, payload.index, payload.siteName
    );
    if (!result?.id) throw new Error('슬러지 사진 Drive 업로드 결과가 없습니다.');
    return result;
  }
  if (task.task_type === 'medicine-photo-drive') {
    const routes = require('../routes/medicineInRoutes.cjs');
    const result = await routes.__uploadMedicinePhotoToDrive(
      db, payload.date, payload.itemName, payload.localPath, payload.siteName, payload.photoIndex
    );
    if (!result?.id) throw new Error('약품·키트 사진 Drive 업로드 결과가 없습니다.');
    return result;
  }
  if (task.task_type === 'management-photo-drive') {
    const {
      isDriveConfigured,
      getDriveRootFolderId,
      getOrCreateFolderPath,
      uploadBufferToFolder,
    } = require('./driveService.cjs');
    const { managementPhotoName, managementPhotoSegments } = require('./drivePathService.cjs');
    if (!isDriveConfigured()) throw new Error('Google Drive가 설정되지 않았습니다.');
    const folder = await getOrCreateFolderPath(getDriveRootFolderId(), managementPhotoSegments(payload.date));
    const result = await uploadBufferToFolder({
      folderId: folder.id,
      fileName: managementPhotoName(
        payload.date,
        payload.siteName || 'Unknown Site',
        payload.itemLabel,
        Number(payload.photoIndex) || 0,
        payload.extension || '.jpg'
      ),
      buffer: fs.readFileSync(payload.localPath),
      mimeType: payload.mimeType || 'image/jpeg',
    });
    if (!result?.id) throw new Error('관리사진 Drive 업로드 결과가 없습니다.');
    return result;
  }
  throw new Error(`지원하지 않는 파일 작업입니다: ${task.task_type}`);
}

async function processPendingBackgroundFileTasks(db, { shouldContinue = () => true, limit = 50 } = {}) {
  ensureTable(db);
  const now = new Date().toISOString();
  const tasks = db.prepare(`
    SELECT * FROM background_file_tasks
    WHERE status = 'pending' AND COALESCE(next_run_at, '') <= ?
    ORDER BY created_at ASC, id ASC
    LIMIT ?
  `).all(now, Math.max(1, Number(limit) || 50));
  const summary = { total: tasks.length, completed: 0, failed: 0, paused: false };

  for (const task of tasks) {
    if (!shouldContinue()) {
      summary.paused = true;
      break;
    }
    const claimed = db.prepare(`
      UPDATE background_file_tasks
      SET status = 'running', attempts = attempts + 1, updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(new Date().toISOString(), task.id);
    if (!claimed.changes) continue;

    try {
      await executeTask(db, task);
      db.prepare('DELETE FROM background_file_tasks WHERE id = ?').run(task.id);
      summary.completed += 1;
    } catch (error) {
      const attempts = Number(task.attempts || 0) + 1;
      const retryMs = Math.min(60 * 60 * 1000, Math.max(10 * 60 * 1000, attempts * 10 * 60 * 1000));
      const failedAt = new Date();
      db.prepare(`
        UPDATE background_file_tasks
        SET status = 'pending', last_error = ?, next_run_at = ?, updated_at = ?
        WHERE id = ?
      `).run(
        String(error?.message || error).slice(0, 1000),
        new Date(failedAt.getTime() + retryMs).toISOString(),
        failedAt.toISOString(),
        task.id
      );
      summary.failed += 1;
    }
  }
  return summary;
}

module.exports = {
  ensureBackgroundFileTaskTable: ensureTable,
  enqueueBackgroundFileTask,
  processPendingBackgroundFileTasks,
};
