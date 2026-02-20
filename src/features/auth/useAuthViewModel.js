import { useState, useEffect, useRef, useCallback } from 'react';
import { AuthModel } from './AuthModel';
import { apiClient } from '../../core/api';

export const useAuthViewModel = () => {
    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const autoLogoutTimerRef = useRef(null);
    const restoringRef = useRef(false);

    const clearAutoLogoutTimer = useCallback(() => {
        if (autoLogoutTimerRef.current) {
            clearTimeout(autoLogoutTimerRef.current);
            autoLogoutTimerRef.current = null;
        }
    }, []);

    const performAutoLogout = useCallback(async (userData) => {
        if (!userData) return;
        try {
            console.log(`[자동 로그아웃] ${userData.name} - 18:00 자동 퇴근 처리`);
            await AuthModel.recordLogout(userData, true);
        } catch (err) {
            console.error("Auto logout sync failed:", err);
        }
        AuthModel.clearSession();
        setUser(null);
    }, []);

    const setupAutoLogoutTimer = useCallback((userData) => {
        clearAutoLogoutTimer();

        const now = new Date();
        const cutoff = new Date();
        cutoff.setHours(22, 0, 0, 0);

        if (now >= cutoff) {
            performAutoLogout(userData);
            return;
        }

        const msUntilCutoff = cutoff.getTime() - now.getTime();
        console.log(`자동 로그아웃까지 ${Math.round(msUntilCutoff / 1000 / 60)}분 남음`);

        autoLogoutTimerRef.current = setTimeout(() => {
            performAutoLogout(userData);
        }, msUntilCutoff);
    }, [clearAutoLogoutTimer, performAutoLogout]);

    useEffect(() => {
        const restoreSession = async () => {
            if (restoringRef.current) return;
            restoringRef.current = true;

            try {
                const savedUser = AuthModel.loadSession();
                if (!savedUser || !savedUser.id) {
                    setIsLoading(false);
                    return;
                }

                const freshData = await AuthModel.localLogin(savedUser.name, savedUser.password);
                if (!freshData) {
                    AuthModel.clearSession();
                    setIsLoading(false);
                    return;
                }

                const activeSession = await AuthModel.findActiveSession(freshData.id);

                const restoredUser = {
                    ...freshData,
                    isRemote: savedUser.isRemote ?? false,
                    loginLat: savedUser.loginLat ?? null,
                    loginLng: savedUser.loginLng ?? null
                };

                if (!activeSession) {
                    try {
                        const coords = await getCurrentCoords();
                        const lat = coords?.latitude || null;
                        const lng = coords?.longitude || null;
                        const matched = checkLocationMatched(freshData, coords);
                        await AuthModel.recordAttendance(freshData, lat, lng, matched);
                        restoredUser.isRemote = !matched;
                        restoredUser.loginLat = lat;
                        restoredUser.loginLng = lng;
                    } catch (attErr) {
                        console.warn("세션 복원 중 출석 기록 실패:", attErr.message);
                    }
                }

                AuthModel.saveSession(restoredUser);
                setUser(restoredUser);
                setupAutoLogoutTimer(restoredUser);
            } catch (err) {
                console.error("세션 복원 실패:", err);
                AuthModel.clearSession();
            } finally {
                setIsLoading(false);
            }
        };

        restoreSession();
        return () => clearAutoLogoutTimer();
    }, [setupAutoLogoutTimer, clearAutoLogoutTimer]);

    const login = async (name, password) => {
        setIsLoading(true);
        try {
            const currentCoords = await getCurrentCoords();

            let userData = await AuthModel.localLogin(name, password);
            if (!userData) {
                userData = await AuthModel.discoveryLogin(name, password);
            }

            if (userData) {
                const loginLat = currentCoords?.latitude || null;
                const loginLng = currentCoords?.longitude || null;
                const locationMatched = checkLocationMatched(userData, currentCoords);

                try {
                    await AuthModel.recordAttendance(userData, loginLat, loginLng, locationMatched);
                } catch (attErr) {
                    console.warn("출석 기록 실패 (로그인은 계속 진행):", attErr.message);
                }

                const enrichedUser = { ...userData, isRemote: !locationMatched, loginLat, loginLng };

                AuthModel.saveSession(enrichedUser);
                setUser(enrichedUser);
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
                await AuthModel.recordLogout(user, false);
            } catch (err) {
                console.error("Logout sync failed:", err);
            }
        }
        AuthModel.clearSession();
        setUser(null);
    };

    return {
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout
    };
};

async function getCurrentCoords() {
    try {
        const data = await apiClient.get('/api/location/current');
        if (data.success) {
            return { latitude: data.latitude, longitude: data.longitude };
        }
        return null;
    } catch {
        return null;
    }
}

function checkLocationMatched(userData, currentCoords) {
    if (!userData.target_lat || !userData.target_lng || !currentCoords) return false;
    const R = 6371e3;
    const φ1 = currentCoords.latitude * Math.PI / 180;
    const φ2 = userData.target_lat * Math.PI / 180;
    const Δφ = (userData.target_lat - currentCoords.latitude) * Math.PI / 180;
    const Δλ = (userData.target_lng - currentCoords.longitude) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return dist <= (userData.radius_m || 500);
}
