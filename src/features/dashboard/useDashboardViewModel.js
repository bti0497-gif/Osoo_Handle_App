import { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardModel } from './DashboardModel';
import { buildWaterSummary } from './widgets/WaterQualityWidget';

const FLOW_KEYS = ['유입유량계', '방류유량계', '내부반송유량계', '외부반송유량계', '전력량계'];

function toDateKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
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

            const [flowResponse, waterResponse, medicineResponse, kitResponse] = await Promise.all([
                DashboardModel.fetchFlowHistory(params),
                DashboardModel.fetchWaterHistory(params),
                DashboardModel.fetchMedicineHistory(params),
                DashboardModel.fetchKitHistory(params),
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
        } catch (error) {
            console.error('[Dashboard] 데이터 조회 실패:', error);
            setHistoryRows([]);
            setWaterRows([]);
            setMedicineRows([]);
            setKitRows([]);
        } finally {
            setLoading(false);
        }
    }, [currentUser?.site_id]);

    useEffect(() => {
        loadHistory();
    }, [loadHistory]);

    const maxOffsetWeeks = useMemo(() => {
        if (historyRows.length <= 1) return 0;
        return Math.floor((historyRows.length - 1) / 7);
    }, [historyRows.length]);

    const chartWindow = useMemo(() => {
        if (historyRows.length === 0) {
            return {
                rows: [],
                rangeText: '',
                canGoPast: false,
                canGoFuture: false,
            };
        }

        const safeOffset = Math.max(0, Math.min(weekOffset, maxOffsetWeeks));
        const shiftDays = safeOffset * 7;
        const endIndex = Math.max(0, historyRows.length - 1 - shiftDays);
        const startIndex = Math.max(0, endIndex - 29);
        const rows = historyRows.slice(startIndex, endIndex + 1);
        const firstDate = rows[0]?.date || '';
        const lastDate = rows[rows.length - 1]?.date || '';

        return {
            rows,
            rangeText: firstDate && lastDate ? `${firstDate} ~ ${lastDate}` : '',
            canGoPast: startIndex > 0,
            canGoFuture: safeOffset > 0,
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
        refresh: loadHistory,
    };
}

export { FLOW_KEYS };

