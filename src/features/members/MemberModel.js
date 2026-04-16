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
    },

    async bootstrapSiteMember(payload) {
        const data = await apiClient.post('/api/settings/bootstrap-site-member', payload);
        if (!data.success) throw new Error(data.message || data.error || '현장/회원 동시 저장 실패');
        return data;
    },

    async fetchSites() {
        const data = await apiClient.get('/api/settings/sites');
        if (!data.success) throw new Error(data.message || '현장 목록 조회 실패');
        return { sites: data.sites || [], currentSiteId: data.currentSiteId || null };
    },

    async saveSite(sitePayload) {
        const data = await apiClient.post('/api/settings/sites', {
            siteId: sitePayload.siteId,
            siteName: sitePayload.siteName,
            managerName: sitePayload.managerName,
            method: sitePayload.method,
            series: sitePayload.series,
            isActive: sitePayload.isActive
        });
        if (!data.success) throw new Error(data.message || '현장 저장 실패');
        return data.site;
    },

    async deleteSite(siteId) {
        const data = await apiClient.delete(`/api/settings/sites/${siteId}`);
        if (!data.success) throw new Error(data.message || '현장 삭제 실패');
        return data;
    },

    async selectSite(siteId) {
        const data = await apiClient.post('/api/settings/select-site', { siteId });
        if (!data.success) throw new Error(data.message || '현장 선택 실패');
        return data.site;
    }
};
