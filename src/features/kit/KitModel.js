import { apiClient } from '../../core/api';

export const KitModel = {
    async fetchHistory() {
        return apiClient.get('/api/kits/history');
    },

    async bulkSave(items) {
        return apiClient.post('/api/kits/bulk', { items });
    }
};
