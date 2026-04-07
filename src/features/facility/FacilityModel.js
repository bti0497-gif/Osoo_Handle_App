import { apiClient } from '../../core/api';

/**
 * FacilityModel — 고장·수리 이력 API
 *
 * [향후 추가 예정: 장비이력카드 연계 API]
 * - fetchEquipments()        : 현장 장비 목록 조회 (기기명, 사양, 사진 URL 등)
 * - createEquipment(data)    : 장비 등록
 * - updateEquipment(id, data): 장비 정보 수정
 * - removeEquipment(id)      : 장비 삭제
 * - fetchLogsByEquipment(facilityId): 특정 장비의 수리 이력만 필터 조회
 *
 * facility_logs 에 facility_id 컬럼 추가 후 위 API와 연동
 */

export const FacilityModel = {
    async fetchAll(q) {
        return apiClient.get('/api/facilities', q ? { q } : {});
    },

    async create(data) {
        return apiClient.post('/api/facilities', data);
    },

    async update(id, data) {
        return apiClient.put(`/api/facilities/${id}`, data);
    },

    async remove(id) {
        return apiClient.delete(`/api/facilities/${id}`);
    }
};
