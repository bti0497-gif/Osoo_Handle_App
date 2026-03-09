import { useState, useEffect } from 'react';
import { FacilityModel } from './FacilityModel';

export const useFacilityViewModel = (currentUser, { showAlert } = {}) => {
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
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

            showAlert?.("상태: 시설 일지 기록 완료");
            await loadLogs();
            setForm({ facility_name: '', content: '', company: '', price: '', notes: '' });
            return { success: true };
        } catch (err) {
            showAlert?.("오류: " + err.message);
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
