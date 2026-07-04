import { apiClient } from '../../core/api';

const SESSION_KEY = 'osoo_user_session';
const ADMIN_ROLES = ['admin', 'group_admin'];

function isAdminUser(userData) {
    return ADMIN_ROLES.includes(String(userData?.role || 'user'));
}

export const AuthModel = {
    async getLoginHint() {
        try {
            const data = await apiClient.get('/api/auth/login-hint');
            if (!data.success) return '';
            return String(data.name || '').trim();
        } catch (e) {
            console.warn('로그인 힌트 조회 실패:', e);
            return '';
        }
    },

    async localLogin(name, password) {
        try {
            const data = await apiClient.post('/api/auth/local-login', { name, password });
            if (!data.success) {
                console.error("Login failed:", data.message);
                return null;
            }
            return data.member;
        } catch (e) {
            console.error("Error during localLogin:", e);
            return null;
        }
    },

    async discoveryLogin(name, password) {
        try {
            const data = await apiClient.post('/api/auth/discovery-login', { name, password });
            if (!data.success) {
                console.error("Discovery login failed:", data.message);
                return null;
            }
            return data.member;
        } catch (e) {
            console.error("Error during discoveryLogin:", e);
            return null;
        }
    },

    async findActiveSession(memberId) {
        try {
            const data = await apiClient.post('/api/auth/session', { memberId });
            return data.success ? data.session : null;
        } catch (e) {
            console.error("Error finding active session:", e);
            return null;
        }
    },

    async recordAttendance(member, lat, lng, locationMatched) {
        try {
            const data = await apiClient.post('/api/auth/attendance', {
                memberId: member.id,
                memberName: member.name,
                lat,
                lng,
                locationMatched
            });
            if (!data.success) throw new Error(data.error);
            return data.session;
        } catch (e) {
            console.error("Error recording attendance:", e);
            throw e;
        }
    },

    async recordLogout(member, autoLogout = false) {
        try {
            const data = await apiClient.post('/api/auth/logout', {
                memberId: member.id,
                autoLogout
            });
            if (!data.success) throw new Error(data.error);
        } catch (e) {
            console.error("Error recording logout:", e);
            throw e;
        }
    },

    async clearServerActiveSession() {
        try {
            await apiClient.post('/api/auth/logout-current', {});
        } catch (e) {
            console.warn('[AuthModel] 서버 활성 세션 해제 실패:', e);
        }
    },

    async syncAttendanceBQ() {
        try {
            const data = await apiClient.post('/api/auth/sync-attendance-bq', {});
            return data;
        } catch (e) {
            console.error('[AuthModel] BQ 동기화 오류:', e);
        }
    },

    async switchActiveSite(siteId) {
        try {
            const data = await apiClient.post('/api/settings/select-site', { siteId });
            if (!data.success) throw new Error(data.message || '현장 전환 실패');
            return data;
        } catch (e) {
            console.error('[AuthModel] 현장 전환 오류:', e);
            throw e;
        }
    },

    saveSession(userData) {
        try {
            if (isAdminUser(userData)) {
                localStorage.removeItem(SESSION_KEY);
                return;
            }
            const session = {
                user: userData,
                savedAt: new Date().toISOString(),
                loggedOut: false
            };
            localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        } catch (e) {
            console.warn("세션 저장 실패:", e);
        }
    },

    loadSession() {
        try {
            const raw = localStorage.getItem(SESSION_KEY);
            if (!raw) return null;

            const session = JSON.parse(raw);
            const now = new Date();
            const savedAt = new Date(session.savedAt);

            // 날짜가 바뀌면 자동 로그인을 허용하지 않고 다시 비밀번호를 받습니다.
            if (session.loggedOut || now.toDateString() !== savedAt.toDateString()) {
                this.clearSession();
                return null;
            }

            return session.user || null;
        } catch (e) {
            console.warn("세션 복원 실패:", e);
            return null;
        }
    },

    clearSession() {
        try {
            localStorage.removeItem(SESSION_KEY);
        } catch (e) {
            console.warn("세션 삭제 실패:", e);
        }
    }
};
