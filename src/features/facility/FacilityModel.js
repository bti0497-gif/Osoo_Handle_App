import { apiClient } from '../../core/api';

/** 업무 기록은 로컬 우선이며, 사진은 Drive와 메타데이터 동기화 경로로 백업한다. */
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

    async fetchPhotos(id) {
        return apiClient.get(`/api/work-records/${id}/photos`);
    },

    async deletePhoto(id, photoId) {
        return apiClient.delete(`/api/work-records/${id}/photos/${photoId}`);
    },
};
