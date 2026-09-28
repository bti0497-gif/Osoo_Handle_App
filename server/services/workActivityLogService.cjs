const fs = require('fs');
const path = require('path');

const MAX_TOTAL_BYTES = 500 * 1024 * 1024;
const RETENTION_DAYS = 30;
const ACTIVITY_FILE_PATTERN = /^activity-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const TITLES = [
  [/^\/api\/flows?(?:\/|$)/i, '유량·검침 관리'],
  [/^\/api\/(?:water-quality|waterQuality)(?:\/|$)/i, '수질분석 관리'],
  [/^\/api\/medicines?(?:\/|$)/i, '약품 관리'],
  [/^\/api\/kits?(?:\/|$)/i, '키트 관리'],
  [/^\/api\/medicine-in(?:\/|$)/i, '약품 입고·사진 관리'],
  [/^\/api\/medicine-register(?:\/|$)/i, '약품관리대장'],
  [/^\/api\/sludge-photos?(?:\/|$)/i, '슬러지 사진·대장 관리'],
  [/^\/api\/(?:work-records|equipment)(?:\/|$)/i, '장비이력·업무사진 관리'],
  [/^\/api\/facilit(?:y|ies)(?:\/|$)/i, '시설이력 관리'],
  [/^\/api\/daily-work-log(?:\/|$)/i, '일일업무일지'],
  [/^\/api\/monthly-operation-report(?:\/|$)/i, '월운영보고서'],
  [/^\/api\/roadwork-helper(?:\/|$)/i, '공사입력도우미'],
  [/^\/api\/attendance(?:\/|$)/i, '근태 관리'],
  [/^\/api\/settings(?:\/|$)/i, '앱 설정'],
  [/^\/api\/board(?:\/|$)/i, '소통게시판'],
  [/^\/api\/certificates?(?:\/|$)/i, '수질성적서 관리'],
  [/^\/api\/operation-status(?:\/|$)/i, '운전상태 관리'],
  [/^\/api\/(?:excel|reports?)(?:\/|$)/i, '보고서 생성'],
  [/^\/api\/uploads?(?:\/|$)/i, '파일·사진 관리'],
];

function getKstDate(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function titleForPath(urlPath) {
  return TITLES.find(([pattern]) => pattern.test(urlPath))?.[1] || null;
}

function pruneActivityFiles(directory, now = new Date()) {
  const today = getKstDate(now);
  const cutoff = new Date(`${today}T00:00:00+09:00`);
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);
  const cutoffDate = getKstDate(cutoff);
  const files = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && ACTIVITY_FILE_PATTERN.test(entry.name))
    .map((entry) => {
      const date = entry.name.match(ACTIVITY_FILE_PATTERN)[1];
      const filePath = path.join(directory, entry.name);
      return { date, filePath, size: fs.statSync(filePath).size };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  let totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  let deletedFiles = 0;
  for (const file of files) {
    if (file.date >= cutoffDate && totalBytes <= MAX_TOTAL_BYTES) continue;
    if (file.date === today && totalBytes > MAX_TOTAL_BYTES) {
      const fd = fs.openSync(file.filePath, 'r+');
      try {
        const size = fs.fstatSync(fd).size;
        const keepBytes = Math.min(size, 1024 * 1024);
        const tail = Buffer.allocUnsafe(keepBytes);
        const read = fs.readSync(fd, tail, 0, keepBytes, size - keepBytes);
        fs.writeSync(fd, tail, 0, read, 0);
        fs.ftruncateSync(fd, read);
        totalBytes -= size - read;
      } finally {
        fs.closeSync(fd);
      }
      continue;
    }
    fs.unlinkSync(file.filePath);
    totalBytes -= file.size;
    deletedFiles += 1;
  }
  return { totalBytes, deletedFiles };
}

function createWorkActivityLogService(appDataPath) {
  const directory = path.join(appDataPath, 'logs', 'activity');
  fs.mkdirSync(directory, { recursive: true });
  pruneActivityFiles(directory);

  function record({ method, path: requestPath, statusCode }) {
    const title = titleForPath(requestPath);
    if (!title) return;
    const now = new Date();
    const date = getKstDate(now);
    const event = {
      time: now.toISOString(),
      title,
      result: statusCode < 400 ? 'success' : statusCode < 500 ? 'rejected' : 'failed',
    };
    const filePath = path.join(directory, `activity-${date}.jsonl`);
    fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, 'utf8');
    pruneActivityFiles(directory);
  }

  function middleware(req, res, next) {
    const method = String(req.method || '').toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next();
    const requestPath = String(req.originalUrl || req.url || '').split('?')[0];
    if (!requestPath.startsWith('/api/')) return next();
    if (/^\/api\/(?:auth|ping|diagnostic|preload-trigger|background-tasks?)(?:\/|$)/i.test(requestPath)
      || /(?:^|\/)(?:warmup|health)(?:\/|$)/i.test(requestPath)) {
      return next();
    }
    res.once('finish', () => {
      try { record({ method, path: requestPath, statusCode: Number(res.statusCode || 500) }); } catch (_) { /* never affect business request */ }
    });
    return next();
  }

  return { middleware, prune: () => pruneActivityFiles(directory) };
}

module.exports = { createWorkActivityLogService, pruneActivityFiles, titleForPath, MAX_TOTAL_BYTES, RETENTION_DAYS };
