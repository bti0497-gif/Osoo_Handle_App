import { apiClient } from '../../core/api';

export const WaterQualityModel = {
    async fetchData(date) {
        return apiClient.get('/api/water-quality', { date });
    },

    async saveRecord(data) {
        return apiClient.post('/api/water-quality', data);
    }
};
