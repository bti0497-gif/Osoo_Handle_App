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

    /**
     * AI Studio 등에서 받은 batch_export.zip (all_pages_data.json + pages/ 이미지)
     * 서버: POST /api/certificates/manual-upload-zip (관리자, x-user-role 헤더 필요)
     */
    async uploadBatchZip(file, authHeaders = {}, uploadTaskId = '') {
        const formData = new FormData();
        formData.append('bundleZip', file);
        if (uploadTaskId) {
            formData.append('uploadTaskId', uploadTaskId);
        }
        return apiClient.upload('/api/certificates/manual-upload-zip', formData, {
            headers: authHeaders,
        });
    },

    async fetchZipUploadProgress(taskId, userRole = '') {
        return apiClient.get('/api/certificates/manual-upload-zip-progress', {
            taskId,
            _role: userRole || '',
        });
    },

    async getDownloadInfo(certificateId) {
        return apiClient.get(`/api/certificates/${certificateId}/download`);
    }
};