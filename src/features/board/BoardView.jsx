import React, { useState, useRef, useMemo } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { useBoardViewModel } from './useBoardViewModel';
import { useDialog } from '../../components/common/DialogContext';

// ── 성능 최적화를 위한 댓글 입력 컴포넌트 분리 ──
const CommentInput = ({ onSubmit, placeholder, initialValue = '', onCancel, buttonText = '등록' }) => {
    const [text, setText] = useState(initialValue);

    const handleSubmit = () => {
        if (!text.trim()) return;
        onSubmit(text);
        setText('');
    };

    return (
        <div style={{ display: 'flex', gap: '6px', width: '100%' }}>
            <input
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder={placeholder}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                style={{
                    flex: 1, border: '1.5px solid #e2e8f0', height: '34px',
                    padding: '0 10px', fontSize: '0.8125rem', fontWeight: 600,
                    outline: 'none', borderRadius: '6px'
                }}
                onFocus={e => e.target.style.borderColor = '#1e293b'}
                onBlur={e => e.target.style.borderColor = '#e2e8f0'}
            />
            <button onClick={handleSubmit}
                style={{
                    height: '34px', padding: '0 14px', backgroundColor: '#1e293b',
                    color: 'white', border: 'none', borderRadius: '6px',
                    fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer'
                }}>
                {buttonText}
            </button>
            {onCancel && (
                <button onClick={onCancel}
                    style={{
                        height: '34px', padding: '0 10px', backgroundColor: '#f1f5f9',
                        color: '#64748b', border: 'none', borderRadius: '6px',
                        fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer'
                    }}>
                    취소
                </button>
            )}
        </div>
    );
};

const BoardView = ({ currentUser }) => {
    const { showAlert, showConfirm } = useDialog();
    const {
        posts, allPostsCount, loading, form, updateForm,
        submitPost, deletePost, viewPost, editPost,
        selectedPost, comments, submitComment, deleteComment, uploadFile,
        viewMode, setViewMode, searchTerm, setSearchTerm,
        currentPage, setCurrentPage, totalPages, resetForm, loadPosts, replyToPost
    } = useBoardViewModel(currentUser, { showAlert, showConfirm });

    const [replyTo, setReplyTo] = useState(null);
    const fileInputRef = useRef(null);

    const isAdmin = currentUser?.role === 'admin';
    const isAuthor = (authorName) => currentUser?.name === authorName;
    const resolveAttachmentHref = (attachment) => {
        const rawUrl = String(attachment?.url || '').trim();
        const fileName = String(attachment?.name || 'download').trim() || 'download';
        if (!rawUrl) return '#';
        // 로컬 저장 URL은 다운로드 API를 거치며 원본 파일명으로 내려받는다.
        if (rawUrl.startsWith('/uploads/')) {
            return `/api/download?url=${encodeURIComponent(rawUrl)}&name=${encodeURIComponent(fileName)}`;
        }
        return rawUrl;
    };

    // Quill modules
    const quillModules = useMemo(() => ({
        toolbar: {
            container: [
                [{ 'header': [1, 2, 3, false] }],
                ['bold', 'italic', 'underline', 'strike'],
                [{ 'color': [] }, { 'background': [] }],
                [{ 'align': [] }],
                [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                ['blockquote'],
                ['link', 'image'],
                ['clean']
            ]
        }
    }), []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.title.trim()) { await showAlert('제목을 입력해주세요.'); return; }
        if (!form.content.trim() || form.content === '<p><br></p>') { await showAlert('내용을 입력해주세요.'); return; }
        submitPost();
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // 50MB 용량 체크
        const maxSize = 50 * 1024 * 1024;
        if (file.size > maxSize) {
            await showAlert('파일 용량이 너무 큽니다. 최대 50MB까지 업로드 가능합니다.');
            e.target.value = '';
            return;
        }

        const result = await uploadFile(file, {
            boardId: form.id || 'draft',
            date: new Date().toISOString(),
        });
        if (result) {
            const current = form.attachments ? JSON.parse(form.attachments) : [];
            current.push({ url: result.url, name: result.originalName, size: result.size });
            updateForm({ attachments: JSON.stringify(current) });
        }
        e.target.value = '';
    };

    const removeAttachment = (index) => {
        const current = JSON.parse(form.attachments);
        current.splice(index, 1);
        updateForm({ attachments: current.length > 0 ? JSON.stringify(current) : '' });
    };

    const handleCommentSubmit = (text) => {
        submitComment(selectedPost.id, text, null);
    };

    const handleReplySubmit = (text, parentId) => {
        submitComment(selectedPost.id, text, parentId);
        setReplyTo(null);
    };

    const parseBoardDate = (value) => {
        if (!value) return null;

        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? null : value;
        }

        if (typeof value === 'string' || typeof value === 'number') {
            const d = new Date(value);
            return Number.isNaN(d.getTime()) ? null : d;
        }

        if (typeof value === 'object') {
            if (typeof value.value === 'string' || typeof value.value === 'number') {
                const d = new Date(value.value);
                return Number.isNaN(d.getTime()) ? null : d;
            }
            if (typeof value.timestampValue === 'string') {
                const d = new Date(value.timestampValue);
                return Number.isNaN(d.getTime()) ? null : d;
            }
            if (typeof value.seconds === 'number') {
                const millis = value.seconds * 1000 + Math.floor((typeof value.nanos === 'number' ? value.nanos : 0) / 1_000_000);
                const d = new Date(millis);
                return Number.isNaN(d.getTime()) ? null : d;
            }
        }

        return null;
    };

    const formatDate = (dateStr) => {
        const d = parseBoardDate(dateStr);
        if (!d) return '-';
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hour = String(d.getHours()).padStart(2, '0');
        const minute = String(d.getMinutes()).padStart(2, '0');
        return `${month}-${day} ${hour}:${minute}`;
    };

    const formatFullDate = (dateStr) => {
        const d = parseBoardDate(dateStr);
        if (!d) return '-';
        return d.toLocaleString('ko-KR', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
    };

    const getAttachments = (attachmentsStr) => {
        if (!attachmentsStr) return [];
        try { return JSON.parse(attachmentsStr); } catch { return []; }
    };

    const formatFileSize = (bytes) => {
        if (bytes < 1024) return bytes + 'B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
        return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
    };

    // ── 댓글 트리 구조 ──
    const topComments = comments.filter(c => !c.parent_id);
    const getReplies = (parentId) => comments.filter(c => c.parent_id === parentId);

    return (
        <div className="panel-container justify-center">
            <div className="dynamic-panel w-[850px] shadow-2xl border-slate-200">

                {/* ════════════════════════════════════════════ */}
                {/* ── 목록 모드 ── */}
                {/* ════════════════════════════════════════════ */}
                {viewMode === 'list' ? (
                    <>
                        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '2px solid #e2e8f0', flexShrink: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h1 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#1e293b', letterSpacing: '-0.025em' }}>
                                    소통게시판
                                </h1>
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8' }}>
                                    총 {allPostsCount}건
                                </span>
                            </div>
                        </div>

                        {/* 컬럼 헤더 */}
                        <div style={{
                            display: 'flex', alignItems: 'center',
                            padding: '0.5rem 1.5rem',
                            backgroundColor: '#f8fafc',
                            borderBottom: '1px solid #e2e8f0',
                            flexShrink: 0,
                            fontSize: '0.6875rem', fontWeight: 800, color: '#94a3b8',
                            textTransform: 'uppercase', letterSpacing: '0.08em',
                            textAlign: 'center' // 전체 헤더 중앙 정렬
                        }}>
                            <span style={{ width: '40px', textAlign: 'center' }}>번호</span>
                            <span style={{ flex: 1, textAlign: 'center' }}>제목</span>
                            <span style={{ width: '80px', textAlign: 'center' }}>작성자</span>
                            <span style={{ width: '100px', textAlign: 'center' }}>일시</span>
                            <span style={{ width: '40px', textAlign: 'center' }}>조회</span>
                        </div>

                        {/* 게시글 목록 */}
                        <div style={{ flex: 1, overflowY: 'auto' }}>
                            {loading ? (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', fontWeight: 700, fontSize: '0.875rem' }}>
                                    데이터를 불러오는 중...
                                </div>
                            ) : posts.length === 0 ? (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#cbd5e1', fontWeight: 700, fontSize: '0.875rem' }}>
                                    등록된 게시글이 없습니다.
                                </div>
                            ) : (
                                <div>
                                    {posts.map((p, index) => {
                                        const attachments = getAttachments(p.attachments);
                                        return (
                                            <div
                                                key={p.id}
                                                onClick={() => viewPost(p)}
                                                style={{
                                                    display: 'flex', alignItems: 'center',
                                                    padding: '0.4rem 1.5rem',
                                                    borderBottom: '1px solid #f1f5f9',
                                                    cursor: 'pointer',
                                                    transition: 'background-color 0.15s',
                                                    backgroundColor: p.is_notice ? '#fffbeb' : 'transparent'
                                                }}
                                                onMouseEnter={e => e.currentTarget.style.backgroundColor = p.is_notice ? '#fef3c7' : '#f0f9ff'}
                                                onMouseLeave={e => e.currentTarget.style.backgroundColor = p.is_notice ? '#fffbeb' : 'transparent'}
                                            >
                                                <span style={{ width: '40px', textAlign: 'center', color: '#94a3b8', fontSize: '0.75rem', fontWeight: 500 }}>
                                                    {p.is_notice ? '📌' : (p.parent_id ? '' : (currentPage - 1) * 10 + index + 1)}
                                                </span>
                                                <div style={{
                                                    flex: 1, display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden',
                                                    paddingLeft: p.depth > 0 ? `${p.depth * 1.25}rem` : '8px'
                                                }}>
                                                    {p.is_notice ? (
                                                        <span style={{ fontSize: '0.5625rem', fontWeight: 900, color: '#d97706', backgroundColor: '#fef3c7', padding: '1px 5px', borderRadius: '3px', flexShrink: 0 }}>공지</span>
                                                    ) : null}
                                                    {p.target_site && isAdmin && (
                                                        <span style={{ fontSize: '0.5625rem', fontWeight: 900, color: '#7c3aed', backgroundColor: '#ede9fe', padding: '1px 5px', borderRadius: '3px', flexShrink: 0 }}>→{p.target_site}</span>
                                                    )}
                                                    {p.parent_id && (
                                                        <span style={{ color: '#94a3b8', fontWeight: 800, marginRight: '4px' }}>↳</span>
                                                    )}
                                                    <span style={{ fontWeight: p.parent_id ? 500 : 700, color: '#1e293b', fontSize: '0.8125rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {p.title}
                                                    </span>
                                                    {p.comment_count > 0 && (
                                                        <span style={{ fontSize: '0.625rem', color: '#3b82f6', fontWeight: 800, flexShrink: 0 }}>
                                                            [{p.comment_count}]
                                                        </span>
                                                    )}
                                                    {attachments.length > 0 && (
                                                        <span style={{ fontSize: '0.6875rem', flexShrink: 0 }}>📎</span>
                                                    )}
                                                </div>
                                                <span style={{ width: '80px', textAlign: 'center', fontWeight: 600, color: '#475569', fontSize: '0.75rem' }}>
                                                    {p.author}
                                                </span>
                                                <span style={{ width: '100px', textAlign: 'center', color: '#94a3b8', fontSize: '0.6875rem' }}>
                                                    {formatDate(p.created_at)}
                                                </span>
                                                <span style={{ width: '40px', textAlign: 'center', color: '#94a3b8', fontSize: '0.6875rem' }}>
                                                    {p.view_count}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* 하단: 페이지네이션 + 검색 + 글쓰기 */}
                        <div style={{
                            padding: '0.75rem 1.5rem',
                            borderTop: '2px solid #e2e8f0',
                            flexShrink: 0,
                            display: 'flex', alignItems: 'center', gap: '0.75rem'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                                    style={{ width: '28px', height: '28px', border: 'none', background: 'none', cursor: currentPage === 1 ? 'default' : 'pointer', color: currentPage === 1 ? '#cbd5e1' : '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.875rem' }}>‹</button>
                                <span style={{ minWidth: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1e293b', color: 'white', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 800 }}>{currentPage}</span>
                                <button onClick={() => setCurrentPage(p => Math.min(totalPages || 1, p + 1))} disabled={currentPage >= totalPages}
                                    style={{ width: '28px', height: '28px', border: 'none', background: 'none', cursor: currentPage >= totalPages ? 'default' : 'pointer', color: currentPage >= totalPages ? '#cbd5e1' : '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.875rem' }}>›</button>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flex: 1, maxWidth: '240px' }}>
                                <span className="material-icons" style={{ fontSize: '16px', color: '#94a3b8' }}>search</span>
                                <input placeholder="검색..." value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                                    style={{ border: '1.5px solid #e2e8f0', height: '28px', padding: '0 8px', fontSize: '0.75rem', fontWeight: 600, color: '#1e293b', outline: 'none', borderRadius: '6px', width: '100%', transition: 'border-color 0.15s' }}
                                    onFocus={e => e.target.style.borderColor = '#1e293b'} onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
                            </div>
                            <div style={{ flex: 1 }} />
                            <button onClick={() => { resetForm(); setViewMode('form'); }}
                                style={{ height: '32px', padding: '0 14px', backgroundColor: '#1e293b', color: 'white', borderRadius: '6px', border: 'none', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', transition: 'background-color 0.15s', flexShrink: 0 }}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = '#334155'} onMouseLeave={e => e.currentTarget.style.backgroundColor = '#1e293b'}>
                                <span className="material-icons" style={{ fontSize: '14px' }}>edit</span> 글쓰기
                            </button>
                        </div>
                    </>

                    /* ════════════════════════════════════════════ */
                    /* ── 상세보기 모드 ── */
                    /* ════════════════════════════════════════════ */
                ) : viewMode === 'detail' && selectedPost ? (
                    <>
                        <div style={{ padding: '1rem 1.5rem', borderBottom: '2px solid #e2e8f0', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h1 style={{ fontSize: '1.125rem', fontWeight: 900, color: '#1e293b' }}>게시글 보기</h1>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button onClick={() => { setViewMode('list'); resetForm(); loadPosts(); }}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, color: '#64748b', fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span className="material-icons" style={{ fontSize: '16px' }}>arrow_back</span> 목록으로
                                </button>
                            </div>
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
                            {/* 제목 + 메타 */}
                            {selectedPost.is_notice ? (
                                <span style={{ fontSize: '0.625rem', fontWeight: 900, color: '#d97706', backgroundColor: '#fef3c7', padding: '2px 6px', borderRadius: '3px', marginBottom: '6px', display: 'inline-block' }}>📌 공지</span>
                            ) : null}
                            <h2 style={{ fontSize: '1.125rem', fontWeight: 900, color: '#1e293b', marginBottom: '0.5rem' }}>{selectedPost.title}</h2>
                            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600, borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
                                <span style={{ fontWeight: 700, color: '#475569' }}>{selectedPost.author}</span>
                                <span>{formatFullDate(selectedPost.created_at)}</span>
                                <span>조회 {selectedPost.view_count}</span>
                            </div>

                            {/* 본문 (HTML) */}
                            <div className="ql-snow">
                                <div className="ql-editor" style={{ padding: 0, minHeight: '80px', fontSize: '0.875rem', color: '#334155', lineHeight: 1.8 }}
                                    dangerouslySetInnerHTML={{ __html: selectedPost.content }} />
                            </div>

                            {/* 첨부파일 */}
                            {getAttachments(selectedPost.attachments).length > 0 && (
                                <div style={{ marginTop: '1.25rem', borderTop: '1px solid #e2e8f0', paddingTop: '0.75rem' }}>
                                    <div style={{ fontSize: '0.6875rem', fontWeight: 800, color: '#94a3b8', marginBottom: '6px', textTransform: 'uppercase' }}>첨부파일</div>
                                    {getAttachments(selectedPost.attachments).map((att, i) => (
                                        <a key={i} href={resolveAttachmentHref(att)} target="_blank" rel="noopener noreferrer"
                                            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px', marginBottom: '4px', textDecoration: 'none', fontSize: '0.75rem', color: '#475569', fontWeight: 600 }}>
                                            <span className="material-icons" style={{ fontSize: '14px', color: '#94a3b8' }}>attach_file</span>
                                            {att.name} <span style={{ color: '#94a3b8' }}>({formatFileSize(att.size)})</span>
                                        </a>
                                    ))}
                                </div>
                            )}

                            {/* 버튼 영역 (답글 / 수정 / 삭제) */}
                            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                                <button onClick={() => replyToPost(selectedPost)}
                                    style={{ height: '30px', padding: '0 12px', backgroundColor: '#3b82f6', color: 'white', borderRadius: '6px', border: 'none', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span className="material-icons" style={{ fontSize: '14px' }}>reply</span> 답글 쓰기
                                </button>

                                {isAuthor(selectedPost.author) && (
                                    <>
                                        <button onClick={() => editPost(selectedPost)}
                                            style={{ height: '30px', padding: '0 12px', backgroundColor: 'white', color: '#1e293b', borderRadius: '6px', border: '1.5px solid #e2e8f0', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer' }}>수정</button>
                                        <button onClick={() => deletePost(selectedPost.id)}
                                            style={{ height: '30px', padding: '0 12px', backgroundColor: '#fee2e2', color: '#dc2626', borderRadius: '6px', border: '1.5px solid #fecaca', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer' }}>삭제</button>
                                    </>
                                )}
                            </div>

                            {/* ── 댓글 영역 ── */}
                            <div style={{ marginTop: '1.5rem', borderTop: '2px solid #e2e8f0', paddingTop: '1rem' }}>
                                <div style={{ fontSize: '0.8125rem', fontWeight: 800, color: '#1e293b', marginBottom: '0.75rem' }}>
                                    💬 댓글 {comments.length}개
                                </div>

                                {/* 댓글 목록 */}
                                {topComments.map(c => (
                                    <div key={c.id} style={{ marginBottom: '0.75rem' }}>
                                        <div style={{ padding: '0.625rem 0.75rem', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <span style={{ fontWeight: 700, fontSize: '0.75rem', color: '#1e293b' }}>{c.author}</span>
                                                    <span style={{ fontSize: '0.625rem', color: '#94a3b8' }}>{formatFullDate(c.created_at)}</span>
                                                </div>
                                                <div style={{ display: 'flex', gap: '8px' }}>
                                                    <button onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}
                                                        style={{
                                                            display: 'flex', alignItems: 'center', gap: '2px',
                                                            background: '#eff6ff', border: '1px solid #bfdbfe',
                                                            padding: '2px 8px', borderRadius: '4px', cursor: 'pointer',
                                                            fontSize: '0.6875rem', fontWeight: 800, color: '#2563eb'
                                                        }}>
                                                        <span className="material-icons" style={{ fontSize: '12px' }}>reply</span> 댓글
                                                    </button>
                                                    {isAuthor(c.author) && (
                                                        <button onClick={() => deleteComment(c.id, selectedPost.id)}
                                                            style={{
                                                                background: '#fff1f2', border: '1px solid #fecdd3',
                                                                padding: '2px 8px', borderRadius: '4px', cursor: 'pointer',
                                                                fontSize: '0.6875rem', fontWeight: 800, color: '#e11d48'
                                                            }}>삭제</button>
                                                    )}
                                                </div>
                                            </div>
                                            <div style={{ fontSize: '0.8125rem', color: '#334155', lineHeight: 1.6 }}>{c.content}</div>
                                        </div>

                                        {/* 답글 목록 */}
                                        {getReplies(c.id).map(r => (
                                            <div key={r.id} style={{ marginLeft: '1.5rem', marginTop: '4px', padding: '0.5rem 0.75rem', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <span style={{ fontSize: '0.6875rem', color: '#94a3b8' }}>↳</span>
                                                        <span style={{ fontWeight: 700, fontSize: '0.6875rem', color: '#1e293b' }}>{r.author}</span>
                                                        <span style={{ fontSize: '0.5625rem', color: '#94a3b8' }}>{formatFullDate(r.created_at)}</span>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '6px' }}>
                                                        <button onClick={() => setReplyTo(replyTo === r.id ? null : r.id)}
                                                            style={{
                                                                background: '#f8fafc', border: '1px solid #e2e8f0',
                                                                padding: '1px 6px', borderRadius: '4px', cursor: 'pointer',
                                                                fontSize: '0.625rem', fontWeight: 700, color: '#64748b'
                                                            }}>답글</button>
                                                        {isAuthor(r.author) && (
                                                            <button onClick={() => deleteComment(r.id, selectedPost.id)}
                                                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.625rem', fontWeight: 700, color: '#ef4444' }}>삭제</button>
                                                        )}
                                                    </div>
                                                </div>
                                                <div style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.5 }}>{r.content}</div>
                                            </div>
                                        ))}

                                        {/* 답글 입력 (부모 댓글 또는 답글에 대해) */}
                                        {replyTo === c.id && (
                                            <div style={{ marginLeft: '1.5rem', marginTop: '6px' }}>
                                                <CommentInput
                                                    placeholder="답글을 입력하세요..."
                                                    onSubmit={(text) => handleReplySubmit(text, c.id)}
                                                    onCancel={() => setReplyTo(null)}
                                                />
                                            </div>
                                        )}
                                    </div>
                                ))}

                                {/* 댓글 입력 */}
                                <div style={{ marginTop: '1rem' }}>
                                    <CommentInput
                                        placeholder="댓글을 입력하세요..."
                                        onSubmit={handleCommentSubmit}
                                    />
                                </div>
                            </div>
                        </div>
                    </>

                    /* ════════════════════════════════════════════ */
                    /* ── 글쓰기/수정 모드 ── */
                    /* ════════════════════════════════════════════ */
                ) : (
                    <>
                        <div style={{ padding: '1rem 1.5rem', borderBottom: '2px solid #e2e8f0', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h1 style={{ fontSize: '1.125rem', fontWeight: 900, color: '#1e293b' }}>{form.id ? '글 수정' : '새 글 작성'}</h1>
                            <button onClick={() => { setViewMode('list'); resetForm(); }}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, color: '#64748b', fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span className="material-icons" style={{ fontSize: '16px' }}>arrow_back</span> 목록으로
                            </button>
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
                            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                                {/* 제목 + 공지 */}
                                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 800, color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>제목</label>
                                        <input value={form.title} onChange={e => updateForm({ title: e.target.value })} placeholder="제목을 입력하세요" required
                                            style={{ width: '100%', border: '2px solid #1e293b', height: '40px', padding: '0 12px', fontWeight: 700, color: '#1e293b', outline: 'none' }} />
                                    </div>
                                    {isAdmin && (
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', height: '40px', fontSize: '0.75rem', fontWeight: 700, color: '#d97706', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                            <input type="checkbox" checked={form.is_notice === 1} onChange={e => updateForm({ is_notice: e.target.checked ? 1 : 0 })} />
                                            📌 공지
                                        </label>
                                    )}
                                </div>

                                {/* 관리자 전용: 대상 현장 선택 */}
                                {isAdmin && (
                                    <div style={{ marginBottom: '0.75rem' }}>
                                        <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 800, color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>대상 현장</label>
                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8125rem', fontWeight: 700, cursor: 'pointer' }}>
                                                <input type="radio" name="target_site" value=""
                                                    checked={!form.target_site}
                                                    onChange={() => updateForm({ target_site: '' })} />
                                                전체 현장
                                            </label>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8125rem', fontWeight: 700, cursor: 'pointer' }}>
                                                <input type="radio" name="target_site" value="specific"
                                                    checked={!!form.target_site}
                                                    onChange={() => updateForm({ target_site: form.target_site || '' })} />
                                                특정 현장
                                            </label>
                                            {!!form.target_site !== false && (
                                                <input
                                                    value={form.target_site}
                                                    onChange={e => updateForm({ target_site: e.target.value })}
                                                    placeholder="현장명 입력"
                                                    style={{ border: '1.5px solid #e2e8f0', height: '32px', padding: '0 10px', fontSize: '0.8125rem', fontWeight: 600, outline: 'none', borderRadius: '6px', width: '160px' }}
                                                    onFocus={e => e.target.style.borderColor = '#1e293b'}
                                                    onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                                                />
                                            )}
                                        </div>
                                        <p style={{ fontSize: '0.625rem', color: '#94a3b8', marginTop: '4px', fontWeight: 600 }}>
                                            * 전체: 모든 현장관리자 + 중앙관리자에게 표시 / 특정 현장: 해당 현장관리자 + 중앙관리자에게만 표시
                                        </p>
                                    </div>
                                )}

                                {/* 에디터 */}
                                <div style={{ flex: 1, marginBottom: '0.75rem', minHeight: '200px' }}>
                                    <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 800, color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>내용</label>
                                    <ReactQuill
                                        theme="snow"
                                        value={form.content}
                                        onChange={val => updateForm({ content: val })}
                                        modules={quillModules}
                                        style={{ height: '220px', marginBottom: '42px' }}
                                        placeholder="내용을 입력하세요..."
                                    />
                                </div>

                                {/* 첨부파일 */}
                                <div style={{ marginBottom: '1rem' }}>
                                    <label style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 800, color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>첨부파일</label>
                                    <input type="file" ref={fileInputRef} onChange={handleFileUpload} style={{ display: 'none' }} />
                                    <button type="button" onClick={() => fileInputRef.current?.click()}
                                        style={{ height: '32px', padding: '0 12px', border: '1.5px solid #e2e8f0', borderRadius: '6px', backgroundColor: '#f8fafc', fontSize: '0.75rem', fontWeight: 700, color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <span className="material-icons" style={{ fontSize: '14px' }}>attach_file</span> 파일 추가
                                    </button>
                                    <p style={{ fontSize: '0.625rem', color: '#94a3b8', marginTop: '4px', fontWeight: 600 }}>* 최대 50MB까지 업로드 가능합니다. (한글 파일명 지원)</p>
                                    {getAttachments(form.attachments).map((att, i) => (
                                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', padding: '4px 8px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px', fontSize: '0.75rem', color: '#475569', fontWeight: 600 }}>
                                            <span className="material-icons" style={{ fontSize: '14px', color: '#94a3b8' }}>attach_file</span>
                                            {att.name} <span style={{ color: '#94a3b8' }}>({formatFileSize(att.size)})</span>
                                            <button type="button" onClick={() => removeAttachment(i)}
                                                style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '0.625rem', fontWeight: 700 }}>✕</button>
                                        </div>
                                    ))}
                                </div>

                                {/* 버튼 */}
                                <div style={{ display: 'flex', gap: '0.75rem' }}>
                                    <button type="button" onClick={() => { setViewMode('list'); resetForm(); }}
                                        style={{ flex: 1, height: '48px', borderRadius: '12px', border: '1.5px solid #e2e8f0', backgroundColor: 'white', fontWeight: 800, fontSize: '0.9375rem', color: '#64748b', cursor: 'pointer' }}>취소</button>
                                    <button type="submit"
                                        style={{ flex: 2, height: '48px', borderRadius: '12px', border: 'none', backgroundColor: '#1e293b', color: 'white', fontWeight: 900, fontSize: '1rem', cursor: 'pointer', boxShadow: '0 4px 12px rgba(30,41,59,0.2)' }}>
                                        {form.id ? '수정하기' : '게시하기'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default BoardView;
