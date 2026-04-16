import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { FlowModel } from './FlowModel';
import { getTodayKST } from '../../core/constants';

/** 설정 검침항목 위젯과 맞추기 전 1계열 기본(위젯에서 flowTypes 미전달 시) */
const DEFAULT_FLOW_TYPES = ['유입유량계', '방류유량계', '내부반송유량계', '외부반송유량계', '슬러지', '전력량계'];

/**
 * 해당 유량 종류에 대해 startIdx 행부터 아래로 적산(raw)은 유지한 채 누계(diff)를 연쇄 재계산한다.
 * @returns {Map<string, { raw, diff, error, isManual }>} date → 해당 type의 pending 스냅샷
 */
function cascadeRecalculateType(newHist, startIdx, type, correctData, findPreviousSludgeCumulative, isManualAtStart) {
    const pendingByDate = new Map();

    for (let j = startIdx; j < newHist.length; j += 1) {
        const row = newHist[j];
        const prevCell = newHist[j][type] || {};
        let raw = prevCell.raw != null ? Number(prevCell.raw) : null;
        if (raw !== null && Number.isNaN(raw)) raw = null;

        let flow = null;
        let errorMsg = null;

        if (type === '슬러지') {
            if (raw !== null && !Number.isNaN(raw)) {
                const previousCumulative = findPreviousSludgeCumulative(newHist, j, row.date, type);
                flow = Math.round((previousCumulative + raw) * 10) / 10;
                if (raw > 10000) errorMsg = '입력값이 정상 범위를 초과합니다.';
                else if (raw < 0) errorMsg = '반출량은 음수일 수 없습니다.';
            }
        } else if (raw !== null && !Number.isNaN(raw)) {
            let prevReading = null;
            for (let i = j - 1; i >= 0; i -= 1) {
                const c = correctData(newHist[i][type]);
                if (c.reading !== null && c.reading !== undefined) {
                    prevReading = c.reading;
                    break;
                }
            }
            if (prevReading !== null) {
                flow = Math.round((raw - prevReading) * 10) / 10;
                if (raw < prevReading) errorMsg = '전일 검침값보다 작습니다.';
                else if (flow > 5000000) errorMsg = '입력값이 비정상적으로 큽니다.';
            }
        }

        newHist[j] = {
            ...newHist[j],
            [type]: {
                ...prevCell,
                raw,
                diff: flow,
                error: errorMsg,
                isChanged: true,
                isUserInput: j === startIdx,
            },
        };

        const isManual = j === startIdx && isManualAtStart;
        pendingByDate.set(row.date, {
            raw,
            diff: flow,
            error: errorMsg,
            isManual,
        });
    }

    return pendingByDate;
}

/**
 * DB에 남아 있는 1계열 type명(내부반송유량계 등)을 2계열 UI 컬럼 키(…1)로 끌어와 같은 날짜 행에서 보이게 한다.
 * 이미 …1 행에 값이 있으면 덮어쓰지 않는다. flowTypes에 레거시 이름이 그대로 있으면(1계열 UI) 병합하지 않는다.
 */
function mergeLegacyFlowKeysForDisplay(rows, flowTypes) {
    if (!Array.isArray(rows) || !Array.isArray(flowTypes) || flowTypes.length === 0) {
        return rows;
    }
    const types = new Set(flowTypes);
    const legacyPairs = [
        { legacy: '내부반송유량계', modern: '내부반송유량계1' },
        { legacy: '외부반송유량계', modern: '외부반송유량계1' },
    ];

    const cellHasData = (cell) => cell && (cell.raw != null || cell.diff != null);

    return rows.map((row) => {
        let touched = false;
        const out = { ...row };
        for (const { legacy, modern } of legacyPairs) {
            if (!types.has(modern)) continue;
            if (types.has(legacy)) continue;
            const leg = row[legacy];
            const mod = row[modern];
            if (!cellHasData(leg)) continue;
            if (cellHasData(mod)) continue;
            out[modern] = { ...leg };
            touched = true;
        }
        return touched ? out : row;
    });
}

export const useFlowViewModel = (currentUser, { showAlert, flowTypes: flowTypesProp } = {}) => {
    /** 부모가 매 렌더마다 새 배열을 넘겨도, 검침 타입 목록이 같으면 동일 키 → 히스토리 재조회 1회로 제한 */
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

    const findPreviousSludgeCumulative = (rows, currentIndex, rowDate, type) => {
        const currentYear = String(rowDate || '').slice(0, 4);

        for (let i = currentIndex - 1; i >= 0; i--) {
            if (String(rows[i].date || '').slice(0, 4) !== currentYear) {
                break;
            }

            const candidate = correctData(rows[i][type]);
            if (candidate.flow !== null && candidate.flow !== undefined) {
                return Number(candidate.flow);
            }
        }

        return 0;
    };

    const correctData = (data) => {
        if (!data) return { reading: null, flow: null, error: null };
        return { reading: data.raw, flow: data.diff, error: data.error };
    };

    const loadReadings = useCallback(async () => {
        setLoading(true);
        try {
            const todayStr = getTodayKST();
            const todayAnchor = new Date(`${todayStr}T12:00:00`);

            const historyData = await FlowModel.fetchHistory();
            if (historyData.success) {
                const hist = historyData.history;
                hist.sort((a, b) => a.date.localeCompare(b.date));

                // 전체 기간(첫 데이터 ~ 오늘)의 빈 날짜 채우기
                if (hist.length > 0) {
                    const firstDateStr = hist[0].date > todayStr ? todayStr : hist[0].date;
                    let currentDate = new Date(`${firstDateStr}T12:00:00`);
                    const existingDates = new Set(hist.map(h => h.date));

                    while (currentDate < todayAnchor) {
                        const ds = currentDate.toISOString().split('T')[0];
                        if (!existingDates.has(ds)) {
                            const emptyRow = { date: ds };
                            flowTypesResolved.forEach((t) => { emptyRow[t] = { raw: null, diff: null }; });
                            hist.push(emptyRow);
                            existingDates.add(ds);
                        }
                        currentDate.setDate(currentDate.getDate() + 1);
                    }
                }

                // 오늘이 없으면 추가
                if (!hist.find(h => h.date === todayStr)) {
                    const emptyRow = { date: todayStr };
                    flowTypesResolved.forEach((t) => { emptyRow[t] = { raw: null, diff: null }; });
                    hist.push(emptyRow);
                }

                // 미래 5일 추가
                for (let i = 1; i <= 5; i++) {
                    const d = new Date(todayAnchor);
                    d.setDate(todayAnchor.getDate() + i);
                    const ds = d.toISOString().split('T')[0];
                    if (!hist.find(h => h.date === ds)) {
                        const emptyRow = { date: ds, isFuture: true };
                        flowTypesResolved.forEach((t) => { emptyRow[t] = { raw: null, diff: null }; });
                        hist.push(emptyRow);
                    }
                }

                // 빈 날짜들을 맨 뒤에 push했으므로 최종적으로 정렬
                hist.sort((a, b) => a.date.localeCompare(b.date));

                const histMerged = mergeLegacyFlowKeysForDisplay(hist, flowTypesResolved);

                setHistory(histMerged);
                setPendingChanges({});
                pendingChangesRef.current = {};
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [flowTypesResolved]);

    useEffect(() => {
        loadReadings();
    }, [loadReadings]);

    // 셀 편집: 적산값 입력 -> 당일 누계 + 이후 날짜 연쇄 재계산
    const updateReading = (rowDate, type, rawValue) => {
        const parsed = rawValue === '' ? null : parseFloat(rawValue);
        const numRaw = parsed !== null && Number.isFinite(parsed) ? parsed : null;
        let pendingByDate = null;

        setHistory((prev) => {
            const newHist = prev.map((r) => ({ ...r }));
            const idx = newHist.findIndex((h) => h.date === rowDate);
            if (idx === -1) return prev;

            const prevCell = newHist[idx][type] || {};
            newHist[idx] = {
                ...newHist[idx],
                [type]: {
                    ...prevCell,
                    raw: numRaw,
                    diff: prevCell.diff,
                    isChanged: true,
                    isUserInput: true,
                    error: prevCell.error,
                },
            };

            pendingByDate = cascadeRecalculateType(
                newHist,
                idx,
                type,
                correctData,
                findPreviousSludgeCumulative,
                false
            );

            return newHist;
        });

        if (pendingByDate) {
            setPendingChanges((p) => {
                const nextPending = { ...p };
                for (const [date, snap] of pendingByDate.entries()) {
                    nextPending[date] = { ...(p[date] || {}), [type]: snap };
                }
                pendingChangesRef.current = nextPending;
                return nextPending;
            });
        }
    };

    // 셀 편집: 수동 수정 모드 (적산·누계 개별 입력). 적산(raw) 변경 시 이후 날짜 누계 연쇄 재계산.
    const updateManualReading = (rowDate, type, field, val) => {
        const numVal = val === '' ? null : parseFloat(val);
        let pendingByDate = null;
        let manualDiffSnap = null;

        setHistory((prev) => {
            const newHist = prev.map((r) => ({ ...r }));
            const idx = newHist.findIndex((h) => h.date === rowDate);
            if (idx === -1) return prev;

            const currentCell = newHist[idx][type] || {};
            const newCell = {
                ...currentCell,
                [field]: numVal,
                isChanged: true,
                isUserInput: true,
                error: field === 'raw' ? null : currentCell.error,
            };

            newHist[idx] = { ...newHist[idx], [type]: newCell };

            if (field === 'raw') {
                pendingByDate = cascadeRecalculateType(
                    newHist,
                    idx,
                    type,
                    correctData,
                    findPreviousSludgeCumulative,
                    true
                );
            } else {
                const c = newHist[idx][type] || {};
                manualDiffSnap = { raw: c.raw, diff: c.diff };
            }

            return newHist;
        });

        if (field === 'raw' && pendingByDate) {
            setPendingChanges((p) => {
                const nextPending = { ...p };
                for (const [date, snap] of pendingByDate.entries()) {
                    const prevRow = p[date] || {};
                    const prevType = prevRow[type] || {};
                    nextPending[date] = {
                        ...prevRow,
                        [type]: {
                            ...prevType,
                            ...snap,
                            isManual: date === rowDate,
                        },
                    };
                }
                pendingChangesRef.current = nextPending;
                return nextPending;
            });
        } else if (field !== 'raw' && manualDiffSnap) {
            setPendingChanges((p) => {
                const rowChanges = p[rowDate] || {};
                const typeChanges = rowChanges[type] || {
                    raw: manualDiffSnap.raw,
                    diff: manualDiffSnap.diff,
                };
                const nextPending = {
                    ...p,
                    [rowDate]: {
                        ...rowChanges,
                        [type]: { ...typeChanges, [field]: numVal, isManual: true },
                    },
                };
                pendingChangesRef.current = nextPending;
                return nextPending;
            });
        }
    };

    // 일괄 저장
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
                        is_reset: false
                    });
                }
                if (items.length > 0) {
                    const res = await FlowModel.bulkSave(dt, items);
                    if (!res.success) throw new Error(res.error);
                }
            }
            if (!silent) showAlert?.("데이터가 성공적으로 저장되었습니다.");
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
        flowTypes: flowTypesResolved,
        correctData,
        updateReading,
        updateManualReading,
        submitBatch,
        refresh: loadReadings,
        pendingChanges
    };
};
