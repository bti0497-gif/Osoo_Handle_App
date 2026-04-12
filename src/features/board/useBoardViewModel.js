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
    const [form, setForm] = useState({ title: '', content: '', is_notice: 0, attachments: '', parent_id: null, target_site: '' });
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

    const sortThreadedPosts = (data) => {
        const notices = data.filter(p => p.is_notice === 1).map(p => ({ ...p, depth: 0 }));
        const regulars = data.filter(p => p.is_notice !== 1);

        const postMap = {};
        regulars.forEach(p => { postMap[p.id] = p; });

        // Root ID와 현재 게시글의 깊이(Depth)를 함께 찾는 함수
        const getThreadInfo = (post) => {
            let current = post;
            let depth = 0;
            let visited = new Set();
            while (current.parent_id && postMap[current.parent_id] && !visited.has(current.parent_id)) {
                visited.add(current.id);
                current = postMap[current.parent_id];
                depth++;
            }
            return { rootId: current.id, depth };
        };

        const threads = {};
        regulars.forEach(p => {
            const { rootId, depth } = getThreadInfo(p);
            p.depth = depth; // 게시글 데이터에 깊이 주입
            if (!threads[rootId]) threads[rootId] = { items: [] };
            threads[rootId].items.push(p);
        });

        const threadList = Object.keys(threads).map(rootId => {
            const thread = threads[rootId];
            const lastActivity = thread.items.reduce((max, curr) => {
                const currTime = new Date(curr.created_at).getTime();
                return currTime > max ? currTime : max;
            }, 0);
            return { rootId, items: thread.items, lastActivity };
        });

        threadList.sort((a, b) => b.lastActivity - a.lastActivity);

        const sortedRegulars = [];
        threadList.forEach(t => {
            // 스레드 내 정렬: 단순히 일직선이 아니라 트리 구조 유지가 필요하지만,
            // 게시판 목록 특성상 '부모 우선 + 생성일순'으로 평탄화하되
            // depth를 통해 위계를 표현함.
            // 재귀적 평탄화 함수
            const flatten = (parentId = null) => {
                const children = t.items.filter(item => (item.parent_id === parentId || (!parentId && !item.parent_id && !sortedRegulars.includes(item))));
                children.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                children.forEach(child => {
                    if (!sortedRegulars.includes(child)) {
                        sortedRegulars.push(child);
                        flatten(child.id);
                    }
                });
            };
            flatten();
        });

        return [...notices, ...sortedRegulars];
    };

    const loadPosts = useCallback(async () => {
        try {
            setLoading(true);
            const data = await BoardModel.fetchPosts(currentUser);
            const sortedData = sortThreadedPosts(data);
            setPosts(sortedData);
        } catch (error) {
            console.error('Failed to view post:', error);
            showAlert?.('게시글을 불러올 수 없습니다.');
        } finally {
            setLoading(false);
        }
    }, [currentUser, showAlert]);

    useEffect(() => { loadPosts(); }, [loadPosts]);

    const updateForm = (patch) => setForm(prev => ({ ...prev, ...patch }));

    const submitPost = async () => {
        try {
            const postPayload = {
                ...form,
                author: currentUser?.name || '익명'
            };
            await BoardModel.savePost(postPayload, currentUser);

            showAlert?.('저장 완료');
            await loadPosts();
            resetForm();
            setViewMode('list');
            return { success: true };
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
            await BoardModel.deletePost(id, currentUser);
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
            const detail = await BoardModel.fetchPost(post.id, currentUser);
            setSelectedPost(detail);
            setViewMode('detail');
            loadComments(post.id);
        } catch {
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
            parent_id: post.parent_id || null,
            target_site: post.target_site || ''
        });
        setViewMode('form');
    };

    const resetForm = () => {
        setForm({ title: '', content: '', is_notice: 0, attachments: '', parent_id: null, target_site: '' });
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
            await BoardModel.saveComment(postId, commentData, currentUser);

            await loadComments(postId);
        } catch (err) {
            console.error(err);
            showAlert?.('댓글 저장 실패: ' + err.message);
        }
    };

    const deleteComment = async (commentId, postId) => {
        try {
            await BoardModel.deleteComment(commentId, currentUser);
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
