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
            try {
                await fetch(`${API_BASE_URL}/api/members`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(remoteUser)
                });
            } catch (e) {
                console.warn("Local registration failed, but proceeding with remote discovery", e);
            }
            return remoteUser;
        }
        return null;
    },

    /**
     * 출근 기록 (위치 정보 포함)
     * @param {string} name - 사용자 이름
     * @param {number|null} lat - 로그인 시 위도
     * @param {number|null} lng - 로그인 시 경도
     * @param {boolean} locationMatched - 등록 위치와 일치 여부
     */
    async recordAttendance(name, lat, lng, locationMatched) {
        await fetch(`${API_BASE_URL}/api/attendance/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                login_lat: lat,
                login_lng: lng,
                location_matched: locationMatched
            })
        });
    },

    /**
     * 퇴근 기록
     * @param {string} name - 사용자 이름
     * @param {boolean} autoLogout - 자동 로그아웃 여부 (18시)
     */
    async recordLogout(name, autoLogout = false) {
        await fetch(`${API_BASE_URL}/api/attendance/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, auto_logout: autoLogout })
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
