const API_BASE_URL = 'http://localhost:8901';

export const BoardModel = {
    async fetchPosts(userName) {
        const url = userName
            ? `${API_BASE_URL}/api/posts?user=${encodeURIComponent(userName)}`
            : `${API_BASE_URL}/api/posts`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch posts');
        return await response.json();
    },

    async fetchPost(id) {
        const response = await fetch(`${API_BASE_URL}/api/posts/${id}`);
        if (!response.ok) throw new Error('Failed to fetch post');
        return await response.json();
    },

    async savePost(data) {
        const response = await fetch(`${API_BASE_URL}/api/posts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Failed to save post');
        return result;
    },

    async deletePost(id) {
        const response = await fetch(`${API_BASE_URL}/api/posts/${id}`, { method: 'DELETE' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Failed to delete post');
        return result;
    },

    // Comments
    async fetchComments(postId) {
        const response = await fetch(`${API_BASE_URL}/api/posts/${postId}/comments`);
        if (!response.ok) throw new Error('Failed to fetch comments');
        return await response.json();
    },

    async saveComment(postId, data) {
        const response = await fetch(`${API_BASE_URL}/api/posts/${postId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Failed to save comment');
        return result;
    },

    async deleteComment(id) {
        const response = await fetch(`${API_BASE_URL}/api/comments/${id}`, { method: 'DELETE' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Failed to delete comment');
        return result;
    },

    // File Upload
    async uploadFile(file) {
        const formData = new FormData();
        formData.append('file', file);
        const response = await fetch(`${API_BASE_URL}/api/upload`, {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Failed to upload file');
        return result;
    }
};
