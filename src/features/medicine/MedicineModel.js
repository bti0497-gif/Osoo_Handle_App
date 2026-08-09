import { apiClient } from '../../core/api';
import { getOlderHistoryRange, getRecentHistoryStart } from '../records/historyRange';

let historyCache = null;
let historyPromise = null;

const clearHistoryCache = () => {
    historyCache = null;
    historyPromise = null;
};

export const MedicineModel = {
    async fetchHistory(options = {}) {
        if (!options.force && historyCache) return historyCache;
        if (!options.force && historyPromise) return historyPromise;

        historyPromise = apiClient.get('/api/medicines/history', { fromDate: getRecentHistoryStart() })
            .then((result) => {
                historyCache = result;
                return result;
            })
            .finally(() => {
                historyPromise = null;
            });
        return historyPromise;
    },

    async fetchOlderHistory(beforeDate) {
        return apiClient.get('/api/medicines/history', getOlderHistoryRange(beforeDate));
    },

    async fetchHistoryRange(fromDate, toDate = fromDate) {
        return apiClient.get('/api/medicines/history', { fromDate, toDate });
    },

    async bulkSave(items) {
        clearHistoryCache();
        return apiClient.post('/api/medicines/bulk', { items });
    },

    async savePurchase(date, items) {
        clearHistoryCache();
        return apiClient.post('/api/medicines/purchase', { date, items });
    },

    async fetchLogs(date) {
        return apiClient.get('/api/medicines', { date });
    },

    async saveLog(data) {
        clearHistoryCache();
        return apiClient.post('/api/medicines', data);
    },

    clearHistoryCache
};
