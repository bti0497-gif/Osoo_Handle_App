import { apiClient } from '../../core/api';

export const CertificateModel = {
    async fetchList(siteName) {
        const params = {};
        if (siteName) {
            params.siteName = siteName;
        }
        return apiClient.get('/api/certificates', params);
    },

    async uploadPdf(file) {
        const formData = new FormData();
        formData.append('certificatePdf', file);
        return apiClient.post('/api/certificates/upload', formData);
    },

    async getDownloadInfo(certificateId) {
        return apiClient.get(`/api/certificates/${certificateId}/download`);
    }
};