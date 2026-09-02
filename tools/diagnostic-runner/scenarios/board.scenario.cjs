'use strict';

/**
 * board 시나리오: 소통게시판의 현재 계약을 고정한다(트립와이어).
 *
 * 2026-09-01 진단 발견: 게시판 쓰기/조회는 Firebase 키가 없으면 500을 반환하며
 * 로컬 저장으로 폴백하지 않는다(로컬 우선 큐 없음). 실제 배포환경은 설치 스크립트가
 * firebase-service-account.json을 프로비저닝하므로 동작하지만, 키 손상 시 게시판 전체가
 * 죽는 결합 구조다. 이 시나리오는 그 현재 동작을 고정한다:
 * - 키 없는 격리 환경에서 POST/GET 모두 500 + Firebase 안내 메시지.
 * - 로컬 우선 저장이 구현되면 이 단계들이 실패하며 계약 갱신을 요구한다.
 */

module.exports = {
  id: 'board',
    covers: ["board"],
  version: '0.1.0',
  status: 'contract-pending',
  async run({ ctx }) {
    await ctx.step('board-write-current-contract', async () => {
      const response = await ctx.request('POST', '/api/board/posts', {
        body: { title: '[진단] 계약 고정 탐침', content: '<p>probe</p>' },
      });
      ctx.assert(response.status === 500, `게시판 쓰기가 더 이상 Firebase 강제 결합이 아닙니다(HTTP ${response.status}). 로컬 우선 저장이 구현된 것으로 보이니 이 시나리오를 implemented로 승격하세요.`, 'BOARD_CONTRACT_CHANGED');
      ctx.assert(response.json && String(response.json.message || '').includes('Firebase'), '게시판 500 오류 메시지 계약이 변했습니다.', 'BOARD_CONTRACT_CHANGED', response.json);
      return { status: response.status };
    });

    await ctx.step('board-list-current-contract', async () => {
      const response = await ctx.request('GET', '/api/board/posts', { query: { limit: 20 } });
      ctx.assert(response.status === 500, `게시판 목록이 더 이상 Firebase 강제 결합이 아닙니다(HTTP ${response.status}). 계약 갱신이 필요합니다.`, 'BOARD_CONTRACT_CHANGED');
      return { status: response.status };
    });
  },
};
