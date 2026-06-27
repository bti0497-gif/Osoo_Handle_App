'use strict';

/**
 * drivePathService.cjs
 * =====================================================================
 * Google Drive 폴더 구조 및 파일명 규칙 단일 관리 모듈
 *
 * 이 파일 하나에서 모든 Drive 경로/파일명 규칙을 정의한다.
 * 새 기능을 추가할 때 반드시 이 파일에 먼저 규칙을 등록하고,
 * driveService.cjs의 getOrCreateFolderPath / uploadBufferToFolder 와 조합해 사용한다.
 *
 *
 *
 *
 *
 * ROOT/                             ??env: GOOGLE_DRIVE_FOLDER_ID
 * ??
 * ├── Board_Uploads/                ← 게시판 첨부파일 (현재 구현)
 * ??
 * ├── 성적서/                       ← 중앙 업로드 (관리자 PC에서 일괄 올림)
 * │   └── {year}/
 * │       └── {month}/
 * │           └── {구분}-{date}-{현장명}.pdf
 * │               예) mlss-2026-04-01-청주.pdf
 * │               예) 성적서-2026-04-01-청주.pdf
 * ??
 * └── {현장명}/                     ← 현장별 (각 현장 PC에서 올림)
 *     ??
 *     ├── 수질분석/                 ← 큐앤텍 데이터 가져오기 시 자동 업로드 (현재 구현)
 * │   └── {year}/
 * │       └── {month}/
 *     │           └── {date}/
 *     │               └── {date}-{공법명}-{항목명}.jpg
 *     │                   예) 2026-04-01-A2O-암모니아성 질소.jpg
 *     │                   예) 2026-04-01-2차-질산성 질소.jpg  (차수 있을 때)
 *     ??
 *     ├── 수질분석/                 ← 큐앤텍 데이터 가져오기 시 자동 업로드 (현재 구현)
 * │   └── {year}/
 * │       └── {month}/
 *     │           └── {date}/
 *     │               └── {date}-{약품명}.jpg
 *     ??                  ?? 2026-04-01-PAC.jpg
 *     │                   예) 2026-04-01-PAC-2.jpg  (같은 날 동일 약품 여러 장)
 *     ??
 *     ├── 수질분석/                 ← 큐앤텍 데이터 가져오기 시 자동 업로드 (현재 구현)
 * │   └── {year}/
 * │       └── {month}/
 *     │           └── {date}/
 *                     └── {date}-슬러지-{번호}.jpg
 *                         ?? 2026-04-01-슬러지-1.jpg
 *
 * │
 * 사용 방법 (예시)
 * │
 *
 *   const { getOrCreateFolderPath, uploadBufferToFolder } = require('./driveService.cjs');
 *   const {
 *     waterAnalysisPhotoSegments,
 *     waterAnalysisPhotoName,
 *   } = require('./drivePathService.cjs');
 *
 *   // 1) 폴더 생성/조회
 *   const folder = await getOrCreateFolderPath(rootFolderId,
 *     waterAnalysisPhotoSegments('청주', '2026-04-01')
 *   );
 *   // → ROOT/청주/수질분석/2026/04/2026-04-01/
 *
 *   // 2) 파일 업로드
 *   const fileName = waterAnalysisPhotoName('2026-04-01', '암모니아성 질소', 'A2O', '.jpg');
 *   await uploadBufferToFolder({ folderId: folder.id, fileName, buffer, mimeType: 'image/jpeg' });
 *
 * =====================================================================
 */

// ─────────────────────────────────────────────────────────────────────
// 1. 카테고리 상수
//    Drive 폴더명으로 사용되는 값. 변경 시 기존 Drive 파일 위치도 바뀌므로 신중히.
// ─────────────────────────────────────────────────────────────────────
const DRIVE_CATEGORY = {
  BOARD_UPLOADS:    'Board_Uploads',  // 게시판 첨부파일
  CERTIFICATE:      '성적서',         // 성적서 (중앙 업로드)
  MANAGEMENT_PHOTO: '관리사진',       // 현장 업무사진 통합 보관
  WATER_ANALYSIS:   '수질분석',       // 수질분석 사진 (현장 업로드)
  MEDICINE_RECEIPT: '약품입고',       // 약품입고 사진 (향후 구현)
  SLUDGE:           '슬러지',         // 슬러지 사진 (향후 구현)
};

// ─────────────────────────────────────────────────────────────────────
// 2. 내부 유틸
// ─────────────────────────────────────────────────────────────────────

/**
 * 파일명/폴더명에 사용 불가한 문자를 '_'로 치환한다.
 * Windows / Drive 모두 안전한 이름을 만든다.
 */
function sanitize(value) {
  return String(value || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

function yearOf(dateStr)  { return String(dateStr).slice(0, 4); }
function monthOf(dateStr) { return String(dateStr).slice(5, 7); }

// ─────────────────────────────────────────────────────────────────────
// 3. 폴더 세그먼트 빌더
//    반환값을 driveService.getOrCreateFolderPath(rootFolderId, segments) 에 그대로 넘긴다.
// ─────────────────────────────────────────────────────────────────────

/**
 * 게시판 첨부파일 폴더
 * ??ROOT/Board_Uploads/
 */
function boardUploadsSegments() {
  return [DRIVE_CATEGORY.BOARD_UPLOADS];
}

/**
 * 성적서 폴더 (중앙 업로드
 * → ROOT/성적서/{year}/{month}/
 * @param {string} date  'YYYY-MM-DD' 형식
 */
function certificateFolderSegments(date) {
  return [DRIVE_CATEGORY.CERTIFICATE, yearOf(date), monthOf(date)];
}

/**
 * 현장 업무사진 통합 폴더
 * → ROOT/관리사진/{year}/{month}/
 */
function managementPhotoSegments(date) {
  return [DRIVE_CATEGORY.MANAGEMENT_PHOTO, yearOf(date), monthOf(date)];
}

/**
 * 수질분석 사진 폴더 (현장 업로드
 * → ROOT/{현장명}/수질분석/{year}/{month}/{date}/
 * @param {string} siteName  현장명
 * @param {string} date  'YYYY-MM-DD' 형식
 */
function waterAnalysisPhotoSegments(siteName, date) {
  return [
    sanitize(siteName),
    DRIVE_CATEGORY.WATER_ANALYSIS,
    yearOf(date),
    monthOf(date),
    date,
  ];
}

/**
 * 약품입고 사진 폴더 (현장 업로드 수신후 구현
 * → ROOT/{현장명}/수질분석/{year}/{month}/{date}/
 * @param {string} siteName  현장명
 * @param {string} date  'YYYY-MM-DD' 형식
 */
function medicinePhotoSegments(siteName, date) {
  return [
    sanitize(siteName),
    DRIVE_CATEGORY.MEDICINE_RECEIPT,
    yearOf(date),
    monthOf(date),
    date,
  ];
}

/**
 * 슬러지 사진 폴더 (현장 업로드 수신후 구현
 * → ROOT/{현장명}/수질분석/{year}/{month}/{date}/
 * @param {string} siteName  현장명
 * @param {string} date      'YYYY-MM-DD' 형식
 */
function sludgePhotoSegments(siteName, date) {
  return [
    sanitize(siteName),
    DRIVE_CATEGORY.SLUDGE,
    yearOf(date),
    monthOf(date),
    date,
  ];
}

// ─────────────────────────────────────────────────────────────────────
// 4. 파일명 빌더
// ─────────────────────────────────────────────────────────────────────

/**
 * 성적서 파일명
 * 형식: {구분}-{date}-{현장명}.{ext}
 * 예)   mlss-2026-04-01-청주.pdf
 *       성적서-2026-04-01-청주.pdf
 *
 * @param {'mlss'|'성적서'|string} category  구분 (mlss, 성적서, tp, ...)
 * @param {string} date      'YYYY-MM-DD'
 * @param {string} siteName  현장명
 * @param {string} [ext]     확장자 (기본 '.pdf')
 */
function certificateFileName(category, date, siteName, ext = '.pdf') {
  const parts = [sanitize(category), date, sanitize(siteName)].filter(Boolean);
  return parts.join('-') + ext;
}

/**
 * 성적서 파일명
 * 형식: {date}-{공법명}-{항목명}.{ext}
 * 예)   2026-04-01-A2O-암모니아성 질소.jpg
 *       2026-04-01-2차-질산성 질소.jpg       (차수 표기 시)
 *       2026-04-01-A2O-암모니아성 질소-2.jpg (같은 날 동일 항목 두 번째)
 *
 * @param {string} date           'YYYY-MM-DD'
 * @param {string} itemName       항목명 (예: 암모니아성 질소)
 * @param {string} sourceLabel    공법명 또는 차수 (없으면 빈 문자열)
 * @param {string} ext            ?뺤옣??(?? '.jpg')
 * @param {number} [duplicateIndex]  중복 인덱스 (0이면 suffix 없음, 1부터 '-2', '-3')
 */
function waterAnalysisPhotoName(date, itemName, sourceLabel, ext, duplicateIndex = 0) {
  const parts = [date, sanitize(sourceLabel), sanitize(itemName)].filter(Boolean);
  if (duplicateIndex > 0) parts.push(String(duplicateIndex + 1));
  return parts.join('-') + ext;
}

/**
 * 성적서 파일명
 * 형식: {date}-{약품명}.{ext}
 * ??   2026-04-01-PAC.jpg
 *       2026-04-01-PAC-2.jpg  (같은 날 동일 약품 두 번째 사진)
 *
 * @param {string} date        'YYYY-MM-DD'
 * @param {string} medicineName 약품명
 * @param {number} [index]     중복 인덱스 (0이면 suffix 없음, 1부터 '-2', '-3')
 * @param {string} [ext]       확장자 (기본 '.jpg')
 */
function medicinePhotoName(date, medicineName, index = 0, ext = '.jpg') {
  const parts = [date, sanitize(medicineName)].filter(Boolean);
  if (index > 0) parts.push(String(index + 1));
  return parts.join('-') + ext;
}

/**
 *
 * 형식: {date}-슬러지-{번호}.{ext}
 * ??   2026-04-01-슬러지-1.jpg
 *
 * @param {string} date   'YYYY-MM-DD'
 * @param {number} index  1부터 시작하는 일련번호
 * @param {string} [ext]       확장자 (기본 '.jpg')
 */
function sludgePhotoName(date, index = 1, ext = '.jpg') {
  return [date, '슬러지', String(index)].join('-') + ext;
}

/**
 * 현장 업무사진 통합 파일명
 * 형식: {date}_{현장명}_{업무항목}[순번].jpg
 */
function managementPhotoName(date, siteName, itemLabel, index = 0, ext = '.jpg') {
  const normalizedExt = String(ext || '.jpg').startsWith('.') ? String(ext || '.jpg') : `.${ext}`;
  const sequence = Number(index) > 0 ? String(Number(index)) : '';
  const parts = [date, sanitize(siteName), `${sanitize(itemLabel)}${sequence}`].filter(Boolean);
  return `${parts.join('_')}${normalizedExt.toLowerCase()}`;
}

// ─────────────────────────────────────────────────────────────────────
// 5. exports
// ─────────────────────────────────────────────────────────────────────
module.exports = {
  // 카테고리 상수 (폴더명 하드코딩 금지 — 반드시 이 상수 사용)
  DRIVE_CATEGORY,

  // 파일명 정리
  sanitize,

// ─────────────────────────────────────────────────────────────────────
  boardUploadsSegments,
  certificateFolderSegments,
  managementPhotoSegments,
  waterAnalysisPhotoSegments,
  medicinePhotoSegments,     // 향후 구현
  sludgePhotoSegments,       // 향후 구현

// ─────────────────────────────────────────────────────────────────────
  certificateFileName,
  managementPhotoName,
  waterAnalysisPhotoName,
  medicinePhotoName,         // 향후 구현
  sludgePhotoName,           // 향후 구현
};
