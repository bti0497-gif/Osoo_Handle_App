import { useState, useEffect, useRef } from 'react';
import { MedicineModel } from './MedicineModel';
import { SettingsModel } from '../settings/SettingsModel';
import { DriveSyncService } from '../../services/DriveSyncService';

export const useMedicineViewModel = (currentUser, { showAlert } = {}) => {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [pendingChanges, setPendingChanges] = useState({});
    const [medicineTypes, setMedicineTypes] = useState([]);
    const pendingChangesRef = useRef({});

    useEffect(() => {
        loadLogs();
    }, []);

    const correctData = (data) => {
        if (!data) return { purchase: null, usage: null, inventory: null, error: null };
        return { purchase: data.purchase, usage: data.usage, inventory: data.inventory, error: data.error };
    };

    const calculateInventory = (histArr, startIndex, type) => {
        for (let i = startIndex; i < histArr.length; i++) {
            const prevInv = i > 0 && histArr[i - 1][type]?.inventory != null ? histArr[i - 1][type].inventory : 0;
            const p = histArr[i][type]?.purchase || 0;
            const u = histArr[i][type]?.usage || 0;

            const newInv = Math.round((prevInv + p - u) * 10) / 10;
            histArr[i][type].inventory = newInv;
        }
    };

    const loadLogs = async () => {
        setLoading(true);
        try {
            const today = new Date();
            const todayStr = today.toISOString().split('T')[0];

            await DriveSyncService.syncOperationalDataFromCloud(currentUser?.name, todayStr);

            // 설정에서 활성화된 약품 항목 가져오기
            const settingsData = await SettingsModel.getSettings();
            let dynamicTypes = [];
            if (settingsData?.success && settingsData.configItems) {
                const meds = settingsData.configItems.filter(i => i.category === 'medicine' && i.is_active);
                // 맵핑용 키 (ex: PAC_purchase) 필터링
                const baseMeds = meds.filter(i => !i.item_name.endsWith('_purchase') && !i.item_name.endsWith('_usage') && !i.item_name.endsWith('_inventory'));
                dynamicTypes = baseMeds.map(i => i.item_name);
            }
            if (dynamicTypes.length === 0) {
                dynamicTypes = ['차아염소산나트륨', 'PAC', '고분자응집제', '메탄올', '소포제']; // 기본값
            }
            setMedicineTypes(dynamicTypes);

            const historyData = await MedicineModel.fetchHistory();
            if (historyData.success) {
                const histRaw = historyData.history;

                const dateMap = new Map();
                histRaw.forEach(r => {
                    if (!dateMap.has(r.date)) {
                        const row = { date: r.date };
                        dynamicTypes.forEach(t => row[t] = { purchase: null, usage: null, inventory: null });
                        dateMap.set(r.date, row);
                    }
                    if (dynamicTypes.includes(r.medicine_name)) {
                        dateMap.get(r.date)[r.medicine_name] = {
                            purchase: r.purchase_amount,
                            usage: r.usage_amount,
                            inventory: r.current_inventory
                        };
                    }
                });

                const hist = Array.from(dateMap.values());

                // 날짜 오름차순
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

                // 미래 5일
                for (let i = 1; i <= 5; i++) {
                    const d = new Date(today);
                    d.setDate(today.getDate() + i);
                    const ds = d.toISOString().split('T')[0];
                    if (!hist.find(h => h.date === ds)) {
                        const emptyRow = { date: ds, isFuture: true };
                        dynamicTypes.forEach(t => { emptyRow[t] = { purchase: null, usage: null, inventory: null }; });
                        hist.push(emptyRow);
                    }
                }

                // 마지막으로 정렬
                hist.sort((a, b) => a.date.localeCompare(b.date));

                // For dates that lack inventory data, calculate it initially
                dynamicTypes.forEach(type => {
                    calculateInventory(hist, 0, type);
                });

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
                for (const [medicine_name, data] of Object.entries(rowChanges)) {
                    items.push({
                        date: dt,
                        medicine_name,
                        purchase_amount: data.purchase || 0,
                        usage_amount: data.usage || 0,
                        current_inventory: data.inventory || 0
                    });
                }
            }

            if (items.length > 0) {
                const res = await MedicineModel.bulkSave(items);
                if (!res.success) throw new Error(res.error);
            }

            if (!silent) showAlert?.("데이터가 성공적으로 저장되었습니다.");

            const todayStr = new Date().toISOString().split('T')[0];
            await DriveSyncService.syncDetailedDataToCloud(currentUser?.name, todayStr, { medicines: items });

            await loadLogs();
        } catch (err) {
            if (!silent) showAlert?.("저장 실패: " + err.message);
        } finally {
            setLoading(false);
        }
    };

    return {
        history,
        loading,
        medicineTypes,
        correctData,
        updateAmount,
        submitBatch,
        refresh: loadLogs,
        pendingChanges
    };
};
