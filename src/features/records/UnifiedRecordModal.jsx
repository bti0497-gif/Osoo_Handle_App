import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useUnifiedRecordViewModel } from './useUnifiedRecordViewModel';
import { WaterQualityModel } from '../water/WaterQualityModel';
import { SludgePhotoModel } from '../sludge/SludgePhotoModel';
import SludgePhotoButton from '../sludge/SludgePhotoButton';
import { getTodayKST } from '../../core/constants';
import { BatchProgressDialog } from '../../components/common';

const TAB_META = [
    { id: 'flow', label: '유량관리' },
    { id: 'water', label: '수질분석' },
    { id: 'medicine', label: '약품관리' },
    { id: 'kit', label: '키트관리' },
];

const TAB_LABEL_BY_ID = TAB_META.reduce((acc, tab) => {
    acc[tab.id] = tab.label;
    return acc;
}, {});

const WATER_FIELD_META = [
    { id: 'nh3_n', label: '암모니아성질소', code: 'NH3-N' },
    { id: 'no3_n', label: '질산성질소', code: 'NO3-N' },
    { id: 'po4_p', label: '인산염인', code: 'PO4-P' },
    { id: 'alkalinity', label: '알칼리도', code: 'ALK' },
];

const emptyWaterDraft = () => WATER_FIELD_META.reduce((acc, field) => {
    acc[field.id] = '';
    return acc;
}, {});

const toNumberOrNull = (value) => {
    if (value === '' || value === null || value === undefined) return null;
    const parsed = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
};


const round1 = (value) => Math.round(value * 10) / 10;
const clampInventory = (value) => Math.max(0, round1(Number(value || 0)));
const POWER_UNIT_STORAGE_KEY = 'osoo:power-reading-unit';

const getStoredPowerReadingUnit = () => {
    try {
        const unit = String(window.localStorage.getItem(POWER_UNIT_STORAGE_KEY) || '').toUpperCase();
        return unit === 'MWH' || unit === 'KWH' ? unit : '';
    } catch {
        return '';
    }
};

const storePowerReadingUnit = (unit) => {
    try {
        window.localStorage.setItem(POWER_UNIT_STORAGE_KEY, unit);
    } catch {
        // 저장소를 사용할 수 없는 환경에서도 현재 입력은 계속 처리한다.
    }
};

const getKitExperimentStep = (item, analysisLocationCount) => {
    const kitName = String(item?.key || item?.name || item?.label || '')
        .normalize('NFKC')
        .toUpperCase()
        .replace(/[^\p{L}\p{N}]/gu, '');
    const isPhosphateKit = kitName.includes('인산염인') || kitName.includes('PO4P');
    if (isPhosphateKit) return 3;
    return Math.max(1, Number(analysisLocationCount) || 0);
};

const getWaterFieldForKit = (item) => {
    const kitName = String(item?.key || item?.name || item?.label || '')
        .normalize('NFKC')
        .toUpperCase()
        .replace(/[^\p{L}\p{N}]/gu, '');
    if (kitName.includes('NH3') || kitName.includes('암모니아')) return 'nh3_n';
    if (kitName.includes('NO3') || kitName.includes('질산')) return 'no3_n';
    if (kitName.includes('PO4') || kitName.includes('인산염인') || kitName.includes('오르토인산')) return 'po4_p';
    if (kitName.includes('ALK') || kitName.includes('알칼리')) return 'alkalinity';
    return '';
};

const countAnalysisUsage = (history = [], targetDate = '') => {
    const counts = { nh3_n: 0, no3_n: 0, po4_p: 0, alkalinity: 0 };
    history.forEach((row) => {
        if (String(row?.date || '').slice(0, 10) !== targetDate) return;
        Object.keys(counts).forEach((field) => {
            const value = row?.[field];
            if (value !== '' && value !== null && value !== undefined) counts[field] += 1;
        });
    });
    return counts;
};

const formatValue = (value) => {
    if (value === null || value === undefined || value === '') return '-';
    if (Number.isFinite(Number(value))) return Number(value).toLocaleString();
    return String(value);
};

const inputStyle = {
    height: 38,
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    padding: '0 12px',
    fontSize: 15,
    fontWeight: 700,
    color: '#0f172a',
    textAlign: 'right',
    background: '#fff',
};

const labelStyle = {
    fontSize: 14,
    fontWeight: 800,
    color: '#475569',
};

const buttonBaseStyle = {
    height: 38,
    borderRadius: 7,
    border: '1px solid #cbd5e1',
    background: '#fff',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 900,
    color: '#334155',
    whiteSpace: 'nowrap',
};

const ADMIN_ROLES = new Set(['admin', 'group_admin', 'super_admin', 'central_admin']);

function DateOnlyInput({ value, onChange, style }) {
    const pickerRef = useRef(null);

    const openPicker = () => {
        const picker = pickerRef.current;
        if (!picker) return;
        if (typeof picker.showPicker === 'function') {
            picker.showPicker();
            return;
        }
        picker.click();
    };

    return (
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', ...style }}>
            <input
                type="text"
                value={value || ''}
                onChange={(e) => onChange?.(e.target.value)}
                placeholder="YYYY-MM-DD"
                style={{
                    ...inputStyle,
                    width: '100%',
                    height: style?.height || inputStyle.height,
                    textAlign: 'left',
                    boxSizing: 'border-box',
                    paddingRight: 34,
                }}
            />
            <button
                type="button"
                onClick={openPicker}
                style={{
                    position: 'absolute',
                    right: 6,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 24,
                    height: 24,
                    border: 0,
                    background: 'transparent',
                    color: '#0f172a',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                }}
                aria-label="날짜 선택"
            >
                <span className="material-icons" style={{ fontSize: 19 }}>calendar_today</span>
            </button>
            <input
                ref={pickerRef}
                type="date"
                value={value || ''}
                onChange={(e) => onChange?.(e.target.value)}
                tabIndex={-1}
                aria-hidden="true"
                style={{
                    position: 'absolute',
                    right: 0,
                    bottom: 0,
                    width: 1,
                    height: 1,
                    opacity: 0,
                    pointerEvents: 'none',
                }}
            />
        </div>
    );
}

function normalizeRoundOptions(rounds = [], fallbackOrder = 1) {
    if (Array.isArray(rounds) && rounds.length === 0) return [];

    const normalized = rounds
        .map((round) => {
            const value = Number(round.value ?? round.order ?? round.measurementOrder);
            if (!Number.isFinite(value) || value <= 0) return null;
            const order = Math.floor(value);
            return {
                value: order,
                label: round.label || `${order}회차`,
                sourceType: round.sourceType || round.source_type || 'manual',
                measurementGroup: round.measurementGroup || round.measurement_group || '',
                qntechProjectId: round.qntechProjectId || round.qntech_project_id || null,
                isNewManual: Boolean(round.isNewManual),
            };
        })
        .filter(Boolean);

    if (normalized.length > 0) return normalized;

    const safeOrder = Number.isFinite(Number(fallbackOrder)) && Number(fallbackOrder) > 0
        ? Math.floor(Number(fallbackOrder))
        : 1;

    return [{ value: safeOrder, label: `${safeOrder}회차`, sourceType: 'manual', measurementGroup: '' }];
}

function buildInitialDraft(tabId, item, roundValue) {
    if (!item) return {};

    if (tabId === 'flow') {
        const isSludge = isSludgeFlowItem(item);
        const isPower = String(item?.key || item?.name || item?.label || '').includes('전력');
        const previousMonthlyExport = toNumberOrNull(item?.previous?.monthlyExport)
            ?? toNumberOrNull(item?.previous?.monthly_export)
            ?? 0;
        return {
            reading: item.values?.reading ?? (isSludge ? 0 : ''),
            calculatedFlow: item.values?.flow ?? (isSludge ? round1(previousMonthlyExport) : ''),
            readingUnit: isPower
                ? (item.values?.readingUnit || getStoredPowerReadingUnit() || item.previous?.readingUnit || 'KWH')
                : '',
        };
    }

    if (tabId === 'medicine' || tabId === 'kit') {
        const purchase = item.values?.purchase ?? 0;
        const usage = item.values?.usage ?? 0;
        const previousInventory = toNumberOrNull(item.previous?.inventory) || 0;
        const savedInventory = toNumberOrNull(item.values?.inventory);
        const numericUsage = toNumberOrNull(usage) ?? 0;
        return {
            purchase,
            usage,
            inventory: savedInventory !== null
                ? clampInventory(savedInventory)
                : clampInventory(previousInventory + (toNumberOrNull(purchase) || 0) - numericUsage),
        };
    }

    const roundValues = item.valuesByRound?.[roundValue];
    const values = roundValues || item.values || {};
    return WATER_FIELD_META.reduce((acc, field) => {
        acc[field.id] = values[field.id] ?? '';
        return acc;
    }, {});
}

const getFlowGroupMeta = (item) => {
    const label = String(item?.label || item?.name || item?.key || '').trim();
    if (label.includes('내부반송')) return { key: 'flow-group:internal-return', label: '내부반송' };
    if (label.includes('외부반송')) return { key: 'flow-group:external-return', label: '외부반송' };
    return { key: item?.key || label, label };
};

const isSludgeFlowItem = (item) => String(item?.label || item?.name || item?.key || '').includes('슬러지');

const buildFlowGroups = (items = []) => {
    const groupMap = new Map();
    items.forEach((item) => {
        const meta = getFlowGroupMeta(item);
        if (!groupMap.has(meta.key)) {
            groupMap.set(meta.key, { ...meta, items: [] });
        }
        groupMap.get(meta.key).items.push(item);
    });
    return Array.from(groupMap.values());
};

export default function UnifiedRecordModal({
    isOpen,
    mode = 'add',
    currentUser = null,
    initialTab = 'flow',
    initialDate = '',
    contexts = {},
    isImportingQntech = false,
    onClose,
    onSaveComplete,
    onImportQntech,
    onImportQntechRange,
    onConfirm,
    onValidationError,
    onDateChange,
}) {
    const canUseBaselineStatus = ADMIN_ROLES.has(String(currentUser?.role || '').trim().toLowerCase());
    const [activeTab, setActiveTab] = useState(initialTab);
    const [date, setDate] = useState(initialDate);
    const [selectedByTab, setSelectedByTab] = useState({});
    const [draft, setDraft] = useState({});
    const [defaultPurchaseAppliedByTab, setDefaultPurchaseAppliedByTab] = useState({});
    const [waterRounds, setWaterRounds] = useState([{ value: 1, label: '1회차' }]);
    const [selectedWaterRound, setSelectedWaterRound] = useState(1);
    const [rangeStartDate, setRangeStartDate] = useState(initialDate);
    const [rangeEndDate, setRangeEndDate] = useState(initialDate);
    const [waterInputMode, setWaterInputMode] = useState('manual');
    const [saveStatusMode, setSaveStatusMode] = useState('manual');
    const [savedTabs, setSavedTabs] = useState([]);
    const [internalQntechProgress, setInternalQntechProgress] = useState(null);
    const [isInternalQntechImporting, setIsInternalQntechImporting] = useState(false);
    const [isLookingUpExperimentCounts, setIsLookingUpExperimentCounts] = useState(false);
    const [experimentLookupMessage, setExperimentLookupMessage] = useState('');
    const [sludgePhotoDraft, setSludgePhotoDraft] = useState({
        date: '',
        sludgeFiles: [],
        certificateFile: null,
        sludgePhotoUrl: null,
        certificatePhotoUrl: null,
    });
    const [isLoadingSludgePhotos, setIsLoadingSludgePhotos] = useState(false);
    const [isUploadingSludgePhotos, setIsUploadingSludgePhotos] = useState(false);
    const wasOpenRef = useRef(false);
    const initialWaterSignature = JSON.stringify({
        measurementOrder: contexts.water?.measurementOrder || 1,
        rounds: contexts.water?.rounds || [],
    });
    const {
        contexts: resolvedContexts,
        isDateContextPending,
        isRefreshing: isRefreshingUnifiedData,
        isSaving,
        saveAllTabs,
        reloadContexts,
    } = useUnifiedRecordViewModel({ isOpen, date, contexts });

    const runInternalQntechImport = async (targetDate) => {
        setIsInternalQntechImporting(true);
        setInternalQntechProgress({ message: `${targetDate} 서버 데이터를 가져오는 중...` });
        try {
            await WaterQualityModel.recordQntechUiDiagnostic('unified-single-dispatch', { date: targetDate });
            const result = await WaterQualityModel.importFromQntech(targetDate);
            if (!result?.success) throw new Error(result?.error || '서버에서 데이터를 가져오지 못했습니다.');
            await reloadContexts({ force: true, tabs: ['water', 'kit'] });
            setInternalQntechProgress({ message: '서버에서 데이터 가져오기가 완료되었습니다.', completed: true });
            return result;
        } catch (error) {
            setInternalQntechProgress({ status: 'error', message: error.message });
            throw error;
        } finally {
            setIsInternalQntechImporting(false);
        }
    };

    const runInternalQntechRangeImport = async (startDate, endDate) => {
        if (!startDate || !endDate) throw new Error('가져올 기간을 선택하세요.');
        if (startDate > endDate) throw new Error('시작 날짜가 종료 날짜보다 늦을 수 없습니다.');
        if (startDate > getTodayKST() || endDate > getTodayKST()) throw new Error('오늘보다 미래 날짜는 불러올 수 없습니다.');
        const confirmImport = typeof onConfirm === 'function'
            ? onConfirm
            : (message) => Promise.resolve(window.confirm(message));
        const confirmed = await confirmImport('기간 불러오기는 즉시 저장됩니다. 기존 값이 있는 날짜는 값을 유지하고 사진을 함께 저장합니다. 계속할까요?');
        if (!confirmed) return null;

        setIsInternalQntechImporting(true);
        setInternalQntechProgress({ message: '서버 백그라운드 작업을 시작하는 중...', completedDates: 0, totalDates: 0 });
        try {
            await WaterQualityModel.recordQntechUiDiagnostic('unified-range-dispatch', { startDate, endDate });
            const started = await WaterQualityModel.importRangeFromQntech(startDate, endDate);
            if (!started?.success) throw new Error(started?.error || '서버에서 기간 데이터 가져오기를 시작하지 못했습니다.');

            let result = null;
            while (!result) {
                const response = await WaterQualityModel.fetchRangeImportProgress();
                const progress = response?.progress;
                if (!progress || (started.jobId && progress.jobId !== started.jobId)) {
                    throw new Error('서버의 기간 작업 상태를 확인할 수 없습니다.');
                }
                setInternalQntechProgress(progress);
                if (progress.status === 'completed') result = progress.result;
                else if (progress.status === 'error') throw new Error(progress.message || '서버에서 기간 데이터 가져오기에 실패했습니다.');
                else await new Promise((resolve) => setTimeout(resolve, 1000));
            }

            if (!result?.success) throw new Error(result?.error || '서버에서 기간 데이터 가져오기에 실패했습니다.');
            await reloadContexts({ force: true, tabs: ['water', 'kit'] });
            setInternalQntechProgress((previous) => ({
                ...previous,
                status: 'completed',
                message: `기간 데이터 불러오기 완료 - 값 ${result.summary?.insertedRowCount || 0}건, 사진 ${result.summary?.savedPhotoCount || 0}건`,
            }));
            return result;
        } catch (error) {
            setInternalQntechProgress({ status: 'error', message: error.message });
            throw error;
        } finally {
            setIsInternalQntechImporting(false);
        }
    };

    const effectiveImportQntech = typeof onImportQntech === 'function' ? onImportQntech : runInternalQntechImport;
    const effectiveImportQntechRange = typeof onImportQntechRange === 'function' ? onImportQntechRange : runInternalQntechRangeImport;
    const effectiveIsImportingQntech = isImportingQntech || isInternalQntechImporting;
    const usesInternalQntechProgress = typeof onImportQntech !== 'function' || typeof onImportQntechRange !== 'function';
    const internalProgressStatus = internalQntechProgress?.status === 'error'
        ? 'error'
        : internalQntechProgress?.status === 'completed' || internalQntechProgress?.completed
            ? 'success'
            : 'processing';
    const internalProgressTotal = Math.max(1, Number(internalQntechProgress?.totalDates) || 1);
    const internalProgressCompleted = internalProgressStatus === 'success'
        ? internalProgressTotal
        : Math.min(internalProgressTotal, Math.max(0, Number(internalQntechProgress?.completedDates) || 0));
    const internalProgressPercent = internalProgressStatus === 'success' || internalProgressStatus === 'error'
        ? 100
        : Math.min(100, Math.round((internalProgressCompleted / internalProgressTotal) * 100));
    const internalProgressTasks = internalQntechProgress ? [{
        id: 'unified-water-import',
        title: rangeStartDate === rangeEndDate
            ? `${rangeStartDate} 서버 데이터`
            : `${rangeStartDate} ~ ${rangeEndDate} 데이터`,
        status: internalProgressStatus,
        message: internalQntechProgress.message || '서버에서 가져오는 중...',
        completedUnits: internalProgressCompleted,
        errorUnits: internalProgressStatus === 'error' ? 1 : 0,
        totalUnits: internalProgressTotal,
    }] : [];

    useEffect(() => {
        if (!isOpen || !isRefreshingUnifiedData) return undefined;
        const timer = setTimeout(() => {
            void WaterQualityModel.recordQntechUiDiagnostic('unified-context-load-slow', {
                date,
                activeTab,
                isDateContextPending,
            });
        }, 8000);
        return () => clearTimeout(timer);
    }, [isOpen, isRefreshingUnifiedData, isDateContextPending, date, activeTab]);

    useEffect(() => {
        if (!isOpen) {
            wasOpenRef.current = false;
            return undefined;
        }
        if (wasOpenRef.current) return undefined;

        const timer = setTimeout(() => {
            wasOpenRef.current = true;
            const waterContext = JSON.parse(initialWaterSignature);
            const rounds = normalizeRoundOptions(waterContext.rounds, waterContext.measurementOrder || 1);
            setActiveTab(initialTab);
            setDate(initialDate);
            setRangeStartDate(initialDate);
            setRangeEndDate(initialDate);
            setSelectedByTab({});
            setDraft({});
            setDefaultPurchaseAppliedByTab({});
            setSavedTabs([]);
            setInternalQntechProgress(null);
            setIsInternalQntechImporting(false);
            setSaveStatusMode('manual');
            setWaterRounds(rounds);
            setSelectedWaterRound(rounds[0]?.value || 1);
            setWaterInputMode('manual');
        }, 0);
        return () => clearTimeout(timer);
    }, [isOpen, initialTab, initialDate, initialWaterSignature]);

    useEffect(() => {
        if (!isOpen || isDateContextPending) return;
        const waterContext = resolvedContexts.water || {};
        const rounds = normalizeRoundOptions(waterContext.rounds, waterContext.measurementOrder || 1);
        const timer = setTimeout(() => {
            setWaterRounds(rounds);
            setSelectedWaterRound((current) => (
                rounds.some((round) => round.value === current) ? current : (rounds[0]?.value || 1)
            ));
        }, 0);
        return () => clearTimeout(timer);
    }, [isOpen, isDateContextPending, resolvedContexts.water]);

    useEffect(() => {
        if (!isOpen || !date) return undefined;
        let cancelled = false;
        const [year, month] = date.split('-').map(Number);
        setSludgePhotoDraft({ date, sludgeFiles: [], certificateFile: null, sludgePhotoUrl: null, certificatePhotoUrl: null });
        setIsLoadingSludgePhotos(true);
        SludgePhotoModel.fetchByMonth(year, month)
            .then((result) => {
                if (cancelled || !result?.success) return;
                const item = (result.items || []).find((row) => row.date === date);
                if (!item) return;
                setSludgePhotoDraft((current) => current.date === date ? {
                    ...current,
                    sludgePhotoUrl: item.sludge_photo_url || null,
                    certificatePhotoUrl: item.certificate_photo_url || null,
                } : current);
            })
            .catch((error) => console.error('[UnifiedRecordModal] sludge photo load failed', error))
            .finally(() => {
                if (!cancelled) setIsLoadingSludgePhotos(false);
            });
        return () => { cancelled = true; };
    }, [isOpen, date]);

    const currentItems = useMemo(
        () => resolvedContexts[activeTab]?.items || [],
        [resolvedContexts, activeTab]
    );
    const flowGroups = useMemo(() => buildFlowGroups(currentItems), [currentItems]);
    const selectedKey = selectedByTab[activeTab] || (activeTab === 'flow' ? flowGroups[0]?.key : currentItems[0]?.key) || '';
    const selectedFlowGroup = activeTab === 'flow'
        ? (flowGroups.find((group) => group.key === selectedKey) || flowGroups[0] || null)
        : null;
    const selectedItem = activeTab === 'flow'
        ? (selectedFlowGroup?.items?.[0] || null)
        : (currentItems.find((item) => item.key === selectedKey) || currentItems[0] || null);
    const selectedRound = waterRounds.find((round) => round.value === selectedWaterRound) || waterRounds[0] || null;
    const waterLocationNameSet = useMemo(() => (
        new Set((resolvedContexts.water?.items || []).map(
            (item) => String(item.label || item.key || '').trim()
        ))
    ), [resolvedContexts.water?.items]);
    const isWaterMbrLayout = !waterLocationNameSet.has('침전조');

    const isPo4pInputEnabled = (item) => {
        if (!item) return false;
        const locationName = String(item.label || item.key || '').trim();
        if (locationName === '유량조정조' || locationName === '방류조') return true;
        if (locationName === '포기조') return isWaterMbrLayout || item.po4pApplicable === true;
        if (locationName === '침전조') return !isWaterMbrLayout || item.po4pApplicable === true;
        return item.po4pApplicable === true;
    };

    if (!isOpen) return null;

    const getDraftKeyForItem = (tabId, item, roundValue = selectedWaterRound) => (
        `${tabId}:${item?.key || ''}:${tabId === 'water' ? roundValue : 'base'}`
    );

    const getDraftForItem = (tabId, item, roundValue = selectedWaterRound) => {
        const key = getDraftKeyForItem(tabId, item, roundValue);
        return draft[key] || buildInitialDraft(tabId, item, roundValue);
    };

    const recalculateInventoryDraft = (item, values) => {
        const previousInventory = toNumberOrNull(item?.previous?.inventory) || 0;
        const purchase = toNumberOrNull(values.purchase) || 0;
        const usage = toNumberOrNull(values.usage) || 0;
        return {
            ...values,
            inventory: clampInventory(previousInventory + purchase - usage),
        };
    };

    const setWaterDraftField = (item, field, value) => {
        setDraft((prev) => {
            const key = getDraftKeyForItem('water', item, selectedWaterRound);
            return {
                ...prev,
                [key]: {
                    ...(prev[key] || buildInitialDraft('water', item, selectedWaterRound)),
                    [field]: value,
                },
            };
        });
    };

    const setFlowDraftFieldForItem = (item, field, value) => {
        setDraft((prev) => {
            const isSludge = isSludgeFlowItem(item);
            const key = getDraftKeyForItem('flow', item);
            const current = prev[key] || buildInitialDraft('flow', item);
            const nextDirty = {
                ...(current.__dirty || {}),
                [field]: true,
            };
            if (field === 'reading') {
                delete nextDirty.calculatedFlow;
            }
            const nextDraft = {
                ...current,
                [field]: value,
                __dirty: nextDirty,
            };

            if (isSludge && field === 'reading') {
                const exportAmount = toNumberOrNull(value);
                const previousMonthlyExport = toNumberOrNull(item?.previous?.monthlyExport)
                    ?? toNumberOrNull(item?.previous?.monthly_export)
                    ?? 0;
                if (exportAmount !== null) {
                    nextDraft.calculatedFlow = round1(previousMonthlyExport + exportAmount);
                } else {
                    nextDraft.calculatedFlow = previousMonthlyExport > 0 ? round1(previousMonthlyExport) : '';
                }
            }

            if (isSludge && field === 'calculatedFlow') {
                const monthlyExport = toNumberOrNull(value);
                const previousMonthlyExport = toNumberOrNull(item?.previous?.monthlyExport)
                    ?? toNumberOrNull(item?.previous?.monthly_export)
                    ?? 0;
                if (monthlyExport !== null) {
                    nextDraft.reading = round1(Math.max(0, monthlyExport - previousMonthlyExport));
                }
            }

            const isPower = String(item?.key || item?.name || item?.label || '').includes('전력');
            const readingMultiplier = isPower && String(nextDraft.readingUnit || '').toUpperCase() === 'MWH' ? 1000 : 1;

            if (!isSludge && (field === 'reading' || field === 'readingUnit')) {
                const reading = toNumberOrNull(value);
                const effectiveReading = field === 'readingUnit' ? toNumberOrNull(nextDraft.reading) : reading;
                const previousReading = toNumberOrNull(item?.previous?.reading);
                if (effectiveReading !== null && previousReading !== null) {
                    nextDraft.calculatedFlow = round1(Math.max(0, (effectiveReading - previousReading) * readingMultiplier));
                } else if (effectiveReading !== null) {
                    nextDraft.calculatedFlow = round1(effectiveReading * readingMultiplier);
                }
            }

            if (!isSludge && field === 'calculatedFlow') {
                const calculatedFlow = toNumberOrNull(value);
                const previousReading = toNumberOrNull(item?.previous?.reading) ?? 0;
                if (calculatedFlow !== null) {
                    nextDraft.reading = isPower && readingMultiplier === 1000
                        ? Math.round((previousReading + (calculatedFlow / 1000)) * 1000) / 1000
                        : round1(previousReading + calculatedFlow);
                }
            }

            return { ...prev, [key]: nextDraft };
        });
    };

    const setInventoryDraftFieldForItem = (tabId, item, field, value) => {
        setDraft((prev) => {
            const key = getDraftKeyForItem(tabId, item);
            const current = prev[key] || buildInitialDraft(tabId, item);
            const nextDraft = {
                ...current,
                [field]: value,
                __dirty: {
                    ...(current.__dirty || {}),
                    [field]: true,
                },
            };

            if (field === 'purchase' || field === 'usage') {
                Object.assign(nextDraft, recalculateInventoryDraft(item, nextDraft));
            }

            return { ...prev, [key]: nextDraft };
        });
    };

    const handleToggleDefaultPurchases = () => {
        if (activeTab !== 'medicine' && activeTab !== 'kit') return;
        const nextApplied = !defaultPurchaseAppliedByTab[activeTab];

        setDraft((prev) => {
            const next = { ...prev };
            currentItems.forEach((item) => {
                const key = getDraftKeyForItem(activeTab, item);
                const current = next[key] || buildInitialDraft(activeTab, item);
                const updated = {
                    ...current,
                    purchase: nextApplied ? (Number(item.defaultPurchase) || 0) : '',
                };
                next[key] = recalculateInventoryDraft(item, updated);
            });
            return next;
        });

        setDefaultPurchaseAppliedByTab((prev) => ({ ...prev, [activeTab]: nextApplied }));
    };

    const handleAdjustKitUsage = (delta) => {
        if (activeTab !== 'kit') return;
        const analysisLocationCount = (resolvedContexts.water?.items || []).length;

        setDraft((prev) => {
            const next = { ...prev };
            currentItems.forEach((item) => {
                const key = getDraftKeyForItem('kit', item);
                const current = next[key] || buildInitialDraft('kit', item);
                const currentUsage = toNumberOrNull(current.usage) || 0;
                const experimentStep = getKitExperimentStep(item, analysisLocationCount);
                const nextUsage = round1(Math.max(0, currentUsage + (delta * experimentStep)));
                const updated = {
                    ...current,
                    usage: nextUsage,
                };
                next[key] = recalculateInventoryDraft(item, updated);
            });
            return next;
        });
    };

    const handleSelectItem = (key) => {
        setSelectedByTab((prev) => ({ ...prev, [activeTab]: key }));
    };

    const applyInventoryDefaults = (tabId) => {
        if (tabId !== 'medicine' && tabId !== 'kit') return;
        const items = resolvedContexts[tabId]?.items || [];
        setDraft((prev) => {
            const next = { ...prev };
            items.forEach((item) => {
                const key = getDraftKeyForItem(tabId, item);
                if (next[key]) return;
                next[key] = recalculateInventoryDraft(item, buildInitialDraft(tabId, item));
            });
            return next;
        });
    };

    const handleTabChange = (nextTab) => {
        setActiveTab(nextTab);
        applyInventoryDefaults(nextTab);
    };

    const handleLookupExperimentCounts = async () => {
        if (!date || isLookingUpExperimentCounts) return;
        setIsLookingUpExperimentCounts(true);
        setExperimentLookupMessage('분석결과를 조회하는 중...');
        try {
            const response = await WaterQualityModel.fetchHistory({ force: true });
            const history = Array.isArray(response) ? response : (Array.isArray(response?.history) ? response.history : []);
            const counts = countAnalysisUsage(history, date);
            const matchedCount = currentItems.reduce((sum, item) => (
                sum + (counts[getWaterFieldForKit(item)] || 0)
            ), 0);

            setDraft((prev) => {
                const next = { ...prev };
                currentItems.forEach((item) => {
                    const field = getWaterFieldForKit(item);
                    if (!field) return;
                    const key = getDraftKeyForItem('kit', item);
                    const current = next[key] || buildInitialDraft('kit', item);
                    const updated = {
                        ...current,
                        usage: counts[field] || 0,
                        __dirty: { ...(current.__dirty || {}), usage: true },
                    };
                    next[key] = recalculateInventoryDraft(item, updated);
                });
                return next;
            });
            setExperimentLookupMessage(
                matchedCount > 0
                    ? `분석결과를 기준으로 실험횟수 ${matchedCount}건을 채웠습니다.`
                    : '선택한 날짜에 저장된 분석결과가 없습니다.'
            );
        } catch (error) {
            console.error('[UnifiedRecordModal] automatic experiment count lookup failed:', error);
            setExperimentLookupMessage('자동실험횟수를 조회하지 못했습니다.');
            onValidationError?.(`자동실험횟수 조회 실패: ${error.message}`);
        } finally {
            setIsLookingUpExperimentCounts(false);
        }
    };

    const markTabsSaved = (tabIds = []) => {
        setSavedTabs((prev) => Array.from(new Set([...prev, ...tabIds])));
    };

    const handleAddWaterRound = () => {
        const nextOrder = Math.max(0, ...waterRounds.map((round) => Number(round.value) || 0)) + 1;
        const nextRound = {
            value: nextOrder,
            label: `${nextOrder}회차`,
            sourceType: 'manual',
            measurementGroup: `manual:${date}:${nextOrder}`,
            qntechProjectId: null,
            isNewManual: true,
        };
        setWaterRounds((prev) => [...prev, nextRound]);
        setSelectedWaterRound(nextOrder);
        setDraft((prev) => {
            const next = { ...prev };
            currentItems.forEach((item) => {
                next[getDraftKeyForItem('water', item, nextOrder)] = emptyWaterDraft();
            });
            return next;
        });
    };

    const notifyValidation = (message) => {
        if (onValidationError) onValidationError(message);
        else window.alert(message);
    };

    const hasPendingSludgePhotos = sludgePhotoDraft.date === date
        && Boolean(sludgePhotoDraft.sludgeFiles.length || sludgePhotoDraft.certificateFile);

    const handleSludgePhotoFiles = (files) => {
        setSludgePhotoDraft((current) => ({
            ...current,
            date,
            sludgeFiles: [...current.sludgeFiles, ...files],
        }));
    };

    const handleCertificatePhotoFile = (file) => {
        setSludgePhotoDraft((current) => ({ ...current, date, certificateFile: file }));
    };

    const uploadPendingSludgePhotos = async () => {
        if (!hasPendingSludgePhotos) return true;
        const pending = sludgePhotoDraft;
        setIsUploadingSludgePhotos(true);
        try {
            let driveUploadFailed = false;
            const uploadQueue = [
                ...pending.sludgeFiles.map((file) => ({ type: 'sludge', file, urlKey: 'sludgePhotoUrl' })),
                ...(pending.certificateFile
                    ? [{ type: 'certificate', file: pending.certificateFile, urlKey: 'certificatePhotoUrl' }]
                    : []),
            ];
            for (const { type, file, urlKey } of uploadQueue) {
                const result = await SludgePhotoModel.uploadPhoto(date, type, file);
                if (!result?.success) throw new Error(result?.error || `${type} 사진 업로드에 실패했습니다.`);
                if (result.driveUploaded === false) driveUploadFailed = true;
                setSludgePhotoDraft((current) => current.date === date ? {
                    ...current,
                    sludgeFiles: type === 'sludge'
                        ? current.sludgeFiles.filter((candidate) => candidate !== file)
                        : current.sludgeFiles,
                    certificateFile: type === 'certificate' ? null : current.certificateFile,
                    [urlKey]: result.url || current[urlKey] || true,
                } : current);
            }
            if (driveUploadFailed) {
                notifyValidation('사진은 로컬에 저장되었지만 Drive 업로드에 실패했습니다. 진단로그를 확인해 주세요.');
            }
            return true;
        } catch (error) {
            notifyValidation(`슬러지 사진 저장 실패: ${error.message}`);
            return false;
        } finally {
            setIsUploadingSludgePhotos(false);
        }
    };

    const logOperationalNotice = (message, extra = {}) => {
        if (!message) return;
        console.info('[UnifiedRecordModal]', message, { date, activeTab, ...extra });
    };

    const focusMissingInput = (missing) => {
        if (!missing) return;
        setActiveTab(missing.tab);
        if (missing.round) setSelectedWaterRound(missing.round);
        if (missing.item?.key) {
            const nextKey = missing.tab === 'flow'
                ? getFlowGroupMeta(missing.item).key
                : missing.item.key;
            setSelectedByTab((prev) => ({ ...prev, [missing.tab]: nextKey }));
        }
    };

    const hasDraftTabData = (tabId) => (
        Object.keys(draft).some((key) => key.startsWith(`${tabId}:`))
        || (tabId === 'flow' && hasPendingSludgePhotos)
    );

    const hasDraftForItem = (tabId, item) => (
        Object.prototype.hasOwnProperty.call(draft, getDraftKeyForItem(tabId, item))
    );

    const buildSavePlan = ({
        tabIds = ['flow', 'medicine', 'water', 'kit'],
        validateFlow = true,
        allowFlowDefaults = false,
    } = {}) => {
        const targetTabs = new Set(tabIds);
        const flowMissing = [];
        const notices = [];
        const flowItemsToSave = [];
        const medicineItemsToSave = [];
        const kitItemsToSave = [];
        const waterItemsToSave = [];
        const effectiveSaveStatusMode = canUseBaselineStatus ? saveStatusMode : 'manual';
        const isAdminUser = ADMIN_ROLES.has(String(currentUser?.role || '').trim().toLowerCase());
        const shouldAutoAdjustKitUsageFromWater = targetTabs.has('water')
            && targetTabs.has('kit')
            && !isAdminUser
            && effectiveSaveStatusMode !== 'baseline';

        if (targetTabs.has('flow')) {
            (resolvedContexts.flow?.items || []).forEach((item) => {
                const values = getDraftForItem('flow', item);
                const reading = toNumberOrNull(values.reading);
                const calculatedFlow = toNumberOrNull(values.calculatedFlow);
                const isSludge = isSludgeFlowItem(item);

                if (reading === null && isSludge) {
                    const previousYearlyExport = toNumberOrNull(item?.previous?.yearlyExport)
                        ?? toNumberOrNull(item?.previous?.yearly_export)
                        ?? 0;
                    flowItemsToSave.push({
                        type: item.key || item.name || item.label,
                        raw_value: 0,
                        calculated_flow: round1(previousYearlyExport),
                        sludge_export: 0,
                        is_manual: false,
                        is_reset: false,
                        input_status: 'defaulted',
                    });
                    return;
                }
                if (reading === null) {
                    const previousReading = toNumberOrNull(item?.previous?.reading);
                    if (allowFlowDefaults && previousReading !== null) {
                        flowItemsToSave.push({
                            type: item.key || item.name || item.label,
                            raw_value: previousReading,
                            calculated_flow: 0,
                            sludge_export: null,
                            is_manual: true,
                            is_reset: false,
                            input_status: 'defaulted',
                        });
                        notices.push(`${item.label || item.key} 유량은 전날 검침값을 기준으로 0 처리했습니다.`);
                        return;
                    }
                    if (validateFlow) {
                        flowMissing.push({
                            tab: 'flow',
                            item,
                            message: `${item.label || item.key} 검침값`,
                        });
                    }
                    return;
                }
                flowItemsToSave.push({
                    type: item.key || item.name || item.label,
                    raw_value: reading,
                    calculated_flow: isSludge
                        ? round1((toNumberOrNull(item?.previous?.yearlyExport)
                            ?? toNumberOrNull(item?.previous?.yearly_export)
                            ?? 0) + (reading ?? 0))
                        : calculatedFlow,
                    reading_unit: String(item.key || item.name || item.label || '').includes('전력')
                        ? (String(values.readingUnit || '').trim().toUpperCase() || 'KWH')
                        : null,
                    sludge_export: isSludge ? reading : null,
                    is_manual: false,
                    is_reset: false,
                    input_status: effectiveSaveStatusMode === 'baseline' ? 'baseline' : 'manual',
                });
            });
        }

        const zeroUsageMedicines = [];
        const collectInventoryItems = (tab, nameField, target) => {
            (resolvedContexts[tab]?.items || []).forEach((item) => {
                const isDrafted = hasDraftForItem(tab, item);

                const values = getDraftForItem(tab, item);
                const purchase = toNumberOrNull(values.purchase);
                const usage = toNumberOrNull(values.usage) ?? 0;
                const previousInventory = toNumberOrNull(item?.previous?.inventory) || 0;
                const inventory = toNumberOrNull(values.inventory)
                    ?? clampInventory(previousInventory + (purchase || 0) - usage);
                if (tab === 'medicine' && isDrafted && usage === 0) {
                    zeroUsageMedicines.push(item.label || item.key);
                }
                target.push({
                    date,
                    [nameField]: item.key || item.name || item.label,
                    purchase_amount: purchase ?? 0,
                    usage_amount: usage,
                    current_inventory: inventory,
                    inventory_is_manual: Boolean(values.__dirty?.inventory),
                    input_status: (
                        effectiveSaveStatusMode === 'baseline'
                            ? 'baseline'
                            : ((purchase === null && toNumberOrNull(values.usage) === null)
                                ? 'defaulted'
                                : 'manual')
                    ),
                });
            });
        };

        if (targetTabs.has('medicine')) {
            collectInventoryItems('medicine', 'medicine_name', medicineItemsToSave);
        }
        if (targetTabs.has('kit')) {
            collectInventoryItems('kit', 'kit_name', kitItemsToSave);
        }

        const waterUsageByKit = new Map([
            ['nh3_n', { kitName: '암모니아성질소(NH3-N)', count: 0 }],
            ['no3_n', { kitName: '질산성질소(NO3-N)', count: 0 }],
            ['po4_p', { kitName: '인산염인(PO4-P)', count: 0 }],
            ['alkalinity', { kitName: '알칼리도(ALK)', count: 0 }],
        ]);
        let hasAnyWaterValue = false;
        let hasPartialWaterInput = false;
        if (targetTabs.has('water')) {
            const rounds = waterRounds.length > 0
                ? waterRounds
                : [{ value: 1, label: '1회차', sourceType: 'manual' }];
            rounds.forEach((round) => {
                (resolvedContexts.water?.items || []).forEach((item) => {
                    const values = getDraftForItem('water', item, round.value);
                    const enabledFields = WATER_FIELD_META.filter(
                        (field) => field.id !== 'po4_p' || isPo4pInputEnabled(item)
                    );
                    const hasAny = enabledFields.some((field) => toNumberOrNull(values[field.id]) !== null);
                    const missingFields = enabledFields.filter((field) => toNumberOrNull(values[field.id]) === null);
                    if (!hasAny) return;
                    hasAnyWaterValue = true;
                    if (missingFields.length > 0) {
                        hasPartialWaterInput = true;
                    }
                    if (shouldAutoAdjustKitUsageFromWater) {
                        enabledFields.forEach((field) => {
                            if (toNumberOrNull(values[field.id]) !== null) {
                                const usage = waterUsageByKit.get(field.id);
                                if (usage) usage.count += 1;
                            }
                        });
                    }
                    waterItemsToSave.push({
                        date,
                        measurement_group: round.sourceType === 'qntech'
                            ? round.measurementGroup
                            : `manual:${date}:${round.value}`,
                        measurement_order: round.value,
                        source_type: round.sourceType || 'manual',
                        input_status: round.sourceType === 'qntech' ? 'imported' : (effectiveSaveStatusMode === 'baseline' ? 'baseline' : 'manual'),
                        source_label: round.label,
                        qntech_project_id: round.qntechProjectId || null,
                        location: item.key || item.label,
                        ...WATER_FIELD_META.reduce((acc, field) => {
                            acc[field.id] = field.id === 'po4_p' && !isPo4pInputEnabled(item)
                                ? null
                                : toNumberOrNull(values[field.id]);
                            return acc;
                        }, {}),
                    });
                });
            });
        }

        if (shouldAutoAdjustKitUsageFromWater) {
            waterUsageByKit.forEach(({ kitName, count }) => {
                if (count <= 0) return;
                let kitRow = kitItemsToSave.find((item) => item.kit_name === kitName);
                if (!kitRow) {
                    const kitContext = (resolvedContexts.kit?.items || []).find(
                        (item) => (item.key || item.name || item.label) === kitName
                    );
                    if (!kitContext) return;
                    const values = getDraftForItem('kit', kitContext);
                    const purchase = toNumberOrNull(values.purchase) ?? 0;
                    const usage = toNumberOrNull(values.usage) ?? 0;
                    const previousInventory = toNumberOrNull(kitContext?.previous?.inventory) || 0;
                    kitRow = {
                        date,
                        kit_name: kitName,
                        purchase_amount: purchase,
                        usage_amount: usage,
                        current_inventory: clampInventory(previousInventory + purchase - usage),
                        input_status: 'imported',
                    };
                    kitItemsToSave.push(kitRow);
                }
                if (!kitRow) return;
                if (kitRow.usage_amount < count) {
                    const kitContext = (resolvedContexts.kit?.items || []).find(
                        (item) => (item.key || item.name || item.label) === kitName
                    );
                    const previousInventory = toNumberOrNull(kitContext?.previous?.inventory) || 0;
                    kitRow.usage_amount = count;
                    kitRow.current_inventory = clampInventory(
                        previousInventory + kitRow.purchase_amount - kitRow.usage_amount
                    );
                }
            });
        }

        if (zeroUsageMedicines.length > 0) {
            notices.push(`사용되지 않은 약품: ${zeroUsageMedicines.join(', ')}`);
        }
        const hasAnyKitUsage = kitItemsToSave.some((item) => item.usage_amount > 0);
        if (targetTabs.has('water') && !hasAnyWaterValue && !hasAnyKitUsage) {
            notices.push('실험분석값과 키트 사용량이 없습니다.');
        } else if (targetTabs.has('water') && hasPartialWaterInput) {
            notices.push('실험분석에 빠진 항목이 있습니다.');
        }

        return {
            flowMissing,
            notices,
            flowItems: flowItemsToSave,
            medicineItems: medicineItemsToSave,
            waterItems: waterItemsToSave,
            kitItems: kitItemsToSave,
        };
    };

    const savePlan = async (plan) => {
        const result = await saveAllTabs(plan);
        if (!result.success) {
            notifyValidation(`일부 데이터 저장에 실패했습니다. ${result.error || ''}`.trim());
            return null;
        }

        if (result.savedTabs.length > 0) {
            markTabsSaved(result.savedTabs);
            setDraft((prev) => {
                const savedTabSet = new Set(result.savedTabs);
                return Object.fromEntries(
                    Object.entries(prev).filter(([key]) => {
                        const tabId = key.split(':')[0];
                        return !savedTabSet.has(tabId);
                    })
                );
            });
            await onSaveComplete?.({ date, savedTabs: result.savedTabs });
        }
        return result;
    };

    const handleSave = async () => {
        if (isDateContextPending || isSaving || isUploadingSludgePhotos) return;
        const plan = buildSavePlan({
            tabIds: [activeTab],
            validateFlow: activeTab === 'flow',
            allowFlowDefaults: activeTab === 'flow',
        });

        if (plan.flowMissing.length > 0) {
            focusMissingInput(plan.flowMissing[0]);
            notifyValidation('유량탭에서 입력이 없는 항목이 있습니다.');
            return;
        }

        const result = await savePlan(plan);
        if (!result) return;
        if (activeTab === 'flow' && result.savedTabs.includes('flow') && hasPendingSludgePhotos) {
            await uploadPendingSludgePhotos();
        }
        if (plan.notices.length > 0) {
            logOperationalNotice('저장 중 자동 처리된 항목이 있습니다.', { notices: plan.notices });
        }
    };

    const handleClose = async () => {
        if (isDateContextPending || isSaving || isUploadingSludgePhotos) return;

        const dirtyUnsavedTabs = TAB_META
            .filter((tab) => hasDraftTabData(tab.id))
            .map((tab) => tab.id);

        if (dirtyUnsavedTabs.length > 0) {
            const dirtyLabels = dirtyUnsavedTabs.map((tabId) => TAB_LABEL_BY_ID[tabId] || tabId).join(', ');
            logOperationalNotice('저장하지 않고 닫기 확인이 필요한 입력이 있습니다.', {
                dirtyTabs: dirtyLabels,
            });
            if (!window.confirm('저장하지 않은 입력이 있습니다. 저장하지 않고 닫을까요?')) return;
        }

        const statusLines = TAB_META.map((tab) => {
            const dirty = hasDraftTabData(tab.id);
            const saved = savedTabs.includes(tab.id);
            const status = dirty
                ? (saved ? '저장 후 다시 변경됨 — 현재 변경은 미저장' : '변경 후 미저장')
                : (saved ? '저장됨' : '작업하지 않음');
            return `- ${tab.label}: ${status}`;
        });
        window.alert(['이번 통합입력 작업 현황', '', ...statusLines].join('\n'));

        onClose?.();
    };

    const handleModalDateChange = (nextDate) => {
        if (isUploadingSludgePhotos) return;
        const hasUnsaved = TAB_META.some((tab) => hasDraftTabData(tab.id));
        if (hasUnsaved && !window.confirm('저장하지 않은 입력이 있습니다. 날짜를 바꾸면 현재 입력이 사라집니다. 계속할까요?')) {
            return;
        }
        setDate(nextDate);
        setRangeStartDate(nextDate);
        setRangeEndDate(nextDate);
        setSelectedByTab({});
        setDraft({});
        setSavedTabs([]);
        onDateChange?.(nextDate);
    };

    const renderWaterSidebar = () => {
        if (activeTab !== 'water') return null;

        return (
            <div style={{ minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: 10, borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                    {[
                        ['manual', '수동입력'],
                        ['qntech', '자동입력'],
                    ].map(([modeValue, label]) => {
                        const isActive = waterInputMode === modeValue;
                        return (
                            <button
                                key={modeValue}
                                type="button"
                                onClick={() => setWaterInputMode(modeValue)}
                                style={{
                                    ...buttonBaseStyle,
                                    height: 32,
                                    borderColor: isActive ? '#1e293b' : '#cbd5e1',
                                    background: isActive ? '#1e293b' : '#fff',
                                    color: isActive ? '#fff' : '#475569',
                                }}
                            >
                                {label}
                            </button>
                        );
                    })}
                </div>

                {waterInputMode === 'manual' ? (
                    <>
                        <div style={{ overflowY: 'auto', padding: 10, display: 'grid', alignContent: 'start', gap: 6, flex: 1, minHeight: 0 }}>
                            {waterRounds.length === 0 && (
                                <div style={{ padding: '18px 8px', color: '#94a3b8', fontSize: 14, fontWeight: 800, textAlign: 'center' }}>
                                    등록된 회차가 없습니다.
                                </div>
                            )}
                            {waterRounds.map((round) => {
                                const isSelected = round.value === selectedWaterRound;
                                return (
                                    <button
                                        key={`${round.value}-${round.measurementGroup}`}
                                        type="button"
                                        onClick={() => setSelectedWaterRound(round.value)}
                                        style={{
                                            border: `1px solid ${isSelected ? '#2563eb' : '#e2e8f0'}`,
                                            background: isSelected ? '#eff6ff' : '#fff',
                                            color: isSelected ? '#1d4ed8' : '#334155',
                                            borderRadius: 8,
                                            padding: '9px 11px',
                                            cursor: 'pointer',
                                            textAlign: 'left',
                                            fontSize: 15,
                                            fontWeight: 850,
                                        }}
                                    >
                                        <div>{round.label}</div>
                                        <div style={{ marginTop: 2, fontSize: 12, color: '#94a3b8', fontWeight: 700 }}>
                                            {round.sourceType === 'qntech' ? '서버자료' : '수동입력'}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                        <div style={{ padding: 10, borderTop: '1px solid #e2e8f0', background: '#fff' }}>
                            <button
                                type="button"
                                onClick={handleAddWaterRound}
                                style={{ ...buttonBaseStyle, width: '100%', borderColor: '#2563eb', background: '#eff6ff', color: '#1d4ed8' }}
                            >
                                회차 추가
                            </button>
                        </div>
                    </>
                ) : (
                    <div style={{ display: 'grid', gap: 10, padding: 12, flex: 1, alignContent: 'start' }}>
                        <label style={{ display: 'grid', gap: 5 }}>
                            <span style={labelStyle}>시작 날짜</span>
                            <DateOnlyInput value={rangeStartDate} onChange={setRangeStartDate} style={{ width: '100%' }} />
                        </label>
                        <label style={{ display: 'grid', gap: 5 }}>
                            <span style={labelStyle}>종료 날짜</span>
                            <DateOnlyInput value={rangeEndDate} onChange={setRangeEndDate} style={{ width: '100%' }} />
                        </label>
                        {(() => {
                            // 시작/종료 날짜가 같으면 단일 날짜, 다르면 기간으로 판단하여
                            // 사용자가 헷갈리지 않도록 한 번에 하나의 불러오기 버튼만 활성화한다.
                            const hasBoth = Boolean(rangeStartDate && rangeEndDate);
                            const isSameDay = hasBoth && rangeStartDate === rangeEndDate;
                            const isRange = hasBoth && !isSameDay;
                            return (
                            <>
                                <button
                                    type="button"
                                    onClick={async () => {
                                        try {
                                            let importResult = null;
                                            if (isRange) {
                                                importResult = await effectiveImportQntechRange(rangeStartDate, rangeEndDate);
                                            } else if (isSameDay) {
                                                importResult = await effectiveImportQntech(rangeStartDate);
                                            }
                                            if (importResult?.success) {
                                                markTabsSaved(['water', 'kit']);
                                                await onSaveComplete?.({ date, savedTabs: ['water', 'kit'], source: 'qntech' });
                                            }
                                        } catch (error) {
                                            onValidationError?.(`서버에서 가져오기를 시작하지 못했습니다: ${error.message}`);
                                        }
                                    }}
                                    disabled={effectiveIsImportingQntech || !hasBoth}
                                    style={{
                                        ...buttonBaseStyle,
                                        borderColor: '#2563eb',
                                        background: '#eff6ff',
                                        color: '#1d4ed8',
                                        cursor: effectiveIsImportingQntech || !hasBoth ? 'not-allowed' : 'pointer',
                                    }}
                                >
                                    {effectiveIsImportingQntech
                                        ? '서버에서 가져오는 중...'
                                        : isRange
                                            ? '서버에서 기간 가져오기'
                                            : isSameDay
                                                ? '서버에서 가져오기'
                                                : '서버에서 가져오기'}
                                </button>
                                {internalQntechProgress?.message && (
                                    <span style={{ fontSize: 12, color: internalQntechProgress.status === 'error' ? '#dc2626' : '#2563eb', fontWeight: 800, lineHeight: 1.5 }}>
                                        {internalQntechProgress.message}
                                        {internalQntechProgress.totalDates > 0
                                            ? ` (${internalQntechProgress.completedDates || 0}/${internalQntechProgress.totalDates})`
                                            : ''}
                                    </span>
                                )}
                                <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700, lineHeight: 1.5 }}>
                                    시작·종료 날짜가 같으면 해당일만, 다르면 기간을 불러옵니다.
                                </span>
                            </>
                            );
                        })()}
                    </div>
                )}
            </div>
        );
    };

    const renderFields = () => {
        if (activeTab !== 'water' && !selectedItem) {
            return (
                <div style={{ padding: 24, color: '#94a3b8', fontWeight: 700, fontSize: 15 }}>
                    선택할 항목이 없습니다.
                </div>
            );
        }

        if (activeTab === 'flow') {
            const visibleFlowItems = selectedFlowGroup?.items || [];
            const isSludgeGroup = visibleFlowItems.length > 0 && visibleFlowItems.every(isSludgeFlowItem);
            const sludgeItem = isSludgeGroup ? visibleFlowItems[0] : null;
            const sludgeValues = sludgeItem ? getDraftForItem('flow', sludgeItem) : {};
            const hasSludgeAmount = (toNumberOrNull(sludgeValues.reading) || 0) > 0;
            const flowHeaderLabels = isSludgeGroup ? ['항목', '반출량', '월 반출량'] : ['유량계', '검침값', '유량 계산값'];
            return (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(160px, 1fr) repeat(2, minmax(110px, 150px))',
                    alignItems: 'center',
                    overflow: 'hidden',
                    border: '1px solid #e2e8f0',
                    borderRadius: 10,
                    background: '#fff',
                }}>
                    {flowHeaderLabels.map((label, index) => (
                        <div
                            key={label}
                            style={{
                                padding: '8px 10px',
                                background: '#f8fafc',
                                borderBottom: '1px solid #e2e8f0',
                                fontSize: 14,
                                fontWeight: 900,
                                color: '#475569',
                                textAlign: index === 0 ? 'left' : 'center',
                            }}
                        >
                            {label}
                        </div>
                    ))}

                    {visibleFlowItems.map((item) => {
                        const values = getDraftForItem('flow', item);
                        const fieldLabels = isSludgeFlowItem(item)
                            ? [
                                ['reading', '반출량'],
                                ['calculatedFlow', '월 반출량'],
                            ]
                            : [
                                ['reading', '검침값'],
                                ['calculatedFlow', String(item.key || item.label || '').includes('전력') ? '사용량(kWh)' : '유량 계산값'],
                            ];
                        return (
                            <React.Fragment key={item.key}>
                                <div style={{ padding: '10px 12px', borderBottom: '1px solid #f1f5f9', fontSize: 15, fontWeight: 900, color: '#0f172a' }}>
                                    <div>{item.label}</div>
                                    {String(item.key || item.label || '').includes('전력') ? (
                                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 5, fontSize: 12, color: '#475569', cursor: 'pointer' }}>
                                            <input
                                                type="checkbox"
                                                checked={String(values.readingUnit || '').toUpperCase() === 'MWH'}
                                                onChange={(event) => {
                                                    const unit = event.target.checked ? 'MWH' : 'KWH';
                                                    storePowerReadingUnit(unit);
                                                    setFlowDraftFieldForItem(item, 'readingUnit', unit);
                                                }}
                                            />
                                            메가와트시(MWh) 입력
                                        </label>
                                    ) : null}
                                </div>
                                {fieldLabels.map(([field, label]) => (
                                    <div key={`${item.key}-${field}`} style={{ padding: '7px 8px', borderBottom: '1px solid #f1f5f9' }}>
                                        <input
                                            aria-label={`${item.label} ${label}`}
                                            style={{
                                                ...inputStyle,
                                                width: '100%',
                                                height: 34,
                                                padding: '0 8px',
                                                textAlign: 'right',
                                                background: field === 'calculatedFlow' ? '#f8fafc' : '#fff',
                                                color: inputStyle.color,
                                                cursor: 'text',
                                                boxSizing: 'border-box',
                                            }}
                                            value={values[field] ?? ''}
                                            onChange={(e) => setFlowDraftFieldForItem(item, field, e.target.value)}
                                        />
                                    </div>
                                ))}
                            </React.Fragment>
                        );
                    })}
                    {isSludgeGroup && (
                        <div style={{
                            gridColumn: '1 / -1',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            flexWrap: 'wrap',
                            padding: '10px 12px',
                            background: '#f8fafc',
                        }}>
                            <SludgePhotoButton
                                label={`반출사진${sludgePhotoDraft.sludgeFiles.length ? ` (${sludgePhotoDraft.sludgeFiles.length}장)` : ''}`}
                                disabled={!hasSludgeAmount || isLoadingSludgePhotos}
                                busy={isUploadingSludgePhotos}
                                multiple
                                hasPhoto={Boolean(sludgePhotoDraft.sludgeFiles.length || sludgePhotoDraft.sludgePhotoUrl)}
                                onFiles={handleSludgePhotoFiles}
                            />
                            <SludgePhotoButton
                                label="청소필증"
                                disabled={!hasSludgeAmount || isLoadingSludgePhotos}
                                busy={isUploadingSludgePhotos}
                                hasPhoto={Boolean(sludgePhotoDraft.certificateFile || sludgePhotoDraft.certificatePhotoUrl)}
                                onFile={handleCertificatePhotoFile}
                            />
                            {!hasSludgeAmount && (
                                <span style={{ color: '#94a3b8', fontSize: 12, fontWeight: 700 }}>
                                    반출량을 입력하면 사진을 등록할 수 있습니다.
                                </span>
                            )}
                        </div>
                    )}
                </div>
            );
        }

        if (activeTab === 'medicine' || activeTab === 'kit') {
            const isKitTab = activeTab === 'kit';
            const itemLabel = isKitTab ? '키트' : '약품';
            const purchaseLabel = isKitTab ? '구매' : '입고';
            const defaultButtonLabel = defaultPurchaseAppliedByTab[activeTab] ? `${purchaseLabel} 적용 해제` : `${purchaseLabel} 적용`;
            return (
                <div style={{ display: 'grid', gap: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                        <button
                            type="button"
                            onClick={handleToggleDefaultPurchases}
                            style={{
                                ...buttonBaseStyle,
                                padding: '0 14px',
                                borderColor: defaultPurchaseAppliedByTab[activeTab] ? '#f59e0b' : '#2563eb',
                                background: defaultPurchaseAppliedByTab[activeTab] ? '#fffbeb' : '#eff6ff',
                                color: defaultPurchaseAppliedByTab[activeTab] ? '#92400e' : '#1d4ed8',
                            }}
                        >
                            {defaultButtonLabel}
                        </button>
                        {isKitTab && (
                            <>
                                <button
                                    type="button"
                                    onClick={handleLookupExperimentCounts}
                                    disabled={isLookingUpExperimentCounts || !date}
                                    style={{
                                        ...buttonBaseStyle,
                                        padding: '0 14px',
                                        borderColor: '#16a34a',
                                        background: '#f0fdf4',
                                        color: '#166534',
                                        cursor: isLookingUpExperimentCounts || !date ? 'not-allowed' : 'pointer',
                                    }}
                                >
                                    {isLookingUpExperimentCounts ? '조회 중...' : '자동실험횟수 조회'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleAdjustKitUsage(1)}
                                    style={{
                                        ...buttonBaseStyle,
                                        padding: '0 12px',
                                        borderColor: '#7c3aed',
                                        background: '#f5f3ff',
                                        color: '#5b21b6',
                                    }}
                                >
                                    실험+
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleAdjustKitUsage(-1)}
                                    style={{
                                        ...buttonBaseStyle,
                                        padding: '0 12px',
                                        borderColor: '#7c3aed',
                                        background: '#ffffff',
                                        color: '#5b21b6',
                                    }}
                                >
                                    실험-
                                </button>
                            </>
                        )}
                    </div>
                    {isKitTab && experimentLookupMessage && (
                        <div style={{ textAlign: 'right', fontSize: 12, color: '#166534', fontWeight: 800 }}>
                            {experimentLookupMessage}
                        </div>
                    )}

                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(160px, 1fr) repeat(3, minmax(82px, 110px))',
                        alignItems: 'center',
                        overflow: 'hidden',
                        border: '1px solid #e2e8f0',
                        borderRadius: 10,
                        background: '#fff',
                    }}>
                        {[itemLabel, purchaseLabel, '사용', '재고'].map((label) => (
                            <div
                                key={label}
                                style={{
                                    padding: '8px 10px',
                                    background: '#f8fafc',
                                    borderBottom: '1px solid #e2e8f0',
                                    fontSize: 14,
                                    fontWeight: 900,
                                    color: '#475569',
                                    textAlign: label === itemLabel ? 'left' : 'center',
                                }}
                            >
                                {label}
                            </div>
                        ))}

                        {currentItems.map((item) => {
                            const values = getDraftForItem(activeTab, item);
                            return (
                                <React.Fragment key={item.key}>
                                    <div style={{ padding: '10px 12px', borderBottom: '1px solid #f1f5f9', fontSize: 15, fontWeight: 900, color: '#0f172a' }}>
                                        {item.label}
                                    </div>
                                    {[
                                        ['purchase', purchaseLabel],
                                        ['usage', '사용'],
                                        ['inventory', '재고'],
                                    ].map(([field, label]) => (
                                        <div key={`${item.key}-${field}`} style={{ padding: '7px 8px', borderBottom: '1px solid #f1f5f9' }}>
                                            <input
                                                aria-label={`${item.label} ${label}`}
                                                style={{
                                                    ...inputStyle,
                                                    width: '100%',
                                                    height: 34,
                                                    padding: '0 8px',
                                                    textAlign: 'right',
                                                    background: '#fff',
                                                    boxSizing: 'border-box',
                                                }}
                                                value={values[field] ?? ''}
                                                onChange={(e) => setInventoryDraftFieldForItem(activeTab, item, field, e.target.value)}
                                            />
                                        </div>
                                    ))}
                                </React.Fragment>
                            );
                        })}
                    </div>
                </div>
            );
        }

        const activeLocations = currentItems.map((item) => String(item.label || item.key).trim());
        const gridTemplateColumns = `128px repeat(${activeLocations.length}, minmax(76px, 1fr))`;
        const minWidth = 128 + activeLocations.length * 84;

        const itemByLocation = new Map(
            currentItems.map((item) => [String(item.label || item.key).trim(), item])
        );

        return (
            <div className="unified-record-scroll-area" style={{
                overflowX: 'auto',
                scrollbarGutter: 'stable',
                borderRadius: 10,
                background: '#fff',
                boxShadow: 'inset 0 0 0 1px #e2e8f0',
            }}>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns,
                    alignItems: 'center',
                    minWidth,
                    padding: '8px 10px',
                    background: '#f8fafc',
                    borderBottom: '1px solid #e2e8f0',
                    columnGap: 8,
                }}>
                    <div style={{ fontSize: 13, fontWeight: 950, color: '#64748b' }}>항목</div>
                    {activeLocations.map((location) => (
                        <div
                            key={location}
                            style={{
                                fontSize: 13,
                                fontWeight: 950,
                                color: '#334155',
                                textAlign: 'center',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {location}
                        </div>
                    ))}
                </div>

                {WATER_FIELD_META.map((field, index) => (
                    <div
                        key={field.id}
                        style={{
                            display: 'grid',
                            gridTemplateColumns,
                            alignItems: 'center',
                            minWidth,
                            padding: '10px',
                            columnGap: 8,
                            borderBottom: index === WATER_FIELD_META.length - 1 ? 0 : '1px solid #eef2f7',
                        }}
                    >
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 15, fontWeight: 950, color: '#0f172a', lineHeight: 1.2 }}>
                                {field.label}
                            </div>
                            <div style={{ marginTop: 2, fontSize: 12, fontWeight: 900, color: '#64748b' }}>
                                {field.code}
                            </div>
                        </div>

                        {activeLocations.map((location) => {
                            const item = itemByLocation.get(location);
                            const enabled = Boolean(item) && (field.id !== 'po4_p' || isPo4pInputEnabled(item));
                            const values = item ? getDraftForItem('water', item) : {};
                            return (
                                <div key={`${field.id}-${location}`} style={{ display: 'flex', justifyContent: 'center' }}>
                                    <input
                                        disabled={!enabled}
                                        style={{
                                            ...inputStyle,
                                            height: 34,
                                            width: 72,
                                            padding: '0 6px',
                                            fontSize: 14,
                                            boxSizing: 'border-box',
                                            background: enabled ? '#fff' : '#f1f5f9',
                                            color: enabled ? '#0f172a' : '#cbd5e1',
                                            borderColor: enabled ? '#cbd5e1' : '#e2e8f0',
                                            cursor: enabled ? 'text' : 'not-allowed',
                                        }}
                                        value={enabled ? (values[field.id] ?? '') : ''}
                                        onChange={(e) => {
                                            if (enabled) setWaterDraftField(item, field.id, e.target.value);
                                        }}
                                    />
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
        );
    };

    return (
        <>
        <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(15, 23, 42, 0.42)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
        }}>
            <div style={{
                width: activeTab === 'water'
                    ? `min(${Math.max(860, 380 + currentItems.length * 100)}px, calc(100vw - 32px))`
                    : 'min(860px, calc(100vw - 32px))',
                height: 'min(760px, calc(100vh - 32px))',
                background: '#fff',
                borderRadius: 12,
                boxShadow: '0 24px 80px rgba(15, 23, 42, 0.24)',
                display: 'flex',
                flexDirection: 'column',
                minWidth: 0,
                minHeight: 0,
                overflow: 'hidden',
                transform: 'translateY(-6px)',
            }}>
                <div style={{ display: 'grid', gap: 10, padding: '12px 16px 10px', borderBottom: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(170px, 1fr) auto', gap: 12, alignItems: 'center', minWidth: 0 }}>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 19, fontWeight: 900, color: '#0f172a', whiteSpace: 'nowrap' }}>
                                통합 데이터 입력
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#64748b', marginTop: 2 }}>
                                {mode === 'edit' ? '선택 행 수정' : '새 데이터 추가'}
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', minWidth: 0 }}>
                            {canUseBaselineStatus && (
                                <select
                                    value={saveStatusMode}
                                    onChange={(event) => setSaveStatusMode(event.target.value)}
                                    title="저장구분"
                                    style={{
                                        ...inputStyle,
                                        width: 124,
                                        height: 36,
                                        textAlign: 'left',
                                        fontSize: 14,
                                        fontWeight: 900,
                                        flex: '0 0 auto',
                                    }}
                                >
                                    <option value="manual">일반 입력</option>
                                    <option value="baseline">기준값</option>
                                </select>
                            )}

                            <DateOnlyInput
                                value={date}
                                onChange={handleModalDateChange}
                                style={{ width: 140, flex: '0 0 auto' }}
                            />

                            <button type="button" onClick={handleClose} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: '#94a3b8', padding: 4, height: 34, flex: '0 0 auto' }}>
                                <span className="material-icons" style={{ fontSize: 25 }}>close</span>
                            </button>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 6, minWidth: 0, overflowX: 'auto', paddingBottom: 2 }}>
                        {TAB_META.map((tab) => {
                            const isActive = tab.id === activeTab;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => handleTabChange(tab.id)}
                                    style={{
                                        height: 38,
                                        padding: '0 14px',
                                        border: `1px solid ${isActive ? '#1e293b' : '#e2e8f0'}`,
                                        borderRadius: 7,
                                        background: isActive ? '#1e293b' : '#fff',
                                        cursor: 'pointer',
                                        fontSize: 15,
                                        fontWeight: 900,
                                        color: isActive ? '#fff' : '#64748b',
                                        whiteSpace: 'nowrap',
                                        flex: '0 0 auto',
                                    }}
                                >
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: (activeTab === 'medicine' || activeTab === 'kit') ? '1fr' : '210px 1fr', gap: 0, minHeight: 0, flex: 1 }}>
                    {activeTab !== 'medicine' && activeTab !== 'kit' && (
                    <aside style={{ borderRight: '1px solid #e2e8f0', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                        {activeTab === 'water' ? renderWaterSidebar() : (
                            <div style={{ overflowY: 'auto', padding: 10, display: 'grid', alignContent: 'start', gap: 6 }}>
                                {(activeTab === 'flow' ? flowGroups : currentItems).map((item) => {
                                    const isSelected = item.key === selectedKey;
                                    return (
                                        <button
                                            key={item.key}
                                            type="button"
                                            onClick={() => handleSelectItem(item.key)}
                                            style={{
                                                border: `1px solid ${isSelected ? '#2563eb' : '#e2e8f0'}`,
                                                background: isSelected ? '#eff6ff' : '#fff',
                                                color: isSelected ? '#1d4ed8' : '#334155',
                                                borderRadius: 8,
                                                padding: '9px 11px',
                                                cursor: 'pointer',
                                                textAlign: 'left',
                                            fontSize: 15,
                                                fontWeight: 850,
                                            }}
                                        >
                                            {item.label}
                                            {activeTab === 'flow' && item.items?.length > 1 && (
                                                <div style={{ marginTop: 4, fontSize: 12, color: '#64748b', fontWeight: 800 }}>
                                                    {item.items.length}개 유량계
                                                </div>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </aside>
                    )}

                    <main style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                            <div style={{ fontSize: 17, fontWeight: 900, color: '#0f172a' }}>
                                {activeTab === 'water'
                                    ? `수질분석 ${selectedRound?.label || ''}`
                                    : activeTab === 'flow'
                                        ? (selectedFlowGroup?.label || selectedItem?.label || '항목 선택')
                                    : activeTab === 'medicine'
                                        ? '약품 입고/사용/재고'
                                        : activeTab === 'kit'
                                            ? '분석키트 구매/사용/재고'
                                            : (selectedItem?.label || '항목 선택')}
                            </div>
                            <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
                                {(activeTab === 'water'
                                    ? [{ label: '날짜', value: date }, { label: '입력방식', value: selectedRound?.sourceType === 'qntech' ? '서버자료' : '수동입력' }]
                                    : activeTab === 'flow'
                                        ? [{ label: '날짜', value: date }, { label: '항목', value: `${selectedFlowGroup?.items?.length || 0}개` }]
                                    : activeTab === 'medicine' || activeTab === 'kit'
                                        ? [{ label: '날짜', value: date }, { label: '항목', value: `${currentItems.length}개` }]
                                        : (selectedItem?.summary || [])
                                ).map((item) => (
                                    <div key={item.label} style={{ fontSize: 14, color: '#64748b', fontWeight: 800 }}>
                                        {item.label}: <span style={{ color: '#0f172a' }}>{formatValue(item.value)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="unified-record-scroll-area" style={{
                            padding: 18,
                            flex: 1,
                            overflowY: 'auto',
                            scrollbarGutter: 'stable',
                            opacity: isDateContextPending ? 0.55 : 1,
                            pointerEvents: isDateContextPending ? 'none' : 'auto',
                        }}>
                            {renderFields()}
                        </div>
                    </main>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '12px 18px', borderTop: '1px solid #e2e8f0' }}>
                    <button type="button" onClick={handleClose} style={{ padding: '8px 16px', borderRadius: 7, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: 800, color: '#475569' }}>
                        닫기
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={isDateContextPending || isSaving || isUploadingSludgePhotos}
                        style={{
                            padding: '8px 16px',
                            borderRadius: 7,
                            border: 0,
                            background: '#1e293b',
                            cursor: isDateContextPending || isSaving || isUploadingSludgePhotos ? 'wait' : 'pointer',
                            fontWeight: 900,
                            color: '#fff',
                            opacity: isDateContextPending || isSaving || isUploadingSludgePhotos ? 0.65 : 1,
                        }}
                    >
                        {isDateContextPending ? '데이터 확인 중...' : isSaving ? '저장 중...' : isUploadingSludgePhotos ? '사진 저장 중...' : `${TAB_LABEL_BY_ID[activeTab] || '현재 탭'} 저장하기`}
                    </button>
                </div>
            </div>
        </div>
        {usesInternalQntechProgress && internalQntechProgress && (
            <BatchProgressDialog
                isOpen
                title={rangeStartDate === rangeEndDate ? '서버에서 가져오기' : '서버에서 기간 데이터 가져오기'}
                tasks={internalProgressTasks}
                progress={internalProgressPercent}
                isProcessing={isInternalQntechImporting}
                isFinished={!isInternalQntechImporting && (internalProgressStatus === 'success' || internalProgressStatus === 'error')}
                onClose={() => {
                    if (!isInternalQntechImporting) setInternalQntechProgress(null);
                }}
            />
        )}
        </>
    );
}
