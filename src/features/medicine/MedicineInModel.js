import { apiClient } from '../../core/api';
import { getApiBase } from '../../core/api/serverConfig.js';

export const MedicineInModel = {
  /** 전달 구매량 기본값 + 약품·키트 목록 */
  async fetchDefaults(year, month) {
    return apiClient.get('/api/medicine-in/defaults', { year, month });
  },

  /** 구매량 저장 (사진 경로 포함 가능) */
  async saveItems(payload) {
    return apiClient.post('/api/medicine-in/save', payload);
  },

  /** 사진 파일 업로드 (웹/브라우저 모드 - File.path 없을 때) */
  async uploadPhoto(date, medicineName, file) {
    const formData = new FormData();
    formData.append('date', date);
    formData.append('medicineName', medicineName);
    formData.append('photo', file);
    const res = await fetch(`${getApiBase()}/api/medicine-in/upload-photo`, {
      method: 'POST',
      body: formData,
    });
    return res.json();
  },

  /** HWPX 생성 */
  async exportDoc(payload) {
    return apiClient.post('/api/medicine-in/export', payload);
  },
};
