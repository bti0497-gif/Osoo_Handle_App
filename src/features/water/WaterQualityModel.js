import { apiClient } from '../../core/api';

const QNTECH_IMPORT_TIMEOUT_MS = 180000;
const QNTECH_RANGE_START_TIMEOUT_MS = 30000;

let historyCache = null;
let historyPromise = null;

const clearHistoryCache = () => {
    historyCache = null;
    historyPromise = null;
};

export const WaterQualityModel = {
    async recordQntechUiDiagnostic(event, details = {}) {
        try {
            await apiClient.post('/api/auth/ui-diagnostic', {
                event: `qntech-${event}`,
                details,
            });
        } catch (error) {
            console.warn('QnTECH UI diagnostic failed:', error);
        }
    },

    async fetchHistory(options = {}) {
        if (!options.force && historyCache) return historyCache;
        if (!options.force && historyPromise) return historyPromise;

        historyPromise = apiClient.get('/api/water-quality/history')
            .then((result) => {
                historyCache = result;
                return result;
            })
            .finally(() => {
                historyPromise = null;
            });
        return historyPromise;
    },

    async importFromQntech(date) {
        clearHistoryCache();
        return apiClient.post('/api/water-quality/import-from-qntech', { date }, { timeout: QNTECH_IMPORT_TIMEOUT_MS });
    },

    async importValuesFromQntech(date) {
        clearHistoryCache();
        return apiClient.post('/api/water-quality/import-values-from-qntech', { date }, { timeout: QNTECH_IMPORT_TIMEOUT_MS });
    },

    async importPhotosFromQntech(date) {
        return apiClient.post('/api/water-quality/import-photos-from-qntech', { date }, { timeout: QNTECH_IMPORT_TIMEOUT_MS });
    },

    async importRangeFromQntech(startDate, endDate) {
        clearHistoryCache();
        return apiClient.post('/api/water-quality/import-range-from-qntech', { startDate, endDate }, { timeout: QNTECH_RANGE_START_TIMEOUT_MS });
    },

    async fetchRangeImportProgress() {
        return apiClient.get('/api/water-quality/import-range-progress');
    },

    async bulkSave(items) {
        clearHistoryCache();
        return apiClient.post('/api/water-quality/bulk', { items });
    },

    async fetchData(date) {
        return apiClient.get('/api/water-quality', { date });
    },

    async saveRecord(data) {
        clearHistoryCache();
        return apiClient.post('/api/water-quality', data);
    },

    clearHistoryCache
};
