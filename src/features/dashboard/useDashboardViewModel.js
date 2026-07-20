import { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardModel } from './DashboardModel';
import { buildWaterSummary } from './waterSummary';

const FLOW_KEYS = ['유입유량계', '방류유량계', '내부반송유량계', '외부반송유량계', '전력량계'];
const EMPTY_WIDGET_ERRORS = { flow: null, water: null, inventory: null };

async function requestWithOneRetry(request) {
    try {
        return await request();
    } catch (firstError) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        try {
            return await request();
        } catch (secondError) {
            secondError.firstError = firstError;
            throw secondError;
        }
    }
}

function toDateKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
}

function parseDateKey(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function addDays(date, days) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + days);
    return next;
}

function addMonths(date, months) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const originalDate = next.getDate();
    next.setMonth(next.getMonth() + months);
    if (next.getDate() !== originalDate) {
        next.setDate(0);
    }
    return next;
}

function toNumberOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

export function useDashboardViewModel(currentUser) {
    const [loading, setLoading] = useState(false);
    const [historyRows, setHistoryRows] = useState([]);
    const [waterRows, setWaterRows] = useState([]);
    const [medicineRows, setMedicineRows] = useState([]);
    const [kitRows, setKitRows] = useState([]);
    const [medicineDefaults, setMedicineDefaults] = useState([]);
    const [kitDefaults, setKitDefaults] = useState([]);
    const [widgetErrors, setWidgetErrors] = useState(EMPTY_WIDGET_ERRORS);
    const [weekOffset, setWeekOffset] = useState(0);
    const [visibleSeries, setVisibleSeries] = useState({
        inflow: true,
        outflow: true,
        internalReturn: true,
        externalReturn: true,
        power: true,
    });

    const loadHistory = useCallback(async () => {
        setLoading(true);
        try {
            let siteId = null;
            try {
                siteId = await DashboardModel.fetchAppSettingsSiteId();
            } catch {
                siteId = null;
            }
            if (!siteId && currentUser?.site_id) {
                siteId = String(currentUser.site_id);
            }
            const params = siteId ? { site_id: siteId } : {};

            const results = await Promise.allSettled([
                requestWithOneRetry(() => DashboardModel.fetchFlowHistory(params)),
                requestWithOneRetry(() => DashboardModel.fetchWaterHistory(params)),
                requestWithOneRetry(() => DashboardModel.fetchMedicineHistory(params)),
                requestWithOneRetry(() => DashboardModel.fetchKitHistory(params)),
                requestWithOneRetry(() => DashboardModel.fetchMedicineDefaults()),
                requestWithOneRetry(() => DashboardModel.fetchKitDefaults()),
            ]);
            const [
                flowResponse,
                waterResponse,
                medicineResponse,
                kitResponse,
                medicineDefaultsResponse,
                kitDefaultsResponse,
            ] = results.map((result) => (result.status === 'fulfilled' ? result.value : null));
            const nextErrors = { ...EMPTY_WIDGET_ERRORS };
            const failureMessages = results.map((result) => (
                result.status === 'rejected' ? String(result.reason?.message || result.reason || '알 수 없는 오류') : null
            ));

            if (flowResponse?.success && Array.isArray(flowResponse.history)) {
                const today = toDateKey(new Date());
                const normalized = flowResponse.history
                    .filter((row) => String(row?.date || '') <= today)
                    .map((row) => ({
                        date: String(row.date || ''),
                        inflow: toNumberOrNull(row['유입유량계']?.diff),
                        outflow: toNumberOrNull(row['방류유량계']?.diff),
                        internalReturn: toNumberOrNull(row['내부반송유량계']?.diff),
                        externalReturn: toNumberOrNull(row['외부반송유량계']?.diff),
                        power: toNumberOrNull(row['전력량계']?.diff),
                    }))
                    .sort((a, b) => a.date.localeCompare(b.date));
                setHistoryRows(normalized);
                setWeekOffset(0);
            } else {
                nextErrors.flow = failureMessages[0] || '유량·전력 데이터를 불러오지 못했습니다.';
            }

            if (waterResponse?.success && Array.isArray(waterResponse.history)) {
                const today = toDateKey(new Date());
                const normalizedWater = waterResponse.history
                    .filter((row) => String(row?.date || '') <= today)
                    .map((row) => ({
                        date: String(row.date || ''),
                        location: row.location || '',
                        nh3_n: toNumberOrNull(row.nh3_n),
                        no3_n: toNumberOrNull(row.no3_n),
                        po4_p: toNumberOrNull(row.po4_p),
                        alkalinity: toNumberOrNull(row.alkalinity),
                    }))
                    .sort((a, b) => b.date.localeCompare(a.date));
                setWaterRows(normalizedWater);
            } else {
                nextErrors.water = failureMessages[1] || '수질 데이터를 불러오지 못했습니다.';
            }

            if (medicineResponse?.success && Array.isArray(medicineResponse.history)) {
                setMedicineRows(medicineResponse.history);
            }

            if (kitResponse?.success && Array.isArray(kitResponse.history)) {
                setKitRows(kitResponse.history);
            }
            if (medicineDefaultsResponse?.success && Array.isArray(medicineDefaultsResponse.items)) {
                setMedicineDefaults(medicineDefaultsResponse.items);
            }
            if (kitDefaultsResponse?.success && Array.isArray(kitDefaultsResponse.items)) {
                setKitDefaults(kitDefaultsResponse.items);
            }
            if (!medicineResponse?.success || !Array.isArray(medicineResponse.history)
                || !kitResponse?.success || !Array.isArray(kitResponse.history)
                || !medicineDefaultsResponse?.success || !Array.isArray(medicineDefaultsResponse.items)
                || !kitDefaultsResponse?.success || !Array.isArray(kitDefaultsResponse.items)) {
                nextErrors.inventory = failureMessages.slice(2).filter(Boolean).join(' / ')
                    || '약품·키트 재고 데이터를 일부 불러오지 못했습니다.';
            }
            setWidgetErrors(nextErrors);
            const failedWidgets = Object.entries(nextErrors).filter(([, message]) => Boolean(message));
            if (failedWidgets.length > 0) {
                DashboardModel.recordLoadDiagnostic({
                    siteId: siteId || null,
                    widgets: failedWidgets.map(([widget, message]) => ({ widget, message })),
                });
            }
        } catch (error) {
            console.error('[Dashboard] 데이터 조회 실패:', error);
            const message = String(error?.message || error || '대시보드 조회 실패');
            setWidgetErrors({ flow: message, water: message, inventory: message });
            DashboardModel.recordLoadDiagnostic({ fatal: true, message });
        } finally {
            setLoading(false);
        }
    }, [currentUser?.site_id]);

    useEffect(() => {
        loadHistory();
    }, [loadHistory]);

    const maxOffsetWeeks = useMemo(() => {
        if (historyRows.length <= 1) return 0;
        const firstDate = parseDateKey(historyRows[0]?.date);
        const lastDate = parseDateKey(historyRows[historyRows.length - 1]?.date);
        if (!firstDate || !lastDate || firstDate >= lastDate) return 0;
        const diffDays = Math.floor((lastDate.getTime() - firstDate.getTime()) / 86400000);
        return Math.max(0, Math.ceil(diffDays / 7));
    }, [historyRows]);

    const chartWindow = useMemo(() => {
        if (historyRows.length === 0) {
            return {
                rows: [],
                rangeText: '',
                canGoPast: false,
                canGoFuture: false,
            };
        }

        const latestDate = parseDateKey(historyRows[historyRows.length - 1]?.date);
        const earliestDate = parseDateKey(historyRows[0]?.date);
        if (!latestDate || !earliestDate) {
            return {
                rows: [],
                rangeText: '',
                canGoPast: false,
                canGoFuture: false,
            };
        }

        const safeOffset = Math.max(0, Math.min(weekOffset, maxOffsetWeeks));
        const endDate = addDays(latestDate, -(safeOffset * 7));
        const startDate = addMonths(endDate, -1);
        const startKey = formatDateKey(startDate);
        const endKey = formatDateKey(endDate);
        const rowByDate = new Map(
            historyRows
                .filter((row) => row.date >= startKey && row.date <= endKey)
                .map((row) => [row.date, row])
        );
        const rows = [];
        for (let cursor = startDate; cursor <= endDate; cursor = addDays(cursor, 1)) {
            const date = formatDateKey(cursor);
            rows.push(rowByDate.get(date) || {
                date,
                inflow: null,
                outflow: null,
                internalReturn: null,
                externalReturn: null,
                power: null,
            });
        }

        return {
            rows,
            rangeText: `${startKey} ~ ${endKey}`,
            canGoFuture: safeOffset > 0,
            canGoPast: startDate > earliestDate,
        };
    }, [historyRows, maxOffsetWeeks, weekOffset]);

    const toggleSeries = useCallback((key) => {
        setVisibleSeries((prev) => ({ ...prev, [key]: !prev[key] }));
    }, []);

    const goPastWeek = useCallback(() => {
        setWeekOffset((prev) => Math.min(maxOffsetWeeks, prev + 1));
    }, [maxOffsetWeeks]);

    const goFutureWeek = useCallback(() => {
        setWeekOffset((prev) => Math.max(0, prev - 1));
    }, []);

    const waterWidgetRows = useMemo(() => waterRows.slice(0, 20), [waterRows]);
    const waterSummary = useMemo(() => buildWaterSummary(waterRows), [waterRows]);

    return {
        loading,
        visibleSeries,
        chartWindow,
        toggleSeries,
        goPastWeek,
        goFutureWeek,
        waterWidgetRows,
        waterSummary,
        medicineRows,
        kitRows,
        medicineDefaults,
        kitDefaults,
        widgetErrors,
        refresh: loadHistory,
    };
}

export { FLOW_KEYS };

