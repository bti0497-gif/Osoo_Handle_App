import { useState, useEffect } from 'react';
import { FlowModel } from './FlowModel';
import { DriveSyncService } from '../../services/DriveSyncService';

export const useFlowViewModel = (currentUser, { showAlert } = {}) => {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [pendingChanges, setPendingChanges] = useState({});

    useEffect(() => {
        loadReadings();
    }, []);

    const flowTypes = ['유입유량계', '방류유량계', '내부반송유량계', '외부반송유량계', '슬러지', '전력량계'];

    const correctData = (data) => {
        if (!data) return { reading: null, flow: null, error: null };
        return { reading: data.raw, flow: data.diff, error: data.error };
    };

    const loadReadings = async () => {
        setLoading(true);
        try {
            const today = new Date();
            const todayStr = today.toISOString().split('T')[0];

            await DriveSyncService.syncOperationalDataFromCloud(currentUser?.name, todayStr);

            const historyData = await FlowModel.fetchHistory();
            if (historyData.success) {
                const hist = historyData.history;
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
                            const emptyRow = { date: ds };
                            flowTypes.forEach(t => { emptyRow[t] = { raw: null, diff: null }; });
                            hist.push(emptyRow);
                            existingDates.add(ds);
                        }
                        currentDate.setDate(currentDate.getDate() + 1);
                    }
                }

                // 오늘이 없으면 추가
                if (!hist.find(h => h.date === todayStr)) {
                    const emptyRow = { date: todayStr };
                    flowTypes.forEach(t => { emptyRow[t] = { raw: null, diff: null }; });
                    hist.push(emptyRow);
                }

                // 미래 5일 추가
                for (let i = 1; i <= 5; i++) {
                    const d = new Date(today);
                    d.setDate(today.getDate() + i);
                    const ds = d.toISOString().split('T')[0];
                    if (!hist.find(h => h.date === ds)) {
                        const emptyRow = { date: ds, isFuture: true };
                        flowTypes.forEach(t => { emptyRow[t] = { raw: null, diff: null }; });
                        hist.push(emptyRow);
                    }
                }

                // 빈 날짜들을 맨 뒤에 push했으므로 최종적으로 정렬
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

    // 셀 편집: 적산값 입력 -> 누계 자동 계산
    const updateReading = (rowDate, type, rawValue) => {
        const numRaw = rawValue === '' ? null : parseFloat(rawValue);

        setHistory(prev => {
            const newHist = prev.map(r => ({ ...r }));
            const idx = newHist.findIndex(h => h.date === rowDate);
            if (idx === -1) return prev;

            // 전일 적산값 찾기
            let prevReading = null;
            for (let i = idx - 1; i >= 0; i--) {
                const c = correctData(newHist[i][type]);
                if (c.reading !== null) {
                    prevReading = c.reading;
                    break;
                }
            }

            let flow = null;
            let errorMsg = null;
            if (numRaw !== null && prevReading !== null) {
                flow = Math.round((numRaw - prevReading) * 10) / 10;
                if (numRaw < prevReading) {
                    errorMsg = "전일 검침값보다 작습니다.";
                } else if (flow > 5000000) {
                    errorMsg = "입력값이 비정상적으로 큽니다.";
                }
            } else if (numRaw !== null && type === '슬러지') {
                if (numRaw > 10000) {
                    errorMsg = "입력값이 정상 범위를 초과합니다.";
                }
            }

            newHist[idx] = {
                ...newHist[idx],
                [type]: { raw: numRaw, diff: flow, isChanged: true, isUserInput: true, error: errorMsg }
            };

            // pending 기록
            setPendingChanges(p => ({
                ...p,
                [rowDate]: { ...p[rowDate], [type]: { raw: numRaw, diff: flow, error: errorMsg } }
            }));

            return newHist;
        });
    };

    // 셀 편집: 수동 수정 모드 (적산, 누계 개별 입력, 검증/계산 생략)
    const updateManualReading = (rowDate, type, field, val) => {
        const numVal = val === '' ? null : parseFloat(val);
        setHistory(prev => {
            const newHist = [...prev];
            const idx = newHist.findIndex(h => h.date === rowDate);
            if (idx === -1) return prev;

            const currentCell = newHist[idx][type] || {};
            const newCell = {
                ...currentCell,
                [field]: numVal,
                isChanged: true,
                isUserInput: true,
                error: null // 수동 모드에선 에러 리셋
            };

            newHist[idx] = { ...newHist[idx], [type]: newCell };

            setPendingChanges(p => {
                const rowChanges = p[rowDate] || {};
                const typeChanges = rowChanges[type] || { raw: currentCell.raw, diff: currentCell.diff };
                return {
                    ...p,
                    [rowDate]: {
                        ...rowChanges,
                        [type]: { ...typeChanges, [field]: numVal, isManual: true }
                    }
                };
            });

            return newHist;
        });
    };

    // 일괄 저장
    const submitBatch = async () => {
        const changedDates = Object.keys(pendingChanges);
        if (changedDates.length === 0) {
            showAlert?.("변경 사항이 없습니다.");
            return;
        }

        setLoading(true);
        try {
            for (const dt of changedDates) {
                const items = [];
                const changes = pendingChanges[dt];
                for (const [type, data] of Object.entries(changes)) {
                    if (type === 'date' || type === 'isFuture') continue;
                    items.push({
                        type,
                        raw_value: data.raw,
                        calculated_flow: data.diff,
                        is_manual: !!data.isManual,
                        is_reset: false
                    });
                }
                if (items.length > 0) {
                    const res = await FlowModel.bulkSave(dt, items);
                    if (!res.success) throw new Error(res.error);
                }
            }
            showAlert?.("데이터가 성공적으로 저장되었습니다.");
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
        flowTypes,
        correctData,
        updateReading,
        updateManualReading,
        submitBatch,
        refresh: loadReadings,
        pendingChanges
    };
};
