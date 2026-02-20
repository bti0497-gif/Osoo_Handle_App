import { useState, useEffect } from 'react';
import { MedicineModel } from './MedicineModel';
import { DriveSyncService } from '../../services/DriveSyncService';

export const useMedicineViewModel = (initialDate, currentUser) => {
    const [date, setDate] = useState(initialDate || new Date().toISOString().split('T')[0]);
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState({
        medicine_name: 'hypochlorite',
        purchase_amount: '',
        usage_amount: ''
    });

    useEffect(() => {
        loadLogs();
    }, [date]);

    const loadLogs = async () => {
        setLoading(true);
        try {
            // 1. 클라우드 데이터 동기화 확인
            await DriveSyncService.syncOperationalDataFromCloud(currentUser?.name, date);

            const data = await MedicineModel.fetchLogs(date);
            setLogs(data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const updateForm = (updates) => {
        setForm(prev => ({ ...prev, ...updates }));
    };

    const submitForm = async () => {
        try {
            await MedicineModel.saveLog({ ...form, date });

            // 3. 전체 데이터 클라우드 동기화
            const allLogs = await MedicineModel.fetchLogs(date);
            await DriveSyncService.syncDetailedDataToCloud(currentUser?.name, date, { medicines: allLogs });

            alert("상태: 저장 및 재고 업데이트 완료");
            await loadLogs();
            setForm(prev => ({ ...prev, purchase_amount: '', usage_amount: '' }));
            return { success: true };
        } catch (err) {
            alert("오류: " + err.message);
            return { success: false, error: err.message };
        }
    };

    return {
        date,
        setDate,
        logs,
        loading,
        form,
        updateForm,
        submitForm,
        refresh: loadLogs
    };
};
