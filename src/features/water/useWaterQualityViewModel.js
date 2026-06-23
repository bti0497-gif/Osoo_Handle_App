import { useCallback, useEffect, useRef, useState } from 'react';
import { getTodayKST } from '../../core/constants';
import { WaterQualityModel } from './WaterQualityModel';

const WATER_FIELDS = ['nh3_n', 'no3_n', 'po4_p', 'alkalinity', 'tn', 'tp', 'cod', 'ss'];

const buildManualMeasurementGroup = (date, order = 1) => `manual:${date}:${order}`;
const buildRowKey = (date, measurementGroup) => `${date}__${measurementGroup}`;

const normalizeMeasurementOrder = (value) => {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return Math.floor(numeric);
    return 1;
};

const resolveMeasurementGroup = (record = {}) => {
    const date = String(record.date || '').slice(0, 10);
    const rawGroup = String(record.measurement_group || '').trim();
    if (rawGroup) return rawGroup;

    const projectId = String(record.qntech_project_id || '').trim();
    if (projectId) return `qntech:${projectId}`;

    return buildManualMeasurementGroup(date, normalizeMeasurementOrder(record.measurement_order));
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
        isFuture: Boolean(record.isFuture),
    };
};

const createPlaceholderRow = (date, options = {}) => ({
    ...buildRowIdentity({
        date,
        measurement_group: options.measurementGroup || buildManualMeasurementGroup(date, options.measurementOrder || 1),
        measurement_order: options.measurementOrder || 1,
        source_type: options.sourceType || 'manual',
        source_label: options.sourceLabel || '',
        qntech_project_id: options.qntechProjectId || null,
        isFuture: options.isFuture || false,
    }),
    displayLabel: options.displayLabel || '',
    isFuture: Boolean(options.isFuture),
});

const sortHistoryRows = (rows = []) => rows.sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;

    const orderCompare = normalizeMeasurementOrder(a.measurementOrder) - normalizeMeasurementOrder(b.measurementOrder);
    if (orderCompare !== 0) return orderCompare;

    const createdCompare = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    if (createdCompare !== 0) return createdCompare;

    return a.rowKey.localeCompare(b.rowKey);
});

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
            displayLabel: row.sourceLabel || ((countByDate.get(row.date) || 0) > 1 ? `${nextOrder}회차` : ''),
        };
    });
};

const normalizeWaterValue = (value) => {
    if (value === null || value === undefined || value === '') return value ?? null;
    if (typeof value === 'number' && Number.isNaN(value)) return '초과';

    const normalized = String(value).trim();
    if (['-1', '-1.0', '-1.00', 'NaN', 'nan'].includes(normalized)) return '초과';
    return normalized;
};

const normalizeModalSaveValue = (value) => {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text === '' ? null : text;
};

export const useWaterQualityViewModel = (currentUser, { showToast } = {}) => {
    const historyRef = useRef([]);
    const pendingChangesRef = useRef({});
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [pendingChanges, setPendingChanges] = useState({});
    const [isImportingFromQntech, setIsImportingFromQntech] = useState(false);
    const [lastImportSummary, setLastImportSummary] = useState(null);
    const [lastRangeImportSummary, setLastRangeImportSummary] = useState(null);

    const waterTypes = ['nh3_n', 'no3_n', 'po4_p', 'alkalinity'];

    const commitHistoryState = (rows) => {
        historyRef.current = rows;
        setHistory(rows);
    };

    const loadReadings = useCallback(async (options = {}) => {
        setLoading(true);
        try {
            const todayStr = getTodayKST();
            const today = new Date(`${todayStr}T12:00:00`);

            const historyData = await WaterQualityModel.fetchHistory({ force: options.force });
            if (!historyData.success) return;

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
                    const dateString = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
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
                const dateString = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
                if (!hist.some((row) => row.date === dateString)) {
                    hist.push(createPlaceholderRow(dateString, { isFuture: true }));
                }
            }

            hist = applyDisplayLabels(sortHistoryRows(hist));
            commitHistoryState(hist);
            setPendingChanges({});
            pendingChangesRef.current = {};
        } catch (err) {
            console.error(err);
            showToast?.(`수질 데이터 조회 실패: ${err.message}`, 'error');
        } finally {
            setLoading(false);
        }
    }, [showToast]);

    useEffect(() => {
        loadReadings();
    }, [loadReadings]);

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
                [`${colKey}_error`]: null,
            };

            setPendingChanges((currentPending) => {
                const rowChanges = currentPending[rowKey] || {};
                const nextPending = {
                    ...currentPending,
                    [rowKey]: { ...rowChanges, [colKey]: normalizedValue },
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

    const handleImportFromQntech = async (date, silent = false) => {
        setIsImportingFromQntech(true);
        try {
            const result = await WaterQualityModel.importFromQntech(date);
            if (!result?.success) {
                throw new Error(result?.error || 'QnTECH 데이터 불러오기에 실패했습니다.');
            }

            setLastImportSummary({
                date: result.date,
                siteName: result.site?.name || '',
                importedRowCount: result.summary?.importedRowCount || 0,
                savedPhotoCount: result.summary?.savedPhotoCount || 0,
                driveUploadedPhotoCount: result.summary?.driveUploadedPhotoCount || 0,
                driveUploadErrorCount: result.summary?.driveUploadErrorCount || 0,
                driveUploadErrors: result.driveUploadErrors || [],
                photoDirectory: result.photoDirectory,
                driveFolderUrl: result.driveFolderUrl || '',
                unmatchedSamples: result.unmatchedSamples || [],
                matchedExistingData: Boolean(result.summary?.matchedExistingData),
                matchedRowCount: result.summary?.matchedRowCount || 0,
            });
            setLastRangeImportSummary(null);

            await loadReadings();
            const importedRowCount = result.summary?.importedRowCount || 0;
            const savedPhotoCount = result.summary?.savedPhotoCount || 0;
            const driveUploadErrorCount = result.summary?.driveUploadErrorCount || 0;

            if (!silent) {
                if (importedRowCount === 0 && savedPhotoCount === 0) {
                    showToast?.('데이터가 없습니다.', 'error');
                } else if (result.summary?.matchedExistingData) {
                    const driveWarning = driveUploadErrorCount > 0
                        ? `, Drive 업로드 실패 ${driveUploadErrorCount}건`
                        : '';
                    showToast?.(`기존 수질값과 일치하여 사진만 보강했습니다. 사진 ${savedPhotoCount}건${driveWarning}`);
                } else {
                    const driveWarning = driveUploadErrorCount > 0
                        ? `, Drive 업로드 실패 ${driveUploadErrorCount}건`
                        : '';
                    showToast?.(`QnTECH 데이터를 저장했습니다. 값 ${importedRowCount}건, 사진 ${savedPhotoCount}건${driveWarning}`);
                }
            }
            return result;
        } catch (err) {
            if (!silent) showToast?.(`QnTECH 불러오기 실패: ${err.message}`, 'error');
            throw err;
        } finally {
            setIsImportingFromQntech(false);
        }
    };

    const handleImportRangeFromQntech = async (startDate, endDate) => {
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
            driveUploadErrorCount: result.summary?.driveUploadErrorCount || 0,
            existingValueDateCount: result.summary?.existingValueDateCount || 0,
            existingValueDates: result.existingValueDates || [],
            insertedDates: result.insertedDates || [],
            photoRoot: result.photoRoot,
            driveFolderUrl: result.driveFolderUrl || '',
            summaryRows: result.summaryRows || [],
        });
        setLastImportSummary(null);

        await loadReadings();
        return result;
    };

    const submitBatch = async (options = {}) => {
        const { targetRowKeys = null, silent = false } = options;
        const sourcePendingChanges = pendingChangesRef.current;
        const changedRowKeys = Array.isArray(targetRowKeys)
            ? targetRowKeys.filter((rowKey) => sourcePendingChanges[rowKey])
            : Object.keys(sourcePendingChanges);

        if (changedRowKeys.length === 0) {
            if (!silent) showToast?.('변경 사항이 없습니다.', 'error');
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

                    if (!locValues[locName]) locValues[locName] = { location: locName };
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
                        ss: locData.ss,
                    });
                });
            });

            if (items.length > 0) {
                const res = await WaterQualityModel.bulkSave(items);
                if (!res.success) throw new Error(res.error);
            }

            if (!silent) showToast?.('데이터가 성공적으로 저장되었습니다.');
            await loadReadings();
        } catch (err) {
            if (!silent) showToast?.(`저장 실패: ${err.message}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    const saveModalDraft = useCallback(async ({
        date,
        items = [],
        measurementOrder = 1,
        measurementGroup,
        sourceType = 'manual',
        sourceLabel,
        qntechProjectId,
    } = {}) => {
        if (!date) {
            showToast?.('저장할 날짜가 없습니다.', 'error');
            return { success: false };
        }

        const safeOrder = normalizeMeasurementOrder(measurementOrder);
        const group = measurementGroup || buildManualMeasurementGroup(date, safeOrder);
        const rows = items
            .map(({ item, values }) => {
                const row = {
                    date,
                    measurement_group: group,
                    measurement_order: safeOrder,
                    source_type: sourceType || 'manual',
                    source_label: sourceLabel || `${safeOrder}회차`,
                    qntech_project_id: qntechProjectId || null,
                    location: item?.key || item?.label,
                    nh3_n: normalizeModalSaveValue(values?.nh3_n),
                    no3_n: normalizeModalSaveValue(values?.no3_n),
                    po4_p: item?.po4pApplicable === false ? null : normalizeModalSaveValue(values?.po4_p),
                    alkalinity: normalizeModalSaveValue(values?.alkalinity),
                };

                return row;
            })
            .filter((row) => row.location);

        if (rows.length === 0) {
            showToast?.('저장할 수질 데이터가 없습니다.', 'error');
            return { success: false };
        }

        setLoading(true);
        try {
            const res = await WaterQualityModel.bulkSave(rows);
            if (!res?.success) throw new Error(res?.error || '수질 데이터 저장에 실패했습니다.');
            showToast?.('수질분석 데이터가 저장되었습니다.');
            await loadReadings();
            return { success: true };
        } catch (err) {
            showToast?.(`저장 실패: ${err.message}`, 'error');
            return { success: false, error: err.message };
        } finally {
            setLoading(false);
        }
    }, [loadReadings, showToast]);

    return {
        history,
        loading,
        waterTypes,
        updateReading,
        submitBatch,
        refresh: () => loadReadings({ force: true }),
        pendingChanges,
        isImportingFromQntech,
        lastImportSummary,
        lastRangeImportSummary,
        handleImportFromQntech,
        handleImportRangeFromQntech,
        applyImportedWaterValues,
        saveModalDraft,
    };
};
