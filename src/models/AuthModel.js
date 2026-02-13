import { DriveSyncService } from '../services/DriveSyncService';

const API_BASE_URL = 'http://localhost:8901';

export const AuthModel = {
    async localLogin(name, password) {
        const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, password })
        });
        if (!response.ok) return null;
        const data = await response.json();
        return data.user;
    },

    async discoveryLogin(name, password) {
        const remoteUser = await DriveSyncService.findRemoteUser(name, password);
        if (remoteUser) {
            // Register local
            await fetch(`${API_BASE_URL}/api/members`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(remoteUser)
            });
            return remoteUser;
        }
        return null;
    },

    async recordAttendance(name, isRemote) {
        await fetch(`${API_BASE_URL}/api/attendance/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, is_remote: isRemote })
        });
    },

    async recordLogout(name) {
        await fetch(`${API_BASE_URL}/api/attendance/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
    },

    async syncTodayData(memberName, date) {
        const [flows, medicines, water, facilities] = await Promise.all([
            fetch(`${API_BASE_URL}/api/flows?date=${date}`).then(r => r.json()),
            fetch(`${API_BASE_URL}/api/medicines?date=${date}`).then(r => r.json()),
            fetch(`${API_BASE_URL}/api/water-quality?date=${date}`).then(r => r.json()),
            fetch(`${API_BASE_URL}/api/facilities?date=${date}`).then(r => r.json())
        ]);

        await DriveSyncService.syncDetailedDataToCloud(memberName, date, {
            flows, medicines, waterQuality: water, facilities
        });
    }
};
