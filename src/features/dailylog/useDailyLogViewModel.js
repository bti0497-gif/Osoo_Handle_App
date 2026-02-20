import { useState, useEffect } from 'react';
import { DailyLogModel } from './DailyLogModel';
import { DriveSyncService } from '../../services/DriveSyncService';

export const useDailyLogViewModel = (currentUser, initialDate) => {
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
            // 1. 클라우드에서 최신 운영 데이터 동기화 확인
            await DriveSyncService.syncOperationalDataFromCloud(currentUser?.name, date);

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
