import { apiClient } from '../../core/api';

export const FlowModel = {
    async fetchReadings(date) {
        return apiClient.get('/api/flows', { date });
    },

    async saveReading(data) {
        return apiClient.post('/api/flows', data);
    }
};
