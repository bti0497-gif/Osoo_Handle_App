import { useCallback, useEffect, useRef, useState } from 'react';
import { FlowModel } from '../flow/FlowModel';
import { MedicineModel } from '../medicine/MedicineModel';
import { KitModel } from '../kit/KitModel';
import { WaterQualityModel } from '../water/WaterQualityModel';
import { SettingsModel } from '../settings/SettingsModel';

const WATER_FIELDS = ['nh3_n', 'no3_n', 'po4_p', 'alkalinity'];

const hasValue = (value) => value !== '' && value !== null && value !== undefined;
const isDefaulted = (row) => String(row?.input_status || row?.inputStatus || '').trim() === 'defaulted';

const unwrapHistory = (result) => (
    Array.isArray(result) ? result : (Array.isArray(result?.history) ? result.history : [])
);

const buildDefaultAmountMap = (result) => {
    const map = new Map();
    if (!result?.success || !Array.isArray(result.items)) return map;

    result.items.forEach((item) => {
        const name = String(item.item_name ?? item.itemName ?? item.name ?? '').trim();
        if (!name) return;
        const amount = Number(item.default_amount ?? item.defaultAmount ?? 0);
        map.set(name, Number.isFinite(amount) ? amount : 0);
    });

    return map;
};

const latestBefore = (rows, date, predicate) => {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
        const row = rows[index];
        if (row?.date < date && predicate(row)) return row;
    }
    return null;
};

const isSludgeFlowName = (value) => String(value || '').includes('슬러지');

const sumSludgeExportsBefore = (rows, date, flowName, periodLength) => {
    const periodKey = String(date || '').slice(0, periodLength);
    if (!periodKey) return 0;
    return rows.reduce((sum, row) => {
        if (!row?.date || row.date >= date || String(row.date).slice(0, periodLength) !== periodKey) return sum;
        const raw = row?.[flowName]?.raw;
        const amount = raw === '' || raw === null || raw === undefined ? null : Number(raw);
        return Number.isFinite(amount) ? sum + amount : sum;
    }, 0);
};

const mergeFlowContext = (baseContext = {}, history = [], date) => {
    const currentRow = history.find((row) => row?.date === date) || {};
    return {
        ...baseContext,
        items: (baseContext.items || []).map((item) => {
            const name = item.key || item.name || item.label;
            const current = currentRow?.[name] || {};
            const hasCurrent = current.raw !== undefined || current.diff !== undefined;
            const previousRow = latestBefore(history, date, (row) => row?.[name]);
            const previous = previousRow?.[name] || {};
            const basePrevious = item.previous || {};
            const isSludge = isSludgeFlowName(name);
            const currentExport = hasCurrent && !isDefaulted(current) && hasValue(current.raw)
                ? Number(current.raw)
                : null;
            const previousMonthlyExport = isSludge ? sumSludgeExportsBefore(history, date, name, 7) : null;
            const previousYearlyExport = isSludge ? sumSludgeExportsBefore(history, date, name, 4) : null;
            return {
                ...item,
                values: {
                    reading: hasCurrent ? (isDefaulted(current) ? '' : (current.raw ?? '')) : '',
                    flow: isSludge
                        ? previousMonthlyExport + (Number.isFinite(currentExport) ? currentExport : 0)
                        : (hasCurrent ? (isDefaulted(current) ? '' : (current.diff ?? '')) : ''),
                    readingUnit: hasCurrent ? (current.reading_unit || '') : '',
                },
                previous: {
                    ...basePrevious,
                    reading: hasValue(previous.raw) ? previous.raw : (basePrevious.reading ?? ''),
                    flow: hasValue(previous.diff) ? previous.diff : (basePrevious.flow ?? ''),
                    readingUnit: previous.reading_unit || basePrevious.readingUnit || '',
                    ...(isSludge && {
                        monthlyExport: previousMonthlyExport,
                        yearlyExport: previousYearlyExport,
                    }),
                },
            };
        }),
    };
};

const mergeInventoryContext = (baseContext = {}, history = [], date, nameField, defaultAmounts = new Map()) => ({
    ...baseContext,
    items: (baseContext.items || []).map((item) => {
        const name = item.key || item.name || item.label;
        const current = history.find((row) => row?.date === date && row?.[nameField] === name) || {};
        const hasCurrent = Boolean(current?.date);
        const previous = latestBefore(history, date, (row) => row?.[nameField] === name) || {};
        const basePrevious = item.previous || {};
        const defaultAmount = defaultAmounts.has(String(name || '').trim())
            ? defaultAmounts.get(String(name || '').trim())
            : (hasValue(item.defaultPurchase) ? item.defaultPurchase : 0);
        return {
            ...item,
            defaultPurchase: defaultAmount,
            values: {
                purchase: hasCurrent ? (isDefaulted(current) ? '' : (current.purchase_amount ?? '')) : '',
                usage: hasCurrent ? (isDefaulted(current) ? '' : (current.usage_amount ?? '')) : '',
                inventory: hasCurrent ? (isDefaulted(current) ? '' : (current.current_inventory ?? '')) : '',
            },
            previous: {
                ...basePrevious,
                inventory: hasValue(previous.current_inventory)
                    ? previous.current_inventory
                    : (basePrevious.inventory ?? ''),
            },
        };
    }),
});

const getWaterRound = (row, fallback) => {
    const numeric = Number(row?.measurement_order ?? row?.measurementOrder);
    return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
};

const mergeWaterContext = (baseContext = {}, history = [], date) => {
    const dateRows = history.filter((row) => row?.date === date);
    const roundMap = new Map();
    dateRows.forEach((row, index) => {
        const value = getWaterRound(row, index + 1);
        if (!roundMap.has(value)) {
            roundMap.set(value, {
                value,
                label: row?.source_label || row?.sourceLabel || `${value}회차`,
                measurementGroup: row?.measurement_group || row?.measurementGroup || `manual:${date}:${value}`,
                sourceType: row?.source_type || row?.sourceType || 'manual',
                qntechProjectId: row?.qntech_project_id || row?.qntechProjectId || null,
            });
        }
    });

    const existingRounds = Array.isArray(baseContext.rounds) ? baseContext.rounds : [];
    existingRounds.forEach((round) => {
        const value = Number(round?.value);
        if (Number.isFinite(value) && !roundMap.has(value)) roundMap.set(value, round);
    });

    const rounds = [...roundMap.values()].sort((a, b) => Number(a.value) - Number(b.value));
    if (rounds.length === 0) {
        rounds.push({
            value: 1,
            label: '1회차',
            measurementGroup: `manual:${date}:1`,
            sourceType: 'manual',
            qntechProjectId: null,
        });
    }

    return {
        ...baseContext,
        measurementOrder: rounds[0].value,
        rounds,
        items: (baseContext.items || []).map((item) => {
            const location = item.key || item.name || item.label;
            const valuesByRound = { ...(item.valuesByRound || {}) };
            rounds.forEach((round) => {
                const row = dateRows.find((candidate, index) => (
                    candidate?.location === location
                    && getWaterRound(candidate, index + 1) === Number(round.value)
                ));
                valuesByRound[round.value] = WATER_FIELDS.reduce((acc, field) => {
                    acc[field] = hasValue(row?.[field]) ? row[field] : '';
                    return acc;
                }, {});
            });
            return {
                ...item,
                values: valuesByRound[rounds[0].value] || {},
                valuesByRound,
            };
        }),
    };
};

const contextSignature = (contexts = {}) => JSON.stringify(
    ['flow', 'water', 'medicine', 'kit'].map((tab) => ({
        tab,
        items: (contexts?.[tab]?.items || []).map((item) => ({
            key: item.key || item.name || item.label,
            defaultPurchase: item.defaultPurchase,
            po4pApplicable: item.po4pApplicable,
        })),
    }))
);

export function useUnifiedRecordViewModel({ isOpen, date, contexts = {} }) {
    const contextsRef = useRef(contexts);
    contextsRef.current = contexts;
    const signature = contextSignature(contexts);
    const [resolvedContexts, setResolvedContexts] = useState(contexts);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [resolvedDate, setResolvedDate] = useState('');
    const requestSequenceRef = useRef(0);

    const reloadContexts = useCallback(async ({ force = false, tabs = ['flow', 'medicine', 'kit', 'water'] } = {}) => {
        if (!date) return;
        const requestSequence = requestSequenceRef.current + 1;
        requestSequenceRef.current = requestSequence;
        const requestedDate = date;
        const baseContexts = contextsRef.current;
        const targetTabs = new Set(tabs);
        setIsLoading(true);

        try {
            const [
                flowResult,
                medicineResult,
                kitResult,
                waterResult,
                medicineDefaults,
                kitDefaults,
            ] = await Promise.all([
                targetTabs.has('flow') ? FlowModel.fetchHistory({ force }) : null,
                targetTabs.has('medicine') ? MedicineModel.fetchHistory({ force }) : null,
                targetTabs.has('kit') ? KitModel.fetchHistory({ force }) : null,
                targetTabs.has('water') ? WaterQualityModel.fetchHistory({ force }) : null,
                targetTabs.has('medicine')
                    ? SettingsModel.getMedicineDefaults().catch(() => ({ success: false, items: [] }))
                    : null,
                targetTabs.has('kit')
                    ? SettingsModel.getKitDefaults().catch(() => ({ success: false, items: [] }))
                    : null,
            ]);
            const medicineDefaultMap = buildDefaultAmountMap(medicineDefaults);
            const kitDefaultMap = buildDefaultAmountMap(kitDefaults);
            if (requestSequence !== requestSequenceRef.current) return;
            setResolvedContexts((previous) => ({
                ...previous,
                ...(targetTabs.has('flow') && {
                    flow: mergeFlowContext(baseContexts.flow, unwrapHistory(flowResult), date),
                }),
                ...(targetTabs.has('medicine') && {
                    medicine: mergeInventoryContext(baseContexts.medicine, unwrapHistory(medicineResult), date, 'medicine_name', medicineDefaultMap),
                }),
                ...(targetTabs.has('kit') && {
                    kit: mergeInventoryContext(baseContexts.kit, unwrapHistory(kitResult), date, 'kit_name', kitDefaultMap),
                }),
                ...(targetTabs.has('water') && {
                    water: mergeWaterContext(baseContexts.water, unwrapHistory(waterResult), date),
                }),
            }));
            setResolvedDate(requestedDate);
        } catch (error) {
            if (requestSequence !== requestSequenceRef.current) return;
            console.error('[unified-record] failed to load contexts:', error);
            setResolvedContexts(baseContexts);
            setResolvedDate(requestedDate);
        } finally {
            if (requestSequence === requestSequenceRef.current) setIsLoading(false);
        }
    }, [date]);

    useEffect(() => {
        if (!isOpen || !date) return undefined;
        let cancelled = false;

        Promise.resolve()
            .then(() => reloadContexts({ force: false }))
            .catch((error) => {
                if (!cancelled) console.error('[unified-record] failed to load contexts:', error);
            });

        return () => {
            cancelled = true;
        };
    }, [isOpen, date, signature, reloadContexts]);

    const saveAllTabs = useCallback(async ({ flowItems, medicineItems, waterItems, kitItems }) => {
        const savedTabs = [];
        setIsSaving(true);
        try {
            if (flowItems.length > 0) {
                const result = await FlowModel.bulkSave(date, flowItems);
                if (!result?.success) throw new Error(result?.error || '유량관리 저장에 실패했습니다.');
                savedTabs.push('flow');
            }
            if (medicineItems.length > 0) {
                const result = await MedicineModel.bulkSave(medicineItems);
                if (!result?.success) throw new Error(result?.error || '약품관리 저장에 실패했습니다.');
                savedTabs.push('medicine');
            }
            if (waterItems.length > 0) {
                const result = await WaterQualityModel.bulkSave(waterItems);
                if (!result?.success) throw new Error(result?.error || '수질분석 저장에 실패했습니다.');
                savedTabs.push('water');
            }
            if (kitItems.length > 0) {
                const result = await KitModel.bulkSave(kitItems);
                if (!result?.success) throw new Error(result?.error || '키트관리 저장에 실패했습니다.');
                savedTabs.push('kit');
            }
            if (savedTabs.length > 0) {
                await reloadContexts({ force: true, tabs: savedTabs });
            }
            return { success: true, savedTabs };
        } catch (error) {
            return { success: false, savedTabs, error: error.message };
        } finally {
            setIsSaving(false);
        }
    }, [date, reloadContexts]);

    return {
        contexts: resolvedContexts,
        // Only a date transition may block editing. A same-date refresh after
        // save must not freeze every input while the latest values are read.
        isDateContextPending: resolvedDate !== date,
        isRefreshing: isLoading,
        isSaving,
        saveAllTabs,
        reloadContexts,
    };
}
