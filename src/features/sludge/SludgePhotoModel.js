import { apiClient } from '../../core/api';

export const SludgePhotoModel = {
  /** 반출관리대장 월별 조회 */
  async fetchLedgerByMonth(year, month) {
    return apiClient.get('/api/sludge-ledger', { year, month });
  },

  /** 해당 연/월의 슬러지 반출 목록 */
  async fetchByMonth(year, month) {
    return apiClient.get('/api/sludge-photos', { year, month });
  },

  /** flow_readings에서 특정 날짜의 슬러지 반출량 조회 */
  async fetchFlowAmount(date) {
    return apiClient.get('/api/sludge-photos/flow-amount', { date });
  },

  /** 저장 (날짜별 upsert + 사진 경로 전달) */
  async save(payload) {
    return apiClient.post('/api/sludge-photos/save', payload);
  },

  /** 사진 업로드 (웹 환경 – multipart) */
  async uploadPhoto(date, type, file) {
    const apiBase = (await import('../../core/api/serverConfig.js')).getApiBase();
    const formData = new FormData();
    formData.append('photo', file);
    if (file?.lastModified) {
      formData.append('takenAt', new Date(file.lastModified).toISOString());
    }
    const resp = await fetch(`${apiBase}/api/sludge-photos/upload-photo?date=${encodeURIComponent(date)}&type=${encodeURIComponent(type)}`, {
      method: 'POST',
      body: formData,
    });
    return resp.json();
  },

  /** 특정 날짜 삭제 */
  async deleteByDate(date) {
    return apiClient.delete(`/api/sludge-photos/${date}`);
  },

  /** 사진대지 엑셀 생성 후 로컬에서 열기 */
  async export(year, month) {
    return apiClient.post('/api/sludge-photos/export', { year, month });
  },

  /** 반출관리대장 엑셀 생성 후 로컬에서 열기 */
  async exportLedger(year, month) {
    return apiClient.post('/api/sludge-photos/export-ledger', { year, month });
  },
};
