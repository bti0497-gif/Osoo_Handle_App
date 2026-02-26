import { useState, useEffect } from 'react';
import { WaterQualityModel } from './WaterQualityModel';
import { DriveSyncService } from '../../services/DriveSyncService';

export const useWaterQualityViewModel = (currentUser, { showAlert } = {}) => {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [pendingChanges, setPendingChanges] = useState({});

    useEffect(() => {
        loadReadings();
    }, []);

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
                            dateRow[`${param}_${loc}`] = r[param];
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
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const updateReading = (rowDate, locName, type, val) => {
        const numVal = val === '' ? null : parseFloat(val);
        const colKey = `${type}_${locName}`;

        setHistory(prev => {
            const newHist = prev.map(r => ({ ...r }));
            const idx = newHist.findIndex(h => h.date === rowDate);
            if (idx === -1) return prev;

            let errorMsg = null;
            if (numVal !== null && numVal < 0) {
                errorMsg = "0 이상이어야 합니다.";
            }

            newHist[idx] = {
                ...newHist[idx],
                [colKey]: numVal,
                [`${colKey}_error`]: errorMsg
            };

            setPendingChanges(p => {
                const rowChanges = p[rowDate] || {};
                return {
                    ...p,
                    [rowDate]: { ...rowChanges, [colKey]: numVal }
                };
            });

            return newHist;
        });
    };

    const submitBatch = async () => {
        const changedDates = Object.keys(pendingChanges);
        if (changedDates.length === 0) {
            showAlert?.("변경 사항이 없습니다.");
            return;
        }

        setLoading(true);
        try {
            const items = [];

            for (const dt of changedDates) {
                const rowChanges = pendingChanges[dt];
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

            showAlert?.("데이터가 성공적으로 저장되었습니다.");

            const todayStr = new Date().toISOString().split('T')[0];
            await DriveSyncService.syncDetailedDataToCloud(currentUser?.name, todayStr, { waterQuality: items });

            await loadReadings();
        } catch (err) {
            showAlert?.("저장 실패: " + err.message);
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
        pendingChanges
    };
};
