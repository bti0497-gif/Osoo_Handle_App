import { useState, useEffect } from 'react';
import { FlowModel } from '../models/FlowModel';
import { DriveSyncService } from '../services/DriveSyncService';

export const useFlowViewModel = (initialDate, currentUser) => {
    const [date, setDate] = useState(initialDate || new Date().toISOString().split('T')[0]);
    const [readings, setReadings] = useState([]);
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState({
        type: 'inflow',
        raw_value: '',
        is_reset: false,
        is_manual: false,
        manual_flow: '',
        sludge_export: ''
    });

    useEffect(() => {
        loadReadings();
    }, [date]);

    const loadReadings = async () => {
        setLoading(true);
        try {
            // 1. 클라우드 데이터 동기화 확인
            await DriveSyncService.syncOperationalDataFromCloud(currentUser?.name, date);

            const data = await FlowModel.fetchReadings(date);
            setReadings(data);
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
            await FlowModel.saveReading({ ...form, date });

            // 3. 전체 데이터 클라우드 동기화 (기존 AuthModel.syncTodayData 패턴 활용)
            const allReadings = await FlowModel.fetchReadings(date);
            await DriveSyncService.syncDetailedDataToCloud(currentUser?.name, date, { flows: allReadings });

            alert("상태: 저장 완료");
            await loadReadings();
            setForm(prev => ({ ...prev, raw_value: '', manual_flow: '', sludge_export: '' }));
            return { success: true };
        } catch (err) {
            alert("오류: " + err.message);
            return { success: false, error: err.message };
        }
    };

    return {
        date,
        setDate,
        readings,
        loading,
        form,
        updateForm,
        submitForm,
        refresh: loadReadings
    };
};
