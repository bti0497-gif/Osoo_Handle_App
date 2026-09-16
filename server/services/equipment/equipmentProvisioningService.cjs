/**
 * server/services/equipment/equipmentProvisioningService.cjs
 * 공법별 기본 설비 목록 1회 프로비저닝 (계획서 §3-4, §7 Phase 2-5).
 *
 * - 장비 목록이 비어 있고 공법(app_settings.method)이 A2O/MBR로 지정된 경우에만 채운다.
 * - 사용자가 만든 데이터를 덮어쓰지 않는다(이후는 순수 CRUD).
 * - 다중 대수 장비는 호기 단위 카드(교반기 A / 교반기 B, M-103A / M-103B)로 등록한다.
 */
const { uuid } = require('./equipmentShared.cjs');

const UNITS2 = ['A', 'B'];
const UNITS4 = ['A', 'B', 'C', 'D'];

function card(managementNo, category1, category2, name, extras = {}) {
  const category3 = (category2 === '계측기류' || category2 === '유량계') ? '계측기' : '기계';
  return {
    management_no: managementNo,
    category_1: category1,
    category_2: category2,
    category_3: category3,
    category_4: `${category1}${category3 === '계측기' ? '계측기시설' : '기계시설'}`,
    equipment_name: name,
    model: '',
    specification: '',
    unit: '대',
    quantity: 1,
    power: '',
    installed_at: '2020-10',
    vendor: '',
    location: category1,
    accessory: '',
    status: '사용 중',
    notes: '',
    ...extras,
  };
}

function unitCards(prefix, category1, category2, baseName, { managementNoBase, statusByUnit = {}, ...extras } = {}, letters = UNITS2) {
  return letters.map((letter) => card(
    `${managementNoBase}${letter}`,
    category1,
    category2,
    `${baseName} ${letter}`,
    { ...extras, status: statusByUnit[letter] || '사용 중' },
  ));
}

const COMMON_DEFS = () => [
  card('M-101', '침사조', '스크린류', '조목스크린', { model: '자동식 조목 스크린', power: '0.75 kW' }),
  card('M-102', '침사조', '스크린류', '드럼스크린', { model: '드럼형 스크린', power: '0.4 kW' }),
  card('FLT-101', '침사조', '유량계', '파샬플롬유량계', { model: '파샬플롬 + 초음파 수위식', accessory: '지시계 포함', notes: '유입유량 측정' }),
  ...unitCards(null, '유량조정조', '교반기류', '교반기', { managementNoBase: 'M-103', model: '수중 교반기', power: '1.5 kW', notes: '기본 2대 · 추가 시 C, D, E...' }),
  ...unitCards(null, '유량조정조', '펌프류', '원수펌프', { managementNoBase: 'M-104', model: '수중펌프', power: '2.2 kW', notes: '기본 2대 · 추가 시 C, D, E...' }),
  card('FLT-102', '유량조정조', '유량계', '유입유량계', { model: '전자유량계' }),
  ...unitCards(null, '포기조', '브로아류', '포기조브로아', { managementNoBase: 'M-301', model: '루츠 블로어', power: '7.5 kW', location: '송풍기실', accessory: '공기 여과기 포함', notes: '기본 2대 · 추가 시 C, D, E...' }),
  card('M-302', '포기조', '브로아류', '급기팬', { model: '환기팬', location: '기계실', notes: '밀폐공간 급기용' }),
  card('M-303', '포기조', '브로아류', '배기팬', { model: '환기팬', location: '기계실', notes: '밀폐공간 배기용' }),
  ...unitCards(null, '포기조', '펌프류', '내부반송펌프', { managementNoBase: 'M-304', model: '수중펌프', power: '2.2 kW', notes: '기본 2대 · 추가 시 C, D, E...' }),
  card('FLT-103', '포기조', '유량계', '내부반송유량계', { model: '전자유량계' }),
  card('DO-101', '포기조', '계측기류', 'DO계', { model: '막전극 용존산소계', specification: '0~20 mg/L' }),
  card('PH-101', '포기조', '계측기류', 'PH계', { model: '유리전극 pH계', specification: '0~14 pH' }),
  ...unitCards(null, '방류조', '펌프류', '방류펌프', { managementNoBase: 'M-501', model: '수중펌프', power: '2.2 kW', notes: '기본 2대 · 추가 시 C, D, E...' }),
  ...unitCards(null, '방류조', '펌프류', '중수펌프', { managementNoBase: 'M-502', model: '수중펌프', power: '1.5 kW', notes: '기본 2대 · 추가 시 C, D, E...' }),
  ...unitCards(null, '방류조', '펌프류', '역세펌프', { managementNoBase: 'M-503', model: '수중펌프', power: '1.5 kW', notes: '여과기 역세용 · 기본 2대' }),
  card('M-504', '방류조', '여과기', '여과기', { model: '모래여과기', accessory: '부속 펌프·밸브 포함' }),
  card('M-505', '방류조', '소독기류', 'UV 소독기', { model: '관류식 자외선 소독기', specification: '램프 4식', power: '0.8 kW', accessory: '램프·안정기 포함' }),
];

const A2O_ONLY_DEFS = () => [
  card('M-401', '침전조', '감속기', '감속기', { model: '중심구동 스크래퍼용', power: '0.75 kW', accessory: '스크래퍼 포함' }),
  ...unitCards(null, '침전조', '펌프류', '외부반송펌프', { managementNoBase: 'M-402', model: '수중펌프', power: '2.2 kW', notes: '기본 2대 · 추가 시 C, D, E...' }),
  card('FLT-104', '침전조', '유량계', '외부반송유량계', { model: '전자유량계' }),
  card('M-403', '응집침전조', '감속기', '감속기', { model: '중심구동 스크래퍼용', power: '0.75 kW', accessory: '스크래퍼 포함' }),
  card('M-404', '응집침전조', '탱크류', '응집제탱크', { model: 'PE 저장탱크', unit: '개', location: '약품실' }),
  card('M-405', '응집침전조', '약품펌프류', '응집제 주입펌프', { model: '정량 다이어프램 펌프', power: '0.1 kW', location: '약품실', notes: '예비 포함 시 추가 등록' }),
  card('M-406', '응집침전조', '탱크류', '폴리머탱크', { model: 'PE 저장탱크', unit: '개', location: '약품실', accessory: '교반기 포함' }),
  card('M-407', '응집침전조', '약품펌프류', '폴리머 주입펌프', { model: '정량 다이어프램 펌프', power: '0.1 kW', location: '약품실', notes: '예비 포함 시 추가 등록' }),
];

const MBR_ONLY_DEFS = () => [
  ...unitCards(null, '막분리조', '막분리', '막모듈', { managementNoBase: 'M-305', model: '침지형 평막 모듈', specification: '0.1 um 평막', unit: '식', accessory: '막 지지 프레임 포함', notes: '기본 4식 · 증설 시 추가 등록' }, UNITS4),
  ...unitCards(null, '막분리조', '펌프류', '흡인펌프', { managementNoBase: 'M-306', model: '자흡식 원심펌프', power: '1.5 kW', notes: '교대 운전 2대 · 추가 시 C, D, E...' }),
  card('M-307', '막분리조', '펌프류', '막세척펌프', { model: '정량 다이어프램 펌프', power: '0.4 kW', accessory: 'CIP 약액 라인 포함', notes: '화학세척(CIP)용' }),
  card('FLT-105', '막분리조', '유량계', '막분리유량계', { model: '전자유량계', notes: '처리수 유량 측정' }),
];

function createEquipmentProvisioningService(db) {
  function ensureProvisioned(siteId, siteName, method) {
    const normalized = String(method || '').toUpperCase();
    if (normalized !== 'A2O' && normalized !== 'MBR') return { provisioned: false, reason: 'method-not-supported' };
    const count = db.prepare('SELECT COUNT(*) AS count FROM equipment_assets WHERE site_id = ?').get(siteId).count;
    if (count > 0) return { provisioned: false, reason: 'already-has-equipment' };

    const defs = [
      ...COMMON_DEFS(),
      ...(normalized === 'MBR' ? MBR_ONLY_DEFS() : A2O_ONLY_DEFS()),
    ];
    const insert = db.prepare(`
      INSERT INTO equipment_assets (
        id, site_id, site_name, management_no, category_1, category_2, category_3, category_4,
        equipment_name, model, specification, unit, quantity, power, installed_at, vendor,
        location, accessory, status, is_visible, notes, author, created_at, last_modified, is_synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)
    `);
    db.transaction(() => {
      defs.forEach((def) => insert.run(
        uuid(), siteId, siteName, def.management_no, def.category_1, def.category_2,
        def.category_3, def.category_4, def.equipment_name, def.model, def.specification,
        def.unit, def.quantity, def.power, def.installed_at, def.vendor,
        def.location, def.accessory, def.status, def.notes,
      ));
    })();
    return { provisioned: true, count: defs.length };
  }

  return { ensureProvisioned };
}

module.exports = createEquipmentProvisioningService;
