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
            // 1. 로컬에 저장된 전체(또는 미동기화) 출결 기록 가져오기
            const res = await fetch(`${getApiBase()}/api/auth/unsynced-attendance`);
            const data = await res.json();

            if (!data.success || !data.logs || data.logs.length === 0) return;

            // 2. Supabase에 업서트 (Upsert) - date와 member_id가 일치할 경우 업데이트 가능성 존재 (실제 요구사항에 따라 조율)
            // 현재는 간단히 순차 확인 후 업데이트 방식 사용 (고도화 시 bulk 쿼리 사용)
            for (const log of data.logs) {
                const { id, ...logData } = log; // 로컬 DB의 id는 제거하고 나머지만 Supabase에 전달

                // 기존 출결 확인
                const { data: existing } = await supabase
                    .from('attendance')
                    .select('id')
                    .eq('member_id', log.member_id)
                    .eq('date', log.date)
                    .maybeSingle();

                if (existing) {
                    // Update
                    await supabase
                        .from('attendance')
                        .update(logData)
                        .eq('id', existing.id);
                } else {
                    // Insert
                    await supabase
                        .from('attendance')
                        .insert([logData]);
                }
            }
            console.log('[SyncService] 출결 정보 동기화 완료');
        } catch (e) {
            console.error('[SyncService] syncAttendance 에러:', e);
        }
    },

    async startBackgroundSync() {
        console.log('[SyncService] 백그라운드 동기화 시작');
        await this.syncMembers();
        await this.syncAttendance();
    }
};
