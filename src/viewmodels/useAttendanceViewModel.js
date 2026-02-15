import { useState, useEffect } from 'react';
import { AttendanceModel } from '../models/AttendanceModel';
import { DriveSyncService } from '../services/DriveSyncService';

export const useAttendanceViewModel = (currentUser, initialDate) => {
    const [date, setDate] = useState(initialDate || new Date().toISOString().split('T')[0]);
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        loadAttendance();
    }, [date]);

    const loadAttendance = async () => {
        setLoading(true);
        try {
            // 1. 클라우드에서 최신 출근 데이터 동기화 확인
            await DriveSyncService.syncOperationalDataFromCloud(currentUser?.name, date);

            const data = await AttendanceModel.fetchAttendance(date);
            setLogs(data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    return {
        date,
        setDate,
        logs,
        loading,
        refresh: loadAttendance
    };
};
