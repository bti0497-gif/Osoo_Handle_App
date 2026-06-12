import { apiClient } from '../../core/api';

let historyCache = null;
let historyPromise = null;

const clearHistoryCache = () => {
    historyCache = null;
    historyPromise = null;
};

export const FlowModel = {
    async fetchReadings(date) {
        return apiClient.get('/api/flows', { date });
    },

    async saveReading(data) {
        clearHistoryCache();
        return apiClient.post('/api/flows', data);
    },

    async fetchHistory(options = {}) {
        if (!options.force && historyCache) return historyCache;
        if (!options.force && historyPromise) return historyPromise;

        historyPromise = apiClient.get('/api/flows/history')
            .then((result) => {
                historyCache = result;
                return result;
            })
            .finally(() => {
                historyPromise = null;
            });
        return historyPromise;
    },

    async bulkSave(date, items) {
        clearHistoryCache();
        return apiClient.post('/api/flows/bulk', { date, items });
    },

    clearHistoryCache
};
