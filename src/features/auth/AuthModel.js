import { getApiBase } from '../../core/api/serverConfig';

const SESSION_KEY = 'osoo_user_session';

export const AuthModel = {
    async localLogin(name, password) {
        try {
            const res = await fetch(`${getApiBase()}/api/auth/local-login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, password })
            });
            const data = await res.json();
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
        return this.localLogin(name, password);
    },

    async findActiveSession(memberId) {
        try {
            const res = await fetch(`${getApiBase()}/api/auth/session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ memberId })
            });
            const data = await res.json();
            return data.success ? data.session : null;
        } catch (e) {
            console.error("Error finding active session:", e);
            return null;
        }
    },

    async recordAttendance(member, lat, lng, locationMatched) {
        try {
            const res = await fetch(`${getApiBase()}/api/auth/attendance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    memberId: member.id,
                    memberName: member.name,
                    lat,
                    lng,
                    locationMatched
                })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            return data.session;
        } catch (e) {
            console.error("Error recording attendance:", e);
            throw e;
        }
    },

    async recordLogout(member, autoLogout = false) {
        try {
            const res = await fetch(`${getApiBase()}/api/auth/logout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    memberId: member.id,
                    autoLogout
                })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
        } catch (e) {
            console.error("Error recording logout:", e);
            throw e;
        }
    },

    async syncTodayData(memberName, date) {
        // Supabase 통합 후 필요시 구현
    },

    saveSession(userData) {
        try {
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

            // 새벽 4시 자동 로그아웃 로직 (옵션)
            if (session.loggedOut || (now.getHours() >= 4 && now.getDate() !== savedAt.getDate())) {
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
