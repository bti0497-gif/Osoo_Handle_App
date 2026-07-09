import { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardModel } from './DashboardModel';
import { buildWaterSummary } from './widgets/WaterQualityWidget';

const FLOW_KEYS = ['유입유량계', '방류유량계', '내부반송유량계', '외부반송유량계', '전력량계'];

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

            const [
                flowResponse,
                waterResponse,
                medicineResponse,
                kitResponse,
                medicineDefaultsResponse,
                kitDefaultsResponse,
            ] = await Promise.all([
                DashboardModel.fetchFlowHistory(params),
                DashboardModel.fetchWaterHistory(params),
                DashboardModel.fetchMedicineHistory(params),
                DashboardModel.fetchKitHistory(params),
                DashboardModel.fetchMedicineDefaults(),
                DashboardModel.fetchKitDefaults(),
            ]);

            if (!flowResponse?.success || !Array.isArray(flowResponse.history)) {
                setHistoryRows([]);
            } else {
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
            }

            if (!waterResponse?.success || !Array.isArray(waterResponse.history)) {
                setWaterRows([]);
            } else {
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
            }

            if (!medicineResponse?.success || !Array.isArray(medicineResponse.history)) {
                setMedicineRows([]);
            } else {
                setMedicineRows(medicineResponse.history);
            }

            if (!kitResponse?.success || !Array.isArray(kitResponse.history)) {
                setKitRows([]);
            } else {
                setKitRows(kitResponse.history);
            }
            setMedicineDefaults(
                medicineDefaultsResponse?.success && Array.isArray(medicineDefaultsResponse.items)
                    ? medicineDefaultsResponse.items
                    : []
            );
            setKitDefaults(
                kitDefaultsResponse?.success && Array.isArray(kitDefaultsResponse.items)
                    ? kitDefaultsResponse.items
                    : []
            );
        } catch (error) {
            console.error('[Dashboard] 데이터 조회 실패:', error);
            setHistoryRows([]);
            setWaterRows([]);
            setMedicineRows([]);
            setKitRows([]);
            setMedicineDefaults([]);
            setKitDefaults([]);
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
        refresh: loadHistory,
    };
}

export { FLOW_KEYS };

