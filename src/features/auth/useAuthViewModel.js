import { useState, useEffect, useRef, useCallback } from 'react';
import { AuthModel } from './AuthModel';
import { apiClient } from '../../core/api';
import { ADMIN_ROLES, FIELD_WORKER_AUTO_LOGOUT_HOUR_KST } from '../../core/constants';

const LOGIN_GEO_CHECK_ENABLED = String(import.meta.env?.VITE_LOGIN_GEO_CHECK_ENABLED || 'false') === 'true';

function isFieldWorker(member) {
    return !ADMIN_ROLES.includes(String(member?.role || 'user'));
}

function hideAppToTray() {
    window.electronAPI?.hideToTray?.().catch((err) => {
        console.warn('[Auto logout] hide to tray failed:', err);
    });
}

/** 한국 시간 기준 자동 퇴근 시각이 되었는지 */
function isKstAtOrPastAutoLogoutHour(date = new Date()) {
    const hourStr = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit',
        hour12: false,
    }).format(date);
    const hour = parseInt(hourStr, 10);
    return hour >= FIELD_WORKER_AUTO_LOGOUT_HOUR_KST;
}

/** 지금부터 한국 시간 당일 자동 퇴근 시각까지 남은 ms (이미 지났으면 0 이하) */
function msUntilKstTodayAutoLogout(now = new Date()) {
    const d = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(now);
    const h = String(FIELD_WORKER_AUTO_LOGOUT_HOUR_KST).padStart(2, '0');
    const deadline = Date.parse(`${d}T${h}:00:00+09:00`);
    return deadline - now.getTime();
}

/**
 * 당일 한국 시간 기준 자동 퇴근 대상인지: 지금이 기준 시각 이후이고,
 * 출근 시각이 오늘(한국)이며 그날 기준 시각 이전에 출근한 미종료 세션
 */
function shouldForceEodLogoutForOpenSession(loginTimeIso) {
    if (!loginTimeIso) return false;
    const loginText = String(loginTimeIso);
    const loginTimeOnly = loginText.match(/^(\d{2}):(\d{2})/);
    const login = loginTimeOnly ? null : new Date(loginText.replace(' ', 'T'));
    const now = new Date();
    if (!isKstAtOrPastAutoLogoutHour(now)) return false;

    if (!loginTimeOnly) {
        const loginDateKst = new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'Asia/Seoul',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(login);
        const todayKst = new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'Asia/Seoul',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(now);
        if (loginDateKst !== todayKst) return false;
    }

    const loginHour = loginTimeOnly ? Number(loginTimeOnly[1]) : parseInt(
        new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Seoul',
            hour: '2-digit',
            hour12: false,
        }).format(login),
        10
    );
    const loginMin = loginTimeOnly ? Number(loginTimeOnly[2]) : parseInt(
        new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Seoul',
            minute: '2-digit',
        }).format(login),
        10
    );
    const loginMinutes = loginHour * 60 + loginMin;
    const cutoffMinutes = FIELD_WORKER_AUTO_LOGOUT_HOUR_KST * 60;
    return loginMinutes < cutoffMinutes;
}

export const useAuthViewModel = () => {
    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loginHintName, setLoginHintName] = useState('');
    const autoLogoutTimerRef = useRef(null);
    const restoringRef = useRef(false);
    const userRef = useRef(null);
    const autoLogoutInProgressRef = useRef(false);

    const clearAutoLogoutTimer = useCallback(() => {
        if (autoLogoutTimerRef.current) {
            clearTimeout(autoLogoutTimerRef.current);
            autoLogoutTimerRef.current = null;
        }
    }, []);

    const refreshLoginHint = useCallback(async () => {
        const hint = await AuthModel.getLoginHint();
        setLoginHintName(String(hint || '').trim());
    }, []);

    useEffect(() => {
        userRef.current = user;
    }, [user]);

    const performAutoLogout = useCallback(async (userData) => {
        if (autoLogoutInProgressRef.current) return;
        if (!userData || !isFieldWorker(userData)) return;

        autoLogoutInProgressRef.current = true;
        try {
            try {
                console.log(
                    `[자동 로그아웃] ${userData.name} - 한국 시간 ${FIELD_WORKER_AUTO_LOGOUT_HOUR_KST}:00 자동 퇴근 처리`
                );
                await AuthModel.recordLogout(userData, true);
            } catch (err) {
                console.error('Auto logout failed:', err);
            }
            AuthModel.clearSession();
            setUser(null);
            hideAppToTray();
            try {
                const result = await AuthModel.syncAttendanceBQ();
                console.log(`[자동 퇴근] BigQuery 출결 동기화 완료 (${result?.syncedCount ?? 0}건)`);
            } catch (err) {
                console.error('[자동 퇴근] BigQuery 동기화 실패:', err);
            }
        } finally {
            autoLogoutInProgressRef.current = false;
        }
    }, []);

    const setupAutoLogoutTimer = useCallback(
        (userData) => {
            clearAutoLogoutTimer();
            if (!userData || !isFieldWorker(userData)) return;

            const msLeft = msUntilKstTodayAutoLogout();
            if (msLeft <= 0) {
                return;
            }

            const mins = Math.round(msLeft / 1000 / 60);
            console.log(`자동 로그아웃까지(한국 ${FIELD_WORKER_AUTO_LOGOUT_HOUR_KST}:00) 약 ${mins}분 남음`);

            autoLogoutTimerRef.current = setTimeout(() => {
                performAutoLogout(userData);
            }, msLeft);
        },
        [clearAutoLogoutTimer, performAutoLogout]
    );

    useEffect(() => {
        const restoreSession = async () => {
            if (restoringRef.current) return;
            restoringRef.current = true;

            try {
                const savedUser = AuthModel.loadSession();
                if (!savedUser || !savedUser.id) {
                    return;
                }

                const freshData = await AuthModel.localLogin(savedUser.name, savedUser.password);
                if (!freshData) {
                    AuthModel.clearSession();
                    return;
                }

                const activeSession = await AuthModel.findActiveSession(freshData.id);
                const field = isFieldWorker(freshData);

                if (field && activeSession && shouldForceEodLogoutForOpenSession(activeSession.login_time)) {
                    try {
                        await AuthModel.recordLogout(freshData, true);
                    } catch (err) {
                        console.error('[세션 복원] 자동 퇴근 처리 실패:', err);
                    }
                    try {
                        await AuthModel.syncAttendanceBQ();
                    } catch (err) {
                        console.error('[세션 복원] BigQuery 동기화 실패:', err);
                    }
                    AuthModel.clearSession();
                    return;
                }

                const restoredUser = {
                    ...freshData,
                    isRemote: savedUser.isRemote ?? false,
                };

                if (field && !activeSession) {
                    try {
                        const coords = LOGIN_GEO_CHECK_ENABLED ? await getCurrentCoords() : null;
                        const lat = coords?.latitude || null;
                        const lng = coords?.longitude || null;
                        const matched = LOGIN_GEO_CHECK_ENABLED ? checkLocationMatched(freshData, coords) : true;
                        await AuthModel.recordAttendance(freshData, lat, lng, matched);
                        restoredUser.isRemote = LOGIN_GEO_CHECK_ENABLED ? !matched : false;
                    } catch (attErr) {
                        console.warn('세션 복원 중 출석 기록 실패:', attErr.message);
                    }
                }

                AuthModel.saveSession(restoredUser);
                setUser(restoredUser);
                if (field) {
                    setupAutoLogoutTimer(restoredUser);
                }
            } catch (err) {
                console.error('세션 복원 실패:', err);
                AuthModel.clearSession();
            } finally {
                if (!userRef.current) {
                    await refreshLoginHint();
                }
                restoringRef.current = false;
                setIsLoading(false);
            }
        };

        restoreSession();
        return () => clearAutoLogoutTimer();
    }, [setupAutoLogoutTimer, clearAutoLogoutTimer, refreshLoginHint]);

    /** 절전 등으로 20시 타이머를 놓친 경우 — 당일 20시 이전 출근·미퇴근만 보정 */
    useEffect(() => {
        if (!user || !isFieldWorker(user)) return undefined;

        const tick = async () => {
            const u = userRef.current;
            if (!u || !isFieldWorker(u)) return;
            if (!isKstAtOrPastAutoLogoutHour()) return;
            try {
                const session = await AuthModel.findActiveSession(u.id);
                if (session?.logout_time != null) return;
                if (shouldForceEodLogoutForOpenSession(session?.login_time)) {
                    performAutoLogout(u);
                }
            } catch (e) {
                console.warn('[자동 로그아웃] 세션 확인 실패:', e);
            }
        };

        const id = setInterval(tick, 60 * 1000);
        return () => clearInterval(id);
    }, [user, performAutoLogout]);

    const login = async (name, password) => {
        setIsLoading(true);
        try {
            const currentCoords = LOGIN_GEO_CHECK_ENABLED ? await getCurrentCoords() : null;

            const normalizedName = String(name || '').trim();
            const isPrimaryAdminLogin = normalizedName.toLowerCase() === 'admin';
            let userData = isPrimaryAdminLogin
                ? await AuthModel.discoveryLogin(normalizedName, password)
                : await AuthModel.localLogin(normalizedName, password);
            if (!userData && !isPrimaryAdminLogin) {
                userData = await AuthModel.discoveryLogin(normalizedName, password);
            }

            if (userData) {
                const field = isFieldWorker(userData);

                if (field) {
                    const loginLat = currentCoords?.latitude || null;
                    const loginLng = currentCoords?.longitude || null;
                    const locationMatched = LOGIN_GEO_CHECK_ENABLED ? checkLocationMatched(userData, currentCoords) : true;

                    try {
                        await AuthModel.recordAttendance(userData, loginLat, loginLng, locationMatched);
                    } catch (attErr) {
                        console.warn('출석 기록 실패 (로그인은 계속 진행):', attErr.message);
                    }

                    const enrichedUser = { ...userData, isRemote: LOGIN_GEO_CHECK_ENABLED ? !locationMatched : false };

                    AuthModel.saveSession(enrichedUser);
                    setUser(enrichedUser);
                    setupAutoLogoutTimer(enrichedUser);

                    setIsLoading(false);
                    return { success: true, user: enrichedUser, locationMatched };
                }

                AuthModel.clearSession();
                setUser(userData);

                setIsLoading(false);
                return { success: true, user: userData, locationMatched: true };
            }

            setIsLoading(false);
            return { success: false, message: '이름 또는 비밀번호가 올바르지 않습니다.' };
        } catch (err) {
            console.error('Login Error:', err);
            setIsLoading(false);
            return { success: false, message: '서버 연결 실패: ' + err.message };
        }
    };

    const logout = async () => {
        const u = user;
        if (u) {
            try {
                clearAutoLogoutTimer();
                if (isFieldWorker(u)) {
                    await AuthModel.recordLogout(u, false);
                } else {
                    await AuthModel.clearServerActiveSession();
                }
            } catch (err) {
                console.error('Logout sync failed:', err);
            }
        }
        AuthModel.clearSession();
        setUser(null);
        await refreshLoginHint();

        if (u && isFieldWorker(u)) {
            try {
                const result = await AuthModel.syncAttendanceBQ();
                console.log(`[퇴근] BigQuery 출결 동기화 (${result?.syncedCount ?? 0}건)`);
            } catch (err) {
                console.error('[퇴근] BigQuery 동기화 실패:', err);
            }
        }
    };

    const switchActiveSite = async (siteId) => {
        try {
            const result = await AuthModel.switchActiveSite(siteId);
            const nextSiteId = result?.site?.id || siteId;
            const nextSiteName = result?.site?.site_name || '';

            setUser((prev) => {
                if (!prev) return prev;
                const updated = {
                    ...prev,
                    site_id: nextSiteId,
                    site_name1: nextSiteName,
                };
                if (isFieldWorker(updated)) {
                    AuthModel.saveSession(updated);
                } else {
                    AuthModel.clearSession();
                }
                return updated;
            });

            return { success: true, site: result?.site || null };
        } catch (err) {
            return { success: false, message: err.message || '현장 전환 실패' };
        }
    };

    return {
        user,
        loginHintName,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
        switchActiveSite,
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
    const φ1 = (currentCoords.latitude * Math.PI) / 180;
    const φ2 = (userData.target_lat * Math.PI) / 180;
    const Δφ = ((userData.target_lat - currentCoords.latitude) * Math.PI) / 180;
    const Δλ = ((userData.target_lng - currentCoords.longitude) * Math.PI) / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return dist <= (userData.radius_m || 500);
}
