import { useCallback, useEffect, useRef, useState } from 'react';
import { FlowModel } from '../flow/FlowModel';
import { MedicineModel } from '../medicine/MedicineModel';
import { KitModel } from '../kit/KitModel';
import { WaterQualityModel } from '../water/WaterQualityModel';

const WATER_FIELDS = ['nh3_n', 'no3_n', 'po4_p', 'alkalinity'];

const hasValue = (value) => value !== '' && value !== null && value !== undefined;
const isDefaulted = (row) => String(row?.input_status || row?.inputStatus || '').trim() === 'defaulted';

const unwrapHistory = (result) => (
    Array.isArray(result) ? result : (Array.isArray(result?.history) ? result.history : [])
);

const latestBefore = (rows, date, predicate) => {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
        const row = rows[index];
        if (row?.date < date && predicate(row)) return row;
    }
    return null;
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
            const baseValues = item.values || {};
            const basePrevious = item.previous || {};
            return {
                ...item,
                values: {
                    reading: hasCurrent ? (isDefaulted(current) ? '' : (current.raw ?? '')) : (baseValues.reading ?? ''),
                    flow: hasCurrent ? (isDefaulted(current) ? '' : (current.diff ?? '')) : (baseValues.flow ?? ''),
                },
                previous: {
                    ...basePrevious,
                    reading: hasValue(basePrevious.reading) ? basePrevious.reading : (previous.raw ?? ''),
                    flow: hasValue(basePrevious.flow) ? basePrevious.flow : (previous.diff ?? ''),
                },
            };
        }),
    };
};

const mergeInventoryContext = (baseContext = {}, history = [], date, nameField) => ({
    ...baseContext,
    items: (baseContext.items || []).map((item) => {
        const name = item.key || item.name || item.label;
        const current = history.find((row) => row?.date === date && row?.[nameField] === name) || {};
        const hasCurrent = Boolean(current?.date);
        const previous = latestBefore(history, date, (row) => row?.[nameField] === name) || {};
        const baseValues = item.values || {};
        const basePrevious = item.previous || {};
        return {
            ...item,
            values: {
                purchase: hasCurrent ? (isDefaulted(current) ? '' : (current.purchase_amount ?? '')) : (baseValues.purchase ?? ''),
                usage: hasCurrent ? (isDefaulted(current) ? '' : (current.usage_amount ?? '')) : (baseValues.usage ?? ''),
                inventory: hasCurrent ? (isDefaulted(current) ? '' : (current.current_inventory ?? '')) : (baseValues.inventory ?? ''),
            },
            previous: {
                ...basePrevious,
                inventory: hasValue(basePrevious.inventory)
                    ? basePrevious.inventory
                    : (previous.current_inventory ?? ''),
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
                const baseValues = valuesByRound[round.value] || {};
                valuesByRound[round.value] = WATER_FIELDS.reduce((acc, field) => {
                    acc[field] = hasValue(baseValues[field]) ? baseValues[field] : (row?.[field] ?? '');
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

    const reloadContexts = useCallback(async ({ force = false } = {}) => {
        if (!date) return;
        const baseContexts = contextsRef.current;
        setIsLoading(true);

        try {
            const [flowResult, medicineResult, kitResult, waterResult] = await Promise.all([
                FlowModel.fetchHistory({ force }),
                MedicineModel.fetchHistory({ force }),
                KitModel.fetchHistory({ force }),
                WaterQualityModel.fetchHistory({ force }),
            ]);
            setResolvedContexts({
                flow: mergeFlowContext(baseContexts.flow, unwrapHistory(flowResult), date),
                medicine: mergeInventoryContext(baseContexts.medicine, unwrapHistory(medicineResult), date, 'medicine_name'),
                kit: mergeInventoryContext(baseContexts.kit, unwrapHistory(kitResult), date, 'kit_name'),
                water: mergeWaterContext(baseContexts.water, unwrapHistory(waterResult), date),
            });
        } catch (error) {
            console.error('[unified-record] failed to load contexts:', error);
            setResolvedContexts(baseContexts);
        } finally {
            setIsLoading(false);
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
                await reloadContexts({ force: true });
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
        isLoading,
        isSaving,
        saveAllTabs,
    };
}
