// 장비이력카드 ViewModel: 상태 관리와 비즈니스 로직을 담당한다.
// 데이터 접근은 EquipmentModel을 경유한다(Phase 2에 apiClient로 교체되어도 이 파일은 불변).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  is_visible: true,
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
  const [showHidden, setShowHidden] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState('history');
  const [equipmentEditor, setEquipmentEditor] = useState({
    open: false,
    draft: emptyEquipmentDraft(),
    initial: emptyEquipmentDraft(),
    managementNoTouched: false,
  });
  const [historyEditor, setHistoryEditor] = useState({ open: false, draft: null, initial: null });
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogChecks, setCatalogChecks] = useState({});
  const [catalogCounts, setCatalogCounts] = useState({});
  const [catalogQuery, setCatalogQuery] = useState('');
  const [customCatalogItems, setCustomCatalogItems] = useState([]);
  const [customDraft, setCustomDraft] = useState({ name: '', process: '', group: '' });
  const [photoUrls, setPhotoUrls] = useState({});
  const pendingPhotoRef = useRef(null);
  const [historyPhotoUrls, setHistoryPhotoUrls] = useState({});
  const [viewer, setViewer] = useState({ open: false, entryId: null, index: 0 });
  const [historyDraftPhotos, setHistoryDraftPhotos] = useState([]);
  const [saving, setSaving] = useState(false);

  const refreshPhotos = useCallback(async (list) => {
    const map = {};
    for (const item of list) {
      const blob = await EquipmentModel.loadEquipmentPhoto(item.id);
      if (blob) map[item.id] = URL.createObjectURL(blob);
    }
    setPhotoUrls((previous) => {
      Object.values(previous).forEach((url) => URL.revokeObjectURL(url));
      return map;
    });
  }, []);

  const refreshHistoryPhotos = useCallback(async (entries) => {
    await EquipmentModel.ensureHistorySeedPhotos();
    const map = {};
    for (const entry of entries) {
      const blobs = await EquipmentModel.loadHistoryPhotos(entry.id);
      if (blobs.length) map[entry.id] = blobs.map((blob) => URL.createObjectURL(blob));
    }
    setHistoryPhotoUrls((previous) => {
      Object.values(previous).flat().forEach((url) => URL.revokeObjectURL(url));
      return map;
    });
  }, []);

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
      await refreshPhotos(nextItems);
      await refreshHistoryPhotos(nextHistory);
    } catch (error) {
      setLoadError(error);
    } finally {
      setLoading(false);
    }
  }, [refreshPhotos, refreshHistoryPhotos]);

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
    return items.filter((item) => {
      // 목록 미표시(is_visible=false) 장비는 토글을 켜야 나타난다(첫 화면에는 주요 장비만).
      if (item.is_visible === false && !showHidden) return false;
      const matchesCategory = category === '전체' || item.category3 === category;
      if (!matchesCategory) return false;
      if (!keyword) return true;
      return [item.managementNo, item.name, item.location, item.category1, item.category3]
        .some((field) => String(field || '').toLowerCase().includes(keyword));
    });
  }, [items, query, category, showHidden]);

  const hiddenCount = useMemo(() => items.filter((item) => item.is_visible === false).length, [items]);

  const toggleShowHidden = useCallback(() => setShowHidden((previous) => !previous), []);

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

  // 선택은 명시적으로 선택한 ID로만 유지한다(검색·필터가 바뀌어도 다른 장비를 암묵 선택하지 않는다).
  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId],
  );

  // 선택한 장비가 현재 검색·필터 결과 밖에 있는 경우 목록에 안내한다.
  const selectedOutsideFilter = useMemo(() => {
    if (!selected) return false;
    return !filtered.some((item) => item.id === selected.id);
  }, [selected, filtered]);

  const clearFilters = useCallback(() => {
    setQuery('');
    setCategory('전체');
    setShowHidden(false);
  }, []);

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
    pendingPhotoRef.current = null;
    setEquipmentEditor({ open: true, draft, initial: { ...draft }, managementNoTouched: false });
  }, []);

  const openEditEquipment = useCallback((item) => {
    if (!item) return;
    const draft = { ...emptyEquipmentDraft(), ...item };
    setEquipmentEditor({ open: true, draft, initial: { ...draft }, managementNoTouched: true });
  }, []);

  const closeEquipmentEditor = useCallback(() => {
    if (saving) return;
    pendingPhotoRef.current = null;
    setEquipmentEditor({ open: false, draft: emptyEquipmentDraft(), initial: emptyEquipmentDraft(), managementNoTouched: false });
  }, [saving]);

  // 편집 중 대표사진 파일 선택: 저장 시 장비 id에 묶여 로컬 저장소에 반영된다.
  const setEquipmentDraftPhoto = useCallback((file) => {
    pendingPhotoRef.current = file;
    setEquipmentEditor((previous) => ({
      ...previous,
      draft: { ...previous.draft, photoName: file ? file.name : '' },
    }));
  }, []);

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
      // 편집 중 선택한 대표사진을 새(또는 기존) 장비 id에 저장한다.
      if (pendingPhotoRef.current) {
        await EquipmentModel.saveEquipmentPhoto(saved.id, pendingPhotoRef.current);
        pendingPhotoRef.current = null;
      }
      await load();
      setSelectedId(saved.id);
      setEquipmentEditor({ open: false, draft: emptyEquipmentDraft(), managementNoTouched: false });
      return saved;
    } finally {
      setSaving(false);
    }
  }, [equipmentEditor.draft, load]);

  const deleteEquipment = useCallback(async (id) => {
    // 인계 문서 §3 삭제 정책: 이력이 있는 장비는 삭제 차단(이력 보존), 이력 없는
    // 잘못 등록한 장비만 삭제한다.
    const hasHistory = historyEntries.some((entry) => entry.equipmentId === id);
    if (hasHistory) {
      throw new Error('이 장비에는 유지보수 이력이 있어 삭제할 수 없습니다.\n(이력이 있는 장비는 보존 대상입니다)');
    }
    setSaving(true);
    try {
      await EquipmentModel.deleteEquipment(id);
      await EquipmentModel.deleteEquipmentPhoto(id);
      setPhotoUrls((previous) => {
        if (previous[id]) URL.revokeObjectURL(previous[id]);
        const next = { ...previous };
        delete next[id];
        return next;
      });
      await load();
      setSelectedId(null);
    } finally {
      setSaving(false);
    }
  }, [historyEntries, load]);

  // 카드에서 사진 클릭 → 파일 선택 → 즉시 저장·교체 표시.
  const uploadEquipmentPhoto = useCallback(async (id, file) => {
    await EquipmentModel.saveEquipmentPhoto(id, file);
    setPhotoUrls((previous) => {
      if (previous[id]) URL.revokeObjectURL(previous[id]);
      return { ...previous, [id]: URL.createObjectURL(file) };
    });
  }, []);

  // 카드 상태 행 빠른 변경.
  const updateStatus = useCallback(async (id, status) => {
    await EquipmentModel.updateEquipmentStatus(id, status);
    await load();
  }, [load]);

  // ---- 사진 보기 (유지보수 내역 사진 칼럼) ----
  const openPhotoViewer = useCallback((entry) => {
    setViewer({ open: true, entryId: entry.id, index: 0 });
  }, []);

  const closePhotoViewer = useCallback(() => {
    setViewer({ open: false, entryId: null, index: 0 });
  }, []);

  const viewerSelect = useCallback((index) => {
    setViewer((previous) => ({ ...previous, index }));
  }, []);

  const viewerDelete = useCallback(async () => {
    const { entryId, index } = viewer;
    const remaining = await EquipmentModel.deleteHistoryPhotoAt(entryId, index);
    await load();
    setViewer((previous) => ({
      ...previous,
      index: remaining === 0 ? 0 : Math.min(previous.index, remaining - 1),
    }));
  }, [viewer, load]);

  const viewerAddFiles = useCallback(async (files) => {
    const { entryId } = viewer;
    const total = await EquipmentModel.appendHistoryPhotos(entryId, files);
    await load();
    setViewer((previous) => ({ ...previous, index: total - files.length }));
  }, [viewer, load]);

  const openCreateHistory = useCallback(() => {
    if (!selected) return;
    setHistoryDraftPhotos([]);
    const draft = emptyHistoryDraft(selected.id);
    setHistoryEditor({ open: true, draft, initial: { ...draft } });
  }, [selected]);

  const openEditHistory = useCallback((entry) => {
    setHistoryDraftPhotos([]);
    const draft = { ...emptyHistoryDraft(entry.equipmentId), ...entry };
    setHistoryEditor({ open: true, draft, initial: { ...draft } });
  }, []);

  const closeHistoryEditor = useCallback(() => {
    if (saving) return;
    setHistoryDraftPhotos([]);
    setHistoryEditor({ open: false, draft: null });
  }, [saving]);

  // 이력 편집 중 사진 여러 장 선택: 저장 시 함께 등록된다.
  const addHistoryDraftPhotos = useCallback((files) => {
    if (files.length) setHistoryDraftPhotos((previous) => [...previous, ...files]);
  }, []);

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
      // 편집 중 선택한 사진들을 이력 id에 묶어 저장한다(기존 사진에 추가).
      if (historyDraftPhotos.length) {
        await EquipmentModel.appendHistoryPhotos(saved.id, historyDraftPhotos);
        setHistoryDraftPhotos([]);
      }
      await load();
      setHistoryEditor({ open: false, draft: null });
      return saved;
    } finally {
      setSaving(false);
    }
  }, [historyEditor.draft, historyDraftPhotos, load]);

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
  // 제거 대상은 호기가 높은 카드부터이며, 이력 보유 여부를 함께 표시해
  // 삭제(이력 없음)와 숨김 전환(이력 보존)을 확인창에서 구분한다.
  const catalogDiff = useMemo(() => {
    const additions = [];
    const removals = [];
    let changeCount = 0;
    const historyIds = new Set(historyEntries.map((entry) => entry.equipmentId));
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
            info.units.forEach((unit) => removals.push({
              id: unit.id,
              number: `${item.name}(${unit.managementNo})`,
              hasHistory: historyIds.has(unit.id),
            }));
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
          sorted.slice(0, current - target).forEach((unit) => removals.push({
            id: unit.id,
            number: `${unit.name}(${unit.managementNo})`,
            hasHistory: historyIds.has(unit.id),
          }));
          changeCount += 1;
        }
      });
    });
    return { additions, removals, changeCount };
  }, [catalogGroups, catalogChecks, catalogCounts, registeredInfo, historyEntries]);

  const catalogChangeCount = catalogDiff.changeCount;
  const catalogRemovals = catalogDiff.removals;

  const applyCatalogChanges = useCallback(async () => {
    const { additions, removals } = catalogDiff;
    if (!additions.length && !removals.length) return { created: [], removed: 0, excluded: 0 };
    setSaving(true);
    try {
      // 인계 문서 §3 삭제 정책: 이력이 있는 장비는 삭제 대신 '숨김' 전환으로 이력을 보존한다.
      const deleteIds = removals.filter((unit) => !unit.hasHistory).map((unit) => unit.id);
      const excludeIds = removals.filter((unit) => unit.hasHistory).map((unit) => unit.id);
      let removed = 0;
      let excluded = 0;
      if (deleteIds.length) removed = await EquipmentModel.deleteEquipmentByIds(deleteIds);
      if (excludeIds.length) excluded = await EquipmentModel.excludeEquipment(excludeIds);
      const created = additions.length ? await EquipmentModel.addCatalogSelections(additions) : [];
      await load();
      setCatalogOpen(false);
      setCatalogChecks({});
      setCatalogCounts({});
      if (created.length) setSelectedId(created[0].id);
      return { created, removed, excluded };
    } finally {
      setSaving(false);
    }
  }, [catalogDiff, load]);

  // ---- 입력 보호: 편집 내용이 있으면 닫기 전에 확인한다(인계 문서 §3). ----
  const isEquipmentDirty = useCallback(() => {
    if (!equipmentEditor.open) return false;
    return JSON.stringify(equipmentEditor.draft) !== JSON.stringify(equipmentEditor.initial);
  }, [equipmentEditor]);

  const isHistoryDirty = useCallback(() => {
    if (!historyEditor.open || !historyEditor.draft) return false;
    return historyDraftPhotos.length > 0
      || JSON.stringify(historyEditor.draft) !== JSON.stringify(historyEditor.initial);
  }, [historyEditor, historyDraftPhotos]);

  const requestCloseEquipment = useCallback(async (confirmFn) => {
    if (!isEquipmentDirty()) {
      closeEquipmentEditor();
      return;
    }
    const confirmed = await confirmFn('입력한 내용이 저장되지 않았습니다.\n창을 닫을까요?', '닫기 확인');
    if (confirmed) {
      pendingPhotoRef.current = null;
      setEquipmentEditor({ open: false, draft: emptyEquipmentDraft(), initial: emptyEquipmentDraft(), managementNoTouched: false });
    }
  }, [isEquipmentDirty, closeEquipmentEditor]);

  const requestCloseHistory = useCallback(async (confirmFn) => {
    if (!isHistoryDirty()) {
      setHistoryDraftPhotos([]);
      setHistoryEditor({ open: false, draft: null, initial: null });
      return;
    }
    const confirmed = await confirmFn('입력한 내용이 저장되지 않았습니다.\n창을 닫을까요?', '닫기 확인');
    if (confirmed) {
      setHistoryDraftPhotos([]);
      setHistoryEditor({ open: false, draft: null, initial: null });
    }
  }, [isHistoryDirty]);

  return {
    // 데이터
    items, filtered, grouped, categories, historyEntries, workRecords,
    equipmentHistory, linkedWorkRecords, selected, stats,
    loading, loadError,
    // 이력 사진 + 뷰어
    historyPhotoUrls, viewer, openPhotoViewer, closePhotoViewer,
    viewerSelect, viewerDelete, viewerAddFiles, historyDraftPhotos, addHistoryDraftPhotos,
    // 목록 상태
    query, setQuery, category, setCategory, groupBy, setGroupBy, selectEquipment,
    showHidden, hiddenCount, toggleShowHidden,
    selectedOutsideFilter, clearFilters,
    // 대표사진
    photoUrls, uploadEquipmentPhoto, setEquipmentDraftPhoto,
    // 상태 빠른 변경
    updateStatus,
    // 입력 보호
    isEquipmentDirty, isHistoryDirty, requestCloseEquipment, requestCloseHistory,
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
    registeredInfo, catalogChangeCount, catalogRemovals,
    openCatalog, closeCatalog, toggleCatalogItem, setCatalogItemCount, setCatalogQuery,
    setCustomDraftField, addCustomCatalogItem, applyCatalogChanges,
    // 공통
    saving, reload: load,
  };
}

export default useEquipmentViewModel;
