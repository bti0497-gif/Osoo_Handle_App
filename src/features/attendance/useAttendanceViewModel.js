import { useState, useEffect, useCallback } from 'react';
import { AttendanceModel } from './AttendanceModel';

const pad2 = (value) => String(value).padStart(2, '0');

const getTodayLocal = () => {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
};

export const useAttendanceViewModel = (currentUser, initialDate) => {
    const [date, setDate] = useState(initialDate || getTodayLocal());
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);

    const loadAttendance = useCallback(async () => {
        setLoading(true);
        try {
            const data = await AttendanceModel.fetchAttendance(date);
            setLogs(data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [date]);

    useEffect(() => {
        loadAttendance();
    }, [loadAttendance]);

    return {
        date,
        setDate,
        logs,
        loading,
        refresh: loadAttendance
    };
};
