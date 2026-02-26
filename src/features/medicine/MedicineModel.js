import { apiClient } from '../../core/api';

export const MedicineModel = {
    async fetchHistory() {
        return apiClient.get('/api/medicines/history');
    },

    async bulkSave(items) {
        return apiClient.post('/api/medicines/bulk', { items });
    },

    async fetchLogs(date) {
        return apiClient.get('/api/medicines', { date });
    },

    async saveLog(data) {
        return apiClient.post('/api/medicines', data);
    }
};
