import { useState, useEffect, useRef } from 'react';
import { WaterQualityModel } from './WaterQualityModel';

const WATER_FIELDS = ['nh3_n', 'no3_n', 'po4_p', 'alkalinity', 'tn', 'tp', 'cod', 'ss'];

const buildManualMeasurementGroup = (date) => `manual:${date}`;

const buildRowKey = (date, measurementGroup) => `${date}__${measurementGroup}`;

const normalizeMeasurementOrder = (value) => {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
        return Math.floor(numeric);
    }
    return 1;
};

const resolveMeasurementGroup = (record = {}) => {
    const date = String(record.date || '').slice(0, 10);
    const rawGroup = String(record.measurement_group || '').trim();
    if (rawGroup) return rawGroup;

    const projectId = String(record.qntech_project_id || '').trim();
    if (projectId) return `qntech:${projectId}`;

    return buildManualMeasurementGroup(date);
};

const buildRowIdentity = (record = {}) => {
    const date = String(record.date || '').slice(0, 10);
    const measurementGroup = resolveMeasurementGroup(record);

    return {
        rowKey: buildRowKey(date, measurementGroup),
        date,
        measurementGroup,
        measurementOrder: normalizeMeasurementOrder(record.measurement_order),
        sourceType: String(record.source_type || '').trim() || (record.qntech_project_id ? 'qntech' : 'manual'),
        sourceLabel: String(record.source_label || '').trim(),
        qntechProjectId: record.qntech_project_id ? String(record.qntech_project_id) : null,
        createdAt: record.created_at || null,
        lastModified: record.last_modified || null,
        isFuture: Boolean(record.isFuture)
    };
};

const createPlaceholderRow = (date, options = {}) => ({
    ...buildRowIdentity({
        date,
        measurement_group: options.measurementGroup || buildManualMeasurementGroup(date),
        measurement_order: options.measurementOrder || 1,
        source_type: options.sourceType || 'manual',
        source_label: options.sourceLabel || '',
        qntech_project_id: options.qntechProjectId || null,
        isFuture: options.isFuture || false
    }),
    displayLabel: options.displayLabel || '',
    isFuture: Boolean(options.isFuture)
});

const sortHistoryRows = (rows = []) => {
    rows.sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;

        const orderCompare = normalizeMeasurementOrder(a.measurementOrder) - normalizeMeasurementOrder(b.measurementOrder);
        if (orderCompare !== 0) return orderCompare;

        const createdCompare = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
        if (createdCompare !== 0) return createdCompare;

        return a.rowKey.localeCompare(b.rowKey);
    });

    return rows;
};

const applyDisplayLabels = (rows = []) => {
    const countByDate = new Map();
    const orderByDate = new Map();

    rows.forEach((row) => {
        countByDate.set(row.date, (countByDate.get(row.date) || 0) + 1);
    });

    return rows.map((row) => {
        const nextOrder = (orderByDate.get(row.date) || 0) + 1;
        orderByDate.set(row.date, nextOrder);

        return {
            ...row,
            displayLabel: row.sourceLabel || ((countByDate.get(row.date) || 0) > 1 ? `${nextOrder}차` : '')
        };
    });
};

export const useWaterQualityViewModel = (currentUser, { showAlert } = {}) => {
    const rangeImportPollingRef = useRef(null);
    const historyRef = useRef([]);
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [pendingChanges, setPendingChanges] = useState({});
    const [isImportingFromQntech, setIsImportingFromQntech] = useState(false);
    const [lastImportSummary, setLastImportSummary] = useState(null);
    const [lastRangeImportSummary, setLastRangeImportSummary] = useState(null);
    const pendingChangesRef = useRef({});

    useEffect(() => {
        loadReadings();
    }, []);

    useEffect(() => {
        loadReadings();
    }, []);

    const normalizeWaterValue = (value) => {
        if (value === null || value === undefined || value === '') return value ?? null;
        if (typeof value === 'number' && Number.isNaN(value)) return '초과';

        const normalized = String(value).trim();
        if (['-1', '-1.0', '-1.00', 'NaN', 'nan'].includes(normalized)) {
            return '초과';
        }

        return normalized;
    };

    const waterTypes = ['nh3_n', 'no3_n', 'po4_p', 'alkalinity'];

    const commitHistoryState = (rows) => {
        historyRef.current = rows;
        setHistory(rows);
    };

    const loadReadings = async () => {
        setLoading(true);
        try {
            const today = new Date();
            const todayStr = today.toISOString().split('T')[0];

            const historyData = await WaterQualityModel.fetchHistory();
            if (historyData.success) {
                const histRaw = Array.isArray(historyData.history) ? historyData.history : [];
                const histMap = new Map();

                histRaw.forEach((record) => {
                    const identity = buildRowIdentity(record);
                    if (!identity.date) return;

                    const existingRow = histMap.get(identity.rowKey) || { ...identity };
                    const loc = record.location || '기본';

                    WATER_FIELDS.forEach((field) => {
                        if (record[field] !== null && record[field] !== undefined) {
                            existingRow[`${field}_${loc}`] = normalizeWaterValue(record[field]);
                        }
                    });

                    histMap.set(identity.rowKey, existingRow);
                });

                let hist = sortHistoryRows(Array.from(histMap.values()));

                if (hist.length > 0) {
                    const firstDateStr = hist[0].date > todayStr ? todayStr : hist[0].date;
                    let currentDate = new Date(firstDateStr);
                    const todayDate = new Date(todayStr);
                    const existingDates = new Set(hist.map((row) => row.date));

                    while (currentDate < todayDate) {
                        const dateString = currentDate.toISOString().split('T')[0];
                        if (!existingDates.has(dateString)) {
                            hist.push(createPlaceholderRow(dateString));
                            existingDates.add(dateString);
                        }
                        currentDate.setDate(currentDate.getDate() + 1);
                    }
                }

                if (!hist.some((row) => row.date === todayStr)) {
                    hist.push(createPlaceholderRow(todayStr));
                }

                for (let index = 1; index <= 5; index += 1) {
                    const futureDate = new Date(today);
                    futureDate.setDate(today.getDate() + index);
                    const dateString = futureDate.toISOString().split('T')[0];
                    if (!hist.some((row) => row.date === dateString)) {
                        hist.push(createPlaceholderRow(dateString, { isFuture: true }));
                    }
                }

                hist = applyDisplayLabels(sortHistoryRows(hist));

                commitHistoryState(hist);
                setPendingChanges({});
                pendingChangesRef.current = {};
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const updateReading = (rowKey, locName, type, val) => {
        const normalizedValue = val === '' ? null : normalizeWaterValue(val);
        const colKey = `${type}_${locName}`;

        setHistory((prev) => {
            const nextHistory = prev.map((row) => ({ ...row }));
            const index = nextHistory.findIndex((row) => row.rowKey === rowKey);
            if (index === -1) return prev;

            nextHistory[index] = {
                ...nextHistory[index],
                [colKey]: normalizedValue,
                [`${colKey}_error`]: null
            };

            setPendingChanges((currentPending) => {
                const rowChanges = currentPending[rowKey] || {};
                const nextPending = {
                    ...currentPending,
                    [rowKey]: { ...rowChanges, [colKey]: normalizedValue }
                };
                pendingChangesRef.current = nextPending;
                return nextPending;
            });

            historyRef.current = nextHistory;
            return nextHistory;
        });
    };

    const applyImportedWaterValues = (importedRows = []) => {
        if (!Array.isArray(importedRows) || importedRows.length === 0) return;

        const nextPending = { ...pendingChangesRef.current };

        setHistory((prev) => {
            const rowMap = new Map(prev.map((row) => [row.rowKey, { ...row }]));

            importedRows.forEach((item) => {
                const identity = buildRowIdentity(item);
                if (!identity.date) return;

                const currentRow = rowMap.get(identity.rowKey) || { ...identity };
                const rowPending = nextPending[identity.rowKey] || {};

                WATER_FIELDS.forEach((field) => {
                    if (item[field] === undefined) return;
                    const colKey = `${field}_${item.location}`;
                    const normalizedValue = normalizeWaterValue(item[field]);
                    currentRow[colKey] = normalizedValue;
                    currentRow[`${colKey}_error`] = null;
                    rowPending[colKey] = normalizedValue;
                });

                rowMap.set(identity.rowKey, currentRow);
                nextPending[identity.rowKey] = rowPending;
            });

            const nextHistory = applyDisplayLabels(sortHistoryRows(Array.from(rowMap.values())));
            setPendingChanges(nextPending);
            pendingChangesRef.current = nextPending;
            historyRef.current = nextHistory;
            return nextHistory;
        });
    };

    const buildBulkSaveItems = (rows = []) => {
        if (!Array.isArray(rows) || rows.length === 0) return [];

        return rows.map((item) => ({
            date: item.date,
            measurement_group: resolveMeasurementGroup(item),
            measurement_order: normalizeMeasurementOrder(item.measurement_order),
            source_type: String(item.source_type || '').trim() || (item.qntech_project_id ? 'qntech' : 'manual'),
            source_label: item.source_label ?? null,
            qntech_project_id: item.qntech_project_id ?? null,
            location: item.location,
            nh3_n: item.nh3_n ?? null,
            no3_n: item.no3_n ?? null,
            po4_p: item.po4_p ?? null,
            alkalinity: item.alkalinity ?? null,
            tn: item.tn ?? null,
            tp: item.tp ?? null,
            cod: item.cod ?? null,
            ss: item.ss ?? null,
        }));
    };

    const persistImportedRows = async (rows = []) => {
        const items = buildBulkSaveItems(rows);
        if (items.length === 0) return;

        const res = await WaterQualityModel.bulkSave(items);
        if (!res?.success) {
            throw new Error(res?.error || 'QnTECH 데이터 저장에 실패했습니다.');
        }
    };

    const handleImportFromQntech = async (date, silent = false) => {
        setIsImportingFromQntech(true);
        try {
            const result = await WaterQualityModel.importFromQntech(date);
            if (!result?.success) {
                throw new Error(result?.error || 'QnTECH 데이터 불러오기에 실패했습니다.');
            }

            await persistImportedRows(result.importedRows || []);
            setLastImportSummary({
                date: result.date,
                siteName: result.site?.name || '',
                importedRowCount: result.summary?.importedRowCount || 0,
                savedPhotoCount: result.summary?.savedPhotoCount || 0,
                driveUploadedPhotoCount: result.summary?.driveUploadedPhotoCount || 0,
                photoDirectory: result.photoDirectory,
                driveFolderUrl: result.driveFolderUrl || '',
                unmatchedSamples: result.unmatchedSamples || []
            });
            setLastRangeImportSummary(null);

            await loadReadings();
            const importedRowCount = result.summary?.importedRowCount || 0;
            const savedPhotoCount = result.summary?.savedPhotoCount || 0;

            if (!silent) {
                if (importedRowCount === 0 && savedPhotoCount === 0) {
                    showAlert?.('데이터가 없습니다.');
                } else {
                    showAlert?.(`QnTECH 데이터를 저장했습니다. 값 ${importedRowCount}건, 사진 ${savedPhotoCount}건`);
                }
            }
            return result;
        } catch (err) {
            if (!silent) {
                showAlert?.(`QnTECH 불러오기 실패: ${err.message}`);
            }
            throw err;
        } finally {
            setIsImportingFromQntech(false);
        }
    };

    const handleImportRangeFromQntech = async (startDate, endDate) => {
        // 기존의 기간 불러오기(단일 API 호출)를 남겨두되, 
        // 뷰에서는 handleImportFromQntech를 개별적으로 루프돌면서 호출하도록 변경됨
        try {
            const result = await WaterQualityModel.importRangeFromQntech(startDate, endDate);
            if (!result?.success) {
                throw new Error(result?.error || 'QnTECH 기간 데이터 불러오기에 실패했습니다.');
            }

            setLastRangeImportSummary({
                startDate: result.startDate,
                endDate: result.endDate,
                processedDates: result.processedDates,
                insertedRowCount: result.summary?.insertedRowCount || 0,
                savedPhotoCount: result.summary?.savedPhotoCount || 0,
                driveUploadedPhotoCount: result.summary?.driveUploadedPhotoCount || 0,
                existingValueDateCount: result.summary?.existingValueDateCount || 0,
                existingValueDates: result.existingValueDates || [],
                insertedDates: result.insertedDates || [],
                photoRoot: result.photoRoot,
                driveFolderUrl: result.driveFolderUrl || '',
                summaryRows: result.summaryRows || []
            });
            setLastImportSummary(null);

            await loadReadings();
            return result;
        } catch (err) {
            throw err;
        }
    };

    const submitBatch = async (options = {}) => {
        const { targetRowKeys = null, silent = false } = options;
        const sourcePendingChanges = pendingChangesRef.current;
        const changedRowKeys = Array.isArray(targetRowKeys)
            ? targetRowKeys.filter((rowKey) => sourcePendingChanges[rowKey])
            : Object.keys(sourcePendingChanges);

        if (changedRowKeys.length === 0) {
            if (!silent) showAlert?.('변경 사항이 없습니다.');
            return;
        }

        setLoading(true);
        try {
            const items = [];
            const rowMap = new Map(historyRef.current.map((row) => [row.rowKey, row]));

            changedRowKeys.forEach((rowKey) => {
                const rowChanges = sourcePendingChanges[rowKey];
                const rowMeta = rowMap.get(rowKey);
                if (!rowMeta) return;

                const locValues = {};
                Object.entries(rowChanges).forEach(([colKey, value]) => {
                    const lastUnderscore = colKey.lastIndexOf('_');
                    if (lastUnderscore === -1) return;
                    const paramId = colKey.substring(0, lastUnderscore);
                    const locName = colKey.substring(lastUnderscore + 1);

                    if (!locValues[locName]) {
                        locValues[locName] = { location: locName };
                    }
                    locValues[locName][paramId] = value;
                });

                Object.values(locValues).forEach((locData) => {
                    items.push({
                        date: rowMeta.date,
                        measurement_group: rowMeta.measurementGroup,
                        measurement_order: rowMeta.measurementOrder,
                        source_type: rowMeta.sourceType,
                        source_label: rowMeta.sourceLabel || rowMeta.displayLabel || null,
                        qntech_project_id: rowMeta.qntechProjectId,
                        location: locData.location,
                        nh3_n: locData.nh3_n,
                        no3_n: locData.no3_n,
                        po4_p: locData.po4_p,
                        alkalinity: locData.alkalinity,
                        tn: locData.tn,
                        tp: locData.tp,
                        cod: locData.cod,
                        ss: locData.ss
                    });
                });
            });

            if (items.length > 0) {
                const res = await WaterQualityModel.bulkSave(items);
                if (!res.success) throw new Error(res.error);
            }

            if (!silent) showAlert?.('데이터가 성공적으로 저장되었습니다.');

            await loadReadings();
        } catch (err) {
            if (!silent) showAlert?.(`저장 실패: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    return {
        history,
        loading,
        waterTypes,
        updateReading,
        submitBatch,
        refresh: loadReadings,
        pendingChanges,
        isImportingFromQntech,
        lastImportSummary,
        lastRangeImportSummary,
        handleImportFromQntech,
        handleImportRangeFromQntech,
        applyImportedWaterValues
    };
};
