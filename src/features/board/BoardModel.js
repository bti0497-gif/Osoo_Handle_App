import { supabase, apiClient } from '../../core/api';

export const BoardModel = {
    async fetchPosts(userName) {
        let query = supabase
            .from('posts')
            .select(`
                *,
                comments (id)
            `)
            .order('is_notice', { ascending: false })
            .order('created_at', { ascending: false });

        if (userName && userName !== 'admin') {
            query = query.or(`author.eq.${userName},is_notice.eq.1`);
        }

        const { data, error } = await query;
        if (error) throw new Error(error.message);

        return data.map(post => ({
            ...post,
            comment_count: post.comments ? post.comments.length : 0
        }));
    },

    async fetchPost(id) {
        const { data, error } = await supabase.from('posts').select('*').eq('id', id).single();
        if (error) throw new Error(error.message);
        return data;
    },

    async savePost(postData) {
        if (postData.id) {
            const { data, error } = await supabase.from('posts').update(postData).eq('id', postData.id).select().single();
            if (error) throw new Error(error.message);
            return data;
        } else {
            const { data, error } = await supabase.from('posts').insert([postData]).select().single();
            if (error) throw new Error(error.message);
            return data;
        }
    },

    async deletePost(id) {
        const { data, error } = await supabase.from('posts').delete().eq('id', id);
        if (error) throw new Error(error.message);
        return data;
    },

    async fetchComments(postId) {
        const { data, error } = await supabase.from('comments').select('*').eq('post_id', postId).order('created_at', { ascending: true });
        if (error) throw new Error(error.message);
        return data;
    },

    async saveComment(postId, commentData) {
        const payload = { ...commentData, post_id: postId };
        const { data, error } = await supabase.from('comments').insert([payload]).select().single();
        if (error) throw new Error(error.message);
        return data;
    },

    async deleteComment(id) {
        const { data, error } = await supabase.from('comments').delete().eq('id', id);
        if (error) throw new Error(error.message);
        return data;
    },

    async uploadFile(file) {
        const formData = new FormData();
        formData.append('file', file);
        return apiClient.upload('/api/upload', formData);
    }
};
