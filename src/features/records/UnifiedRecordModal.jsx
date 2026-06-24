import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useUnifiedRecordViewModel } from './useUnifiedRecordViewModel';

const TAB_META = [
    { id: 'flow', label: '유량관리' },
    { id: 'water', label: '수질분석' },
    { id: 'medicine', label: '약품관리' },
    { id: 'kit', label: '키트관리' },
];

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

const formatValue = (value) => {
    if (value === null || value === undefined || value === '') return '-';
    if (Number.isFinite(Number(value))) return Number(value).toLocaleString();
    return String(value);
};

const inputStyle = {
    height: 34,
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    padding: '0 10px',
    fontSize: 13,
    fontWeight: 700,
    color: '#0f172a',
    textAlign: 'right',
    background: '#fff',
};

const labelStyle = {
    fontSize: 12,
    fontWeight: 800,
    color: '#475569',
};

const buttonBaseStyle = {
    height: 34,
    borderRadius: 7,
    border: '1px solid #cbd5e1',
    background: '#fff',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 900,
    color: '#334155',
};

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
        return {
            reading: item.values?.reading ?? '',
            calculatedFlow: item.values?.flow ?? '',
        };
    }

    if (tabId === 'medicine' || tabId === 'kit') {
        const purchase = item.values?.purchase ?? '';
        const usage = toNumberOrNull(item.values?.usage) ?? 0;
        const previousInventory = toNumberOrNull(item.previous?.inventory) || 0;
        const savedInventory = toNumberOrNull(item.values?.inventory);
        return {
            purchase,
            usage,
            inventory: savedInventory
                ?? round1(previousInventory + (toNumberOrNull(purchase) || 0) - usage),
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
    initialTab = 'flow',
    initialDate = '',
    contexts = {},
    isImportingQntech = false,
    isSyncingAnalysisKits = false,
    onClose,
    onSaveComplete,
    onImportQntech,
    onImportQntechRange,
    onSyncAnalysisKits,
    onValidationError,
    onDateChange,
}) {
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
    const wasOpenRef = useRef(false);
    const initialWaterSignature = JSON.stringify({
        measurementOrder: contexts.water?.measurementOrder || 1,
        rounds: contexts.water?.rounds || [],
    });
    const {
        contexts: resolvedContexts,
        isLoading: isLoadingUnifiedData,
        isSaving,
        saveAllTabs,
    } = useUnifiedRecordViewModel({ isOpen, date, contexts });

    useEffect(() => {
        const isOpening = isOpen && !wasOpenRef.current;
        wasOpenRef.current = isOpen;
        if (!isOpen) return;

        const timer = setTimeout(() => {
            const waterContext = JSON.parse(initialWaterSignature);
            const rounds = normalizeRoundOptions(waterContext.rounds, waterContext.measurementOrder || 1);
            setActiveTab(initialTab);
            setDate(initialDate);
            setRangeStartDate(initialDate);
            setRangeEndDate(initialDate);
            setSelectedByTab({});
            setDraft({});
            setDefaultPurchaseAppliedByTab({});
            setWaterRounds(rounds);
            setSelectedWaterRound(rounds[0]?.value || 1);
            if (isOpening) {
                setWaterInputMode('manual');
            }
        }, 0);
        return () => clearTimeout(timer);
    }, [isOpen, initialTab, initialDate, initialWaterSignature]);

    useEffect(() => {
        if (!isOpen || isLoadingUnifiedData) return;
        const waterContext = resolvedContexts.water || {};
        const rounds = normalizeRoundOptions(waterContext.rounds, waterContext.measurementOrder || 1);
        const timer = setTimeout(() => {
            setWaterRounds(rounds);
            setSelectedWaterRound((current) => (
                rounds.some((round) => round.value === current) ? current : (rounds[0]?.value || 1)
            ));
        }, 0);
        return () => clearTimeout(timer);
    }, [isOpen, isLoadingUnifiedData, resolvedContexts.water]);

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
            inventory: round1(previousInventory + purchase - usage),
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
            const nextDraft = {
                ...(prev[key] || buildInitialDraft('flow', item)),
                [field]: value,
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

            if (!isSludge && mode !== 'edit' && field === 'reading') {
                const reading = toNumberOrNull(value);
                const previousReading = toNumberOrNull(item?.previous?.reading);
                if (reading !== null && previousReading !== null) {
                    nextDraft.calculatedFlow = round1(reading - previousReading);
                }
            }

            if (!isSludge && mode !== 'edit' && field === 'calculatedFlow') {
                const calculatedFlow = toNumberOrNull(value);
                const previousReading = toNumberOrNull(item?.previous?.reading);
                if (calculatedFlow !== null && previousReading !== null) {
                    nextDraft.reading = round1(previousReading + calculatedFlow);
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
            };

            if (field === 'purchase' || field === 'usage') {
                Object.assign(nextDraft, recalculateInventoryDraft(item, nextDraft));
            }

            if (field === 'inventory') {
                const inventory = toNumberOrNull(value);
                const previousInventory = toNumberOrNull(item?.previous?.inventory) || 0;
                const purchase = toNumberOrNull(nextDraft.purchase) || 0;
                if (inventory !== null) {
                    nextDraft.usage = round1(previousInventory + purchase - inventory);
                }
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

        setDraft((prev) => {
            const next = { ...prev };
            currentItems.forEach((item) => {
                const key = getDraftKeyForItem('kit', item);
                const current = next[key] || buildInitialDraft('kit', item);
                const currentUsage = toNumberOrNull(current.usage) || 0;
                const previousInventory = toNumberOrNull(item?.previous?.inventory) || 0;
                const purchase = toNumberOrNull(current.purchase) || 0;
                const nextUsage = round1(Math.max(0, currentUsage + delta));
                const nextInventory = round1(previousInventory + purchase - nextUsage);
                if (delta > 0 && nextInventory < 0) {
                    return;
                }
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

    const buildAllTabSavePlan = () => {
        const flowMissing = [];
        const notices = [];
        const flowItemsToSave = [];
        const medicineItemsToSave = [];
        const kitItemsToSave = [];
        const waterItemsToSave = [];

        (resolvedContexts.flow?.items || []).forEach((item) => {
            const values = getDraftForItem('flow', item);
            const reading = toNumberOrNull(values.reading);
            const calculatedFlow = toNumberOrNull(values.calculatedFlow);
            const isSludge = isSludgeFlowItem(item);

            // 슬러지 반출이 없는 날은 빈칸이 정상이다.
            if (reading === null && isSludge) return;
            if (reading === null) {
                flowMissing.push({
                    tab: 'flow',
                    item,
                    message: `${item.label || item.key} 검침값`,
                });
                return;
            }
            flowItemsToSave.push({
                type: item.key || item.name || item.label,
                raw_value: reading,
                calculated_flow: calculatedFlow,
                sludge_export: isSludge ? reading : null,
                is_manual: true,
                is_reset: false,
            });
        });

        const zeroUsageMedicines = [];
        const collectInventoryItems = (tab, nameField, target) => {
            (resolvedContexts[tab]?.items || []).forEach((item) => {
                const values = getDraftForItem(tab, item);
                const purchase = toNumberOrNull(values.purchase);
                const usage = toNumberOrNull(values.usage) ?? 0;
                const previousInventory = toNumberOrNull(item?.previous?.inventory) || 0;
                const inventory = toNumberOrNull(values.inventory)
                    ?? round1(previousInventory + (purchase || 0) - usage);
                if (tab === 'medicine' && usage === 0) {
                    zeroUsageMedicines.push(item.label || item.key);
                }
                target.push({
                    date,
                    [nameField]: item.key || item.name || item.label,
                    purchase_amount: purchase ?? 0,
                    usage_amount: usage,
                    current_inventory: inventory,
                });
            });
        };

        collectInventoryItems('medicine', 'medicine_name', medicineItemsToSave);
        collectInventoryItems('kit', 'kit_name', kitItemsToSave);

        const waterUsageByKit = new Map([
            ['nh3_n', { kitName: '암모니아성질소(NH3-N)', count: 0 }],
            ['no3_n', { kitName: '질산성질소(NO3-N)', count: 0 }],
            ['po4_p', { kitName: '인산염인(PO4-P)', count: 0 }],
            ['alkalinity', { kitName: '알칼리도(ALK)', count: 0 }],
        ]);
        let hasAnyWaterValue = false;
        let hasPartialWaterInput = false;
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
                enabledFields.forEach((field) => {
                    if (toNumberOrNull(values[field.id]) !== null) {
                        const usage = waterUsageByKit.get(field.id);
                        if (usage) usage.count += 1;
                    }
                });
                waterItemsToSave.push({
                    date,
                    measurement_group: round.sourceType === 'qntech'
                        ? round.measurementGroup
                        : `manual:${date}:${round.value}`,
                    measurement_order: round.value,
                    source_type: round.sourceType || 'manual',
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

        waterUsageByKit.forEach(({ kitName, count }) => {
            if (count <= 0) return;
            const kitRow = kitItemsToSave.find((item) => item.kit_name === kitName);
            if (!kitRow) return;
            if (kitRow.usage_amount < count) {
                const kitContext = (resolvedContexts.kit?.items || []).find(
                    (item) => (item.key || item.name || item.label) === kitName
                );
                const previousInventory = toNumberOrNull(kitContext?.previous?.inventory) || 0;
                kitRow.usage_amount = count;
                kitRow.current_inventory = round1(
                    previousInventory + kitRow.purchase_amount - kitRow.usage_amount
                );
            }
        });

        if (zeroUsageMedicines.length > 0) {
            notices.push(`사용되지 않은 약품: ${zeroUsageMedicines.join(', ')}`);
        }
        const hasAnyKitUsage = kitItemsToSave.some((item) => item.usage_amount > 0);
        if (!hasAnyWaterValue && !hasAnyKitUsage) {
            notices.push('실험분석값과 키트 사용량이 없습니다.');
        } else if (hasPartialWaterInput) {
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

    const handleSave = async () => {
        if (isLoadingUnifiedData || isSaving) return;
        const plan = buildAllTabSavePlan();

        if (plan.flowMissing.length > 0) {
            focusMissingInput(plan.flowMissing[0]);
            notifyValidation('유량탭에서 입력이 없는 항목이 있습니다.');
            return;
        }

        const result = await saveAllTabs(plan);
        if (!result.success) {
            notifyValidation(`일부 데이터 저장에 실패했습니다. ${result.error || ''}`.trim());
            return;
        }

        await onSaveComplete?.({ date, savedTabs: result.savedTabs });
        if (plan.notices.length > 0) {
            notifyValidation(plan.notices.join('\n'));
        } else {
            notifyValidation('입력된 데이터가 저장되었습니다.');
        }
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
                                <div style={{ padding: '18px 8px', color: '#94a3b8', fontSize: 12, fontWeight: 800, textAlign: 'center' }}>
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
                                            fontSize: 13,
                                            fontWeight: 850,
                                        }}
                                    >
                                        <div>{round.label}</div>
                                        <div style={{ marginTop: 2, fontSize: 10, color: '#94a3b8', fontWeight: 700 }}>
                                            {round.sourceType === 'qntech' ? 'QnTECH' : '수동입력'}
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
                        <button
                            type="button"
                            onClick={async () => {
                                await onImportQntechRange?.(rangeStartDate, rangeEndDate);
                            }}
                            disabled={isImportingQntech || !rangeStartDate || !rangeEndDate}
                            style={{
                                ...buttonBaseStyle,
                                borderColor: '#0f766e',
                                background: '#f0fdfa',
                                color: '#115e59',
                                cursor: isImportingQntech || !rangeStartDate || !rangeEndDate ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {isImportingQntech ? '불러오는 중...' : '불러오기'}
                        </button>
                        <button
                            type="button"
                            onClick={async () => {
                                await onImportQntech?.(date);
                            }}
                            disabled={isImportingQntech || !date}
                            style={{
                                ...buttonBaseStyle,
                                borderColor: '#2563eb',
                                background: '#eff6ff',
                                color: '#1d4ed8',
                                cursor: isImportingQntech || !date ? 'not-allowed' : 'pointer',
                            }}
                        >
                            현재 날짜만 불러오기
                        </button>
                    </div>
                )}
            </div>
        );
    };

    const renderFields = () => {
        if (activeTab !== 'water' && !selectedItem) {
            return (
                <div style={{ padding: 24, color: '#94a3b8', fontWeight: 700, fontSize: 13 }}>
                    선택할 항목이 없습니다.
                </div>
            );
        }

        if (activeTab === 'flow') {
            const visibleFlowItems = selectedFlowGroup?.items || [];
            const isSludgeGroup = visibleFlowItems.length > 0 && visibleFlowItems.every(isSludgeFlowItem);
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
                                fontSize: 12,
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
                        const isSludgeItem = isSludgeFlowItem(item);
                        const fieldLabels = isSludgeFlowItem(item)
                            ? [
                                ['reading', '반출량'],
                                ['calculatedFlow', '월 반출량'],
                            ]
                            : [
                                ['reading', '검침값'],
                                ['calculatedFlow', '유량 계산값'],
                            ];
                        return (
                            <React.Fragment key={item.key}>
                                <div style={{ padding: '9px 10px', borderBottom: '1px solid #f1f5f9', fontSize: 13, fontWeight: 900, color: '#0f172a' }}>
                                    {item.label}
                                </div>
                                {fieldLabels.map(([field, label]) => (
                                    <div key={`${item.key}-${field}`} style={{ padding: '7px 8px', borderBottom: '1px solid #f1f5f9' }}>
                                        <input
                                            aria-label={`${item.label} ${label}`}
                                            readOnly={isSludgeItem && field === 'calculatedFlow'}
                                            style={{
                                                ...inputStyle,
                                                width: '100%',
                                                height: 30,
                                                padding: '0 7px',
                                                textAlign: 'right',
                                                background: field === 'calculatedFlow' ? '#f8fafc' : '#fff',
                                                color: isSludgeItem && field === 'calculatedFlow' ? '#64748b' : inputStyle.color,
                                                cursor: isSludgeItem && field === 'calculatedFlow' ? 'default' : 'text',
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
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
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
                                    onClick={() => onSyncAnalysisKits?.(date)}
                                    disabled={isSyncingAnalysisKits || !date}
                                    style={{
                                        ...buttonBaseStyle,
                                        padding: '0 14px',
                                        borderColor: '#16a34a',
                                        background: '#f0fdf4',
                                        color: '#166534',
                                        cursor: isSyncingAnalysisKits || !date ? 'not-allowed' : 'pointer',
                                    }}
                                >
                                    {isSyncingAnalysisKits ? '동기화 중...' : '분석키트 동기화'}
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
                                    fontSize: 12,
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
                                    <div style={{ padding: '9px 10px', borderBottom: '1px solid #f1f5f9', fontSize: 13, fontWeight: 900, color: '#0f172a' }}>
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
                                                    height: 30,
                                                    padding: '0 7px',
                                                    textAlign: 'right',
                                                    background: field === 'inventory' ? '#f8fafc' : '#fff',
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
            <div style={{
                overflowX: 'auto',
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
                    <div style={{ fontSize: 11, fontWeight: 950, color: '#64748b' }}>항목</div>
                    {activeLocations.map((location) => (
                        <div
                            key={location}
                            style={{
                                fontSize: 11,
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
                            <div style={{ fontSize: 13, fontWeight: 950, color: '#0f172a', lineHeight: 1.2 }}>
                                {field.label}
                            </div>
                            <div style={{ marginTop: 2, fontSize: 10.5, fontWeight: 900, color: '#64748b' }}>
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
                                            height: 28,
                                            width: 64,
                                            padding: '0 6px',
                                            fontSize: 12,
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
                width: 'min(860px, 94vw)',
                height: 'min(520px, 84vh)',
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
                <div style={{ display: 'grid', gridTemplateColumns: '210px 1fr auto auto', gap: 14, alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 17, fontWeight: 900, color: '#0f172a', whiteSpace: 'nowrap' }}>
                            통합 데이터 입력
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginTop: 2 }}>
                            {mode === 'edit' ? '선택 행 수정' : '새 데이터 추가'}
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 4, minWidth: 0, overflowX: 'auto' }}>
                        {TAB_META.map((tab) => {
                            const isActive = tab.id === activeTab;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => handleTabChange(tab.id)}
                                    style={{
                                        height: 34,
                                        padding: '0 14px',
                                        border: `1px solid ${isActive ? '#1e293b' : '#e2e8f0'}`,
                                        borderRadius: 7,
                                        background: isActive ? '#1e293b' : '#fff',
                                        cursor: 'pointer',
                                        fontSize: 13,
                                        fontWeight: 900,
                                        color: isActive ? '#fff' : '#64748b',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>

                    <DateOnlyInput
                        value={date}
                        onChange={(nextDate) => {
                            setDate(nextDate);
                            setRangeStartDate(nextDate);
                            setRangeEndDate(nextDate);
                            setSelectedByTab({});
                            setDraft({});
                            onDateChange?.(nextDate);
                        }}
                        style={{ width: 138 }}
                    />

                    <button type="button" onClick={onClose} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: '#94a3b8', padding: 4, height: 34 }}>
                        <span className="material-icons" style={{ fontSize: 25 }}>close</span>
                    </button>
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
                                                fontSize: 13,
                                                fontWeight: 850,
                                            }}
                                        >
                                            {item.label}
                                            {activeTab === 'flow' && item.items?.length > 1 && (
                                                <div style={{ marginTop: 4, fontSize: 11, color: '#64748b', fontWeight: 800 }}>
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
                            <div style={{ fontSize: 15, fontWeight: 900, color: '#0f172a' }}>
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
                                    ? [{ label: '날짜', value: date }, { label: '입력방식', value: selectedRound?.sourceType === 'qntech' ? 'QnTECH' : '수동입력' }]
                                    : activeTab === 'flow'
                                        ? [{ label: '날짜', value: date }, { label: '항목', value: `${selectedFlowGroup?.items?.length || 0}개` }]
                                    : activeTab === 'medicine' || activeTab === 'kit'
                                        ? [{ label: '날짜', value: date }, { label: '항목', value: `${currentItems.length}개` }]
                                        : (selectedItem?.summary || [])
                                ).map((item) => (
                                    <div key={item.label} style={{ fontSize: 12, color: '#64748b', fontWeight: 800 }}>
                                        {item.label}: <span style={{ color: '#0f172a' }}>{formatValue(item.value)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div style={{
                            padding: 18,
                            flex: 1,
                            overflowY: 'auto',
                            opacity: isLoadingUnifiedData ? 0.55 : 1,
                            pointerEvents: isLoadingUnifiedData || isSaving ? 'none' : 'auto',
                        }}>
                            {renderFields()}
                        </div>
                    </main>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '12px 18px', borderTop: '1px solid #e2e8f0' }}>
                    <button type="button" onClick={onClose} style={{ padding: '8px 16px', borderRadius: 7, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: 800, color: '#475569' }}>
                        닫기
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={isLoadingUnifiedData || isSaving}
                        style={{
                            padding: '8px 16px',
                            borderRadius: 7,
                            border: 0,
                            background: '#1e293b',
                            cursor: isLoadingUnifiedData || isSaving ? 'wait' : 'pointer',
                            fontWeight: 900,
                            color: '#fff',
                            opacity: isLoadingUnifiedData || isSaving ? 0.65 : 1,
                        }}
                    >
                        {isLoadingUnifiedData ? '데이터 확인 중...' : isSaving ? '전체 저장 중...' : '전체 저장하기'}
                    </button>
                </div>
            </div>
        </div>
    );
}
