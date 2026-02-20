import { supabase } from '../../core/api';

const SESSION_KEY = 'osoo_user_session';

export const AuthModel = {
    async localLogin(name, password) {
        const { data, error } = await supabase
            .from('members')
            .select('*')
            .eq('name', name)
            .eq('password', password)
            .single();

        if (error || !data) return null;
        return data;
    },

    async discoveryLogin(name, password) {
        return this.localLogin(name, password);
    },

    async findActiveSession(memberId) {
        const dateKST = this._todayKST();

        const { data, error } = await supabase
            .from('attendance')
            .select('*')
            .eq('member_id', memberId)
            .eq('date', dateKST)
            .is('logout_time', null)
            .maybeSingle();

        if (error) {
            console.error("Error finding active session:", error.message);
            return null;
        }
        return data;
    },

    async recordAttendance(member, lat, lng, locationMatched) {
        const dateKST = this._todayKST();

        const activeSession = await this.findActiveSession(member.id);
        if (activeSession) {
            return activeSession;
        }

        const { data, error } = await supabase
            .from('attendance')
            .insert([{
                member_id: member.id,
                member_name: member.name,
                date: dateKST,
                login_time: new Date().toISOString(),
                login_lat: lat,
                login_lng: lng,
                location_matched: locationMatched
            }])
            .select()
            .single();

        if (error) {
            console.error("Error recording attendance:", error.message);
            throw new Error(error.message);
        }
        return data;
    },

    async recordLogout(member, autoLogout = false) {
        const dateKST = this._todayKST();

        const { error } = await supabase
            .from('attendance')
            .update({
                logout_time: new Date().toISOString(),
                auto_logout: autoLogout
            })
            .eq('member_id', member.id)
            .eq('date', dateKST)
            .is('logout_time', null);

        if (error) {
            console.error("Error recording logout:", error.message);
            throw new Error(error.message);
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
            if (session.loggedOut) return null;

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
    },

    _todayKST() {
        return new Date(new Date().getTime() + (9 * 60 * 60 * 1000)).toISOString().split('T')[0];
    }
};
