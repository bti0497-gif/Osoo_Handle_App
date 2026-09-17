// 장비이력카드 ViewModel: 상태 관리와 비즈니스 로직을 담당한다.
// 데이터는 EquipmentModel(apiClient)을 경유하며, 사진 URL은 정적 마운트 상대경로다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiBase } from '../../core/api/serverConfig.js';
import EquipmentModel from './EquipmentModel';
import {
  EQUIPMENT_CATALOG,
  EQUIPMENT_PROCESS_ORDER,
  EQUIPMENT_TYPE_ORDER,
} from './equipmentPreviewData';

const GROUP_FIELD = { process: 'category1', type: 'category2' };
const GROUP_ORDER = { process: EQUIPMENT_PROCESS_ORDER, type: EQUIPMENT_TYPE_ORDER };

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const catalogKey = (group, item) => `${group}::${item.name}::${item.process}`;

// 관리번호 채번 규칙(§3-6)의 클라이언트 사전 표시용 계산.
// 최종 번호는 저장 시 서버가 결정/검증한다.
const UNIT_PATTERN = /^([A-Z]+)-(\d+)(?:[A-Z])?$/;

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
  if (['침사조', '유량조정조'].includes(category1)) return 1;
  if (['혐기조', '무산소조'].includes(category1)) return 2;
  if (['포기조', '막분리조'].includes(category1)) return 3;
  if (['침전조', '응집침전조'].includes(category1)) return 4;
  if (['여과조', '소독조', '방류조'].includes(category1)) return 5;
  return null;
}

function estimateNextManagementNo(items, name, category1, category2, category3) {
  const prefix = managementNoPrefix(name, category2, category3);
  const group = prefix === 'M' ? mechanicalProcessGroup(category1) : null;
  let max = 0;
  items.forEach((item) => {
    const match = UNIT_PATTERN.exec(String(item.managementNo || item.management_no || ''));
    const number = match ? Number(match[2]) : 0;
    if (match && match[1] === prefix && (!group || Math.floor(number / 100) === group)) max = Math.max(max, number);
  });
  const next = max > 0 ? max + 1 : (group ? group * 100 + 1 : 101);
  return `${prefix}-${next}`;
}

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
  model: '',
  specification: '',
  power: '',
  installedAt: '',
  vendor: '',
  location: '',
  accessory: '',
  status: '사용 중',
  is_visible: true,
  notes: '',
  photoName: '',
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

const normalizeEquipment = (item) => ({
  ...item,
  managementNo: item.managementNo || item.management_no,
  name: item.name || item.equipment_name,
  category1: item.category1 || item.category_1,
  category2: item.category2 || item.category_2,
  category3: item.category3 || item.category_3,
  category4: item.category4 || item.category_4,
  installedAt: item.installedAt || item.installed_at,
});

// processMethod: 기본설정(app_settings.method)에서 주입되는 공법('A2O'|'MBR').
// 서버가 기본 설비 목록을 프로비저닝하므로 이 훅은 값을 조회해 표시만 한다.
export function useEquipmentViewModel() {
  const [items, setItems] = useState([]);
  const [historyEntries, setHistoryEntries] = useState([]);
  const [workRecords, setWorkRecords] = useState([]);
  const [processMethod, setProcessMethod] = useState('A2O');
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
  const [historyPhotoUrls, setHistoryPhotoUrls] = useState({});
  const [viewer, setViewer] = useState({ open: false, entryId: null, index: 0, workTitle: '', items: [] });
  const [historyDraftPhotos, setHistoryDraftPhotos] = useState([]);
  const pendingPhotoRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const toServerPhotoUrl = useCallback((url) => {
    if (!url || /^(?:https?:|data:|blob:)/i.test(url)) return url || '';
    return `${getApiBase()}${url.startsWith('/') ? '' : '/'}${url}`;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [nextItems, nextHistory, meta] = await Promise.all([
        EquipmentModel.fetchEquipment(),
        EquipmentModel.fetchHistory(),
        EquipmentModel.fetchMeta(),
      ]);
      setProcessMethod(String(meta?.method || 'A2O').toUpperCase());
      const normalizedItems = nextItems.map(normalizeEquipment);
      setItems(normalizedItems);
      setHistoryEntries(nextHistory);
      const urlMap = {};
      normalizedItems.forEach((item) => {
        if (Number(item.photo_count) > 0 && item.main_photo_url) {
          // 개발(vite 포트)·설치앱(file://) 모두 API 서버 원본을 가리키도록 절대 URL로 조합
          urlMap[item.id] = toServerPhotoUrl(item.main_photo_url);
        }
      });
      setPhotoUrls(urlMap);
      const historyUrlMap = {};
      await Promise.all(nextHistory.map(async (entry) => {
        const rows = await EquipmentModel.loadHistoryPhotos(entry.id);
        if (rows.length) {
          historyUrlMap[entry.id] = rows.map((photo) => ({
            ...photo,
            url: toServerPhotoUrl(photo.url),
          }));
        }
      }));
      setHistoryPhotoUrls(historyUrlMap);
      setSelectedId((current) => (current && normalizedItems.some((item) => item.id === current) ? current : null));
    } catch (error) {
      setLoadError(error);
    } finally {
      setLoading(false);
    }
  }, [toServerPhotoUrl]);

  useEffect(() => { load(); }, [load]);

  const categories = useMemo(() => {
    const unique = Array.from(new Set(items.map((item) => item.category3).filter(Boolean)));
    return ['전체', ...unique];
  }, [items]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return items.filter((item) => {
      // 목록 미표시(is_visible=0) 장비는 토글을 켜야 나타난다(첫 화면에는 주요 장비만).
      if (Number(item.is_visible) === 0 && !showHidden) return false;
      const matchesCategory = category === '전체' || item.category3 === category;
      if (!matchesCategory) return false;
      if (!keyword) return true;
      return [item.managementNo || item.management_no, item.name || item.equipment_name, item.location, item.category1 || item.category_1, item.category3]
        .some((field) => String(field || '').toLowerCase().includes(keyword));
    });
  }, [items, query, category, showHidden]);

  const hiddenCount = useMemo(() => items.filter((item) => Number(item.is_visible) === 0).length, [items]);

  const toggleShowHidden = useCallback(() => setShowHidden((previous) => !previous), []);

  const clearFilters = useCallback(() => {
    setQuery('');
    setCategory('전체');
    setShowHidden(false);
  }, []);

  // 선택은 명시적으로 선택한 ID로만 유지한다(검색·필터가 바뀌어도 다른 장비를 암묵 선택하지 않는다).
  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId],
  );

  const selectedOutsideFilter = useMemo(() => {
    if (!selected) return false;
    return !filtered.some((item) => item.id === selected.id);
  }, [selected, filtered]);

  const normalizedItem = useCallback((item) => normalizeEquipment(item), []);

  const grouped = useMemo(() => {
    const field = GROUP_FIELD[groupBy] || 'category1';
    const order = GROUP_ORDER[groupBy] || EQUIPMENT_PROCESS_ORDER;
    const buckets = new Map();
    filtered.forEach((raw) => {
      const item = normalizedItem(raw);
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
  }, [filtered, groupBy, normalizedItem]);

  const selectedNormalized = useMemo(
    () => (selected ? normalizedItem(selected) : null),
    [selected, normalizedItem],
  );

  // 선택한 장비에 연결된 업무기록(업무사진관리)을 조회한다.
  useEffect(() => {
    let cancelled = false;
    if (!selected?.id) {
      setWorkRecords([]);
      return () => { cancelled = true; };
    }
    EquipmentModel.fetchWorkRecords(selected.id)
      .then((rows) => { if (!cancelled) setWorkRecords(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setWorkRecords([]); });
    return () => { cancelled = true; };
  }, [selected?.id]);

  const equipmentHistory = useMemo(
    () => historyEntries
      .filter((entry) => entry.equipment_id === selected?.id)
      .sort(byDateDesc),
    [historyEntries, selected],
  );

  const linkedWorkRecords = useMemo(
    () => [...workRecords].sort(byDateDesc),
    [workRecords],
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

  // ---- 장비 편집 ----
  const openCreateEquipment = useCallback(() => {
    const draft = emptyEquipmentDraft();
    draft.managementNo = estimateNextManagementNo(items, '', draft.category1, draft.category2, draft.category3);
    pendingPhotoRef.current = null;
    setEquipmentEditor({ open: true, draft, initial: { ...draft }, managementNoTouched: false });
  }, [items]);

  const openEditEquipment = useCallback((item) => {
    if (!item) return;
    const draft = { ...emptyEquipmentDraft(), ...normalizedItem(item) };
    setEquipmentEditor({ open: true, draft, initial: { ...draft }, managementNoTouched: true });
  }, [normalizedItem]);

  const closeEquipmentEditor = useCallback(() => {
    if (saving) return;
    pendingPhotoRef.current = null;
    setEquipmentEditor({ open: false, draft: emptyEquipmentDraft(), initial: emptyEquipmentDraft(), managementNoTouched: false });
  }, [saving]);

  const setEquipmentDraftField = useCallback((field, value) => {
    setEquipmentEditor((previous) => {
      const draft = { ...previous.draft, [field]: value };
      const touched = field === 'managementNo' ? true : previous.managementNoTouched;
      // 사용자가 직접 고치기 전까지는 이름/구분에 맞춰 관리번호를 자동으로 따라가게 한다.
      if (!touched && (field === 'name' || field === 'category1' || field === 'category2' || field === 'category3')) {
        draft.managementNo = estimateNextManagementNo(items, draft.name, draft.category1, draft.category2, draft.category3);
      }
      return { ...previous, draft, managementNoTouched: touched };
    });
  }, [items]);

  const setEquipmentDraftPhoto = useCallback((file) => {
    pendingPhotoRef.current = file;
    setEquipmentEditor((previous) => ({
      ...previous,
      draft: { ...previous.draft, photoName: file ? file.name : '' },
    }));
  }, []);

  const saveEquipment = useCallback(async () => {
    const draft = equipmentEditor.draft;
    if (!String(draft.managementNo || '').trim()) throw new Error('관리번호를 입력해 주세요.');
    if (!String(draft.name || '').trim()) throw new Error('설비명을 입력해 주세요.');
    setSaving(true);
    try {
      const saved = await EquipmentModel.saveEquipment(draft);
      // 편집 중 선택한 대표사진을 저장한다(새 장비라도 id가 발급된 뒤에).
      if (pendingPhotoRef.current) {
        await EquipmentModel.uploadEquipmentPhoto(saved.id, pendingPhotoRef.current);
        pendingPhotoRef.current = null;
      }
      await load();
      setSelectedId(saved.id);
      setEquipmentEditor({ open: false, draft: emptyEquipmentDraft(), initial: emptyEquipmentDraft(), managementNoTouched: false });
      return saved;
    } finally {
      setSaving(false);
    }
  }, [equipmentEditor.draft, load]);

  const deleteEquipment = useCallback(async (id) => {
    // 인계 문서 §3 삭제 정책: 이력이 있는 장비는 서버가 409로 차단한다(이력 보존).
    setSaving(true);
    try {
      await EquipmentModel.deleteEquipment(id);
      setPhotoUrls((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
      await load();
      setSelectedId(null);
    } finally {
      setSaving(false);
    }
  }, [load]);

  // ---- 카탈로그 ----
  const registeredInfo = useCallback((entry) => {
    const pattern = new RegExp(`^${escapeRegExp(entry.name)}(?: ([A-Z]))?$`);
    const matched = items.filter((item) => (item.category_1 || item.category1) === entry.process && pattern.test(item.name));
    return {
      count: matched.length,
      numbers: matched.map((item) => item.managementNo || item.management_no),
      units: matched.map((item) => ({ id: item.id, managementNo: item.managementNo || item.management_no })),
    };
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

  const openCatalog = useCallback(() => {
    // 카탈로그를 열 때 현재 목록 상태를 체크에 반영한다(체크=사용 중, 해제=목록에서 제외).
    const checks = {};
    const counts = {};
    EQUIPMENT_CATALOG.forEach((group) => {
      group.items.forEach((item) => {
        const info = registeredInfo({ name: item.name, process: item.process });
        if (info.count > 0) {
          checks[catalogKey(group.group, item)] = true;
          if (group.supportsCount) counts[catalogKey(group.group, item)] = info.count;
        }
      });
    });
    customCatalogItems.forEach((item) => {
      const info = registeredInfo(item);
      if (info.count > 0) checks[catalogKey(item.group, item)] = true;
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

  const catalogDiff = useMemo(() => {
    const additions = [];
    const removals = [];
    let changeCount = 0;
    const historyIds = new Set(historyEntries.map((entry) => entry.equipment_id));
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
          const sorted = [...info.units].sort((a, b) => b.managementNo.localeCompare(a.managementNo, 'en'));
          sorted.slice(0, current - target).forEach((unit) => removals.push({
            id: unit.id,
            number: `${unit.managementNo}`,
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
      // 이력이 있는 장비는 삭제하지 않고 목록에서만 숨긴다(이력 보존).
      const deleteIds = removals.filter((unit) => !unit.hasHistory).map((unit) => unit.id);
      const excludeIds = removals.filter((unit) => unit.hasHistory).map((unit) => unit.id);
      let removed = 0;
      if (deleteIds.length) removed = await EquipmentModel.deleteEquipmentByIds(deleteIds);
      if (excludeIds.length) await EquipmentModel.excludeEquipment(excludeIds);
      const createResult = additions.length
        ? await EquipmentModel.addCatalogSelections(additions)
        : { created: [] };
      const created = Array.isArray(createResult?.created) ? createResult.created : [];
      await load();
      setCatalogOpen(false);
      setCatalogChecks({});
      setCatalogCounts({});
      if (created.length) setSelectedId(created[0].id);
      return { created, removed, excluded: excludeIds.length };
    } finally {
      setSaving(false);
    }
  }, [catalogDiff, load]);

  // ---- 이력 ----
  const openCreateHistory = useCallback(() => {
    if (!selected) return;
    setHistoryDraftPhotos([]);
    const draft = emptyHistoryDraft(selected.id);
    setHistoryEditor({ open: true, draft, initial: { ...draft } });
  }, [selected]);

  const openEditHistory = useCallback((entry) => {
    setHistoryDraftPhotos([]);
    const draft = {
      ...emptyHistoryDraft(entry.equipment_id),
      ...entry,
      equipmentId: entry.equipment_id,
      // 서버 컬럼(completed_at)과 폼 필드(completedAt) 매핑 — 누락 시 기존 완료일 소실
      completedAt: entry.completed_at || '',
      type: entry.type || '정기점검',
    };
    setHistoryEditor({ open: true, draft, initial: { ...draft } });
  }, []);

  const closeHistoryEditor = useCallback(() => {
    if (saving) return;
    setHistoryDraftPhotos([]);
    setHistoryEditor({ open: false, draft: null, initial: null });
  }, [saving]);

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
      if (historyDraftPhotos.length) {
        await EquipmentModel.appendHistoryPhotos(saved.id, historyDraftPhotos);
        setHistoryDraftPhotos([]);
      }
      await load();
      setHistoryEditor({ open: false, draft: null, initial: null });
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

  // ---- 대표사진 ----
  const uploadEquipmentPhoto = useCallback(async (id, file) => {
    const result = await EquipmentModel.uploadEquipmentPhoto(id, file);
    setPhotoUrls((previous) => ({
      ...previous,
      [id]: toServerPhotoUrl(result.photoUrl) || previous[id],
    }));
  }, [toServerPhotoUrl]);

  // ---- 상태 빠른 변경 ----
  const updateStatus = useCallback(async (id, status) => {
    await EquipmentModel.updateEquipmentStatus(id, status);
    await load();
  }, [load]);

  const exportSelectedEquipmentCard = useCallback(async () => {
    if (!selected?.id || exporting) return null;
    setExporting(true);
    try {
      return await EquipmentModel.exportEquipmentCard(selected.id);
    } finally {
      setExporting(false);
    }
  }, [exporting, selected?.id]);

  // ---- 사진 보기 ----
  const openPhotoViewer = useCallback((entry) => {
    setViewer({ open: true, entryId: entry.id, index: 0, workTitle: '', items: [] });
  }, []);

  const closePhotoViewer = useCallback(() => {
    setViewer({ open: false, entryId: null, index: 0, workTitle: '', items: [] });
  }, []);

  const openEquipmentPhotoViewer = useCallback(() => {
    const url = photoUrls[selected?.id];
    if (url) setViewer({ open: true, entryId: null, index: 0, workTitle: '장비 대표사진', items: [{ id: selected.id, url }] });
  }, [photoUrls, selected]);

  const viewerSelect = useCallback((index) => {
    setViewer((previous) => ({ ...previous, index }));
  }, []);

  const viewerDelete = useCallback(async () => {
    const items = historyPhotoUrls[viewer.entryId] || [];
    const current = items[viewer.index];
    if (!current) return;
    const result = await EquipmentModel.deleteHistoryPhotoAt(viewer.entryId, current.id);
    await load();
    const remaining = result?.remaining ?? 0;
    setViewer((previous) => ({
      ...previous,
      index: remaining === 0 ? 0 : Math.min(previous.index, remaining - 1),
    }));
  }, [viewer, historyPhotoUrls, load]);

  const viewerAddFiles = useCallback(async (files) => {
    // 서버 응답 계약: { success, added, total }
    const result = await EquipmentModel.appendHistoryPhotos(viewer.entryId, files);
    const total = Number(result && result.total) || 0;
    await load();
    setViewer((previous) => ({
      ...previous,
      index: total === 0 ? 0 : Math.max(0, Math.min(total - files.length, total - 1)),
    }));
  }, [viewer, load]);

  // ---- 업무사진 열람 (읽기 전용 뷰어) ----
  const openWorkPhotoViewer = useCallback(async (record) => {
    const title = `${record.date} · ${record.title || '업무 기록'}`;
      const photos = (await EquipmentModel.fetchWorkRecordPhotos(record.id)).map((photo) => ({
        ...photo,
        url: toServerPhotoUrl(photo.url),
      }));
      setViewer({
        open: true,
        entryId: null,
        workTitle: title,
        items: photos,
        index: 0,
      });
  }, [toServerPhotoUrl]);

  // ---- 입력 보호 ----
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
    items: items.map(normalizedItem),
    filtered: filtered.map(normalizedItem),
    grouped,
    categories,
    historyEntries,
    workRecords,
    equipmentHistory,
    linkedWorkRecords,
    selected: selectedNormalized,
    selectedOutsideFilter,
    clearFilters,
    stats,
    loading,
    loadError,
    reload: load,
    processMethod,
    // 목록 상태
    query, setQuery, category, setCategory, groupBy, setGroupBy, selectEquipment,
    showHidden, hiddenCount, toggleShowHidden,
    // 장비 편집
    equipmentEditor, openCreateEquipment, openEditEquipment, closeEquipmentEditor,
    setEquipmentDraftField, setEquipmentDraftPhoto, saveEquipment, deleteEquipment,
    // 카탈로그
    catalogOpen, catalogGroups, catalogChecks, catalogCounts, catalogQuery, customDraft,
    registeredInfo, catalogChangeCount, catalogRemovals,
    openCatalog, closeCatalog, toggleCatalogItem, setCatalogItemCount, setCatalogQuery,
    setCustomDraftField, addCustomCatalogItem, applyCatalogChanges,
    // 이력
    equipmentHistoryTab: tab,
    tab, setTab,
    historyEditor, openCreateHistory, openEditHistory, closeHistoryEditor,
    setHistoryDraftField, addHistoryDraftPhotos, historyDraftPhotos,
    saveHistoryEntry, deleteHistoryEntry,
    // 대표사진
    photoUrls, uploadEquipmentPhoto,
    // 업무사진 열람
    openWorkPhotoViewer, openEquipmentPhotoViewer,
    // 상태 빠른 변경
    updateStatus,
    // 사진 보기
    historyPhotoUrls, viewer, openPhotoViewer, closePhotoViewer, viewerSelect, viewerDelete, viewerAddFiles,
    // 입력 보호
    isEquipmentDirty, isHistoryDirty, requestCloseEquipment, requestCloseHistory,
    // 공통
    saving,
    exporting,
    exportSelectedEquipmentCard,
  };
}

export default useEquipmentViewModel;
