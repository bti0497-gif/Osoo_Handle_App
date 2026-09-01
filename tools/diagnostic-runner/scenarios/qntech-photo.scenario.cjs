'use strict';

/**
 * qntech-photo 시나리오: 큐앤테크 사진 가져오기의 local 모드 계약을 고정한다(감시선).
 *
 * 실제 흐름(서비스 원문 기준):
 *   외부 qntech 서버에서 사진 다운로드 -> <photoRoot>/<YYYY>/<MM>/데이타불러오기 에
 *   <rowId>_<날짜>_<항목>.<ext> 로 저장 -> background_file_tasks 에 Drive 업로드 큐 등록.
 * local 모드에서는 다운로드가 외부 호출이라 guard에 차단되므로, 여기서 검증하는 것은:
 * 1) import 가 외부 의존 없이 성공을 가장하지 않는다(실패가 명확히 전달됨)
 * 2) 실패 시 로컬 파일·Drive 큐에 부분 오염이 없다(fail-closed, 계획 §6 부분 성공 방어)
 * 3) 백그라운드 큐 라우트가 살아 있다
 * 전체 다운로드->날짜 규칙->공사입력도우미 자동 첨부 흐름은 외부 네트워크(smoke) 또는
 * Electron IPC 영역이라 contract-pending 으로 둔다.
 */

const fs = require('fs');
const path = require('path');

function listFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

module.exports = {
  id: 'qntech-photo',
  version: '0.1.0',
  status: 'contract-pending',
  async run({ ctx, fixtures, dbPath }) {
    const date = fixtures.dataset.fixedDate;
    const appData = path.dirname(dbPath);
    // 저장 계약: <photoRoot>/<YYYY>/<MM>/데이타불러오기 (사진 루트는 appData/사진관리/수질분석)
    const photoDir = path.join(appData, '사진관리', '수질분석', date.slice(0, 4), date.slice(5, 7), '데이타불러오기');

    await ctx.step('import-fails-closed-locally', async () => {
      const response = await ctx.request('POST', '/api/water-quality/import-photos-from-qntech', {
        body: { date },
      });
      // local 모드에서 외부 다운로드가 차단되므로 500이 현재 계약이다.
      // 로컬 우선/fixture 경로가 생기면 이 단계가 실패하며 계약 갱신을 요구한다.
      ctx.assert(response.status === 500,
        `사진 가져오기가 local 모드에서 HTTP ${response.status}을 반환했습니다. 외부 없이 성공 경로가 생긴 것이면 이 시나리오를 implemented로 승격하세요.`,
        'QNTECH_IMPORT_CONTRACT_CHANGED',
        { status: response.status, body: response.json });
      ctx.assert(response.json && response.json.success === false, '실패 응답이 success:false를 담지 않습니다.', 'QNTECH_FAILURE_NOT_EXPLICIT', response.json);
      return { note: '외부 다운로드 차단에 따른 명시적 실패(현재 계약)' };
    });

    await ctx.step('no-partial-artifacts', async () => {
      // fail-closed: 실패한 import가 로컬 파일을 남기면 안 된다.
      const strayFiles = listFilesRecursive(photoDir);
      ctx.assert(strayFiles.length === 0,
        '실패한 사진 가져오기가 로컬 파일을 남겼습니다(부분 성공 오염).',
        'PARTIAL_IMPORT_ARTIFACTS',
        { dir: photoDir, files: strayFiles.slice(0, 5).map((f) => path.basename(f)) });

      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      db.pragma('busy_timeout = 10000');
      try {
        // 큐 테이블은 첫 등록 시에만 생성되는 지연 테이블이다. 없으면 잔여 0과 동치다.
        const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'background_file_tasks'").get();
        if (tableExists) {
          const rows = db.prepare("SELECT COUNT(*) AS count FROM background_file_tasks WHERE task_type = 'management-photo-drive'").get();
          ctx.assert(rows.count === 0,
            '실패한 사진 가져오기가 Drive 업로드 큐에 작업을 남겼습니다.',
            'PARTIAL_DRIVE_QUEUE', rows);
        }
      } finally {
        db.close();
      }
    });

    await ctx.step('drive-queue-route-alive', async () => {
      const response = await ctx.request('GET', '/api/auth/background-tasks/pending', { siteHeader: false });
      ctx.assert(response.ok, `백그라운드 큐 라우트 조회 실패: HTTP ${response.status}`, 'QUEUE_ROUTE_FAILED', response.json);
      return { status: response.status };
    });
  },
};
