import { apiClient } from '../../core/api';
import { getOlderHistoryRange, getRecentHistoryStart } from '../records/historyRange';

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

        historyPromise = apiClient.get('/api/flows/history', { fromDate: getRecentHistoryStart() })
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
        const range = getOlderHistoryRange(beforeDate);
        return apiClient.get('/api/flows/history', range);
    },

    async fetchHistoryRange(fromDate, toDate = fromDate) {
        return apiClient.get('/api/flows/history', { fromDate, toDate });
    },

    async bulkSave(date, items) {
        clearHistoryCache();
        return apiClient.post('/api/flows/bulk', { date, items });
    },

    clearHistoryCache
};
