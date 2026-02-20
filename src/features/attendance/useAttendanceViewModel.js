import { useState, useEffect } from 'react';
import { AttendanceModel } from './AttendanceModel';
import { DriveSyncService } from '../../services/DriveSyncService';

// 한국 시간(KST) 기준 오늘 날짜 구하기 (YYYY-MM-DD)
const getTodayKST = () => {
    const kstDate = new Date(new Date().getTime() + (9 * 60 * 60 * 1000));
    return kstDate.toISOString().split('T')[0];
};

export const useAttendanceViewModel = (currentUser, initialDate) => {
    const [date, setDate] = useState(initialDate || getTodayKST());
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        loadAttendance();
    }, [date]);

    const loadAttendance = async () => {
        setLoading(true);
        try {
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
