import { apiClient } from '../../core/api';

const QNTECH_IMPORT_TIMEOUT_MS = 180000;
const QNTECH_RANGE_IMPORT_TIMEOUT_MS = 600000;

export const WaterQualityModel = {
    async fetchHistory() {
        return apiClient.get('/api/water-quality/history');
    },

    async importFromQntech(date) {
        return apiClient.post('/api/water-quality/import-from-qntech', { date }, { timeout: QNTECH_IMPORT_TIMEOUT_MS });
    },

    async importValuesFromQntech(date) {
        return apiClient.post('/api/water-quality/import-values-from-qntech', { date }, { timeout: QNTECH_IMPORT_TIMEOUT_MS });
    },

    async importPhotosFromQntech(date) {
        return apiClient.post('/api/water-quality/import-photos-from-qntech', { date }, { timeout: QNTECH_IMPORT_TIMEOUT_MS });
    },

    async importRangeFromQntech(startDate, endDate) {
        return apiClient.post('/api/water-quality/import-range-from-qntech', { startDate, endDate }, { timeout: QNTECH_RANGE_IMPORT_TIMEOUT_MS });
    },

    async fetchRangeImportProgress() {
        return apiClient.get('/api/water-quality/import-range-progress');
    },

    async bulkSave(items) {
        return apiClient.post('/api/water-quality/bulk', { items });
    },

    async fetchData(date) {
        return apiClient.get('/api/water-quality', { date });
    },

    async saveRecord(data) {
        return apiClient.post('/api/water-quality', data);
    }
};
