import { apiClient } from '../../core/api';
import { getOlderHistoryRange, getRecentHistoryStart } from '../records/historyRange';

let historyCache = null;
let historyPromise = null;

const clearHistoryCache = () => {
    historyCache = null;
    historyPromise = null;
};

export const KitModel = {
    async fetchHistory(options = {}) {
        if (!options.force && historyCache) return historyCache;
        if (!options.force && historyPromise) return historyPromise;

        historyPromise = apiClient.get('/api/kits/history', { fromDate: getRecentHistoryStart() })
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
        return apiClient.get('/api/kits/history', getOlderHistoryRange(beforeDate));
    },

    async fetchHistoryRange(fromDate, toDate = fromDate) {
        return apiClient.get('/api/kits/history', { fromDate, toDate });
    },

    async bulkSave(items) {
        clearHistoryCache();
        return apiClient.post('/api/kits/bulk', { items });
    },

    async syncAnalysisUsage(startDate, endDate) {
        clearHistoryCache();
        return apiClient.post('/api/kits/sync-analysis-usage', { startDate, endDate });
    },

    async savePurchase(date, items) {
        clearHistoryCache();
        return apiClient.post('/api/kits/purchase', { date, items });
    },

    clearHistoryCache
};
