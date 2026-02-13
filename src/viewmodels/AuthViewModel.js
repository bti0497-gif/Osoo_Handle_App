import { useState } from 'react';
import { AuthModel } from '../models/AuthModel';

export const useAuthViewModel = () => {
    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(false);

    const login = async (name, password) => {
        setIsLoading(true);
        try {
            const currentPos = await getCurrentCoords();

            // 1. Try Login
            let userData = await AuthModel.localLogin(name, password);
            if (!userData) {
                userData = await AuthModel.discoveryLogin(name, password);
            }

            if (userData) {
                // 2. Presence Verification
                const isRemote = checkIsRemote(userData, currentPos);

                // 3. Record Attendance
                await AuthModel.recordAttendance(userData.name, isRemote);

                setUser({ ...userData, isRemote });
                setIsLoading(false);
                return { success: true, user: userData, isRemote };
            }

            setIsLoading(false);
            return { success: false, message: '이름 또는 비밀번호가 올바르지 않습니다.' };
        } catch (err) {
            console.error("Login Error:", err);
            setIsLoading(false);
            return { success: false, message: '서버 연결 실패: ' + err.message };
        }
    };

    const logout = async () => {
        if (user) {
            try {
                const date = new Date().toISOString().split('T')[0];
                await AuthModel.syncTodayData(user.name, date);
                await AuthModel.recordLogout(user.name);
            } catch (err) {
                console.error("Logout sync failed:", err);
            }
        }
        setUser(null);
    };

    // Helpers
    const getCurrentCoords = () => new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { timeout: 5000 });
    });

    const checkIsRemote = (userData, currentPos) => {
        if (!userData.target_lat || !userData.target_lng || !currentPos) return true;
        const dist = calculateDistance(
            currentPos.coords.latitude, currentPos.coords.longitude,
            userData.target_lat, userData.target_lng
        );
        return dist > (userData.radius_m || 500);
    };

    const calculateDistance = (lat1, lon1, lat2, lon2) => {
        const R = 6371e3; // metres
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    };

    return {
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout
    };
};
