import { useState, useEffect } from 'react';
import { FacilityModel } from './FacilityModel';
import { DriveSyncService } from '../../services/DriveSyncService';

export const useFacilityViewModel = (initialDate, currentUser) => {
    const [date, setDate] = useState(initialDate || new Date().toISOString().split('T')[0]);
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState({
        facility_name: '',
        content: '',
        company: '',
        price: '',
        notes: ''
    });

    useEffect(() => {
        loadLogs();
    }, [date]);

    const loadLogs = async () => {
        setLoading(true);
        try {
            // 1. 클라우드 데이터 동기화 확인
            await DriveSyncService.syncOperationalDataFromCloud(currentUser?.name, date);

            const data = await FacilityModel.fetchLogs(date);
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
            await FacilityModel.saveLog({ ...form, date });

            // 3. 전체 데이터 클라우드 동기화
            const allFacilities = await FacilityModel.fetchLogs(date);
            await DriveSyncService.syncDetailedDataToCloud(currentUser?.name, date, { facilities: allFacilities });

            alert("상태: 시설 일지 기록 완료");
            await loadLogs();
            setForm({ facility_name: '', content: '', company: '', price: '', notes: '' });
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
