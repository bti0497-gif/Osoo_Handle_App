'use strict';

/**
 * boardService.cjs
 * ─────────────────────────────────────────────────────────────────────
 * 게시판 백엔드 통합 어댑터
 * process.env.BOARD_BACKEND 환경 변수에 따라 Firebase 또는 BigQuery 서비스를 스위칭합니다.
 */

const bigQueryService = require('./boardBigQueryService.cjs');
const firebaseService = require('./boardFirebaseService.cjs');

// 소통게시판의 운영 원본은 Firebase다. BOARD_BACKEND는 장애 진단이나
// 명시적인 전환이 필요할 때만 사용하며, 미설정 현장도 중앙관리자 앱과
// 같은 게시판을 보도록 Firebase를 기본값으로 유지한다.
const backend = String(process.env.BOARD_BACKEND || 'firebase').trim().toLowerCase();

console.log(`[BoardService] Selected backend: ${backend}`);

module.exports = backend === 'firebase' ? firebaseService : bigQueryService;
