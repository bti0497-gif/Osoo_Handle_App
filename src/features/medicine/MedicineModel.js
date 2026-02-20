import { apiClient } from '../../core/api';

export const MedicineModel = {
    async fetchLogs(date) {
        return apiClient.get('/api/medicines', { date });
    },

    async saveLog(data) {
        return apiClient.post('/api/medicines', data);
    }
};
