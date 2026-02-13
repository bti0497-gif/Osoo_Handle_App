import { useState, useEffect } from 'react';
import { FlowModel } from '../models/FlowModel';

export const useFlowViewModel = (initialDate) => {
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
