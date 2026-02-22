import { useState, useEffect, useCallback } from 'react';
import { BoardModel } from './BoardModel';

export const useBoardViewModel = (currentUser, { showAlert, showConfirm } = {}) => {
    const [posts, setPosts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState('list');
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [selectedPost, setSelectedPost] = useState(null);
    const [comments, setComments] = useState([]);
    const [form, setForm] = useState({ title: '', content: '', is_notice: 0, attachments: '', parent_id: null });
    const postsPerPage = 10;

    const getReplyParentPost = (parentId) => {
        return posts.find(p => p.id === parentId);
    };

    const replyToPost = (parentPost) => {
        setForm({
            title: `[답글] ${parentPost.title}`,
            content: '',
            is_notice: 0,
            attachments: '',
            parent_id: parentPost.id
        });
        setViewMode('form');
    };

    const loadPosts = useCallback(async () => {
        try {
            setLoading(true);
            const data = await BoardModel.fetchPosts(currentUser?.name);
            setPosts(data);
        } catch (error) {
            console.error('Failed to view post:', error);
            showAlert?.('게시글을 불러올 수 없습니다.');
        } finally {
            setLoading(false);
        }
    }, [currentUser?.name, showAlert]);

    useEffect(() => { loadPosts(); }, [loadPosts]);

    const updateForm = (patch) => setForm(prev => ({ ...prev, ...patch }));

    const submitPost = async () => {
        try {
            const postPayload = {
                ...form,
                author: currentUser?.name || '익명'
            };
            const res = await BoardModel.savePost(postPayload);

            if (res.success) {
                showAlert?.('저장 완료');
                await loadPosts();
                resetForm();
                setViewMode('list');
                return { success: true };
            }
        } catch (err) {
            console.error(err);
            showAlert?.('저장 실패: ' + err.message);
        }
        return { success: false };
    };

    const deletePost = async (id) => {
        const confirmed = await showConfirm?.('게시글을 삭제하시겠습니까?');
        if (!confirmed) return;
        try {
            await BoardModel.deletePost(id);
            showAlert?.('삭제 완료');
            await loadPosts();
            setViewMode('list');
            setSelectedPost(null);
        } catch (err) {
            console.error(err);
            showAlert?.('삭제 실패: ' + err.message);
        }
    };

    const viewPost = async (post) => {
        try {
            const detail = await BoardModel.fetchPost(post.id);
            setSelectedPost(detail);
            setViewMode('detail');
            loadComments(post.id);
        } catch (err) {
            showAlert?.('게시글을 불러올 수 없습니다.');
        }
    };

    const editPost = (post) => {
        setForm({
            id: post.id,
            title: post.title,
            content: post.content,
            is_notice: post.is_notice || 0,
            attachments: post.attachments || '',
            parent_id: post.parent_id || null
        });
        setViewMode('form');
    };

    const resetForm = () => {
        setForm({ title: '', content: '', is_notice: 0, attachments: '', parent_id: null });
        setSelectedPost(null);
        setComments([]);
    };

    // Comments
    const loadComments = async (postId) => {
        try {
            const data = await BoardModel.fetchComments(postId);
            setComments(data);
        } catch (err) {
            console.error('Failed to load comments:', err);
        }
    };

    const submitComment = async (postId, content, parentId) => {
        try {
            const commentData = {
                content,
                author: currentUser?.name || '익명',
                parent_id: parentId || null
            };
            await BoardModel.saveComment(postId, commentData);

            await loadComments(postId);
        } catch (err) {
            console.error(err);
            showAlert?.('댓글 저장 실패: ' + err.message);
        }
    };

    const deleteComment = async (commentId, postId) => {
        try {
            await BoardModel.deleteComment(commentId);
            await loadComments(postId);
        } catch (err) {
            console.error(err);
            showAlert?.('댓글 삭제 실패: ' + err.message);
        }
    };

    // File upload
    const uploadFile = async (file) => {
        try {
            return await BoardModel.uploadFile(file);
        } catch (err) {
            console.error('File Upload Error:', err);
            showAlert?.('파일 업로드 실패: ' + err.message);
            return null;
        }
    };

    // Filter and Pagination
    const filteredPosts = posts.filter(p =>
        p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.author.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const totalPages = Math.ceil(filteredPosts.length / postsPerPage);
    const currentPosts = filteredPosts.slice(
        (currentPage - 1) * postsPerPage,
        currentPage * postsPerPage
    );

    return {
        posts: currentPosts,
        allPostsCount: filteredPosts.length,
        loading,
        form,
        updateForm,
        submitPost,
        deletePost,
        viewPost,
        editPost,
        replyToPost,
        getReplyParentPost,
        selectedPost,
        comments,
        submitComment,
        deleteComment,
        uploadFile,
        viewMode,
        setViewMode,
        searchTerm,
        setSearchTerm,
        currentPage,
        setCurrentPage,
        totalPages,
        resetForm,
        loadPosts
    };
};
