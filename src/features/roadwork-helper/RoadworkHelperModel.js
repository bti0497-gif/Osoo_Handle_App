import { apiClient } from '../../core/api';

export const RoadworkHelperModel = {
  async fetchAll(date, siteId) {
    return apiClient.get('/api/roadwork-helper/all', { date, siteId });
  },

  async recordDiagnostic(event, details = {}) {
    return apiClient.post('/api/roadwork-helper/diagnostic', { event, details });
  },

  async warmUpDailyWorkLogHwp() {
    return apiClient.post('/api/daily-work-log/warmup-hwp', {});
  },
};
