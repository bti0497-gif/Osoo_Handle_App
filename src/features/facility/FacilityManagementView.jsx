import React, { useRef, useState } from 'react';
import { useFacilityViewModel } from './useFacilityViewModel';
import { useDialog } from '../../components/common/DialogContext';

const TODAY = () => new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
}).format(new Date());

const emptyDraft = () => ({ id: null, date: TODAY(), title: '', content: '', photo_count: 0 });

const FacilityManagementView = ({ currentUser }) => {
    const { showAlert, showConfirm } = useDialog();
    const vm = useFacilityViewModel();
    const [searchInput, setSearchInput] = useState('');
    const [editorOpen, setEditorOpen] = useState(false);
    const [draft, setDraft] = useState(emptyDraft);
    const [draftPhotos, setDraftPhotos] = useState([]);
    const [saving, setSaving] = useState(false);
    const [photoBusyId, setPhotoBusyId] = useState(null);
    const [quickPhotoTargetId, setQuickPhotoTargetId] = useState(null);
    const quickPhotoInputRef = useRef(null);

    const openNew = () => {
        setDraft(emptyDraft());
        setDraftPhotos([]);
        setEditorOpen(true);
    };

    const openRecord = (row) => {
        setDraft({
            id: row.id,
            date: row.date || TODAY(),
            title: row.title || '',
            content: row.content || '',
            photo_count: Number(row.photo_count) || 0,
        });
        setDraftPhotos([]);
        setEditorOpen(true);
    };

    const closeEditor = () => {
        if (saving) return;
        setEditorOpen(false);
        setDraft(emptyDraft());
        setDraftPhotos([]);
    };

    const saveRecord = async () => {
        if (!draft.date) {
            await showAlert('날짜를 선택해 주세요.');
            return;
        }
        if (!String(draft.title || '').trim()) {
            await showAlert('제목에 업무 상황을 기록해 주세요.');
            return;
        }

        setSaving(true);
        try {
            const payload = {
                date: draft.date,
                title: String(draft.title || '').trim(),
                content: String(draft.content || '').trim(),
                location: '',
                notes: '',
                author: currentUser?.name || '',
            };
            let recordId = draft.id;
            if (recordId) {
                await vm.updateLog(recordId, payload);
            } else {
                const created = await vm.createLog(payload);
                recordId = created?.id;
            }
            if (recordId && draftPhotos.length > 0) {
                await vm.uploadPhotos(recordId, draftPhotos);
            }
            setEditorOpen(false);
            setDraft(emptyDraft());
            setDraftPhotos([]);
        } catch (error) {
            await showAlert(`업무 기록 저장 실패: ${error.message}`);
        } finally {
            setSaving(false);
        }
    };

    const deleteRecord = async () => {
        if (!draft.id) return;
        const confirmed = await showConfirm('이 업무 기록과 저장된 로컬 사진을 삭제하시겠습니까?', '삭제 확인');
        if (!confirmed) return;
        setSaving(true);
        try {
            await vm.deleteLog(draft.id);
            setEditorOpen(false);
            setDraft(emptyDraft());
            setDraftPhotos([]);
        } catch (error) {
            await showAlert(`업무 기록 삭제 실패: ${error.message}`);
        } finally {
            setSaving(false);
        }
    };

    const openPhotoFolder = async (row) => {
        if (photoBusyId) return;
        setPhotoBusyId(row.id);
        try {
            await vm.openPhotoFolder(row.id);
        } catch (error) {
            await showAlert(`사진 폴더를 열 수 없습니다: ${error.message}`);
        } finally {
            setPhotoBusyId(null);
        }
    };

    const handleListPhotoClick = (row) => {
        if (Number(row.photo_count) > 0) {
            openPhotoFolder(row);
            return;
        }
        setQuickPhotoTargetId(row.id);
        quickPhotoInputRef.current?.click();
    };

    const uploadQuickPhotos = async (event) => {
        const files = Array.from(event.target.files || []);
        event.target.value = '';
        const recordId = quickPhotoTargetId;
        setQuickPhotoTargetId(null);
        if (!recordId || files.length === 0) return;
        setPhotoBusyId(recordId);
        try {
            await vm.uploadPhotos(recordId, files);
        } catch (error) {
            await showAlert(`사진 저장 실패: ${error.message}`);
        } finally {
            setPhotoBusyId(null);
        }
    };

    return (
        <div style={{ width: '100%', height: '100%', padding: '1.5rem', boxSizing: 'border-box', background: '#f8fafc' }}>
            <input
                ref={quickPhotoInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={uploadQuickPhotos}
                style={{ display: 'none' }}
            />

            <section style={{
                width: 'min(100%, 1000px)',
                height: '100%',
                background: '#fff',
                border: '1px solid #dbe3ec',
                borderRadius: 10,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                boxShadow: '0 2px 8px rgba(15, 23, 42, 0.05)',
            }}>
                <header style={{ padding: '18px 22px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: 20, color: '#1e293b' }}>업무사진관리</h2>
                        <p style={{ margin: '5px 0 0', fontSize: 12, color: '#64748b' }}>이 현장 컴퓨터에만 저장되는 사진 기록 게시판입니다.</p>
                    </div>
                    <button type="button" onClick={openNew} style={{ height: 36, padding: '0 16px', border: 0, borderRadius: 7, background: '#1e293b', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>글쓰기</button>
                </header>

                <div style={{ display: 'grid', gridTemplateColumns: '130px minmax(0, 1fr) 92px', background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', color: '#334155', fontSize: 12, fontWeight: 800 }}>
                    <div style={{ padding: '10px 12px', textAlign: 'center', borderRight: '1px solid #dbe3ec' }}>날짜</div>
                    <div style={{ padding: '10px 14px', borderRight: '1px solid #dbe3ec' }}>제목</div>
                    <div style={{ padding: '10px 12px', textAlign: 'center' }}>사진</div>
                </div>

                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {vm.loading ? (
                        <div style={{ padding: 36, textAlign: 'center', color: '#94a3b8' }}>불러오는 중...</div>
                    ) : vm.logs.length === 0 ? (
                        <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>저장된 업무 기록이 없습니다.</div>
                    ) : vm.logs.map((row, index) => {
                        const hasPhotos = Number(row.photo_count) > 0;
                        const photoBusy = photoBusyId === row.id;
                        return (
                            <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '130px minmax(0, 1fr) 92px', minHeight: 44, background: index % 2 === 0 ? '#fff' : '#fcfdff', borderBottom: '1px solid #e2e8f0' }}>
                                <div style={{ padding: '0 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid #edf2f7', fontSize: 12, color: '#64748b' }}>{row.date}</div>
                                <button
                                    type="button"
                                    onClick={() => openRecord(row)}
                                    style={{ padding: '0 14px', border: 0, borderRight: '1px solid #edf2f7', background: 'transparent', textAlign: 'left', color: '#1e293b', fontSize: 13, fontWeight: 700, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                    title={row.title || ''}
                                >
                                    {row.title || '(제목 없음)'}
                                </button>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <button
                                        type="button"
                                        disabled={photoBusy}
                                        onClick={() => handleListPhotoClick(row)}
                                        title={hasPhotos ? '저장된 사진 폴더 열기' : '사진 추가'}
                                        style={{
                                            minWidth: 58,
                                            height: 27,
                                            border: `1px solid ${hasPhotos ? '#15803d' : '#94a3b8'}`,
                                            borderRadius: 6,
                                            background: hasPhotos ? '#16a34a' : '#fff',
                                            color: hasPhotos ? '#fff' : '#475569',
                                            fontSize: 11,
                                            fontWeight: 800,
                                            cursor: photoBusy ? 'wait' : 'pointer',
                                        }}
                                    >
                                        {photoBusy ? '처리 중' : (hasPhotos ? `사진 ${row.photo_count}` : '사진')}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <footer style={{ padding: '10px 14px', borderTop: '1px solid #dbe3ec', background: '#f8fafc', display: 'flex', alignItems: 'center', gap: 7 }}>
                    <input
                        value={searchInput}
                        onChange={(event) => setSearchInput(event.target.value)}
                        onKeyDown={(event) => { if (event.key === 'Enter') vm.handleSearch(searchInput); }}
                        placeholder="제목 또는 본문 검색"
                        style={{ width: 250, height: 31, padding: '0 10px', border: '1px solid #cbd5e1', borderRadius: 6, outline: 'none', fontSize: 12 }}
                    />
                    <button type="button" onClick={() => vm.handleSearch(searchInput)} style={{ height: 31, padding: '0 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', fontWeight: 700, cursor: 'pointer' }}>검색</button>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b' }}>총 {vm.logs.length}건 · 로컬 전용</span>
                </footer>
            </section>

            {editorOpen && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 15000, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
                    <div style={{ width: 'min(680px, calc(100vw - 24px))', maxHeight: 'calc(100vh - 24px)', overflow: 'hidden', background: '#fff', borderRadius: 10, boxShadow: '0 24px 60px rgba(15, 23, 42, 0.3)', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                            <h3 style={{ margin: 0, fontSize: 16, color: '#1e293b' }}>{draft.id ? '업무 기록 수정' : '업무 기록 작성'}</h3>
                            <button type="button" onClick={closeEditor} disabled={saving} style={{ border: 0, background: 'transparent', fontSize: 24, color: '#64748b', cursor: 'pointer' }}>×</button>
                        </div>
                        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', minHeight: 0 }}>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 170, fontSize: 11, fontWeight: 800, color: '#475569' }}>
                                날짜
                                <input type="date" value={draft.date} onChange={(event) => setDraft((previous) => ({ ...previous, date: event.target.value }))} style={{ height: 34, padding: '0 9px', border: '1px solid #cbd5e1', borderRadius: 6 }} />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 800, color: '#475569' }}>
                                제목
                                <input autoFocus value={draft.title} onChange={(event) => setDraft((previous) => ({ ...previous, title: event.target.value }))} placeholder="업무 중 발생한 상황을 제목에 기록하세요." style={{ height: 38, padding: '0 11px', border: '1px solid #94a3b8', borderRadius: 6, fontSize: 13, fontWeight: 700, outline: 'none' }} />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 800, color: '#475569' }}>
                                본문 <span style={{ fontWeight: 500, color: '#94a3b8' }}>(필요한 경우에만 작성)</span>
                                <textarea value={draft.content} onChange={(event) => setDraft((previous) => ({ ...previous, content: event.target.value }))} rows={4} placeholder="제목으로 설명이 부족할 때만 세부 내용을 작성하세요." style={{ minHeight: 80, maxHeight: 150, padding: 10, border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12, lineHeight: 1.5, resize: 'vertical', outline: 'none' }} />
                            </label>
                            <div style={{ padding: 10, border: '1px dashed #94a3b8', borderRadius: 7, background: '#f8fafc' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <label style={{ padding: '8px 13px', borderRadius: 6, background: '#e2e8f0', color: '#334155', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                                        사진 선택
                                        <input type="file" accept="image/*" multiple onChange={(event) => setDraftPhotos(Array.from(event.target.files || []))} style={{ display: 'none' }} />
                                    </label>
                                    <span style={{ fontSize: 12, color: '#64748b' }}>
                                        {draftPhotos.length > 0 ? `${draftPhotos.length}개 선택됨` : (draft.photo_count > 0 ? `저장된 사진 ${draft.photo_count}개` : '선택된 사진 없음')}
                                    </span>
                                    {draft.id && draft.photo_count > 0 && (
                                        <button type="button" onClick={() => openPhotoFolder(draft)} style={{ marginLeft: 'auto', height: 31, padding: '0 11px', border: '1px solid #15803d', borderRadius: 6, background: '#16a34a', color: '#fff', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>사진 폴더 열기</button>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div style={{ padding: '10px 16px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: 8, background: '#f8fafc', flexShrink: 0 }}>
                            {draft.id && <button type="button" onClick={deleteRecord} disabled={saving} style={{ marginRight: 'auto', height: 35, padding: '0 13px', border: '1px solid #fecaca', borderRadius: 6, background: '#fff', color: '#dc2626', fontWeight: 800, cursor: 'pointer' }}>삭제</button>}
                            <button type="button" onClick={closeEditor} disabled={saving} style={{ height: 35, padding: '0 15px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', color: '#475569', fontWeight: 700, cursor: 'pointer' }}>취소</button>
                            <button type="button" onClick={saveRecord} disabled={saving} style={{ height: 35, padding: '0 18px', border: 0, borderRadius: 6, background: '#1e293b', color: '#fff', fontWeight: 800, cursor: saving ? 'wait' : 'pointer' }}>{saving ? '저장 중...' : '저장'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default FacilityManagementView;
