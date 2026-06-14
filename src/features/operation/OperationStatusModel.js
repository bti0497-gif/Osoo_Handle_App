import { apiClient } from '../../core/api';

let historyCache = null;
let historyPromise = null;

const clearHistoryCache = () => {
    historyCache = null;
    historyPromise = null;
};

export const OperationStatusModel = {
    async fetchHistory(options = {}) {
        if (!options.force && historyCache) return historyCache;
        if (!options.force && historyPromise) return historyPromise;

        historyPromise = apiClient.get('/api/operation-status/history')
            .then((result) => {
                historyCache = result;
                return result;
            })
            .finally(() => {
                historyPromise = null;
            });
        return historyPromise;
    },

    async fetchByDate(date) {
        return apiClient.get('/api/operation-status', { date });
    },

    async saveRecord(record) {
        clearHistoryCache();
        return apiClient.post('/api/operation-status', record);
    },

    clearHistoryCache,
};
