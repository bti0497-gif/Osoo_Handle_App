/**
 * server/services/equipment/equipmentShared.cjs
 * 장비이력카드 서비스 공유 유틸 (관리번호 규칙 §3-6, 식별자 생성)
 */
const crypto = require('crypto');

// 관리번호 형식: 접두어-일련번호(호기 접미사 A~Z는 선택)
const UNIT_PATTERN = /^([A-Z]+)-(\d+)(?:[A-Z])?$/;

function uuid() {
  return crypto.randomUUID();
}

function managementNoPrefix(name, category2, category3) {
  const normalized = String(name || '');
  if (category2 === '유량계' || /유량계/.test(normalized)) return 'FLT';
  if (/수위계/.test(normalized)) return 'LIT';
  if (category2 === '계측기류' || category3 === '계측기') {
    const base = normalized.replace(/계$/, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return base || 'LT';
  }
  return 'M';
}

function nextManagementNo(rows, prefix) {
  let max = 0;
  rows.forEach(({ management_no: managementNo }) => {
    const match = UNIT_PATTERN.exec(String(managementNo || ''));
    if (match && match[1] === prefix) max = Math.max(max, Number(match[2]));
  });
  const next = max > 0 ? max + 1 : 101;
  return `${prefix}-${next}`;
}

function baseNumberOf(managementNo) {
  return String(managementNo || '').replace(/[A-Z]$/i, '');
}

class ServiceError extends Error {
  constructor(message, { status = 400, code = '' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

module.exports = {
  UNIT_PATTERN,
  ServiceError,
  uuid,
  managementNoPrefix,
  nextManagementNo,
  baseNumberOf,
};
