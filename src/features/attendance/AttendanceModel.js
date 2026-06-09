import { apiClient } from '../../core/api';

export const AttendanceModel = {
    async fetchAttendance(date) {
        const res = await apiClient.get('/api/auth/attendance', { date });
        if (!res?.success) {
            throw new Error(res?.error || '출결 기록을 불러오지 못했습니다.');
        }
        const rows = Array.isArray(res.logs) ? res.logs : [];
        return rows.map((log) => ({
            ...log,
            member_name: log.member_name || log.name,
            is_remote: Boolean(log.remote_session_detected),
        }));
    }
};
