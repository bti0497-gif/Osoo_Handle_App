import { apiClient } from '../../core/api';

export const CertificateModel = {
    async fetchList({ siteName, year, month } = {}, authHeaders = {}) {
        const params = {};
        if (siteName) {
            params.siteName = siteName;
        }
        if (year) {
            params.year = year;
        }
        if (month) {
            params.month = month;
        }
        return apiClient.get('/api/certificates', params, {
            headers: authHeaders,
        });
    },

    async syncCache({ siteName, year, month } = {}, authHeaders = {}) {
        return apiClient.post('/api/certificates/sync-cache', {
            siteName,
            year,
            month,
        }, {
            headers: authHeaders,
        });
    },

    async getDownloadInfo(certificateId) {
        return apiClient.get(`/api/certificates/${certificateId}/download`);
    },

    async downloadSelectedPdf(items) {
        return apiClient.post('/api/certificates/download-selected-pdf', { items }, {
            raw: true,
            timeout: 300000,
        });
    },
};
