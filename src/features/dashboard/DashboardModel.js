import { apiClient } from '../../core/api';

export const DashboardModel = {
    /** 로컬 로그 행에 붙는 site_id는 주로 app_settings 기준이므로 대시보드 조회에 우선 사용 */
    async fetchAppSettingsSiteId() {
        const res = await apiClient.get('/api/settings');
        if (!res?.success || !res.settings) return null;
        const raw = res.settings.site_id;
        if (raw == null || String(raw).trim() === '') return null;
        return String(raw);
    },

    async fetchFlowHistory(params = {}) {
        return apiClient.get('/api/flows/history', params);
    },
    async fetchWaterHistory(params = {}) {
        return apiClient.get('/api/water-quality/history', params);
    },
    async fetchMedicineHistory(params = {}) {
        return apiClient.get('/api/medicines/history', params);
    },
    async fetchKitHistory(params = {}) {
        return apiClient.get('/api/kits/history', params);
    },
    async fetchMedicineDefaults() {
        return apiClient.get('/api/settings/medicine-defaults');
    },
    async fetchKitDefaults() {
        return apiClient.get('/api/settings/kit-defaults');
    },
};

