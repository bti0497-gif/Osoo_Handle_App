import { useState, useEffect } from 'react';
import { WaterQualityModel } from './WaterQualityModel';
import { DriveSyncService } from '../../services/DriveSyncService';

export const useWaterQualityViewModel = (initialDate, currentUser) => {
    const [date, setDate] = useState(initialDate || new Date().toISOString().split('T')[0]);
    const [records, setRecords] = useState([]);
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState({
        location: '유입수',
        nh3_n: '',
        no3_n: '',
        po4_p: '',
        alkalinity: ''
    });

    useEffect(() => {
        loadData();
    }, [date]);

    const loadData = async () => {
        setLoading(true);
        try {
            // 1. 클라우드 데이터 동기화 확인
            await DriveSyncService.syncOperationalDataFromCloud(currentUser?.name, date);

            const data = await WaterQualityModel.fetchData(date);
            setRecords(data);
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
            await WaterQualityModel.saveRecord({ ...form, date });

            // 3. 전체 데이터 클라우드 동기화
            const allRecords = await WaterQualityModel.fetchData(date);
            await DriveSyncService.syncDetailedDataToCloud(currentUser?.name, date, { waterQuality: allRecords });

            alert("상태: 분석 데이터 저장 완료");
            await loadData();
            setForm(prev => ({ ...prev, nh3_n: '', no3_n: '', po4_p: '', alkalinity: '' }));
            return { success: true };
        } catch (err) {
            alert("오류: " + err.message);
            return { success: false, error: err.message };
        }
    };

    return {
        date,
        setDate,
        records,
        loading,
        form,
        updateForm,
        submitForm,
        refresh: loadData
    };
};
