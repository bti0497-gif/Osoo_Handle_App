import { apiClient } from '../../core/api';

export const WaterQualityModel = {
    async fetchHistory() {
        return apiClient.get('/api/water-quality/history');
    },

    async bulkSave(items) {
        return apiClient.post('/api/water-quality/bulk', { items });
    },

    async fetchData(date) {
        return apiClient.get('/api/water-quality', { date });
    },

    async saveRecord(data) {
        return apiClient.post('/api/water-quality', data);
    }
};
