import { useState, useEffect } from 'react';
import { AttendanceModel } from '../models/AttendanceModel';

export const useAttendanceViewModel = (initialDate) => {
    const [date, setDate] = useState(initialDate || new Date().toISOString().split('T')[0]);
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
