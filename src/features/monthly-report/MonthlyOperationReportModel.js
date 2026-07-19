import { apiClient } from '../../core/api';

export const MonthlyOperationReportModel = {
  getSummary(year, month) {
    return apiClient.get('/api/monthly-operation-report', { year, month });
  },
  export(year, month) {
    return apiClient.post('/api/monthly-operation-report/export', { year, month }, { timeout: 300000 });
  },
};
