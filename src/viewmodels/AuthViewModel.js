import { useState, useEffect, useRef, useCallback } from 'react';
import { AuthModel } from '../models/AuthModel';

export const useAuthViewModel = () => {
    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const autoLogoutTimerRef = useRef(null);

    // 18시(오후 6시) 자동 로그아웃 타이머 설정
    const setupAutoLogoutTimer = useCallback((userData) => {
        clearAutoLogoutTimer();

        const now = new Date();
        const cutoff = new Date();
        cutoff.setHours(18, 0, 0, 0); // 오후 6시

        if (now >= cutoff) {
            // 이미 18시가 지남 → 즉시 자동 로그아웃
            performAutoLogout(userData);
            return;
        }

        const msUntilCutoff = cutoff.getTime() - now.getTime();
        console.log(`자동 로그아웃까지 ${Math.round(msUntilCutoff / 1000 / 60)}분 남음`);

        autoLogoutTimerRef.current = setTimeout(() => {
            performAutoLogout(userData);
        }, msUntilCutoff);
    }, []);

    const clearAutoLogoutTimer = () => {
        if (autoLogoutTimerRef.current) {
            clearTimeout(autoLogoutTimerRef.current);
            autoLogoutTimerRef.current = null;
        }
    };

    const performAutoLogout = async (userData) => {
        if (!userData) return;
        try {
            console.log(`[자동 로그아웃] ${userData.name} - 18:00 자동 퇴근 처리`);
            const date = new Date().toISOString().split('T')[0];
            await AuthModel.syncTodayData(userData.name, date);
            await AuthModel.recordLogout(userData.name, true); // auto_logout = true
        } catch (err) {
            console.error("Auto logout sync failed:", err);
        }
        setUser(null);
    };

    // 컴포넌트 언마운트 시 타이머 정리
    useEffect(() => {
        return () => clearAutoLogoutTimer();
    }, []);

    const login = async (name, password) => {
        setIsLoading(true);
        try {
            const currentCoords = await getCurrentCoords();

            // 1. Try Login
            let userData = await AuthModel.localLogin(name, password);
            if (!userData) {
                userData = await AuthModel.discoveryLogin(name, password);
            }

            if (userData) {
                // 2. Presence Verification (위치 검증)
                const loginLat = currentCoords?.latitude || null;
                const loginLng = currentCoords?.longitude || null;
                const locationMatched = checkLocationMatched(userData, currentCoords);

                // 3. Record Attendance (위치 정보 포함)
                await AuthModel.recordAttendance(userData.name, loginLat, loginLng, locationMatched);

                const enrichedUser = { ...userData, isRemote: !locationMatched, loginLat, loginLng };
                setUser(enrichedUser);

                // 4. 18시 자동 로그아웃 타이머 설정
                setupAutoLogoutTimer(enrichedUser);

                setIsLoading(false);
                return { success: true, user: enrichedUser, locationMatched };
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
                clearAutoLogoutTimer();
                const date = new Date().toISOString().split('T')[0];
                await AuthModel.syncTodayData(user.name, date);
                await AuthModel.recordLogout(user.name, false); // 수동 로그아웃
            } catch (err) {
                console.error("Logout sync failed:", err);
            }
        }
        setUser(null);
    };

    // Helpers — Windows Location API (서버 경유)
    const getCurrentCoords = async () => {
        try {
            const response = await fetch('http://localhost:8901/api/location/current');
            const data = await response.json();
            if (data.success) {
                return { latitude: data.latitude, longitude: data.longitude };
            }
            console.warn("Location unavailable:", data.message);
            return null;
        } catch (err) {
            console.warn("Location service error:", err);
            return null;
        }
    };

    /**
     * 등록 위치와 현재 위치 비교 → 반경 내이면 true
     */
    const checkLocationMatched = (userData, currentCoords) => {
        if (!userData.target_lat || !userData.target_lng || !currentCoords) return false;
        const dist = calculateDistance(
            currentCoords.latitude, currentCoords.longitude,
            userData.target_lat, userData.target_lng
        );
        return dist <= (userData.radius_m || 500);
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
