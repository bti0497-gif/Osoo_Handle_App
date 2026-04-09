import { apiClient } from '../../core/api';

export const MedicineInModel = {
  /** 전달 구매량 기본값 + 약품·키트 목록 */
  async fetchDefaults(year, month) {
    return apiClient.get('/api/medicine-in/defaults', { year, month });
  },

  /** 구매량 저장 */
  async saveItems(tab, date, items) {
    return apiClient.post('/api/medicine-in/save', { tab, date, items });
  },

  /** HWPX 생성 */
  async exportDoc(payload) {
    return apiClient.post('/api/medicine-in/export', payload);
  },
};
