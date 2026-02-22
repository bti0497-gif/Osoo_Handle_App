import { apiClient } from '../../core/api';

export const FlowModel = {
    async fetchReadings(date) {
        return apiClient.get('/api/flows', { date });
    },

    async saveReading(data) {
        return apiClient.post('/api/flows', data);
    },

    async fetchHistory() {
        return apiClient.get('/api/flows/history');
    },

    async bulkSave(date, items) {
        return apiClient.post('/api/flows/bulk', { date, items });
    }
};
