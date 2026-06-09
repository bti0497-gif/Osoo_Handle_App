import { apiClient } from '../../core/api';

export const SyncService = {
    async syncMembers() {
        try {
            // Google Sheets(또는 로컬 DB 폴백)에서 최신 회원 목록 가져오기
            const data = await apiClient.get('/api/auth/members');
            if (!data.success) {
                console.error('[SyncService] 회원 로드 실패:', data.error);
                return;
            }
            // 로컬 DB에 병합
            for (const member of data.members || []) {
                try {
                    await apiClient.post('/api/auth/sync-member', member);
                } catch (e) {
                    console.error('[SyncService] 멤버 로컬 동기화 실패:', member.name, e);
                }
            }
            console.log('[SyncService] 회원 동기화 완료');
        } catch (e) {
            console.error('[SyncService] syncMembers 에러:', e);
        }
    },

    async syncAttendance() {
        try {
            // 로컬 미동기화 출결 → BigQuery 전송
            const data = await apiClient.post('/api/auth/sync-attendance-bq', {});
            if (data.success) {
                console.log(`[SyncService] 출결 BigQuery 동기화 완료 (${data.syncedCount}건)`);
            } else {
                console.error('[SyncService] 출결 동기화 실패:', data.error);
            }
        } catch (e) {
            console.error('[SyncService] syncAttendance 에러:', e);
        }
    },

    async startBackgroundSync() {
        if (!navigator.onLine) {
            console.log('[SyncService] 오프라인 상태이므로 동기화를 연기합니다.');
            return;
        }
        console.log('[SyncService] 백그라운드 서버 동기화 시작 (온라인)');
        await this.syncMembers();
        await this.syncAttendance();
    },

    initAutoSync() {
        window.addEventListener('online', () => {
            console.log('[SyncService] 네트워크 연결이 복구되었습니다. 밀린 데이터를 동기화합니다.');
            this.startBackgroundSync().catch(console.error);
        });
    }
};

