import { apiClient } from '../../core/api';

export const RoadworkHelperModel = {
  async fetchAll(date) {
    return apiClient.get('/api/roadwork-helper/all', { date });
  },

  async recordDiagnostic(event, details = {}) {
    return apiClient.post('/api/roadwork-helper/diagnostic', { event, details });
  },
};
