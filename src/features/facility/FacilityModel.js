import { apiClient } from '../../core/api';

/** 로컬 전용 업무 기록 API. BigQuery 동기화 경로를 사용하지 않는다. */
export const FacilityModel = {
    async fetchAll(q) {
        return apiClient.get('/api/work-records', q ? { q } : {});
    },

    async create(data) {
        return apiClient.post('/api/work-records', data);
    },

    async update(id, data) {
        return apiClient.put(`/api/work-records/${id}`, data);
    },

    async remove(id) {
        return apiClient.delete(`/api/work-records/${id}`);
    },

    async uploadPhotos(id, files) {
        const formData = new FormData();
        Array.from(files || []).forEach((file) => formData.append('photos', file));
        return apiClient.upload(`/api/work-records/${id}/photos`, formData);
    },

    async openPhotoFolder(id) {
        return apiClient.post(`/api/work-records/${id}/open-photo-folder`, {});
    },
};
