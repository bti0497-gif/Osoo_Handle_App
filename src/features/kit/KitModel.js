import { apiClient } from '../../core/api';

export const KitModel = {
    async fetchHistory() {
        return apiClient.get('/api/kits/history');
    },

    async bulkSave(items) {
        return apiClient.post('/api/kits/bulk', { items });
    },

    async syncAnalysisUsage(startDate, endDate) {
        return apiClient.post('/api/kits/sync-analysis-usage', { startDate, endDate });
    },

    async savePurchase(date, items) {
        return apiClient.post('/api/kits/purchase', { date, items });
    }
};
