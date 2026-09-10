/**
 * 장비이력카드 데이터 모델 — 로컬 API(apiClient) 연결 (Phase 2).
 * 서버 계약: docs/EQUIPMENT_CARD_DEVELOPMENT_PLAN.md §5, §4-4
 * 이전 프로토타입의 메모리 스토어/IndexedDB는 제거되었다.
 *  - 사진 원본: appDataPath/사진관리/장비이력/... (+ Drive 미러)
 *  - 사진 표시: 정적 마운트 /사진관리/... 상대 URL
 */
import { apiClient } from '../../core/api';

const BASE = '/api/equipment';

const EquipmentModel = {
  async fetchMeta() {
    return apiClient.get(`${BASE}/meta`);
  },

  async fetchEquipment() {
    return apiClient.get(BASE);
  },

  async fetchHistory() {
    return apiClient.get(`${BASE}/history`);
  },

  async fetchWorkRecords(equipmentId) {
    return apiClient.get(`${BASE}/work-records`, { equipmentId });
  },

  async saveEquipment(item) {
    return item.id ? apiClient.put(`${BASE}/${item.id}`, item) : apiClient.post(BASE, item);
  },

  async deleteEquipment(id) {
    return apiClient.delete(`${BASE}/${id}`);
  },

  async deleteEquipmentByIds(ids) {
    for (const id of ids) {
      await apiClient.delete(`${BASE}/${id}`);
    }
    return ids.length;
  },

  async excludeEquipment(ids) {
    for (const id of ids) {
      await apiClient.put(`${BASE}/${id}/visibility`, { is_visible: false });
    }
    return ids.length;
  },

  async updateEquipmentStatus(id, status) {
    return apiClient.put(`${BASE}/${id}/status`, { status });
  },

  async uploadEquipmentPhoto(id, file) {
    const formData = new FormData();
    formData.append('photo', file);
    return apiClient.upload(`${BASE}/${id}/photos`, formData);
  },

  async loadHistoryPhotos(id) {
    return apiClient.get(`${BASE}/history/${id}/photos`);
  },

  async appendHistoryPhotos(id, files) {
    const formData = new FormData();
    files.forEach((file) => formData.append('photos', file));
    return apiClient.upload(`${BASE}/history/${id}/photos`, formData);
  },

  async deleteHistoryPhotoAt(id, photoId) {
    return apiClient.delete(`${BASE}/history/${id}/photos/${photoId}`);
  },

  async saveHistoryEntry(entry) {
    return entry.id
      ? apiClient.put(`${BASE}/history/${entry.id}`, entry)
      : apiClient.post(`${BASE}/history`, entry);
  },

  async deleteHistoryEntry(id) {
    return apiClient.delete(`${BASE}/history/${id}`);
  },

  async addCatalogSelections(selections) {
    return apiClient.post(`${BASE}/catalog`, { selections });
  },
};

export default EquipmentModel;
