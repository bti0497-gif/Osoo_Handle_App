// 장비이력카드 데이터 모델.
// Phase 1(현재): 서버 라우트가 없으므로 모듈 메모리 스토어로 동작한다.
//   공법(기본설정 app_settings.method와 동일 값: 'A2O' | 'MBR')에 따라
//   기본 설비 시드에서 목록을 채우고, 앱 세션 동안은 변경이 유지되며 새로고침 시 초기화된다.
// Phase 2: 각 메서드 내부를 apiClient 호출로 교체한다. 메서드 시그니처는 불변이며
//   ViewModel/View는 수정 없이 그대로 사용한다. (docs/EQUIPMENT_CARD_DEVELOPMENT_PLAN.md §5)
//   공법별 기본 목록은 최초 프로비저닝(시드 1회 적용)으로만 사용하고 이후는 사용자 CRUD가 기준.
import {
  EQUIPMENT_HISTORY_SEEDS,
  EQUIPMENT_SEEDS,
  WORK_RECORD_SEEDS,
} from './equipmentPreviewData';

const clone = (list) => list.map((item) => ({ ...item }));
const normalizeMethod = (method) => (
  Object.prototype.hasOwnProperty.call(EQUIPMENT_SEEDS, String(method || '').toUpperCase())
    ? String(method).toUpperCase()
    : 'A2O'
);

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 카탈로그 항목의 현재 등록 상태: 호기 없는 단일 등록이면 1대, '이름 A' 패턴이면 그 대수.
const countRegisteredUnits = (name, process) => {
  const exact = equipmentStore.some((item) => item.name === name && item.category1 === process);
  const unitPattern = new RegExp(`^${escapeRegExp(name)} ([A-Z])$`);
  const letters = equipmentStore
    .filter((item) => item.category1 === process && unitPattern.test(item.name))
    .map((item) => unitPattern.exec(item.name)[1]);
  if (!exact && letters.length === 0) return 0;
  return Math.max(letters.length, exact ? 1 : 0);
};

// 관리번호 접두어 규칙 (2026-09-06 사용자 확정):
// 유량계 → FLT, 수위계측기 → LIT, 계측기(DO/PH/MLSS계 등) → 계측기명 기반 접두어, 그 외 기계설비 → M
const managementNoPrefix = (name, category2, category3) => {
  const normalizedName = String(name || '');
  if (category2 === '유량계' || /유량계/.test(normalizedName)) return 'FLT';
  if (/수위계/.test(normalizedName)) return 'LIT';
  if (category2 === '계측기류' || category3 === '계측기') {
    const base = normalizedName.replace(/계$/, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return base || 'LT';
  }
  return 'M';
};

// 다음 관리번호: 접두어별 기존 최대 일련번호 + 1 (예: M-118 사용 중 → M-119).
// 새 접두어의 첫 번호는 101로 시작해 기존 번호체계와 맞춘다.
// 호기 접미사가 붙은 번호(M-103A 등)는 일련번호 계산에서 제외한다.
const nextManagementNo = (name, category2, category3) => {
  const prefix = managementNoPrefix(name, category2, category3);
  let max = 0;
  equipmentStore.forEach((item) => {
    const match = /^([A-Z]+)-(\d+)$/.exec(String(item.managementNo || ''));
    if (match && match[1] === prefix) max = Math.max(max, Number(match[2]));
  });
  const next = max > 0 ? max + 1 : 101;
  return `${prefix}-${String(next)}`;
};

let currentMethod = 'A2O';
let equipmentStore = clone(EQUIPMENT_SEEDS.A2O);
let historyStore = clone(EQUIPMENT_HISTORY_SEEDS.A2O);
let workRecordStore = clone(WORK_RECORD_SEEDS.A2O);

const delay = (ms = 140) => new Promise((resolve) => setTimeout(resolve, ms));
const nextId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export const EquipmentModel = {
  previewMode: true,
  processMethod: currentMethod,

  // 기본설정에서 넘어온 공법으로 스토어를 다시 채운다(공법 변경 시 기존 편집 내용은 초기화).
  setProcessMethod(method) {
    currentMethod = normalizeMethod(method);
    equipmentStore = clone(EQUIPMENT_SEEDS[currentMethod]);
    historyStore = clone(EQUIPMENT_HISTORY_SEEDS[currentMethod]);
    workRecordStore = clone(WORK_RECORD_SEEDS[currentMethod]);
    this.processMethod = currentMethod;
    return currentMethod;
  },

  async fetchEquipment() {
    await delay();
    return equipmentStore.map((item) => ({ ...item }));
  },

  async fetchHistory() {
    await delay();
    return historyStore.map((item) => ({ ...item }));
  },

  async fetchWorkRecords() {
    await delay();
    return workRecordStore.map((item) => ({ ...item }));
  },

  async saveEquipment(item) {
    await delay();
    const normalized = {
      ...item,
      quantity: Number(item.quantity) || 1,
      managementNo: String(item.managementNo || '').trim(),
      name: String(item.name || '').trim(),
    };
    const duplicate = equipmentStore.some(
      (existing) => existing.managementNo === normalized.managementNo && existing.id !== normalized.id,
    );
    if (duplicate) {
      throw new Error('이미 등록된 관리번호입니다. 관리번호를 변경해 주세요.');
    }
    if (normalized.id) {
      equipmentStore = equipmentStore.map((existing) => (
        existing.id === normalized.id ? { ...normalized } : existing
      ));
      return { ...normalized };
    }
    const saved = { ...normalized, id: nextId('equipment') };
    equipmentStore = [...equipmentStore, saved];
    return { ...saved };
  },

  // (공개) 규칙 기반 다음 관리번호 조회 — 직접 입력 양식의 자동채번 표시용.
  nextManagementNoFor(name, category2, category3) {
    return nextManagementNo(name, category2, category3);
  },

  // 카탈로그 체크 등록: 개수형 항목은 기존 호기 다음부터 A, B, C...로 이어서 생성한다.
  // selections: [{ entry: {name, process, group, category3?}, count: n }]
  async addCatalogSelections(selections) {
    await delay();
    const created = [];
    selections.forEach(({ entry, count }) => {
      const registered = countRegisteredUnits(entry.name, entry.process);
      const wanted = Math.max(1, Number(count) || 1);
      const category3 = entry.category3
        || ((entry.group === '계측기류' || entry.group === '유량계') ? '계측기' : '기계');
      const unitPattern = new RegExp(`^${escapeRegExp(entry.name)} ([A-Z])$`);
      let baseNo = null;
      const existingUnit = equipmentStore.find((item) => (
        item.category1 === entry.process
        && (item.name === entry.name || unitPattern.test(item.name))
      ));
      if (existingUnit) {
        baseNo = String(existingUnit.managementNo).replace(/[A-Z]$/i, '');
      } else {
        baseNo = nextManagementNo(entry.name, entry.group, category3);
      }
      for (let index = 0; index < wanted; index += 1) {
        // 첫 등록 1대는 호기 없이, 그 외에는 기존 호기 다음 글자로 이어서 이름 붙인다.
        const isFirstSingle = registered === 0 && wanted === 1 && index === 0;
        const letter = isFirstSingle
          ? null
          : String.fromCharCode(65 + (registered === 0 ? index : registered + index));
        const saved = {
          id: nextId('equipment'),
          managementNo: isFirstSingle ? baseNo : `${baseNo}${letter}`,
          category1: entry.process,
          category2: entry.group,
          category3,
          category4: `${entry.process}${category3 === '계측기' ? '계측기시설' : '기계시설'}`,
          name: isFirstSingle ? entry.name : `${entry.name} ${letter}`,
          model: '',
          specification: '',
          unit: '대',
          quantity: 1,
          power: '',
          installedAt: '',
          vendor: '',
          location: entry.process,
          accessory: '',
          status: '사용 중',
          notes: '',
        };
        equipmentStore = [...equipmentStore, saved];
        created.push({ ...saved });
      }
    });
    return created;
  },

  async deleteEquipment(id) {
    await delay();
    equipmentStore = equipmentStore.filter((existing) => existing.id !== id);
    historyStore = historyStore.filter((entry) => entry.equipmentId !== id);
    return true;
  },

  // 카탈로그 체크 해제(목록 제거)용: 여러 장비를 한 번에 제거하고 연결된 이력도 정리한다.
  async deleteEquipmentByIds(ids) {
    await delay();
    const idSet = new Set(ids);
    equipmentStore = equipmentStore.filter((item) => !idSet.has(item.id));
    historyStore = historyStore.filter((entry) => !idSet.has(entry.equipmentId));
    return ids.length;
  },

  async saveHistoryEntry(entry) {
    await delay();
    const normalized = {
      ...entry,
      date: String(entry.date || '').trim(),
      completedAt: String(entry.completedAt || '').trim(),
      type: String(entry.type || '기타').trim(),
      content: String(entry.content || '').trim(),
      price: Number(entry.price) || 0,
    };
    if (normalized.id) {
      historyStore = historyStore.map((existing) => (
        existing.id === normalized.id ? { ...normalized } : existing
      ));
      return { ...normalized };
    }
    const saved = { ...normalized, id: nextId('history'), photoCount: Number(entry.photoCount) || 0 };
    historyStore = [...historyStore, saved];
    return { ...saved };
  },

  async deleteHistoryEntry(id) {
    await delay();
    historyStore = historyStore.filter((existing) => existing.id !== id);
    return true;
  },
};

export default EquipmentModel;
