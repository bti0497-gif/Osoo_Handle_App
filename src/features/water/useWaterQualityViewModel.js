import { useState, useEffect, useRef } from 'react';
import { WaterQualityModel } from './WaterQualityModel';
import { DriveSyncService } from '../../services/DriveSyncService';

export const useWaterQualityViewModel = (currentUser, { showAlert } = {}) => {
    const rangeImportPollingRef = useRef(null);
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [pendingChanges, setPendingChanges] = useState({});
    const [isImportingFromQntech, setIsImportingFromQntech] = useState(false);
    const [isImportingRangeFromQntech, setIsImportingRangeFromQntech] = useState(false);
    const [lastImportSummary, setLastImportSummary] = useState(null);
    const [lastRangeImportSummary, setLastRangeImportSummary] = useState(null);
    const [rangeImportProgress, setRangeImportProgress] = useState({
        status: 'idle',
        totalDates: 0,
        completedDates: 0,
        currentDate: null,
        message: ''
    });
    const pendingChangesRef = useRef({});

    useEffect(() => {
        loadReadings();
    }, []);

    useEffect(() => {
        return () => {
            if (rangeImportPollingRef.current) {
                clearInterval(rangeImportPollingRef.current);
            }
        };
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

    const loadReadings = async () => {
        setLoading(true);
        try {
            const today = new Date();
            const todayStr = today.toISOString().split('T')[0];

            await DriveSyncService.syncOperationalDataFromCloud(currentUser?.name, todayStr);

            const historyData = await WaterQualityModel.fetchHistory();
            if (historyData.success) {
                const histRaw = historyData.history; // This is a flat list of { date, location, nh3_n, etc. }
                const histMap = new Map();

                // Group by date
                histRaw.forEach(r => {
                    const loc = r.location || '기본';
                    let dateRow = histMap.get(r.date);
                    if (!dateRow) {
                        dateRow = { date: r.date };
                        histMap.set(r.date, dateRow);
                    }
                    // e.g. dateRow['nh3_n_유량조정조'] = r.nh3_n
                    ['nh3_n', 'no3_n', 'po4_p', 'alkalinity'].forEach(param => {
                        if (r[param] !== null && r[param] !== undefined) {
                            dateRow[`${param}_${loc}`] = normalizeWaterValue(r[param]);
                        }
                    });
                });

                const hist = Array.from(histMap.values());
                hist.sort((a, b) => a.date.localeCompare(b.date));

                // 전체 기간(첫 데이터 ~ 오늘)의 빈 날짜 채우기
                if (hist.length > 0) {
                    const firstDateStr = hist[0].date > todayStr ? todayStr : hist[0].date;
                    let currentDate = new Date(firstDateStr);
                    const todayDate = new Date(todayStr);
                    const existingDates = new Set(hist.map(h => h.date));

                    while (currentDate < todayDate) {
                        const ds = currentDate.toISOString().split('T')[0];
                        if (!existingDates.has(ds)) {
                            hist.push({ date: ds }); // missing params will be undefined
                            existingDates.add(ds);
                        }
                        currentDate.setDate(currentDate.getDate() + 1);
                    }
                }

                // 오늘이 없으면
                if (!hist.find(h => h.date === todayStr)) {
                    hist.push({ date: todayStr });
                }

                // 미래 5일 추가
                for (let i = 1; i <= 5; i++) {
                    const d = new Date(today);
                    d.setDate(today.getDate() + i);
                    const ds = d.toISOString().split('T')[0];
                    if (!hist.find(h => h.date === ds)) {
                        hist.push({ date: ds, isFuture: true });
                    }
                }

                // 마지막으로 정렬
                hist.sort((a, b) => a.date.localeCompare(b.date));

                setHistory(hist);
                setPendingChanges({});
                pendingChangesRef.current = {};
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const updateReading = (rowDate, locName, type, val) => {
        const normalizedValue = val === '' ? null : normalizeWaterValue(val);
        const colKey = `${type}_${locName}`;

        setHistory(prev => {
            const newHist = prev.map(r => ({ ...r }));
            const idx = newHist.findIndex(h => h.date === rowDate);
            if (idx === -1) return prev;

            newHist[idx] = {
                ...newHist[idx],
                [colKey]: normalizedValue,
                [`${colKey}_error`]: null
            };

            setPendingChanges(p => {
                const rowChanges = p[rowDate] || {};
                const nextPending = {
                    ...p,
                    [rowDate]: { ...rowChanges, [colKey]: normalizedValue }
                };
                pendingChangesRef.current = nextPending;
                return nextPending;
            });

            return newHist;
        });
    };

    const applyImportedWaterValues = (importedRows = []) => {
        if (!Array.isArray(importedRows) || importedRows.length === 0) return;

        const nextPending = { ...pendingChangesRef.current };

        setHistory(prev => {
            const rowMap = new Map(prev.map((row) => [row.date, { ...row }]));

            importedRows.forEach((item) => {
                const rowDate = String(item.date || '').slice(0, 10);
                if (!rowDate) return;

                const currentRow = rowMap.get(rowDate) || { date: rowDate };
                const rowPending = nextPending[rowDate] || {};

                ['nh3_n', 'no3_n', 'po4_p', 'alkalinity', 'tn', 'tp', 'cod', 'ss'].forEach((field) => {
                    if (item[field] === undefined) return;
                    const colKey = `${field}_${item.location}`;
                    const normalizedValue = normalizeWaterValue(item[field]);
                    currentRow[colKey] = normalizedValue;
                    currentRow[`${colKey}_error`] = null;
                    rowPending[colKey] = normalizedValue;
                });

                rowMap.set(rowDate, currentRow);
                nextPending[rowDate] = rowPending;
            });

            const nextHistory = Array.from(rowMap.values()).sort((a, b) => a.date.localeCompare(b.date));
            setPendingChanges(nextPending);
            pendingChangesRef.current = nextPending;
            return nextHistory;
        });
    };

    const buildBulkSaveItems = (rows = []) => {
        if (!Array.isArray(rows) || rows.length === 0) return [];

        return rows.map((item) => ({
            date: item.date,
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

        const todayStr = new Date().toISOString().split('T')[0];
        await DriveSyncService.syncDetailedDataToCloud(currentUser?.name, todayStr, { waterQuality: items });
    };

    const handleImportFromQntech = async (date) => {
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
                photoDirectory: result.photoDirectory,
                unmatchedSamples: result.unmatchedSamples || []
            });
            setLastRangeImportSummary(null);

            await loadReadings();
            const importedRowCount = result.summary?.importedRowCount || 0;
            const savedPhotoCount = result.summary?.savedPhotoCount || 0;

            if (importedRowCount === 0 && savedPhotoCount === 0) {
                showAlert?.('데이터가 없습니다.');
            } else {
                showAlert?.(`QnTECH 데이터를 저장했습니다. 값 ${importedRowCount}건, 사진 ${savedPhotoCount}건`);
            }
            return result;
        } catch (err) {
            showAlert?.(`QnTECH 불러오기 실패: ${err.message}`);
            throw err;
        } finally {
            setIsImportingFromQntech(false);
        }
    };

    const handleImportRangeFromQntech = async (startDate, endDate) => {
        const stopRangeImportPolling = () => {
            if (rangeImportPollingRef.current) {
                clearInterval(rangeImportPollingRef.current);
                rangeImportPollingRef.current = null;
            }
        };

        const pollRangeImportProgress = async () => {
            try {
                const progressResponse = await WaterQualityModel.fetchRangeImportProgress();
                if (progressResponse?.success && progressResponse.progress) {
                    setRangeImportProgress(progressResponse.progress);
                }
            } catch (_) {
                // 진행상황 폴링 실패는 실제 import 요청을 막지 않음
            }
        };

        setIsImportingRangeFromQntech(true);
        setRangeImportProgress({
            status: 'processing',
            totalDates: 0,
            completedDates: 0,
            currentDate: startDate,
            message: `${startDate} 데이터를 준비하는 중...`
        });

        stopRangeImportPolling();
        await pollRangeImportProgress();
        rangeImportPollingRef.current = setInterval(pollRangeImportProgress, 1000);

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
                existingValueDateCount: result.summary?.existingValueDateCount || 0,
                existingValueDates: result.existingValueDates || [],
                insertedDates: result.insertedDates || [],
                photoRoot: result.photoRoot,
                summaryRows: result.summaryRows || []
            });
            setLastImportSummary(null);
            setRangeImportProgress({
                status: 'completed',
                totalDates: result.processedDates || 0,
                completedDates: result.processedDates || 0,
                currentDate: result.endDate || endDate,
                message: '기간 데이터 불러오기가 완료되었습니다.'
            });

            await loadReadings();
            const insertedRowCount = result.summary?.insertedRowCount || 0;
            const savedPhotoCount = result.summary?.savedPhotoCount || 0;

            if (insertedRowCount === 0 && savedPhotoCount === 0) {
                showAlert?.('데이터가 없습니다.');
            } else {
                showAlert?.(`기간 불러오기가 완료되었습니다. 값 ${insertedRowCount}건 저장, 사진 ${savedPhotoCount}건 저장`);
            }
            return result;
        } catch (err) {
            setRangeImportProgress((prev) => ({
                ...prev,
                status: 'error',
                message: err.message
            }));
            showAlert?.(`QnTECH 기간 불러오기 실패: ${err.message}`);
            throw err;
        } finally {
            stopRangeImportPolling();
            setIsImportingRangeFromQntech(false);
        }
    };

    const submitBatch = async (options = {}) => {
        const { targetDates = null, silent = false } = options;
        const sourcePendingChanges = pendingChangesRef.current;
        const changedDates = Array.isArray(targetDates)
            ? targetDates.filter(date => sourcePendingChanges[date])
            : Object.keys(sourcePendingChanges);
        if (changedDates.length === 0) {
            if (!silent) showAlert?.("변경 사항이 없습니다.");
            return;
        }

        setLoading(true);
        try {
            const items = [];

            for (const dt of changedDates) {
                const rowChanges = sourcePendingChanges[dt];
                // rowChanges looks like: { nh3_n_유량조정조: 1.5, po4_p_방류조: 0.1 }
                // We need to group by location to send to the backend
                const locValues = {};
                Object.entries(rowChanges).forEach(([colKey, val]) => {
                    const lastUnderscore = colKey.lastIndexOf('_');
                    if (lastUnderscore === -1) return;
                    const paramId = colKey.substring(0, lastUnderscore);
                    const locName = colKey.substring(lastUnderscore + 1);

                    if (!locValues[locName]) {
                        locValues[locName] = { location: locName };
                    }
                    locValues[locName][paramId] = val;
                });

                Object.values(locValues).forEach(locData => {
                    items.push({
                        date: dt,
                        location: locData.location,
                        nh3_n: locData.nh3_n,
                        no3_n: locData.no3_n,
                        po4_p: locData.po4_p,
                        alkalinity: locData.alkalinity
                    });
                });
            }

            if (items.length > 0) {
                const res = await WaterQualityModel.bulkSave(items);
                if (!res.success) throw new Error(res.error);
            }

            if (!silent) showAlert?.("데이터가 성공적으로 저장되었습니다.");

            const todayStr = new Date().toISOString().split('T')[0];
            await DriveSyncService.syncDetailedDataToCloud(currentUser?.name, todayStr, { waterQuality: items });

            await loadReadings();
        } catch (err) {
            if (!silent) showAlert?.("저장 실패: " + err.message);
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
        isImportingRangeFromQntech,
        lastImportSummary,
        lastRangeImportSummary,
        rangeImportProgress,
        handleImportFromQntech,
        handleImportRangeFromQntech,
        applyImportedWaterValues
    };
};
