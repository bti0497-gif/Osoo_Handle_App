const API_BASE_URL = 'http://localhost:8901';

export const AttendanceModel = {
    async fetchAttendance(date) {
        const response = await fetch(`${API_BASE_URL}/api/attendance?date=${date}`);
        if (!response.ok) throw new Error('Failed to fetch attendance logs');
        return await response.json();
    }
};
