import { apiClient } from '../../core/api';

export const SyncService = {
    async syncAttendance() {
        try {
            const data = await apiClient.post('/api/auth/sync-attendance-bq', {});
            if (data.success) {
                console.log(`[SyncService] 출결 BigQuery 동기화 완료 (${data.syncedCount}건)`);
            } else {
                console.error('[SyncService] 출결 동기화 실패:', data.error);
            }
        } catch (e) {
            console.error('[SyncService] syncAttendance 오류:', e);
        }
    },

    async startBackgroundSync() {
        if (!navigator.onLine) {
            console.log('[SyncService] 오프라인 상태이므로 동기화를 연기합니다.');
            return;
        }
        console.log('[SyncService] 백그라운드 출결 동기화 시작');
        await this.syncAttendance();
    },

    initAutoSync() {
        window.addEventListener('online', () => {
            console.log('[SyncService] 네트워크 연결이 복구되었습니다. 출결 데이터를 동기화합니다.');
            this.startBackgroundSync().catch(console.error);
        });
    },
};
