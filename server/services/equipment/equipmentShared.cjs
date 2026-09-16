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

function mechanicalProcessGroup(category1) {
  const process = String(category1 || '').trim();
  if (['침사조', '유량조정조'].includes(process)) return 1;
  if (['혐기조', '무산소조'].includes(process)) return 2;
  if (['포기조', '막분리조'].includes(process)) return 3;
  if (['침전조', '응집침전조'].includes(process)) return 4;
  if (['여과조', '소독조', '방류조'].includes(process)) return 5;
  return null;
}

function nextManagementNo(rows, prefix, category1 = '') {
  const group = prefix === 'M' ? mechanicalProcessGroup(category1) : null;
  let max = 0;
  rows.forEach(({ management_no: managementNo }) => {
    const match = UNIT_PATTERN.exec(String(managementNo || ''));
    const number = match ? Number(match[2]) : 0;
    if (match && match[1] === prefix && (!group || Math.floor(number / 100) === group)) {
      max = Math.max(max, number);
    }
  });
  const next = max > 0 ? max + 1 : (group ? group * 100 + 1 : 101);
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
  mechanicalProcessGroup,
  nextManagementNo,
  baseNumberOf,
};
