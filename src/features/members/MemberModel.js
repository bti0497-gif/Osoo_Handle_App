import { apiClient } from '../../core/api';

export const MemberModel = {
    async fetchMembers() {
        const data = await apiClient.get('/api/auth/members');
        if (!data.success) throw new Error(data.error || '회원 목록 조회 실패');
        return data.members || [];
    },

    async saveMember(memberData) {
        // id 없으면 신규 생성 — 타임스탬프 기반 id 부여
        const payload = {
            ...memberData,
            id: memberData.id || String(Date.now())
        };
        const data = await apiClient.post('/api/auth/members', payload);
        if (!data.success) throw new Error(data.error || '회원 저장 실패');
        return payload;
    },

    async deleteMember(id) {
        const data = await apiClient.delete(`/api/auth/members/${id}`);
        if (!data.success) throw new Error(data.error || '회원 삭제 실패');
        return { success: true };
    }
};
