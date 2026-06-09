import { apiClient } from '../../core/api';

export const SludgePhotoModel = {
  async fetchLedgerByMonth(year, month) {
    return apiClient.get('/api/sludge-ledger', { year, month });
  },

  async fetchByMonth(year, month) {
    return apiClient.get('/api/sludge-photos', { year, month });
  },

  async fetchFlowAmount(date) {
    return apiClient.get('/api/sludge-photos/flow-amount', { date });
  },

  async save(payload) {
    return apiClient.post('/api/sludge-photos/save', payload);
  },

  async uploadPhoto(date, type, file) {
    const formData = new FormData();
    formData.append('photo', file);
    if (file?.lastModified) {
      formData.append('takenAt', new Date(file.lastModified).toISOString());
    }
    formData.append('date', date);
    formData.append('type', type);
    return apiClient.post('/api/sludge-photos/upload-photo', formData);
  },

  async checkRemotePhotos(payload) {
    return apiClient.post('/api/sludge-photos/remote-photos/check', payload);
  },

  async restoreRemotePhotos(payload) {
    return apiClient.post('/api/sludge-photos/remote-photos/restore', payload);
  },

  async deleteByDate(date) {
    return apiClient.delete(`/api/sludge-photos/${date}`);
  },

  async export(year, month) {
    return apiClient.post('/api/sludge-photos/export', { year, month });
  },

  async exportLedger(year, month) {
    return apiClient.post('/api/sludge-photos/export-ledger', { year, month });
  },
};
