import { apiClient } from '../../core/api';

export const MedicineRegisterModel = {
  async fetchMonthlyData(year, month) {
    return apiClient.get('/api/medicine-register', { year, month });
  },

  async exportExcel(year, month) {
    return apiClient.post('/api/medicine-register/export', { year, month });
  },
};
