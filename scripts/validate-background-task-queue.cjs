const { app } = require('electron');
const Database = require('better-sqlite3');

app.whenReady().then(() => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE background_tasks (
      task_type TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_run_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO background_tasks (task_type, status, attempts, next_run_at, updated_at)
    VALUES (?, 'pending', 0, ?, ?)
  `);
  ['attendance-sync', 'data-sync', 'file-sync', 'certificate-cache', 'board-cache', 'diagnostic-sync', 'update-check']
    .forEach((taskType) => insert.run(taskType, now, now));

  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  assert(db.prepare(`SELECT COUNT(*) AS count FROM background_tasks WHERE status = 'pending'`).get().count === 7, 'prepare failed');

  db.prepare(`UPDATE background_tasks SET status = 'running', attempts = attempts + 1 WHERE task_type = ?`).run('data-sync');
  db.prepare(`UPDATE background_tasks SET status = 'pending' WHERE status = 'running'`).run();
  assert(db.prepare(`SELECT status FROM background_tasks WHERE task_type = ?`).get('data-sync').status === 'pending', 'restart recovery failed');

  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  db.prepare(`UPDATE background_tasks SET status = 'completed', next_run_at = ? WHERE task_type = ?`).run(future, 'attendance-sync');
  db.prepare(`UPDATE background_tasks SET status = 'pending' WHERE status = 'completed' AND next_run_at <= ?`).run(now);
  assert(db.prepare(`SELECT status FROM background_tasks WHERE task_type = ?`).get('attendance-sync').status === 'completed', 'future schedule failed');

  const past = new Date(Date.now() - 1000).toISOString();
  db.prepare(`UPDATE background_tasks SET next_run_at = ? WHERE task_type = ?`).run(past, 'attendance-sync');
  db.prepare(`UPDATE background_tasks SET status = 'pending' WHERE status = 'completed' AND next_run_at <= ?`).run(now);
  assert(db.prepare(`SELECT status FROM background_tasks WHERE task_type = ?`).get('attendance-sync').status === 'pending', 'due recovery failed');

  const { enqueueBackgroundFileTask } = require('../server/services/backgroundFileTaskService.cjs');
  enqueueBackgroundFileTask(db, {
    taskType: 'medicine-photo-drive',
    dedupeKey: 'medicine:C:/photo.jpg',
    payload: { localPath: 'C:/photo.jpg', date: '2026-08-03' },
  });
  enqueueBackgroundFileTask(db, {
    taskType: 'medicine-photo-drive',
    dedupeKey: 'medicine:C:/photo.jpg',
    payload: { localPath: 'C:/photo.jpg', date: '2026-08-04' },
  });
  assert(db.prepare('SELECT COUNT(*) AS count FROM background_file_tasks').get().count === 1, 'file task dedupe failed');
  assert(JSON.parse(db.prepare('SELECT payload_json FROM background_file_tasks').get().payload_json).date === '2026-08-04', 'file task refresh failed');
  assert(db.prepare(`SELECT status FROM background_tasks WHERE task_type = 'file-sync'`).get().status === 'pending', 'file sync parent task failed');

  db.close();
  console.log('PASS background task queue: prepare/claim/restart/complete/due/file-dedupe');
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
