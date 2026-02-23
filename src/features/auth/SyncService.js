import { supabase } from '../../core/api/supabaseClient';
import { getApiBase } from '../../core/api/serverConfig';

export const SyncService = {
    async syncMembers() {
        try {
            // 1. Supabase에서 최신 사용자 목록 가져오기 (admin 제외)
            const { data: members, error } = await supabase
                .from('members')
                .select('*')
                .neq('name', 'admin');

            if (error) {
                console.error('[SyncService] Supabase 멤버 로드 실패:', error.message);
                return;
            }

            // 2. 로컬 DB에 병합
            for (const member of members) {
                try {
                    await fetch(`${getApiBase()}/api/auth/sync-member`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(member)
                    });
                } catch (e) {
                    console.error('[SyncService] 멤버 강제 동기화 실패:', member.name, e);
                }
            }
            console.log('[SyncService] 멤버 동기화 완료');
        } catch (e) {
            console.error('[SyncService] syncMembers 에러:', e);
        }
    },

    async syncAttendance() {
        try {
            // 1. 로컬에 저장된 미동기화(is_synced=0) 출결 기록 가져오기
            const res = await fetch(`${getApiBase()}/api/auth/unsynced-attendance`);
            const data = await res.json();

            if (!data.success || !data.logs || data.logs.length === 0) return;

            const syncedIds = [];

            // 2. Supabase에 업서트 (Upsert)
            for (const log of data.logs) {
                const { id, is_synced, ...logData } = log; // 로컬 DB 전용 컬럼 제거

                const { data: existing } = await supabase
                    .from('attendance')
                    .select('id')
                    .eq('member_id', log.member_id)
                    .eq('date', log.date)
                    .maybeSingle();

                if (existing) {
                    const { error } = await supabase
                        .from('attendance')
                        .update(logData)
                        .eq('id', existing.id);
                    if (!error) syncedIds.push(id);
                } else {
                    const { error } = await supabase
                        .from('attendance')
                        .insert([logData]);
                    if (!error) syncedIds.push(id);
                }
            }

            // 3. 동기화 성공한 로컬 레코드의 is_synced = 1 처리
            if (syncedIds.length > 0) {
                await fetch(`${getApiBase()}/api/auth/mark-attendance-synced`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: syncedIds })
                });
            }

            console.log(`[SyncService] 출결 정보 동기화 완료 (${syncedIds.length}건)`);
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
