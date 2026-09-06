// 장비이력카드 ViewModel: 상태 관리와 비즈니스 로직을 담당한다.
// 데이터 접근은 EquipmentModel을 경유한다(Phase 2에 apiClient로 교체되어도 이 파일은 불변).
import { useCallback, useEffect, useMemo, useState } from 'react';
import EquipmentModel from './EquipmentModel';
import {
  EQUIPMENT_CATALOG,
  EQUIPMENT_PROCESS_ORDER,
  EQUIPMENT_TYPE_ORDER,
} from './equipmentPreviewData';

// 새 장비 폼의 구분 기본값: 카탈로그 순서의 첫 값을 쓴다(침사조/펌프류).

const GROUP_FIELD = { process: 'category1', type: 'category2' };
const GROUP_ORDER = { process: EQUIPMENT_PROCESS_ORDER, type: EQUIPMENT_TYPE_ORDER };

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const catalogKey = (group, item) => `${group}::${item.name}::${item.process}`;

const TODAY = () => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

export const emptyEquipmentDraft = () => ({
  id: '',
  managementNo: '',
  category1: EQUIPMENT_PROCESS_ORDER[0],
  category2: EQUIPMENT_TYPE_ORDER[0],
  category3: '기계',
  category4: '',
  name: '',
  model: '',
  specification: '',
  unit: '대',
  quantity: 1,
  power: '',
  installedAt: '',
  vendor: '',
  location: '',
  accessory: '',
  status: '사용 중',
  photoName: '',
  notes: '',
});

export const emptyHistoryDraft = (equipmentId) => ({
  id: '',
  equipmentId,
  date: TODAY(),
  completedAt: '',
  type: '정기점검',
  content: '',
  company: '',
  contact: '',
  price: '',
  photoName: '',
});

const byDateDesc = (a, b) => String(b.date || '').localeCompare(String(a.date || ''));

// processMethod: 기본설정(app_settings.method)에서 주입되는 공법 ('A2O' | 'MBR').
// 공법이 바뀌면 기본 설비 시드를 기준으로 목록을 다시 채운다.
export function useEquipmentViewModel({ processMethod = 'A2O' } = {}) {
  const [items, setItems] = useState([]);
  const [historyEntries, setHistoryEntries] = useState([]);
  const [workRecords, setWorkRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('전체');
  const [groupBy, setGroupBy] = useState('process');
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState('history');
  const [equipmentEditor, setEquipmentEditor] = useState({
    open: false,
    draft: emptyEquipmentDraft(),
    managementNoTouched: false,
  });
  const [historyEditor, setHistoryEditor] = useState({ open: false, draft: null });
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogChecks, setCatalogChecks] = useState({});
  const [catalogCounts, setCatalogCounts] = useState({});
  const [catalogQuery, setCatalogQuery] = useState('');
  const [customCatalogItems, setCustomCatalogItems] = useState([]);
  const [customDraft, setCustomDraft] = useState({ name: '', process: '', group: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [nextItems, nextHistory, nextWorkRecords] = await Promise.all([
        EquipmentModel.fetchEquipment(),
        EquipmentModel.fetchHistory(),
        EquipmentModel.fetchWorkRecords(),
      ]);
      setItems(nextItems);
      setHistoryEntries(nextHistory);
      setWorkRecords(nextWorkRecords);
    } catch (error) {
      setLoadError(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    EquipmentModel.setProcessMethod(processMethod);
    setCatalogChecks({});
    setCatalogCounts({});
    setCustomCatalogItems([]);
    setCustomDraft({ name: '', process: '', group: '' });
    load();
  }, [processMethod, load]);

  const categories = useMemo(() => {
    const unique = Array.from(new Set(items.map((item) => item.category3).filter(Boolean)));
    return ['전체', ...unique];
  }, [items]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword && category === '전체') return items;
    return items.filter((item) => {
      const matchesCategory = category === '전체' || item.category3 === category;
      if (!matchesCategory) return false;
      if (!keyword) return true;
      return [item.managementNo, item.name, item.location, item.category1, item.category3]
        .some((field) => String(field || '').toLowerCase().includes(keyword));
    });
  }, [items, query, category]);

  const grouped = useMemo(() => {
    const field = GROUP_FIELD[groupBy] || 'category1';
    const order = GROUP_ORDER[groupBy] || EQUIPMENT_PROCESS_ORDER;
    const buckets = new Map();
    filtered.forEach((item) => {
      const key = String(item[field] || '').trim() || '기타';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(item);
    });
    return Array.from(buckets.entries())
      .sort(([nameA], [nameB]) => {
        const indexA = order.indexOf(nameA);
        const indexB = order.indexOf(nameB);
        return (indexA < 0 ? order.length : indexA) - (indexB < 0 ? order.length : indexB)
          || nameA.localeCompare(nameB, 'ko');
      })
      .map(([name, groupItems]) => ({ name, items: groupItems }));
  }, [filtered, groupBy]);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) || filtered[0] || null,
    [items, selectedId, filtered],
  );

  const equipmentHistory = useMemo(
    () => historyEntries
      .filter((entry) => entry.equipmentId === selected?.id)
      .sort(byDateDesc),
    [historyEntries, selected],
  );

  const linkedWorkRecords = useMemo(
    () => workRecords
      .filter((record) => Array.isArray(record.equipmentIds) && record.equipmentIds.includes(selected?.id))
      .sort(byDateDesc),
    [workRecords, selected],
  );

  const stats = useMemo(() => {
    const currentYear = String(new Date().getFullYear());
    const totalCost = equipmentHistory.reduce((sum, entry) => sum + (Number(entry.price) || 0), 0);
    const yearCost = equipmentHistory
      .filter((entry) => String(entry.date || '').startsWith(currentYear))
      .reduce((sum, entry) => sum + (Number(entry.price) || 0), 0);
    const lastDate = equipmentHistory[0]?.date || '';
    return { historyCount: equipmentHistory.length, totalCost, yearCost, lastDate };
  }, [equipmentHistory]);

  const selectEquipment = useCallback((id) => {
    setSelectedId(id);
    setTab('history');
  }, []);

  const openCreateEquipment = useCallback(() => {
    const draft = emptyEquipmentDraft();
    // 관리번호는 명명규칙에 따라 자동 부여해 시작한다(사용자가 고치면 그때부터 수동).
    draft.managementNo = EquipmentModel.nextManagementNoFor('', undefined, draft.category3);
    setEquipmentEditor({ open: true, draft, managementNoTouched: false });
  }, []);

  const openEditEquipment = useCallback((item) => {
    if (!item) return;
    setEquipmentEditor({ open: true, draft: { ...emptyEquipmentDraft(), ...item }, managementNoTouched: true });
  }, []);

  const closeEquipmentEditor = useCallback(() => {
    if (saving) return;
    setEquipmentEditor({ open: false, draft: emptyEquipmentDraft(), managementNoTouched: false });
  }, [saving]);

  const setEquipmentDraftField = useCallback((field, value) => {
    setEquipmentEditor((previous) => {
      const draft = { ...previous.draft, [field]: value };
      const touched = field === 'managementNo' ? true : previous.managementNoTouched;
      // 사용자가 직접 고치기 전까지는 이름/구분(종류)에 맞춰 관리번호를 자동으로 따라가게 한다.
      if (!touched && (field === 'name' || field === 'category2' || field === 'category3')) {
        draft.managementNo = EquipmentModel.nextManagementNoFor(draft.name, draft.category2, draft.category3);
      }
      return { ...previous, draft, managementNoTouched: touched };
    });
  }, []);

  const saveEquipment = useCallback(async () => {
    const draft = equipmentEditor.draft;
    if (!String(draft.managementNo || '').trim()) throw new Error('관리번호를 입력해 주세요.');
    if (!String(draft.name || '').trim()) throw new Error('설비명을 입력해 주세요.');
    setSaving(true);
    try {
      const saved = await EquipmentModel.saveEquipment(draft);
      await load();
      setSelectedId(saved.id);
      setEquipmentEditor({ open: false, draft: emptyEquipmentDraft() });
      return saved;
    } finally {
      setSaving(false);
    }
  }, [equipmentEditor.draft, load]);

  const deleteEquipment = useCallback(async (id) => {
    setSaving(true);
    try {
      await EquipmentModel.deleteEquipment(id);
      await load();
      setSelectedId(null);
    } finally {
      setSaving(false);
    }
  }, [load]);

  const openCreateHistory = useCallback(() => {
    if (!selected) return;
    setHistoryEditor({ open: true, draft: emptyHistoryDraft(selected.id) });
  }, [selected]);

  const openEditHistory = useCallback((entry) => {
    setHistoryEditor({ open: true, draft: { ...emptyHistoryDraft(entry.equipmentId), ...entry } });
  }, []);

  const closeHistoryEditor = useCallback(() => {
    if (saving) return;
    setHistoryEditor({ open: false, draft: null });
  }, [saving]);

  const setHistoryDraftField = useCallback((field, value) => {
    setHistoryEditor((previous) => (
      previous.draft ? { ...previous, draft: { ...previous.draft, [field]: value } } : previous
    ));
  }, []);

  const saveHistoryEntry = useCallback(async () => {
    const draft = historyEditor.draft;
    if (!draft) return null;
    if (!String(draft.date || '').trim()) throw new Error('발생일을 입력해 주세요.');
    if (!String(draft.content || '').trim()) throw new Error('수리·공사 내용을 입력해 주세요.');
    setSaving(true);
    try {
      const saved = await EquipmentModel.saveHistoryEntry(draft);
      await load();
      setHistoryEditor({ open: false, draft: null });
      return saved;
    } finally {
      setSaving(false);
    }
  }, [historyEditor.draft, load]);

  const deleteHistoryEntry = useCallback(async (id) => {
    setSaving(true);
    try {
      await EquipmentModel.deleteHistoryEntry(id);
      await load();
    } finally {
      setSaving(false);
    }
  }, [load]);

  // ---- 장비 추가 카탈로그 ----

  // 카탈로그 항목의 현재 등록 상태: 호기 없는 단일 등록과 '이름 A' 호기 등록을 함께 센다.
  // units는 목록에 실제로 존재하는 카드(관리번호 표시·제거 단위).
  const registeredInfo = useCallback((entry) => {
    const pattern = new RegExp(`^${escapeRegExp(entry.name)}(?: ([A-Z]))?$`);
    const matched = items
      .filter((item) => item.category1 === entry.process && pattern.test(item.name))
      .map((item) => ({ id: item.id, name: item.name, managementNo: item.managementNo }));
    return { count: matched.length, units: matched, numbers: matched.map((unit) => unit.managementNo) };
  }, [items]);

  const catalogGroups = useMemo(() => {
    const keyword = catalogQuery.trim().toLowerCase();
    return EQUIPMENT_CATALOG
      .map((group) => ({
        ...group,
        items: [
          ...group.items.filter((item) => !item.methods || item.methods.includes(processMethod)),
          ...customCatalogItems.filter((item) => item.group === group.group),
        ].map((item) => ({ ...item, key: catalogKey(group.group, item) })),
      }))
      .map((group) => (keyword ? {
        ...group,
        items: group.items.filter((item) => (
          [item.name, item.process, group.group]
            .some((field) => String(field || '').toLowerCase().includes(keyword))
        )),
      } : group))
      .filter((group) => group.items.length > 0);
  }, [processMethod, customCatalogItems, catalogQuery]);

  // 카탈로그를 열 때 현재 목록 상태를 체크에 반영한다(체크=사용 중, 해제=목록에서 제거).
  const openCatalog = useCallback(() => {
    const checks = {};
    const counts = {};
    const allEntries = EQUIPMENT_CATALOG.flatMap((group) => group.items.map((item) => ({ group: group.group, item, countable: Boolean(group.supportsCount) })));
    customCatalogItems.forEach((item) => {
      allEntries.push({ group: item.group, item, countable: false });
    });
    allEntries.forEach(({ group, item, countable }) => {
      const info = registeredInfo({ name: item.name, process: item.process });
      if (info.count > 0) {
        checks[catalogKey(group, item)] = true;
        if (countable) counts[catalogKey(group, item)] = info.count;
      }
    });
    setCatalogChecks(checks);
    setCatalogCounts(counts);
    setCatalogQuery('');
    setCatalogOpen(true);
  }, [customCatalogItems, registeredInfo]);

  const closeCatalog = useCallback(() => {
    if (saving) return;
    setCatalogOpen(false);
  }, [saving]);

  const toggleCatalogItem = useCallback((group, item) => {
    const key = catalogKey(group, item);
    setCatalogChecks((previous) => ({ ...previous, [key]: !previous[key] }));
  }, []);

  const setCatalogItemCount = useCallback((group, item, count) => {
    const key = catalogKey(group, item);
    setCatalogCounts((previous) => ({ ...previous, [key]: Math.max(1, Number(count) || 1) }));
  }, []);

  const setCustomDraftField = useCallback((field, value) => {
    setCustomDraft((previous) => ({ ...previous, [field]: value }));
  }, []);

  const addCustomCatalogItem = useCallback(() => {
    const name = String(customDraft.name || '').trim();
    const process = String(customDraft.process || '').trim();
    const group = String(customDraft.group || '').trim();
    if (!name || !process || !group) {
      throw new Error('이름, 공정, 종류를 모두 선택해 주세요.');
    }
    const entry = { name, process, group, custom: true };
    setCustomCatalogItems((previous) => (
      previous.some((item) => item.name === name && item.process === process)
        ? previous
        : [...previous, entry]
    ));
    setCatalogChecks((previous) => ({ ...previous, [catalogKey(group, entry)]: true }));
    setCustomDraft({ name: '', process, group });
  }, [customDraft]);

  // 체크(사용) ↔ 목록 상태의 차이를 계산한다. 개수형은 스테퍼 값이 '원하는 대수'다.
  const catalogDiff = useMemo(() => {
    const additions = [];
    const removalIds = [];
    const removalNames = [];
    let changeCount = 0;
    catalogGroups.forEach((group) => {
      group.items.forEach((item) => {
        const info = registeredInfo(item);
        const current = info.count;
        const checked = Boolean(catalogChecks[item.key]);
        const countable = Boolean(group.supportsCount);
        if (!countable) {
          if (checked && current === 0) {
            additions.push({ entry: { name: item.name, process: item.process, group: group.group, category3: item.category3 }, count: 1 });
            changeCount += 1;
          }
          if (!checked && current > 0) {
            removalIds.push(...info.units.map((unit) => unit.id));
            removalNames.push(item.name);
            changeCount += 1;
          }
          return;
        }
        const target = checked ? Math.max(1, Number(catalogCounts[item.key]) || current || 1) : 0;
        if (target > current) {
          additions.push({ entry: { name: item.name, process: item.process, group: group.group, category3: item.category3 }, count: target - current });
          changeCount += 1;
        }
        if (target < current) {
          // 줄일 때는 호기가 높은 카드부터 제거한다.
          const sorted = [...info.units].sort((a, b) => b.name.localeCompare(a.name, 'en'));
          removalIds.push(...sorted.slice(0, current - target).map((unit) => unit.id));
          if (target === 0) removalNames.push(item.name);
          changeCount += 1;
        }
      });
    });
    return { additions, removalIds, removalNames, changeCount };
  }, [catalogGroups, catalogChecks, catalogCounts, registeredInfo]);

  const catalogChangeCount = catalogDiff.changeCount;
  const catalogRemovalNames = catalogDiff.removalNames;

  const applyCatalogChanges = useCallback(async () => {
    const { additions, removalIds } = catalogDiff;
    if (!additions.length && !removalIds.length) return { created: [], removed: 0 };
    setSaving(true);
    try {
      let removed = 0;
      if (removalIds.length) removed = await EquipmentModel.deleteEquipmentByIds(removalIds);
      const created = additions.length ? await EquipmentModel.addCatalogSelections(additions) : [];
      await load();
      setCatalogOpen(false);
      setCatalogChecks({});
      setCatalogCounts({});
      if (created.length) setSelectedId(created[0].id);
      return { created, removed };
    } finally {
      setSaving(false);
    }
  }, [catalogDiff, load]);

  return {
    // 데이터
    items, filtered, grouped, categories, historyEntries, workRecords,
    equipmentHistory, linkedWorkRecords, selected, stats,
    loading, loadError,
    // 목록 상태
    query, setQuery, category, setCategory, groupBy, setGroupBy, selectEquipment,
    // 카드 상태
    tab, setTab,
    // 장비 편집기
    equipmentEditor, openCreateEquipment, openEditEquipment, closeEquipmentEditor,
    setEquipmentDraftField, saveEquipment, deleteEquipment,
    // 이력 편집기
    historyEditor, openCreateHistory, openEditHistory, closeHistoryEditor,
    setHistoryDraftField, saveHistoryEntry, deleteHistoryEntry,
    // 장비 추가 카탈로그
    catalogOpen, catalogGroups, catalogChecks, catalogCounts, catalogQuery, customDraft,
    registeredInfo, catalogChangeCount, catalogRemovalNames,
    openCatalog, closeCatalog, toggleCatalogItem, setCatalogItemCount, setCatalogQuery,
    setCustomDraftField, addCustomCatalogItem, applyCatalogChanges,
    // 공통
    saving, reload: load,
  };
}

export default useEquipmentViewModel;
