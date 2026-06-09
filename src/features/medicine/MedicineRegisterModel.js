import { apiClient } from '../../core/api';

export const MedicineRegisterModel = {
  async fetchMonthlyData(year, month, context = {}) {
    return apiClient.get('/api/medicine-register', { year, month, ...context });
  },

  async exportExcel(year, month, context = {}) {
    return apiClient.post('/api/medicine-register/export', { year, month, ...context });
  },
};
