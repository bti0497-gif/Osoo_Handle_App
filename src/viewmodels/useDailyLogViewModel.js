import { useState, useEffect } from 'react';
import { DailyLogModel } from '../models/DailyLogModel';

export const useDailyLogViewModel = (initialDate) => {
    const [date, setDate] = useState(initialDate || new Date().toISOString().split('T')[0]);
    const [data, setData] = useState({
        flows: [],
        medicines: [],
        waterQuality: [],
        facilities: []
    });
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        loadData();
    }, [date]);

    const loadData = async () => {
        setLoading(true);
        try {
            const result = await DailyLogModel.fetchAllData(date);
            setData(result);
        } catch (err) {
            console.error("Aggregation failed:", err);
        } finally {
            setLoading(false);
        }
    };

    const handlePrint = () => {
        window.print();
    };

    return {
        date,
        setDate,
        data,
        loading,
        handlePrint,
        refresh: loadData
    };
};
