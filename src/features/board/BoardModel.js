import { apiClient } from '../../core/api';

/**
 * _user 헬퍼 — 현재 로그인 사용자 정보를 요청 body에 포함시킨다.
 * boardRoutes.cjs는 이 정보를 기준으로 가시성 필터와 권한 체크를 수행한다.
 */
function userPayload(currentUser) {
    return {
        _user: {
            name: currentUser?.name || 'unknown',
            role: currentUser?.role || 'manager',
            site: currentUser?.site_name1 || ''
        }
    };
}

function userQuery(currentUser) {
    const u = userPayload(currentUser)._user;
    return new URLSearchParams({
        _role: u.role,
        _site: u.site,
        _name: u.name
    }).toString();
}

export const BoardModel = {
    async fetchSites() {
        const res = await apiClient.get('/api/settings/sites');
        if (!res.success) throw new Error(res.message || '현장 목록 로드 실패');
        return Array.isArray(res.sites) ? res.sites : [];
    },

    async fetchPosts(currentUser) {
        const u = userPayload(currentUser)._user;
        const res = await apiClient.get('/api/board/posts', {
            _role: u.role,
            _site: u.site,
            _name: u.name
        });
        if (!res.success) throw new Error(res.message || '게시글 로드 실패');
        return res.data;
    },

    async fetchPost(id, currentUser) {
        const u = userPayload(currentUser)._user;
        const res = await apiClient.get(`/api/board/posts/${id}`, {
            _role: u.role,
            _site: u.site,
            _name: u.name
        });
        if (!res.success) throw new Error(res.message || '게시글 로드 실패');
        return res.data;
    },

    async savePost(postData, currentUser) {
        const body = { ...postData, ...userPayload(currentUser) };
        if (postData.id) {
            const res = await apiClient.put(`/api/board/posts/${postData.id}`, body);
            if (!res.success) throw new Error(res.message || '수정 실패');
            return { id: postData.id, ...postData };
        } else {
            const res = await apiClient.post('/api/board/posts', body);
            if (!res.success) throw new Error(res.message || '작성 실패');
            return res.data;
        }
    },

    async deletePost(id, currentUser) {
        const query = userQuery(currentUser);
        const res = await apiClient.delete(`/api/board/posts/${id}?${query}`);
        if (!res.success) throw new Error(res.message || '삭제 실패');
        return res.data;
    },

    async fetchComments(postId, currentUser) {
        const u = userPayload(currentUser)._user;
        const res = await apiClient.get(`/api/board/posts/${postId}/comments`, {
            _role: u.role,
            _site: u.site,
            _name: u.name
        });
        if (!res.success) throw new Error(res.message || '댓글 로드 실패');
        return res.data;
    },

    async saveComment(postId, commentData, currentUser) {
        const body = { ...commentData, ...userPayload(currentUser) };
        const res = await apiClient.post(`/api/board/posts/${postId}/comments`, body);
        if (!res.success) throw new Error(res.message || '댓글 작성 실패');
        return res.data;
    },

    async deleteComment(id, currentUser) {
        const query = userQuery(currentUser);
        const res = await apiClient.delete(`/api/board/comments/${id}?${query}`);
        if (!res.success) throw new Error(res.message || '댓글 삭제 실패');
        return res.data;
    },

    async uploadFile(file, { boardId = null, date = null } = {}) {
        const formData = new FormData();
        formData.append('file', file);
        if (boardId) formData.append('boardId', String(boardId));
        if (date) formData.append('date', String(date));
        return apiClient.upload('/api/upload', formData);
    }
};

