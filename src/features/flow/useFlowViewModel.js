import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlowModel } from './FlowModel';
import { getTodayKST } from '../../core/constants';

const DEFAULT_FLOW_TYPES = ['유입유량계', '방류유량계', '내부반송유량계', '외부반송유량계', '전력량계', '슬러지'];

const toNumberOrNull = (value) => {
    if (value === '' || value === null || value === undefined) return null;
    const parsed = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
};

const round1 = (value) => Math.round(value * 10) / 10;

function buildEmptyRow(date, flowTypes, extra = {}) {
    const row = { date, ...extra };
    flowTypes.forEach((type) => {
        row[type] = { raw: null, diff: null };
    });
    return row;
}

function mergeLegacyFlowKeysForDisplay(rows, flowTypes) {
    if (!Array.isArray(rows) || !Array.isArray(flowTypes) || flowTypes.length === 0) return rows;

    const types = new Set(flowTypes);
    const legacyPairs = [
        { legacy: '내부반송유량계', modern: '내부반송유량계1' },
        { legacy: '외부반송유량계', modern: '외부반송유량계1' },
    ];

    const cellHasData = (cell) => cell && (cell.raw != null || cell.diff != null);

    return rows.map((row) => {
        let touched = false;
        const next = { ...row };

        for (const { legacy, modern } of legacyPairs) {
            if (!types.has(modern) || types.has(legacy)) continue;
            if (!cellHasData(row[legacy]) || cellHasData(row[modern])) continue;
            next[modern] = { ...row[legacy] };
            touched = true;
        }

        return touched ? next : row;
    });
}

function findPreviousReading(rows, currentIndex, type) {
    for (let i = currentIndex - 1; i >= 0; i -= 1) {
        const raw = rows[i]?.[type]?.raw;
        const parsed = toNumberOrNull(raw);
        if (parsed !== null) return parsed;
    }
    return null;
}

function findPreviousSludgeCumulative(rows, currentIndex, rowDate, type) {
    const currentYear = String(rowDate || '').slice(0, 4);

    for (let i = currentIndex - 1; i >= 0; i -= 1) {
        if (String(rows[i].date || '').slice(0, 4) !== currentYear) break;
        const flow = toNumberOrNull(rows[i]?.[type]?.diff);
        if (flow !== null) return flow;
    }

    return 0;
}

function recalculateFromIndex(rows, startIndex, type, isManualAtStart) {
    const pendingByDate = new Map();

    for (let i = startIndex; i < rows.length; i += 1) {
        const row = rows[i];
        const previousCell = row[type] || {};
        const raw = toNumberOrNull(previousCell.raw);
        let diff = null;
        let error = null;

        if (type === '슬러지') {
            if (raw !== null) {
                diff = round1(findPreviousSludgeCumulative(rows, i, row.date, type) + raw);
                if (raw < 0) error = '반출량은 음수일 수 없습니다.';
                if (raw > 10000) error = '입력값이 정상 범위를 초과합니다.';
            }
        } else if (raw !== null) {
            const previousReading = findPreviousReading(rows, i, type);
            if (previousReading !== null) {
                diff = round1(raw - previousReading);
                if (raw < previousReading) error = '전날 검침값보다 작습니다.';
                if (diff > 5000000) error = '입력값이 비정상적으로 큽니다.';
            }
        }

        rows[i] = {
            ...row,
            [type]: {
                ...previousCell,
                raw,
                diff,
                error,
                isChanged: true,
                isUserInput: i === startIndex,
            },
        };

        pendingByDate.set(row.date, {
            raw,
            diff,
            error,
            isManual: i === startIndex && isManualAtStart,
        });
    }

    return pendingByDate;
}

export const useFlowViewModel = (currentUser, { showAlert, flowTypes: flowTypesProp } = {}) => {
    const flowTypesKey = useMemo(() => {
        if (!Array.isArray(flowTypesProp) || flowTypesProp.length === 0) return '';
        return flowTypesProp.join('|');
    }, [flowTypesProp]);

    const flowTypesResolved = useMemo(() => {
        if (!flowTypesKey) return DEFAULT_FLOW_TYPES.slice();
        return flowTypesKey.split('|');
    }, [flowTypesKey]);

    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [pendingChanges, setPendingChanges] = useState({});
    const pendingChangesRef = useRef({});

    const correctData = useCallback((data) => {
        if (!data) return { reading: null, flow: null, error: null };
        return { reading: data.raw, flow: data.diff, error: data.error };
    }, []);

    const loadReadings = useCallback(async (options = {}) => {
        setLoading(true);
        try {
            const todayStr = getTodayKST();
            const todayAnchor = new Date(`${todayStr}T12:00:00`);
            const historyData = await FlowModel.fetchHistory({ force: options.force });

            if (!historyData.success) return;

            const hist = Array.isArray(historyData.history)
                ? historyData.history.filter((row) => String(row?.date || '') <= todayStr)
                : [];
            hist.sort((a, b) => a.date.localeCompare(b.date));

            if (hist.length > 0) {
                const firstDateStr = hist[0].date > todayStr ? todayStr : hist[0].date;
                const existingDates = new Set(hist.map((row) => row.date));
                const currentDate = new Date(`${firstDateStr}T12:00:00`);

                while (currentDate < todayAnchor) {
                    const ds = currentDate.toISOString().split('T')[0];
                    if (!existingDates.has(ds)) {
                        hist.push(buildEmptyRow(ds, flowTypesResolved));
                        existingDates.add(ds);
                    }
                    currentDate.setDate(currentDate.getDate() + 1);
                }
            }

            if (!hist.find((row) => row.date === todayStr)) {
                hist.push(buildEmptyRow(todayStr, flowTypesResolved));
            }

            for (let i = 1; i <= 5; i += 1) {
                const futureDate = new Date(todayAnchor);
                futureDate.setDate(todayAnchor.getDate() + i);
                const ds = futureDate.toISOString().split('T')[0];
                if (!hist.find((row) => row.date === ds)) {
                    hist.push(buildEmptyRow(ds, flowTypesResolved, { isFuture: true }));
                }
            }

            hist.sort((a, b) => a.date.localeCompare(b.date));
            setHistory(mergeLegacyFlowKeysForDisplay(hist, flowTypesResolved));
            setPendingChanges({});
            pendingChangesRef.current = {};
        } catch (err) {
            console.error(err);
            showAlert?.(`유량 데이터 로드 실패: ${err.message}`);
        } finally {
            setLoading(false);
        }
    }, [flowTypesResolved, showAlert]);

    useEffect(() => {
        loadReadings();
    }, [loadReadings]);

    const updateReading = (rowDate, type, rawValue) => {
        const raw = toNumberOrNull(rawValue);
        let pendingByDate = null;

        setHistory((prev) => {
            const next = prev.map((row) => ({ ...row }));
            const idx = next.findIndex((row) => row.date === rowDate);
            if (idx === -1) return prev;

            next[idx] = {
                ...next[idx],
                [type]: {
                    ...(next[idx][type] || {}),
                    raw,
                    isChanged: true,
                    isUserInput: true,
                },
            };

            pendingByDate = recalculateFromIndex(next, idx, type, false);
            return next;
        });

        if (pendingByDate) {
            setPendingChanges((prev) => {
                const next = { ...prev };
                for (const [date, snap] of pendingByDate.entries()) {
                    next[date] = { ...(next[date] || {}), [type]: snap };
                }
                pendingChangesRef.current = next;
                return next;
            });
        }
    };

    const updateManualReading = (rowDate, type, field, value) => {
        const numValue = toNumberOrNull(value);
        let pendingByDate = null;
        let manualSnap = null;

        setHistory((prev) => {
            const next = prev.map((row) => ({ ...row }));
            const idx = next.findIndex((row) => row.date === rowDate);
            if (idx === -1) return prev;

            const currentCell = next[idx][type] || {};
            next[idx] = {
                ...next[idx],
                [type]: {
                    ...currentCell,
                    [field]: numValue,
                    isChanged: true,
                    isUserInput: true,
                    error: field === 'raw' ? null : currentCell.error,
                },
            };

            if (field === 'raw') {
                pendingByDate = recalculateFromIndex(next, idx, type, true);
            } else {
                const cell = next[idx][type] || {};
                manualSnap = { raw: cell.raw, diff: cell.diff };
            }

            return next;
        });

        if (field === 'raw' && pendingByDate) {
            setPendingChanges((prev) => {
                const next = { ...prev };
                for (const [date, snap] of pendingByDate.entries()) {
                    next[date] = { ...(next[date] || {}), [type]: { ...(next[date]?.[type] || {}), ...snap, isManual: date === rowDate } };
                }
                pendingChangesRef.current = next;
                return next;
            });
        } else if (field !== 'raw' && manualSnap) {
            setPendingChanges((prev) => {
                const next = {
                    ...prev,
                    [rowDate]: {
                        ...(prev[rowDate] || {}),
                        [type]: { ...(prev[rowDate]?.[type] || manualSnap), [field]: numValue, isManual: true },
                    },
                };
                pendingChangesRef.current = next;
                return next;
            });
        }
    };

    const submitBatch = async (options = {}) => {
        const { targetDates = null, silent = false } = options;
        const sourcePendingChanges = pendingChangesRef.current;
        const changedDates = Array.isArray(targetDates)
            ? targetDates.filter((date) => sourcePendingChanges[date])
            : Object.keys(sourcePendingChanges);

        if (changedDates.length === 0) {
            if (!silent) showAlert?.('변경 사항이 없습니다.');
            return { success: false };
        }

        setLoading(true);
        try {
            for (const dt of changedDates) {
                const items = [];
                const changes = sourcePendingChanges[dt];
                for (const [type, data] of Object.entries(changes)) {
                    if (type === 'date' || type === 'isFuture') continue;
                    items.push({
                        type,
                        raw_value: data.raw,
                        calculated_flow: data.diff,
                        sludge_export: type === '슬러지' ? data.raw : null,
                        is_manual: !!data.isManual,
                        is_reset: false,
                    });
                }
                if (items.length > 0) {
                    const res = await FlowModel.bulkSave(dt, items);
                    if (!res.success) throw new Error(res.error || '저장 실패');
                }
            }

            if (!silent) showAlert?.('데이터가 성공적으로 저장되었습니다.');
            await loadReadings();
            return { success: true };
        } catch (err) {
            if (!silent) showAlert?.(`저장 실패: ${err.message}`);
            return { success: false, error: err.message };
        } finally {
            setLoading(false);
        }
    };

    const saveModalDraft = async ({ date, items = [] } = {}) => {
        if (!date) {
            showAlert?.('저장할 날짜가 없습니다.');
            return { success: false };
        }

        const payloadItems = items
            .map(({ item, values }) => {
                const type = item?.key || item?.name || item?.label;
                if (!type) return null;
                const rawValue = toNumberOrNull(values?.reading);
                const calculatedFlow = toNumberOrNull(values?.calculatedFlow);

                return {
                    type,
                    raw_value: rawValue,
                    calculated_flow: calculatedFlow,
                    sludge_export: type === '슬러지' ? rawValue : null,
                    is_manual: true,
                    is_reset: false,
                };
            })
            .filter(Boolean);

        if (payloadItems.length === 0) {
            showAlert?.('저장할 유량 데이터가 없습니다.');
            return { success: false };
        }

        setLoading(true);
        try {
            const res = await FlowModel.bulkSave(date, payloadItems);
            if (!res.success) throw new Error(res.error || '유량 데이터 저장에 실패했습니다.');
            showAlert?.('유량 데이터가 저장되었습니다.');
            await loadReadings();
            return res;
        } catch (err) {
            showAlert?.(`저장 실패: ${err.message}`);
            return { success: false, error: err.message };
        } finally {
            setLoading(false);
        }
    };

    return {
        history,
        loading,
        flowTypes: flowTypesResolved,
        correctData,
        updateReading,
        updateManualReading,
        submitBatch,
        saveModalDraft,
        refresh: ({ force = true } = {}) => loadReadings({ force }),
        pendingChanges,
    };
};
