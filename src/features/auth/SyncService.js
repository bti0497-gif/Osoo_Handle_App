import { apiClient } from '../../core/api';

export const SyncService = {
    _initialized: false,

    async syncAttendance() {
        try {
            const data = await apiClient.post('/api/auth/sync-attendance-bq', {});
            if (data.success) {
                console.log(`[SyncService] 출결 BigQuery 동기화 완료 (${data.syncedCount}건)`);
                return data;
            }
            throw new Error(data.error || '출결 동기화에 실패했습니다.');
        } catch (e) {
            console.error('[SyncService] syncAttendance 오류:', e);
            throw e;
        }
    },

    async startBackgroundSync() {
        if (!navigator.onLine) {
            console.log('[SyncService] 오프라인 상태이므로 동기화를 연기합니다.');
            throw new Error('오프라인 상태이므로 출결 동기화를 연기합니다.');
        }
        console.log('[SyncService] 백그라운드 출결 동기화 시작');
        return this.syncAttendance();
    },

    async notifyUserActivity() {
        try {
            await apiClient.post('/api/auth/user-activity', {}, { timeout: 3000 });
        } catch (e) {
            // 활동 통지는 최적화 힌트일 뿐이며 로컬 업무에는 영향을 주지 않는다.
            console.warn('[SyncService] 사용자 활동 통지 실패:', e.message);
        }
    },

    async prepareBackgroundTasks(taskTypes) {
        return apiClient.post('/api/auth/background-tasks/prepare', { taskTypes });
    },

    async getPendingBackgroundTasks() {
        const result = await apiClient.get('/api/auth/background-tasks/pending');
        return Array.isArray(result?.tasks) ? result.tasks : [];
    },

    async claimBackgroundTask(taskType) {
        return apiClient.post('/api/auth/background-tasks/claim', { taskType });
    },

    async completeBackgroundTask(taskType, delayMs = 60 * 60 * 1000) {
        return apiClient.post('/api/auth/background-tasks/complete', { taskType, delayMs });
    },

    async failBackgroundTask(taskType, error) {
        return apiClient.post('/api/auth/background-tasks/fail', {
            taskType,
            error: error?.message || String(error || ''),
        });
    },

    async runDataBackgroundSync() {
        const result = await apiClient.post('/api/auth/background-tasks/run-data-sync', {});
        const paused = Boolean(result?.result?.results?.paused || result?.result?.reason === 'waiting-for-idle');
        if (result?.result?.error) throw new Error(result.result.error);
        if (paused) throw new Error('사용자 활동으로 데이터 동기화를 연기했습니다.');
        return result;
    },

    async runFileBackgroundSync() {
        const result = await apiClient.post('/api/auth/background-tasks/run-file-sync', {}, { timeout: 300000 });
        if (result?.summary?.paused) {
            throw new Error('사용자 활동으로 사진 전송을 연기했습니다.');
        }
        if (Number(result?.summary?.failed || 0) > 0) {
            throw new Error(`${result.summary.failed}개 사진 전송을 재시도합니다.`);
        }
        return result;
    },

    async runDiagnosticBackgroundSync() {
        return apiClient.post('/api/auth/background-tasks/run-diagnostic-sync', {}, { timeout: 300000 });
    },

    initAutoSync() {
        if (this._initialized) return;
        this._initialized = true;
        window.addEventListener('online', () => {
            console.log('[SyncService] 네트워크 연결 복구 - 유휴 동기화 스케줄러에 알립니다.');
            window.dispatchEvent(new CustomEvent('osoo:background-sync-wakeup'));
        });
    },
};
