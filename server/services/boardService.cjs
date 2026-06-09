'use strict';

/**
 * boardService.cjs
 * ─────────────────────────────────────────────────────────────────────
 * 게시판 백엔드 통합 어댑터
 * process.env.BOARD_BACKEND 환경 변수에 따라 Firebase 또는 BigQuery 서비스를 스위칭합니다.
 */

const bigQueryService = require('./boardBigQueryService.cjs');
const firebaseService = require('./boardFirebaseService.cjs');

const backend = String(process.env.BOARD_BACKEND || 'bigquery').trim().toLowerCase();

console.log(`[BoardService] Selected backend: ${backend}`);

module.exports = backend === 'firebase' ? firebaseService : bigQueryService;
