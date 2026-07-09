import { useState, useEffect, useRef, useCallback } from 'react';
import { KitModel } from './KitModel';
import { SettingsModel } from '../settings/SettingsModel';
import { getTodayKST } from '../../core/constants';

const toNumberOrZero = (value) => {
    if (value === '' || value === null || value === undefined) return 0;
    const parsed = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
};

export const useKitViewModel = (currentUser, { showAlert } = {}) => {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [pendingChanges, setPendingChanges] = useState({});
    const [kitTypes, setKitTypes] = useState([]);
    const [isSyncingAnalysisKits, setIsSyncingAnalysisKits] = useState(false);
    const [lastKitSyncSummary, setLastKitSyncSummary] = useState(null);
    const [showPurchaseModal, setShowPurchaseModal] = useState(false);
    const [purchaseDate, setPurchaseDate] = useState('');
    const [purchaseItems, setPurchaseItems] = useState([]);
    const [isSavingPurchase, setIsSavingPurchase] = useState(false);
    const [autoSaveStatus, setAutoSaveStatus] = useState('idle');
    const pendingChangesRef = useRef({});
    const submitBatchRef = useRef(null);
    const autoSaveTimerRef = useRef(null);
    const autoSaveStatusTimerRef = useRef(null);
    const isAutoSavingRef = useRef(false);

    const toDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const resolveMonthRange = (baseDateText) => {
        const today = new Date();
        const todayStr2 = toDateStr(today);
        if (baseDateText) {
            // 특정 날짜가 선택된 경우 → 해당 월 범위
            const baseDate = new Date(`${baseDateText}T00:00:00`);
            const y = baseDate.getFullYear();
            const m = baseDate.getMonth();
            const monthStart = new Date(y, m, 1);
            const monthEnd = new Date(y, m + 1, 0);
            const end = monthEnd > today ? today : monthEnd;
            return { startDate: toDateStr(monthStart), endDate: toDateStr(end) };
        }
        // 선택된 날짜 없으면 → 올해 1월 1일 ~ 오늘 전체
        return { startDate: `${today.getFullYear()}-01-01`, endDate: todayStr2 };
    };

    useEffect(() => {
        return () => {
            if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
            if (autoSaveStatusTimerRef.current) clearTimeout(autoSaveStatusTimerRef.current);
        };
    }, []);

    const calculateInventory = (histArr, startIndex, type) => {
        for (let i = startIndex; i < histArr.length; i++) {
            const prevInv = i > 0 && histArr[i - 1][type]?.inventory != null ? histArr[i - 1][type].inventory : 0;
            const p = histArr[i][type]?.purchase || 0;
            const u = histArr[i][type]?.usage || 0;

            const newInv = Math.round((prevInv + p - u) * 10) / 10;
            histArr[i][type].inventory = newInv;
        }
    };

    const loadLogs = useCallback(async (options = {}) => {
        setLoading(true);
        try {
            const todayStr = getTodayKST();
            const today = new Date(`${todayStr}T12:00:00`);

            // 설정에서 활성화된 키트 항목 가져오기
            const settingsData = await SettingsModel.getSettings();
            let dynamicTypes = [];
            if (settingsData?.success && settingsData.configItems) {
                const kits = settingsData.configItems.filter(i => i.category === 'kit' && i.is_active
                    && !i.item_name.endsWith('_purchase') && !i.item_name.endsWith('_usage') && !i.item_name.endsWith('_inventory'));
                dynamicTypes = kits.map(i => i.item_name);
            }
            if (dynamicTypes.length === 0) {
                dynamicTypes = ['암모니아성질소(NH3-N)', '질산성질소(NO3-N)', '인산염인(PO4-P)', '알칼리도(ALK)'];
            }
            setKitTypes(dynamicTypes);

            const historyData = await KitModel.fetchHistory({ force: options.force });
            if (historyData.success) {
                const histRaw = historyData.history;

                const dateMap = new Map();
                histRaw.forEach(r => {
                    if (!dateMap.has(r.date)) {
                        const row = { date: r.date };
                        dynamicTypes.forEach(t => row[t] = { purchase: null, usage: null, inventory: null });
                        dateMap.set(r.date, row);
                    }
                    if (dynamicTypes.includes(r.kit_name)) {
                        dateMap.get(r.date)[r.kit_name] = {
                            purchase: r.purchase_amount,
                            usage: r.usage_amount,
                            inventory: r.current_inventory
                        };
                    }
                });

                const hist = Array.from(dateMap.values());
                hist.sort((a, b) => a.date.localeCompare(b.date));

                // 전체 기간(첫 데이터 ~ 오늘)의 빈 날짜 채우기
                if (hist.length > 0) {
                    const firstDateStr = hist[0].date > todayStr ? todayStr : hist[0].date;
                    let currentDate = new Date(firstDateStr);
                    const todayDate = new Date(todayStr);
                    const existingDates = new Set(hist.map(h => h.date));

                    while (currentDate < todayDate) {
                        const ds = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
                        if (!existingDates.has(ds)) {
                            const emptyRow = { date: ds };
                            dynamicTypes.forEach(t => { emptyRow[t] = { purchase: null, usage: null, inventory: null }; });
                            hist.push(emptyRow);
                            existingDates.add(ds);
                        }
                        currentDate.setDate(currentDate.getDate() + 1);
                    }
                }

                // 오늘 없으면 추가
                if (!hist.find(h => h.date === todayStr)) {
                    const emptyRow = { date: todayStr };
                    dynamicTypes.forEach(t => { emptyRow[t] = { purchase: null, usage: null, inventory: null }; });
                    hist.push(emptyRow);
                }

                // 미래 1일
                for (let i = 1; i <= 1; i++) {
                    const d = new Date(today);
                    d.setDate(today.getDate() + i);
                    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    if (!hist.find(h => h.date === ds)) {
                        const emptyRow = { date: ds, isFuture: true };
                        dynamicTypes.forEach(t => { emptyRow[t] = { purchase: null, usage: null, inventory: null }; });
                        hist.push(emptyRow);
                    }
                }

                hist.sort((a, b) => a.date.localeCompare(b.date));

                // 재고 자동 계산은 이제 더 이상 로드 시 수행하지 않음 (DB 값 신뢰)
                // dynamicTypes.forEach(type => {
                //     calculateInventory(hist, 0, type);
                // });

                setHistory(hist);
                setPendingChanges({});
                pendingChangesRef.current = {};
            }
        } catch (err) {
            console.error('Kit data load failed:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadLogs();
    }, [loadLogs]);

    const updateAmount = (rowDate, type, field, val) => {
        const numVal = val === '' ? null : parseFloat(val);

        setHistory(prev => {
            const newHist = prev.map(r => {
                const rowCopy = { ...r };
                if (rowCopy[type]) rowCopy[type] = { ...rowCopy[type] };
                return rowCopy;
            });
            const idx = newHist.findIndex(h => h.date === rowDate);
            if (idx === -1) return prev;

            let errorMsg = null;
            if (numVal !== null && numVal < 0) {
                errorMsg = "0 이상이어야 합니다.";
            }

            newHist[idx][type][field] = numVal;
            newHist[idx][type].error = errorMsg;

            // 수정한 날짜 이후의 재고 자동 재계산
            calculateInventory(newHist, idx, type);

            setPendingChanges(p => {
                const nextP = { ...p };
                for (let i = idx; i < newHist.length; i++) {
                    const dDate = newHist[i].date;
                    if (!nextP[dDate]) nextP[dDate] = {};
                    if (!nextP[dDate][type]) nextP[dDate][type] = {
                        purchase: newHist[i][type].purchase,
                        usage: newHist[i][type].usage
                    };

                    if (i === idx) {
                        nextP[dDate][type][field] = numVal;
                    }
                    nextP[dDate][type].inventory = newHist[i][type].inventory;
                }
                pendingChangesRef.current = nextP;
                return nextP;
            });

            return newHist;
        });
    };

    const submitBatch = useCallback(async (options = {}) => {
        const { targetDates = null, silent = false } = options;
        const sourcePendingChanges = pendingChangesRef.current;
        const changedDates = Array.isArray(targetDates)
            ? targetDates.filter(date => sourcePendingChanges[date])
            : Object.keys(sourcePendingChanges);
        if (changedDates.length === 0) {
            if (!silent) showAlert?.("변경 사항이 없습니다.");
            return { success: true, empty: true };
        }

        setLoading(true);
        try {
            const items = [];
            for (const dt of changedDates) {
                const changes = sourcePendingChanges[dt];
                for (const [type, data] of Object.entries(changes)) {
                    items.push({
                        kit_name: type,
                        date: dt,
                        purchase_amount: data.purchase || 0,
                        usage_amount: data.usage || 0,
                        current_inventory: data.inventory || 0
                    });
                }
            }
            if (items.length > 0) {
                const res = await KitModel.bulkSave(items);
                if (!res.success) throw new Error(res.error);
            }
            if (!silent) showAlert?.("데이터가 성공적으로 저장되었습니다.");

            await loadLogs();
            return { success: true };
        } catch (err) {
            if (!silent) showAlert?.("저장 실패: " + err.message);
            return { success: false, error: err };
        } finally {
            setLoading(false);
        }
    }, [loadLogs, showAlert]);

    useEffect(() => {
        submitBatchRef.current = submitBatch;
    }, [submitBatch]);

    useEffect(() => {
        const hasPending = Object.keys(pendingChanges).length > 0;
        if (!hasPending) return;

        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = setTimeout(async () => {
            if (isAutoSavingRef.current) return;
            isAutoSavingRef.current = true;
            setAutoSaveStatus('saving');

            const result = await (submitBatchRef.current
                ? submitBatchRef.current({ silent: true })
                : { success: false });

            if (result?.success) {
                setAutoSaveStatus('saved');
                if (autoSaveStatusTimerRef.current) clearTimeout(autoSaveStatusTimerRef.current);
                autoSaveStatusTimerRef.current = setTimeout(() => {
                    setAutoSaveStatus('idle');
                }, 1200);
            } else {
                setAutoSaveStatus('error');
            }

            isAutoSavingRef.current = false;
        }, 120);

        return () => {
            if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        };
    }, [pendingChanges]);

    const openPurchaseModal = async (baseDateText) => {
        // 설정에서 키트 기본 입고량 불러오기
        const today = new Date();
        const defaultDate = baseDateText || toDateStr(today);
        try {
            const res = await SettingsModel.getKitDefaults();
            if (res.success) {
                setPurchaseItems(res.items.map(i => ({ kitName: i.item_name, purchaseAmount: i.default_amount ?? 0 })));
            } else {
                setPurchaseItems(kitTypes.map(name => ({ kitName: name, purchaseAmount: 0 })));
            }
        } catch {
            setPurchaseItems(kitTypes.map(name => ({ kitName: name, purchaseAmount: 0 })));
        }
        setPurchaseDate(defaultDate);
        setShowPurchaseModal(true);
    };

    const savePurchase = async () => {
        if (!purchaseDate) { showAlert?.('날짜를 선택하세요.'); return; }
        setIsSavingPurchase(true);
        try {
            const result = await KitModel.savePurchase(purchaseDate, purchaseItems);
            if (!result?.success) throw new Error(result?.error || '구매 저장 실패');
            setShowPurchaseModal(false);
            await loadLogs();
            showAlert?.(`분석키트 구매 저장 완료 (${purchaseDate})`);
        } catch (err) {
            showAlert?.('분석키트 구매 저장 실패: ' + err.message);
        } finally {
            setIsSavingPurchase(false);
        }
    };

    const saveModalDraft = useCallback(async ({ date, items = [] } = {}) => {
        if (!date) {
            showAlert?.('저장할 날짜가 없습니다.');
            return { success: false };
        }

        const payloadItems = items
            .map(({ item, values }) => {
                const kitName = item?.key || item?.name || item?.label;
                if (!kitName) return null;
                return {
                    kit_name: kitName,
                    date,
                    purchase_amount: toNumberOrZero(values?.purchase),
                    usage_amount: toNumberOrZero(values?.usage),
                    current_inventory: toNumberOrZero(values?.inventory),
                };
            })
            .filter(Boolean);

        if (payloadItems.length === 0) {
            showAlert?.('저장할 키트 데이터가 없습니다.');
            return { success: false };
        }

        setLoading(true);
        try {
            const res = await KitModel.bulkSave(payloadItems);
            if (!res.success) throw new Error(res.error || '키트 데이터 저장에 실패했습니다.');
            showAlert?.('키트 데이터가 저장되었습니다.');
            await loadLogs();
            return res;
        } catch (err) {
            showAlert?.('저장 실패: ' + err.message);
            return { success: false, error: err.message };
        } finally {
            setLoading(false);
        }
    }, [loadLogs, showAlert]);

    const syncAnalysisKits = async (baseDateText) => {
        setIsSyncingAnalysisKits(true);
        try {
            const { startDate, endDate } = resolveMonthRange(baseDateText);
            const result = await KitModel.syncAnalysisUsage(startDate, endDate);
            if (!result?.success) {
                throw new Error(result?.error || '분석키트 동기화에 실패했습니다.');
            }

            setLastKitSyncSummary({
                startDate,
                endDate,
                summary: result.summary || {},
                unsyncedDates: result.unsyncedDates || []
            });

            await loadLogs();
            const updated = result.summary?.updatedCellCount || 0;
            const matched = result.summary?.alreadyMatchedCellCount || 0;
            const msg = updated > 0
                ? `분석키트 동기화 완료: ${result.summary?.unsyncedDateCount || 0}일 신규 반영 (${updated}셀)`
                : `분석키트 동기화 완료: 변경할 내용 없음 (${matched}셀 이미 일치)`;
            showAlert?.(msg);
            return result;
        } catch (err) {
            showAlert?.(`분석키트 동기화 실패: ${err.message}`);
            throw err;
        } finally {
            setIsSyncingAnalysisKits(false);
        }
    };

    return {
        history,
        loading,
        kitTypes,
        isSyncingAnalysisKits,
        lastKitSyncSummary,
        showPurchaseModal, setShowPurchaseModal,
        purchaseDate, setPurchaseDate,
        purchaseItems, setPurchaseItems,
        isSavingPurchase,
        autoSaveStatus,
        openPurchaseModal,
        savePurchase,
        updateAmount,
        submitBatch,
        saveModalDraft,
        syncAnalysisKits,
        refresh: ({ force = true } = {}) => loadLogs({ force }),
        pendingChanges
    };
};
