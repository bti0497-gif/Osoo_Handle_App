import { apiClient } from '../../core/api';

export const FacilityModel = {
    async fetchLogs(date) {
        return apiClient.get('/api/facilities', { date });
    },

    async saveLog(data) {
        return apiClient.post('/api/facilities', data);
    }
};
