import { apiClient } from '../../core/api';

export const MedicineInModel = {
  async fetchDefaults(year, month, context = {}) {
    return apiClient.get('/api/medicine-in/defaults', { year, month, ...context });
  },

  async fetchMonthly(year, month) {
    return apiClient.get('/api/medicine-in/monthly', { year, month });
  },

  async saveItems(payload) {
    return apiClient.post('/api/medicine-in/save', payload);
  },

  async uploadPhoto(date, medicineName, file, photoIndex = 0) {
    const formData = new FormData();
    formData.append('date', date);
    formData.append('medicineName', medicineName);
    formData.append('photoIndex', String(photoIndex));
    formData.append('photo', file);
    return apiClient.post('/api/medicine-in/upload-photo', formData);
  },

  async checkRemotePhotos(payload) {
    return apiClient.post('/api/medicine-in/remote-photos/check', payload);
  },

  async restoreRemotePhotos(payload) {
    return apiClient.post('/api/medicine-in/remote-photos/restore', payload);
  },

  async exportExcel(payload) {
    return apiClient.post('/api/medicine-in/export', payload);
  },
};
